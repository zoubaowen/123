import COS from 'cos-nodejs-sdk-v5'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { ArtifactStore, ToolProvider } from './ports.js'

/**
 * 媒体产物的对象存储配置（腾讯云 COS）。
 *
 * 火山方舟返回的是约 24 小时失效的签名链接，学生作品必须转存到我们自己可控的存储，
 * 否则第二天链接就 404。四个必填项缺任何一个都返回 null —— 此时不做转存、保留上游链接，
 * 而不是伪造一个长期地址。
 */
export interface ArtifactStoreEnvironment {
  readonly secretId: string
  readonly secretKey: string
  readonly bucket: string
  readonly region: string
  readonly prefix: string
  readonly domain: string | null
  readonly timeoutMs: number
}

const DEFAULT_PREFIX = 'xiaobao-artifacts'
const DEFAULT_TIMEOUT_MS = 60_000

const requiredText = z.string().trim().min(1)

function isCleanHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

const environmentSchema = z.object({
  XIAOBAO_ARTIFACT_COS_SECRET_ID: requiredText,
  XIAOBAO_ARTIFACT_COS_SECRET_KEY: requiredText,
  XIAOBAO_ARTIFACT_COS_BUCKET: requiredText,
  XIAOBAO_ARTIFACT_COS_REGION: requiredText,
  XIAOBAO_ARTIFACT_COS_PREFIX: z.preprocess(
    (value) => (value === undefined || value === '' ? DEFAULT_PREFIX : value),
    requiredText,
  ),
  XIAOBAO_ARTIFACT_COS_DOMAIN: z.preprocess(
    (value) => (value === undefined || value === '' ? null : value),
    z
      .string()
      .trim()
      .refine((value) => isCleanHttpUrl(value))
      .nullable(),
  ),
  XIAOBAO_ARTIFACT_COS_TIMEOUT_MS: z.preprocess(
    (value) => (value === undefined || value === '' ? DEFAULT_TIMEOUT_MS : Number(value)),
    z.number().int().positive(),
  ),
})

export function loadArtifactStoreEnvironment(
  environment: Record<string, string | undefined> = process.env,
): ArtifactStoreEnvironment | null {
  const parsed = environmentSchema.safeParse(environment)
  if (!parsed.success) return null
  return {
    secretId: parsed.data.XIAOBAO_ARTIFACT_COS_SECRET_ID,
    secretKey: parsed.data.XIAOBAO_ARTIFACT_COS_SECRET_KEY,
    bucket: parsed.data.XIAOBAO_ARTIFACT_COS_BUCKET,
    region: parsed.data.XIAOBAO_ARTIFACT_COS_REGION,
    prefix: parsed.data.XIAOBAO_ARTIFACT_COS_PREFIX,
    domain: parsed.data.XIAOBAO_ARTIFACT_COS_DOMAIN,
    timeoutMs: parsed.data.XIAOBAO_ARTIFACT_COS_TIMEOUT_MS,
  }
}

/** 公开访问前缀：优先使用配置的 CDN/自定义域名，否则回退到 COS 默认域名。 */
export function artifactPublicUrlBase(environment: ArtifactStoreEnvironment): string {
  const base = environment.domain ?? `https://${environment.bucket}.cos.${environment.region}.myqcloud.com`
  return base.replace(/\/+$/, '')
}

export interface ArtifactUploader {
  put(key: string, body: Buffer, contentType: string | undefined): Promise<boolean>
}

interface CosLikeClient {
  putObject(params: Record<string, unknown>, callback: (error: unknown) => void): void
}

/** COS 上传器：SDK 调用被包到 `{ ok }` 结果里，失败不抛错、不透传上游错误文本。 */
export function createCosArtifactUploader(
  environment: ArtifactStoreEnvironment,
  cosFactory: (options: { SecretId: string; SecretKey: string }) => CosLikeClient = (options) =>
    new COS(options) as unknown as CosLikeClient,
): ArtifactUploader {
  const client = cosFactory({ SecretId: environment.secretId, SecretKey: environment.secretKey })

  return {
    async put(key, body, contentType) {
      try {
        await new Promise<void>((resolve, reject) => {
          client.putObject(
            {
              Bucket: environment.bucket,
              Region: environment.region,
              Key: key,
              Body: body,
              ...(contentType ? { ContentType: contentType } : {}),
            },
            (error: unknown) => (error ? reject(error) : resolve()),
          )
        })
        return true
      } catch {
        return false
      }
    },
  }
}

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
})

/**
 * 对象键里的分段只允许安全字符：先消掉连续点（`..` 不能被当成路径段），
 * 再把其余非法字符替换掉，最后去掉前导点与长度上限。
 */
function safeSegment(value: string): string {
  return value
    .replace(/\.{2,}/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^\.+/, '-')
    .slice(0, 64)
}

export function buildArtifactKey(
  prefix: string,
  request: { taskId: string; kind: string },
  contentType: string | undefined,
  id: string,
): string {
  const extension =
    (contentType ? EXTENSION_BY_CONTENT_TYPE[contentType.split(';')[0]!.trim().toLowerCase()] : '') ?? ''
  return `${safeSegment(prefix)}/${safeSegment(request.taskId)}/${safeSegment(request.kind)}-${safeSegment(id)}${extension}`
}

export interface ArtifactStoreOptions {
  readonly uploader: ArtifactUploader
  /** 不带尾斜杠的公开前缀，见 `artifactPublicUrlBase`。 */
  readonly publicUrlBase: string
  readonly prefix: string
  readonly timeoutMs?: number
  readonly fetchImplementation?: typeof fetch
  readonly idFactory?: () => string
}

/**
 * 对象存储转存实现：下载上游产物 → 上传到自有存储 → 返回长期地址。
 *
 * 任何环节失败（下载失败、空产物、上传失败、超时、网络异常）都返回 `{ ok: false }`，
 * 由调用方退回上游 URL —— 学生至少还能立刻看到作品，同时不会把临时链接当成长期地址。
 */
export function createArtifactStore(options: ArtifactStoreOptions): ArtifactStore {
  const fetchImplementation = options.fetchImplementation ?? fetch
  const idFactory = options.idFactory ?? (() => nanoid(12))
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    async mirror(request) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImplementation(request.sourceUrl, { signal: controller.signal })
        if (!response.ok) {
          if (response.body) await response.body.cancel().catch(() => undefined)
          return { ok: false }
        }
        const contentType = response.headers.get('content-type') ?? undefined
        const body = Buffer.from(await response.arrayBuffer())
        // 0 字节当作失败：写入空对象只会掩盖上游异常。
        if (body.byteLength === 0) return { ok: false }

        const key = buildArtifactKey(options.prefix, request, contentType, idFactory())
        if (!(await options.uploader.put(key, body, contentType))) return { ok: false }
        return { ok: true, url: `${options.publicUrlBase}/${key}` }
      } catch {
        return { ok: false }
      } finally {
        clearTimeout(timeout)
      }
    },

    async healthCheck() {
      return Boolean(options.uploader && options.publicUrlBase)
    },
  }
}

function readArtifactUrl(output: unknown): string | undefined {
  if (!output || typeof output !== 'object') return undefined
  const url = (output as { url?: unknown }).url
  return typeof url === 'string' && url.trim() !== '' ? url : undefined
}

/**
 * 给工具 Provider 加上产物转存：工具成功返回一个 `url` 时，尝试转存并替换为长期地址。
 *
 * - `store` 为 null 时原样返回 provider（未配置对象存储 ⇒ 行为与今天完全一致）；
 * - 转存失败时保留上游 URL，且**不**修改 observation 的其他字段；
 * - 非 URL 产物（如沙箱命令输出）直接透传，不做任何猜测式深挖。
 */
export function withArtifactStore(provider: ToolProvider, store: ArtifactStore | null): ToolProvider {
  if (!store) return provider

  return {
    name: provider.name,
    healthCheck: () => provider.healthCheck(),

    async execute(input, signal) {
      const observation = await provider.execute(input, signal)
      if (!observation.ok) return observation

      const sourceUrl = readArtifactUrl(observation.output)
      if (!sourceUrl) return observation

      const mirrored = await store.mirror({
        taskId: input.taskId,
        sourceUrl,
        kind: input.action.toolName,
      })
      if (!mirrored.ok) return observation

      return {
        ...observation,
        output: { ...(observation.output as Record<string, unknown>), url: mirrored.url },
      }
    },
  }
}
