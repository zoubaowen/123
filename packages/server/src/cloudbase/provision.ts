import { createHash } from 'crypto'
import { nanoid } from 'nanoid'
import tencentcloud from 'tencentcloud-sdk-nodejs'

const CamClient = tencentcloud.cam.v20190116.Client
const TcbClient = tencentcloud.tcb.v20180608.Client
const TagClient = (tencentcloud as any).tag.v20180813.Client

// 鈹€鈹€鈹€ Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface PolicyBuildParams {
  envId: string
  region: string
  ownerUin: string
  cosTagValue: string
}

export interface ProvisionResult {
  envId: string
  envAlias: string
  envRegion: string
  cosTagValue: string
  policyHash: string
  camUsername: string
  camSecretId: string
  camSecretKey?: string
  policyId: number
}

// 鈹€鈹€鈹€ Policy Builders 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * 鏋勫缓鐢ㄦ埛鐜鐨?CAM 绛栫暐 statement锛堢簿纭?ARN 鐗堟湰锛? * 鍦?provision锛堝垱寤烘案涔呯瓥鐣ワ級鍜?auth锛堢鍙戜复鏃跺瘑閽ワ級涓鐢? */
export function buildUserEnvPolicyStatements(params: PolicyBuildParams) {
  const { envId, region, ownerUin, cosTagValue } = params

  // 娉ㄦ剰锛氳吘璁簯 STS GetFederationToken 瀵瑰崟 statement 鐨?action 鏁伴噺鏈変笂闄愶紙绾?40-50锛夈€?  // 杩欓噷鎶婂叏灞€鍙/绠＄悊 action 鎷嗘垚澶氫釜 statement锛堟瘡涓?鈮?30锛夛紝浠ヤ究姝?policy 鏃㈣兘
  // 鍐欏叆 CAM 鑷畾涔夌瓥鐣ワ紝涔熻兘鐩存帴浣滀负 inline policy 浼犵粰 STS GetFederationToken銆?
  return [
    // Statement 1a: cam / cdn / organization / lowcode 鍙
    {
      action: [
        'cam:CreateRole',
        'cam:AttachRolePolicy',
        'cam:ListAttachedRolePolicies',
        'cam:UpdatePolicy',
        'cam:CreateServiceLinkedRole',
        'cam:DescribeServiceLinkedRole',
        'cam:GetRole',

        'cdn:TcbCheckResource',
        'organization:DescribeCloudApplicationToMember',

        'tcbr:DescribeArchitectureType',
        'tcbr:DescribeUserServiceTermsRecord',

        'lowcode:GetUserCertifyInfo',
        'lowcode:DescribeUserCompositeGroupsList',
        'lowcode:DescribeWedaWxBind',
        'lowcode:GetMaxAppNum',
        'lowcode:DescribeApps',

        'ssl:DescribeCertificateDetail',
        'ssl:DescribeCertificates',
      ],
      effect: 'allow',
      resource: ['*'],
    },
    // Statement 1b: tcb 鍏冧俊鎭?/ 璐︽埛 / 閫氱敤璁¤垂鏌ヨ
    {
      action: [
        'tcb:CheckTcbService',
        'tcb:DescribePackages',
        'tcb:DescribeEnvLimit',
        'tcb:DescribeBillingInfo',
        'tcb:DescribeExt*',
        'tcb:DescribeCloudBaseRunAdvancedConfiguration',
        'tcb:DescribePostPackage',
        'tcb:DescribeICPResources',
        'tcb:DescribeMonitorMetric',
        'tcb:DescribeLowCodeUserQuotaUsage',
        'tcb:DescribeEnvStatistics',
        'tcb:DescribeLowCodeEnvQuotaUsage',
        'tcb:CheckFeaturePermission',
        'tcb:DescribeCommonBillingResources',
        'tcb:DescribeCommonBillingPackages',
        'tcb:DescribeAgentList',
        'tcb:DescribeTenant',
        'tcb:GetTemplateAPIsList',
        'tcb:GetApisGroupAndList',
        'tcb:GetUserKeyList',
        'tcb:DescribeEnvBacklogs',
        'tcb:DescribeEnvRestriction',
        'tcb:DescribeUserPromotionalActivity',
        'tcb:DescribeFeaturePermissions',
        'tcb:RefreshAuthDomain',
        'tcb:DescribeActivityInfo',
        'tcb:DescribeTcbAccountInfo',
      ],
      effect: 'allow',
      resource: ['*'],
    },
    // Statement 1c: tcb 妯℃澘 / 鏁版嵁搴?/ 鍑芥暟锛圕AM 浠ヤ富璐﹀彿閴存潈锛屽繀椤?resource: *锛?
    {
      action: [
        'tcb:DescribeAIModels',
        'tcb:DescribeOperationAppTemplates',
        'tcb:DescribeSolutionList',
        'tcb:DescribeCloudBaseRunBaseImages',
        'tcb:DescribeBuildServiceList',

        'tcb:DeleteTable',
        'tcb:CreateTable',
        'tcb:DescribeTable',
        'tcb:DescribeTables',
        'tcb:ListTables',
        'tcb:RunCommands',
        'tcb:UpdateTable',
        'tcb:UpdateItem',
        'tcb:QueryRecords',
        'tcb:PutItem',
        'tcb:ModifyNameSpace',
        'tcb:DeleteItem',
        'tcb:CountRecords',
        'tcb:DescribeRestoreTime',
        'tcb:RestoreTCBTables',
        'tcb:DescribeRestoreTask',
        'tcb:DescribeRestoreTables',

        'tcb:CreateFunction',
        'tcb:UpdateFunctionCode',
        'tcb:UpdateFunctionIncrementalCode',
        'tcb:GetFunctionLogsStatus',
        'tcb:GetFunctionLogDetail',
        'tcb:GetFunctionLogs',
      ],
      effect: 'allow',
      resource: ['*'],
    },
    // Statement 2: tcb:* 闄愬畾鍒扮幆澧?
    {
      action: ['tcb:*'],
      effect: 'allow',
      resource: [`qcs::tcb:${region}:uin/${ownerUin}:env/${envId}`],
    },
    // Statement 3: tcbr:* 闄愬畾鍒扮幆澧?
    {
      action: ['tcbr:*'],
      effect: 'allow',
      resource: [`qcs::tcbr:${region}:uin/${ownerUin}:env/${envId}`],
    },
    // Statement 4: lowcode:* 闄愬畾鍒扮幆澧?
    {
      action: ['lowcode:*'],
      effect: 'allow',
      resource: [`qcs::lowcode::uin/${ownerUin}:env/${envId}`],
    },
    // Statement 5: scf:* 闄愬畾鍒?namespace锛坣amespace = envId锛?
    {
      action: ['scf:*'],
      effect: 'allow',
      resource: [`qcs::scf:${region}:uin/${ownerUin}:namespace/${envId}/function/*`],
    },
    // Statement 6: cos:* 閫氳繃 tag condition 闅旂
    {
      action: ['cos:*'],
      effect: 'allow',
      resource: ['*'],
      condition: {
        'for_any_value:string_equal': {
          'qcs:resource_tag': [`vibe-env&${cosTagValue}`],
        },
      },
    },
  ]
}

/**
 * STS GetFederationToken inline policy 涓撶敤锛堝厹搴曪級
 *
 * 鈿狅笍 鐜扮姸璇存槑锛? *   鏀拺瀵嗛挜锛圱CB_SECRET_ID/KEY锛夊綋鍓嶆槸瀛愯处鍙疯韩浠姐€傝吘璁簯瀵瑰瓙璐﹀彿璋? *   GetFederationToken 鏈夊钁╅檺鍒讹細
 *   - inline policy 涓鏋滃惈 `qcs::tcb:region:uin/<涓昏处鍙?uin>:env/...` 杩欑
 *     ARN锛岀鍑烘潵鐨?token 璋?tcb 鎺ュ彛浼氳鏈嶅姟绔垽 invalid token锛堝嵆渚?grant
 *     鎴愬姛锛夛紱
 *   - 鍗充娇 ARN 鍐?`*`锛屽彧瑕?action 鍒楀嚭 `tcb:*`銆乣tcbr:*` 绛夊叿浣撴湇鍔★紝token
 *     璋?tcb 鎺ュ彛浠嶄細 invalid锛堣瀹炴祴锛夛紱
 *   - 鍞竴鑳借 token 鐪熸鍙敤鐨?inline 鍐欐硶锛歚{ action: ['*'], resource: ['*'] }`
 *
 * 鎹㈠彞璇濊锛宨nline policy 鍦ㄥ瓙璐﹀彿鏀拺瀵嗛挜绛惧彂鍦烘櫙涓?*鍋氫笉鍒?envId 鏀剁揣**銆? * 鐪熸鐨?envId 闅旂宸茬粡鍦?provision 闃舵閫氳繃 buildUserEnvPolicyStatements
 * 鍐欏埌浜嗘瘡涓敤鎴风殑 CAM 瀛愯处鍙峰ぇ policy 涓?鈥斺€?middleware 浼樺厛鐢?user_resources
 * 琛ㄩ噷鐨勬案涔呭瘑閽ワ紙camSecretId/camSecretKey锛夎蛋 permanent 鍒嗘敮锛? * 杩欓噷鍙槸 user_resources 娌℃湁姘镐箙瀵嗛挜鏃剁殑鍏滃簳锛岀鍙戝嚭鏉ョ殑涓存椂鍑瘉鏈夋晥浣? * 娌″仛闅旂鏀剁揣锛堜笌鏀拺璐﹀彿鏈韩鏉冮檺涓€鑷达級銆? *
 * 鍚庣画濡傛灉鏀拺璐﹀彿鎹㈡垚涓昏处鍙?root 瀵嗛挜鎴栫敵璇峰埌 sts:GetFederationToken 璺?uin
 * grant 鏉冮檺锛屽啀鍥炴潵鍔?envId ARN 闄愬畾銆? */
export function buildStsInlinePolicyStatements(_params: PolicyBuildParams) {
  return [{ action: ['*'], effect: 'allow', resource: ['*'] }]
}
// 鈹€鈹€鈹€ Helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function getClients() {
  const credential = {
    secretId: process.env.TCB_SECRET_ID || process.env.TENCENT_SECRET_ID || '',
    secretKey: process.env.TCB_SECRET_KEY || process.env.TENCENT_SECRET_KEY || '',
    token: process.env.TCB_TOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN || '',
  }

  const camClient = new CamClient({
    credential,
    region: '',
    profile: { httpProfile: { endpoint: 'cam.tencentcloudapi.com' } },
  })

  const tcbClient = new TcbClient({
    credential,
    region: process.env.TCB_REGION || 'ap-shanghai',
    profile: { httpProfile: { endpoint: 'tcb.tencentcloudapi.com' } },
  })

  const tagClient = new TagClient({
    credential,
    region: process.env.TCB_REGION || 'ap-shanghai',
  })

  return { camClient, tcbClient, tagClient }
}

/**
 * 鑾峰彇涓昏处鍙?UIN
 * 浼樺厛绾э細鐜鍙橀噺 TENCENTCLOUD_ACCOUNT_ID > STS.GetCallerIdentity 鑷姩鑾峰彇
 * 鑾峰彇鎴愬姛鍚庡啓鍥?process.env锛屽悗缁洿鎺ヨ鍙栫幆澧冨彉閲忓嵆鍙? */
async function getOwnerUin(): Promise<string> {
  // 1. 鐜鍙橀噺宸叉湁
  if (process.env.TENCENTCLOUD_ACCOUNT_ID) {
    return process.env.TENCENTCLOUD_ACCOUNT_ID
  }

  // 2. 閫氳繃 STS.GetCallerIdentity 鍙嶆煡
  const secretId = process.env.TCB_SECRET_ID || process.env.TENCENT_SECRET_ID || ''
  const secretKey = process.env.TCB_SECRET_KEY || process.env.TENCENT_SECRET_KEY || ''
  if (!secretId || !secretKey) {
    throw new Error('[provision] Cannot determine ownerUin: no TENCENTCLOUD_ACCOUNT_ID and no TCB_SECRET_ID/KEY')
  }

  try {
    const StsClient = (tencentcloud as any).sts.v20180813.Client
    const stsClient = new StsClient({
      credential: { secretId, secretKey },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'sts.tencentcloudapi.com' } },
    })
    const resp = await stsClient.GetCallerIdentity({})
    if (resp?.AccountId) {
      // 鍐欏洖鐜鍙橀噺锛屽悗缁墍鏈夎鍙栧鑷姩鑾风泭
      process.env.TENCENTCLOUD_ACCOUNT_ID = resp.AccountId
      console.log('[provision] Resolved ownerUin via STS')
      return resp.AccountId
    }
  } catch (e: any) {
    console.error('[provision] STS.GetCallerIdentity failed')
  }

  throw new Error('[provision] Cannot determine ownerUin: TENCENTCLOUD_ACCOUNT_ID not set and STS lookup failed')
}

export function computePolicyHash(policyDocument: string): string {
  return createHash('md5').update(policyDocument).digest('hex')
}

/**
 * 鐢熸垚 COS tag value 骞跺湪 Tag 鏈嶅姟涓鍒涘缓
 * 鏍煎紡: vibe-${userId.slice(0,12)}-${nanoid(4)}
 */
async function createCosTag(tagClient: any, userId: string): Promise<string> {
  const tagValue = `vibe-${userId.slice(0, 12)}-${nanoid(4)}`

  try {
    await tagClient.CreateTag({ TagKey: 'vibe-env', TagValue: tagValue })
    console.log('[provision] Created COS tag')
  } catch (e: any) {
    // Tag already exists is idempotent
    if (e?.message?.includes('existed') || e?.message?.includes('Existed')) {
      console.log('[provision] COS tag already exists')
    } else {
      throw e
    }
  }

  return tagValue
}

/**
 * 杞绛夊緟 CloudBase 鐜灏辩华
 */
async function waitForEnvReady(
  tcbClient: any,
  envId: string,
  timeoutMs = 120_000,
  intervalMs = 5_000,
): Promise<{ region: string; alias: string }> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const resp = await tcbClient.DescribeEnvs({ EnvId: envId })
      const env = resp.EnvList?.[0]
      if (env?.Status === 'NORMAL') {
        return {
          region: env.Region || process.env.TCB_REGION || 'ap-shanghai',
          alias: env.Alias || '',
        }
      }
      // 鍙湁鏄庣‘鐨?ERROR 鐘舵€佹墠瑙嗕负缁堟€佸け璐?      // UNAVAILABLE / INITIALIZING 绛夐兘瑙嗕负涓棿鐘舵€侊紝缁х画绛夊緟
      if (env?.Status === 'ERROR') {
        throw new Error(`Env ${envId} entered terminal status: ${env.Status}`)
      }
      console.log('[provision] Waiting for env status')
    } catch (e: any) {
      // DescribeEnvs may fail transiently during creation
      if (e?.message?.includes('terminal status')) throw e
      console.log('[provision] DescribeEnvs transient error')
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }

  throw new Error(`Env ${envId} did not reach NORMAL within ${timeoutMs / 1000}s`)
}

function generatePassword(length = 16): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lower = 'abcdefghijklmnopqrstuvwxyz'
  const digits = '0123456789'
  const special = '!@#$%^&*()-_=+'
  const all = upper + lower + digits + special

  const password: string[] = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    special[Math.floor(Math.random() * special.length)],
  ]

  for (let i = password.length; i < length; i++) {
    password.push(all[Math.floor(Math.random() * all.length)])
  }

  for (let i = password.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[password[i], password[j]] = [password[j], password[i]]
  }

  return password.join('')
}

// 鈹€鈹€鈹€ Main Provision Flow 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * 涓虹敤鎴?浠诲姟鍒涘缓 CloudBase 璧勬簮锛? * 1. CAM 瀛愯处鍙?+ API 瀵嗛挜
 * 2. COS Tag锛堢敤浜?bucket 闅旂锛? * 3. CloudBase 鐜锛堝甫 Tags锛? * 4. 绛夊緟鐜灏辩华
 * 5. 鏉冮檺绛栫暐锛堢簿纭?ARN + tag condition锛? *
 * scope 鍖哄垎锛? *   - 涓嶄紶 taskId 鈫?user 绾э紝CAM username = `vibe_{userId}`锛屾瘡涓?user 涓€涓?CAM 瀛愯处鍙? *   - 浼?taskId   鈫?task 绾э紝CAM username = `vibe_t_{taskId}`锛屾瘡涓?task 涓€涓嫭绔嬪瓙璐﹀彿
 *     锛堥伩鍏嶅 task 鍏辩敤鍚屼竴 CAM user 鏃?AccessKey 浜掔浉杞崲瑕嗙洊锛? */
export async function provisionUserResources(
  userId: string,
  username: string,
  options?: { taskId?: string },
): Promise<ProvisionResult> {
  const { camClient, tcbClient, tagClient } = getClients()
  const ownerUin = await getOwnerUin()
  let currentStep = 'cam_user'

  try {
    // 鈹€鈹€鈹€ 姝ラ 1锛氬垱寤?CAM 瀛愯处鍙?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    currentStep = 'cam_user'
    // task 绾э細鐢?taskId 娲剧敓鐙珛 CAM 鐢ㄦ埛鍚嶏紱鍚﹀垯鐢?userId锛堜繚鎸?user 绾ц涓轰笉鍙橈級
    const camUsername = options?.taskId
      ? `vibe_t_${options.taskId.substring(0, 18)}`
      : `vibe_${userId.substring(0, 20)}`
    let subAccountUin: number
    let camSecretId: string = ''
    let camSecretKey: string = ''

    try {
      console.log('[provision] Checking existing CAM user')
      const getUserResp = await (camClient as any).GetUser({ Name: camUsername })
      subAccountUin = getUserResp.Uin
      // 瀛愯处鍙峰凡瀛樺湪锛岀‘淇濇湁 API 瀵嗛挜
      const listKeysResp = await (camClient as any).ListAccessKeys({ TargetUin: subAccountUin })
      const activeKeys = (listKeysResp.AccessKeys || []).filter((k: any) => k.Status === 'Active')
      if (activeKeys.length > 0) {
        // 宸叉湁瀵嗛挜浣?SecretKey 涓嶅彲鎭㈠锛岄渶瑕佽疆鎹?
        for (const k of activeKeys) {
          await (camClient as any).DeleteAccessKey({ TargetUin: subAccountUin, AccessKeyId: k.AccessKeyId })
        }
      }
      const createKeyResp = await (camClient as any).CreateAccessKey({ TargetUin: subAccountUin })
      camSecretId = createKeyResp.AccessKey.AccessKeyId
      camSecretKey = createKeyResp.AccessKey.SecretAccessKey
      console.log('[provision] Reused existing CAM user, rotated key')
    } catch {
      // 鍒涘缓鏂板瓙璐﹀彿锛圓ddUser + UseApi=1 鐩存帴杩斿洖 AK/SK锛?      console.log('[provision] Creating CAM user')
      const password = generatePassword()
      const addUserResp = await (camClient as any).AddUser({
        Name: camUsername,
        Remark: `coder user ${userId} ${username}`,
        ConsoleLogin: 0,
        Password: password,
        NeedResetPassword: 0,
        UseApi: 1,
      })
      subAccountUin = addUserResp.Uin
      if (addUserResp.SecretId) {
        camSecretId = addUserResp.SecretId
        camSecretKey = addUserResp.SecretKey
      } else {
        // Fallback: AddUser 鏈繑鍥炲瘑閽ワ紝鍗曠嫭鍒涘缓
        const createKeyResp = await (camClient as any).CreateAccessKey({ TargetUin: subAccountUin })
        camSecretId = createKeyResp.AccessKey.AccessKeyId
        camSecretKey = createKeyResp.AccessKey.SecretAccessKey
      }
    }

    // 鈹€鈹€鈹€ 姝ラ 2锛氬垱寤?COS Tag 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    currentStep = 'cos_tag'
    const cosTagValue = await createCosTag(tagClient, userId)

    // 鈹€鈹€鈹€ 姝ラ 3锛氬垱寤?CloudBase 鐜 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    currentStep = 'create_env'
    const envAlias = `coder-${username.slice(0, 10)}`
    console.log('[provision] Creating CloudBase env')
    const createEnvResp = await (tcbClient as any).CreateEnv({
      Alias: envAlias,
      PackageId: 'baas_personal',
      Resources: ['flexdb', 'storage', 'function'],
      Tags: [{ Key: 'vibe-env', Value: cosTagValue }],
    })
    const envId: string = createEnvResp.EnvId

    // 鈹€鈹€鈹€ 姝ラ 4锛氱瓑寰呯幆澧冨氨缁?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    currentStep = 'wait_env_ready'
    console.log('[provision] Waiting for env to become NORMAL...')
    const envInfo = await waitForEnvReady(tcbClient, envId)
    const envRegion = envInfo.region
    console.log('[provision] Env ready')

    // 鈹€鈹€鈹€ 姝ラ 4.5锛氭坊鍔犲畨鍏ㄥ煙鍚?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    try {
      const mainEnvId = process.env.TCB_ENV_ID
      const authDomainList = (process.env.AUTH_DOMAINS || 'localhost:5173,localhost:5174')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const domains = authDomainList
      if (mainEnvId) {
        let defaultDomain: string
        try {
          const gwRes = await (tcbClient as any).DescribeCloudBaseGWService({ EnvId: mainEnvId })
          defaultDomain = gwRes.DefaultDomain
          domains.push(defaultDomain)
        } catch {}
      }
      console.log('[provision] Adding security domains')
      await (tcbClient as any).CreateAuthDomain({
        EnvId: envId,
        Domains: domains,
      })
    } catch (e) {
      // 闈炲叧閿細瀹夊叏鍩熷悕娣诲姞澶辫触涓嶉樆濉炵幆澧冨垱寤?      console.log('[provision] CreateAuthDomain failed (non-critical)')
    }

    // 鈹€鈹€鈹€ 姝ラ 5锛氬垱寤烘潈闄愮瓥鐣ワ紙绮剧‘ ARN锛夆攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    currentStep = 'create_policy'
    const policyName = `coder_policy_${envId}`
    let policyId: number | undefined

    try {
      console.log('[provision] Listing policies')
      const listResp = await (camClient as any).ListPolicies({ Keyword: policyName, Scope: 'Local' })
      const found = (listResp.List || []).find((p: any) => p.PolicyName === policyName)
      if (found) policyId = found.PolicyId
    } catch {
      // 鏌ヨ澶辫触涓嶉樆濉?
    }

    const policyDocument = JSON.stringify({
      version: '2.0',
      statement: buildUserEnvPolicyStatements({ envId, region: envRegion, ownerUin, cosTagValue }),
    })
    const policyHash = computePolicyHash(policyDocument)

    if (!policyId) {
      console.log('[provision] Creating policy')
      const createPolicyResp = await (camClient as any).CreatePolicy({
        PolicyName: policyName,
        PolicyDocument: policyDocument,
        Description: 'Coder env access',
      })
      policyId = createPolicyResp.PolicyId
    } else {
      // Policy 宸插瓨鍦紝鐢ㄦ柊鍐呭鏇存柊
      console.log('[provision] Updating existing policy')
      await (camClient as any).UpdatePolicy({
        PolicyId: policyId,
        PolicyDocument: policyDocument,
        Description: 'Coder env access (updated)',
      })
    }

    // 鈹€鈹€鈹€ 姝ラ 6锛氱粦瀹氱瓥鐣ュ埌瀛愯处鍙?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    currentStep = 'attach_policy'
    console.log('[provision] Attaching user policy')
    await (camClient as any).AttachUserPolicy({
      AttachUin: subAccountUin,
      PolicyId: policyId,
    })

    return {
      envId,
      envAlias: envInfo.alias || envAlias,
      envRegion,
      cosTagValue,
      policyHash,
      camUsername,
      camSecretId,
      camSecretKey,
      policyId: policyId!,
    }
  } catch (e) {
    ;(e as any).__provisionFailStep = currentStep
    throw e
  }
}

// 鈹€鈹€鈹€ Utility Functions 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * 涓哄凡瀛樺湪鐨?CloudBase 鐜娣诲姞瀹夊叏鍩熷悕
 * 鐢ㄤ簬琛ュ叏鍘嗗彶鐜缂哄皯鐨勫畨鍏ㄥ煙鍚嶉厤缃? */
export async function ensureAuthDomains(envId: string, domains: string[]): Promise<void> {
  const { tcbClient } = getClients()
  try {
    await (tcbClient as any).CreateAuthDomain({
      EnvId: envId,
      Domains: domains,
    })
    console.log('[provision] Auth domains added')
  } catch (e: any) {
    // ResourceInUse = 鍩熷悕宸插瓨鍦紝蹇界暐
    if (e?.code === 'ResourceInUse') {
      console.log('[provision] Auth domains already exist')
      return
    }
    console.log('[provision] CreateAuthDomain failed')
  }
}

/**
 * 涓?shared 妯″紡鐨勪富鐜娣诲姞瀹夊叏鍩熷悕锛坙ocalhost + DefaultDomain锛夈€? * 浣跨敤 DescribeCloudBaseGWService 鑾峰彇 DefaultDomain锛屼繚璇佸煙鍚嶆牸寮忔纭€? * 闈炲叧閿搷浣滐紝澶辫触涓嶅奖鍝嶆敞鍐屾祦绋嬨€? */
export async function ensureSharedEnvAuthDomains(): Promise<void> {
  const envId = process.env.TCB_ENV_ID
  if (!envId) return

  try {
    const { tcbClient } = getClients()
    let defaultDomain = `${envId}.service.tcloudbase.com`
    try {
      const gwRes = await (tcbClient as any).DescribeCloudBaseGWService({
        EnableRegion: true,
        EnableUnion: true,
        ServiceId: envId,
      })
      if (gwRes.DefaultDomain) defaultDomain = gwRes.DefaultDomain
    } catch {
      // fallback to concatenated domain
    }
    const authDomainList = (process.env.AUTH_DOMAINS || 'localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    await ensureAuthDomains(envId, [...authDomainList, defaultDomain])
  } catch {
    // non-critical
  }
}

/**
 * 鍥炴粴 provisionUserResources 鍒涘缓鐨勮吘璁簯璧勬簮锛堟敞鍐屽け璐ユ椂浣跨敤锛? * 涓嶉攢姣佺幆澧冿紝浠呮竻鐞?CAM 璧勬簮鍜?Tag
 */
export async function rollbackProvisionedResources(result: Partial<ProvisionResult>): Promise<void> {
  const { camClient, tagClient } = getClients()

  if (result.cosTagValue) {
    try {
      await (tagClient as any).DeleteTag({ TagKey: 'vibe-env', TagValue: result.cosTagValue })
    } catch {
      // best-effort
    }
  }

  if (result.policyId) {
    try {
      await (camClient as any).DeletePolicy({ PolicyId: [result.policyId] })
    } catch {
      // best-effort
    }
  }

  if (result.camUsername) {
    try {
      await (camClient as any).DeleteUser({ Name: result.camUsername, Force: 1 })
    } catch {
      // best-effort
    }
  }
}

/**
 * 鍒犻櫎鐢ㄦ埛/浠诲姟鏃舵竻鐞嗚吘璁簯璧勬簮锛圕AM 瀛愮敤鎴?+ 绛栫暐 + Tag + 浜戝紑鍙戠幆澧冿級
 *
 * 杩斿洖姣忎竴姝ョ殑缁撴灉銆傝皟鐢ㄦ柟搴旀牴鎹?`failed` 鍐冲畾鏄惁闃绘 DB 鍒犻櫎锛? *   - failed.length === 0 鈫?鍏ㄩ儴娓呮帀锛堝惈宸蹭笉瀛樺湪鐨勮涓哄箓绛夋垚鍔燂級鈫?鍙互鍒?DB row
 *   - failed.length > 0   鈫?杩樻湁璧勬簮娌℃竻骞插噣锛堝 env 浠嶅湪鍒濆鍖栵級鈫?淇濈暀 DB row锛屼笅娆￠噸璇? *
 * "宸蹭笉瀛樺湪"锛圢otFound 绫婚敊璇級瑙嗕负骞傜瓑鎴愬姛锛屼笉璁″叆 failed銆? */
export interface DestroyStepResult {
  step: 'tag' | 'policy' | 'cam_user' | 'env'
  status: 'ok' | 'not_found' | 'failed' | 'skipped'
  message?: string
  code?: string
  requestId?: string
}

export async function destroyProvisionedResources(resource: {
  camUsername?: string | null
  policyId?: number | null
  envId?: string | null
  cosTagValue?: string | null
}): Promise<{ steps: DestroyStepResult[]; failed: DestroyStepResult[] }> {
  const { camClient, tcbClient, tagClient } = getClients()
  const steps: DestroyStepResult[] = []

  const isNotFound = (e: any): boolean => {
    const code: string = e?.code || e?.original?.Code || ''
    const msg: string = (e?.message || '').toString()
    return (
      /NotExist|NotFound|NoSuch|ResourceNotFound|UnauthorizedOperation\.NotExist/i.test(code) ||
      /not exist|deleted|user does not exist/i.test(msg) ||
      msg.includes('\u4e0d\u5b58\u5728') ||
      msg.includes('\u5df2\u5220\u9664')
    )
  }

  const isAlreadyIsolated = (e: any): boolean => {
    const msg: string = (e?.message || '').toString()
    return /isolated|isolate/i.test(msg) || msg.includes('\u9694\u79bb')
  }

  // 閿€姣侀『搴忥細
  //   1. env 鈫?鎺ㄥ叆闅旂锛堜竴娆?DestroyEnv 鍗冲彲锛岄殧绂绘湡婊¤吘璁簯鍚庣鑷姩褰诲簳鍒狅級
  //   2. cam_user / policy
  //   3. 瑙ｇ粦 tag 涓婃寕鐨勮祫婧愶紙cos bucket 绛夛級鈫?鍒?tag
  //
  // 涓嶅彂绗?2 娆?DestroyEnv锛坽IsForce, BypassCheck}锛夆€?env 杩涘叆闅旂鏈熷悗鑵捐浜戝悗绔細鍦?  // 闅旂鏈熸弧锛堥粯璁?7 澶╋級鑷姩褰诲簳閿€姣侊紱寮哄垹鍙嶈€岀粫杩囪吘璁簯鐨?鍙嶆倲绐楀彛"淇濇姢銆倀ag 涓婃寕鐨?  // cos bucket 鏄?env 瀛愯祫婧愶紙鐢熷懡鍛ㄦ湡璺熼殢 env锛夛紝鐜板湪 env 灏氭湭閿€姣佹墍浠?bucket 杩樺湪 鈫?  // 鐢?DescribeResourcesByTags + DetachResourcesTag 涓诲姩瑙ｇ粦 tag 鍏宠仈锛屽啀 DeleteTag銆?
  // 1) 鎺ㄥ叆闅旂锛圢ORMAL 鈫?Isolated锛?
  if (resource.envId && resource.envId !== process.env.TCB_ENV_ID) {
    const envId = resource.envId
    try {
      await (tcbClient as any).DestroyEnv({ EnvId: envId })
      console.log('[provision] DestroyEnv accepted')
      steps.push({ step: 'env', status: 'ok' })
    } catch (e: any) {
      const code: string = e?.code || e?.original?.Code || ''
      const msg: string = (e?.message || '').toString()
      if (isNotFound(e)) {
        steps.push({ step: 'env', status: 'not_found', message: msg })
      } else if (isAlreadyIsolated(e)) {
        // 宸插湪闅旂鏈燂紝骞傜瓑鎴愬姛
        console.log('[provision] Env already isolated')
        steps.push({ step: 'env', status: 'ok' })
      } else {
        console.warn('[provision] DestroyEnv failed')
        steps.push({ step: 'env', status: 'failed', message: msg, code, requestId: e?.requestId })
      }
    }
  } else {
    steps.push({ step: 'env', status: 'skipped' })
  }

  // 2) 鍒犻櫎 CAM 瀛愯处鍙凤紙绾ц仈鍒犻櫎 API 瀵嗛挜锛?
  if (resource.camUsername) {
    try {
      await (camClient as any).DeleteUser({ Name: resource.camUsername, Force: 1 })
      console.log('[provision] CAM user deleted')
      steps.push({ step: 'cam_user', status: 'ok' })
    } catch (e: any) {
      if (isNotFound(e)) {
        steps.push({ step: 'cam_user', status: 'not_found', message: e?.message })
      } else {
        console.warn('[provision] CAM user delete failed')
        steps.push({ step: 'cam_user', status: 'failed', message: e?.message, code: e?.code, requestId: e?.requestId })
      }
    }
  } else {
    steps.push({ step: 'cam_user', status: 'skipped' })
  }

  // 3) 鍒犻櫎 CAM 绛栫暐
  if (resource.policyId) {
    try {
      await (camClient as any).DeletePolicy({ PolicyId: [resource.policyId] })
      console.log('[provision] CAM policy deleted')
      steps.push({ step: 'policy', status: 'ok' })
    } catch (e: any) {
      if (isNotFound(e)) {
        steps.push({ step: 'policy', status: 'not_found', message: e?.message })
      } else {
        console.warn('[provision] CAM policy delete failed')
        steps.push({ step: 'policy', status: 'failed', message: e?.message, code: e?.code, requestId: e?.requestId })
      }
    }
  } else {
    steps.push({ step: 'policy', status: 'skipped' })
  }

  // 4) 鍒犻櫎 Tag
  //    Tag 涓婃寕鐫€ env 瀛愯祫婧愶紙tcb / tcbr / lowcode / scf / cos bucket 绛夛級銆俥nv 杩涘叆闅旂鏈熷悗
  //    鑵捐浜戝悗绔細鍦ㄩ殧绂绘湡婊★紙榛樿 7 澶╋級鑷姩褰诲簳鍒?env 鍙婃墍鏈夊瓙璧勬簮锛宼ag 鍏宠仈涔熼殢涔嬭В闄ゃ€?  //    姝ゆ椂濡傛灉鐩存帴 DeleteTag 澶ф鐜囦粛鏈夎祫婧愬紩鐢?鈫?闄嶇骇涓?not_found锛堝绔?tag 鏃犲姛鑳藉奖鍝嶏紝
  //    鍚庡彴/瀹氭湡娓呯悊鍙洖鏀讹級銆?  //
  //    涓诲姩瑙ｇ粦锛圖escribeResourcesByTags + UnTagResources锛夊疄娴嬶細
  //      - 闈?cos 璧勬簮锛坱cb/tcbr/lowcode/scf锛夎兘鎴愬姛瑙ｇ粦
  //      - cos bucket 鐨?tag 鍦?cos 鑷繁鏈嶅姟绠＄悊锛岀粺涓€ tag API 瑙ｄ笉鎺?  //    鎵€浠ヨВ缁戜篃鍙兘閮ㄥ垎鎴愬姛 鈫?浠嶅彲鑳?DeleteTag 澶辫触銆傜患鍚堣€冭檻锛氱洿鎺ュ皾璇?DeleteTag锛?  //    澶辫触闄嶇骇锛岀瓑 env 闅旂鏈熸弧鑷姩娓呯悊銆?
  if (resource.cosTagValue) {
    const tagKey = 'vibe-env'
    const tagValue = resource.cosTagValue
    try {
      await (tagClient as any).DeleteTag({ TagKey: tagKey, TagValue: tagValue })
      console.log('[provision] Tag deleted')
      steps.push({ step: 'tag', status: 'ok' })
    } catch (e: any) {
      const code: string = e?.code || e?.original?.Code || ''
      if (isNotFound(e)) {
        steps.push({ step: 'tag', status: 'not_found', message: e?.message })
      } else if (/TagAttachedResource/i.test(code)) {
        console.warn('[provision] Tag still attached, leave to background cleanup')
        steps.push({ step: 'tag', status: 'not_found', message: `attached: ${e?.message}` })
      } else {
        console.warn('[provision] Tag delete failed')
        steps.push({ step: 'tag', status: 'failed', message: e?.message, code: e?.code, requestId: e?.requestId })
      }
    }
  } else {
    steps.push({ step: 'tag', status: 'skipped' })
  }

  // 2) 鍒犻櫎 CAM 瀛愯处鍙凤紙绾ц仈鍒犻櫎 API 瀵嗛挜锛?
  if (resource.camUsername) {
    try {
      await (camClient as any).DeleteUser({ Name: resource.camUsername, Force: 1 })
      console.log('[provision] CAM user deleted')
      steps.push({ step: 'cam_user', status: 'ok' })
    } catch (e: any) {
      if (isNotFound(e)) {
        steps.push({ step: 'cam_user', status: 'not_found', message: e?.message })
      } else {
        console.warn('[provision] CAM user delete failed')
        steps.push({ step: 'cam_user', status: 'failed', message: e?.message, code: e?.code, requestId: e?.requestId })
      }
    }
  } else {
    steps.push({ step: 'cam_user', status: 'skipped' })
  }

  // 3) 鍒犻櫎 CAM 绛栫暐
  if (resource.policyId) {
    try {
      await (camClient as any).DeletePolicy({ PolicyId: [resource.policyId] })
      console.log('[provision] CAM policy deleted')
      steps.push({ step: 'policy', status: 'ok' })
    } catch (e: any) {
      if (isNotFound(e)) {
        steps.push({ step: 'policy', status: 'not_found', message: e?.message })
      } else {
        console.warn('[provision] CAM policy delete failed')
        steps.push({ step: 'policy', status: 'failed', message: e?.message, code: e?.code, requestId: e?.requestId })
      }
    }
  } else {
    steps.push({ step: 'policy', status: 'skipped' })
  }

  // 4) 鍒犻櫎 Tag锛堟敞鎰忥細env 閿€姣佹槸寮傛鐨勶紝cos bucket 绛夊彲鑳借繕娌¤В缁戯紝姝ゆ椂 DeleteTag 浼氭姤
  //    FailedOperation.TagAttachedResource銆傝繖绉嶆儏鍐甸檷绾т负闈為樆濉炶鍛婏紝涓嶈鍏?failed锛岄伩鍏?  //    闃诲澶栧眰 DB 鍒犻櫎鈥斺€斿墿涓嬬殑瀛ょ珛 tag 鏃犲姛鑳藉奖鍝嶏紝鐢卞悗鍙?瀹氭湡鎵弿娓呯悊锛?
  if (resource.cosTagValue) {
    try {
      await (tagClient as any).DeleteTag({ TagKey: 'vibe-env', TagValue: resource.cosTagValue })
      console.log('[provision] Tag deleted')
      steps.push({ step: 'tag', status: 'ok' })
    } catch (e: any) {
      const code: string = e?.code || e?.original?.Code || ''
      if (isNotFound(e)) {
        steps.push({ step: 'tag', status: 'not_found', message: e?.message })
      } else if (/TagAttachedResource/i.test(code)) {
        // Tag 涓婁粛鏈?cos bucket 绛夎祫婧愬湪寮傛閲婃斁涓紝闄嶇骇涓洪潪闃诲璀﹀憡
        console.warn('[provision] Tag still attached to resources, skipping')
        steps.push({ step: 'tag', status: 'not_found', message: `attached: ${e?.message}` })
      } else {
        console.warn('[provision] Tag delete failed')
        steps.push({ step: 'tag', status: 'failed', message: e?.message, code: e?.code, requestId: e?.requestId })
      }
    }
  } else {
    steps.push({ step: 'tag', status: 'skipped' })
  }

  const failed = steps.filter((s) => s.status === 'failed')
  return { steps, failed }
}
