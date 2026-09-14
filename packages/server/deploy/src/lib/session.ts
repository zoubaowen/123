import { EncryptJWT, jwtDecrypt, base64url } from 'jose'

function decodeJweSecret(secret: string): Uint8Array {
  const key = /^[0-9a-f]{64}$/i.test(secret) ? Buffer.from(secret, 'hex') : base64url.decode(secret)
  if (key.length !== 32) {
    throw new Error('JWE_SECRET must decode to 32 bytes')
  }
  return key
}

export async function encryptJWE<T extends string | object = string | object>(
  payload: T,
  expirationTime: string,
  secret: string | undefined = process.env.JWE_SECRET,
): Promise<string> {
  if (!secret) {
    throw new Error('Missing JWE secret')
  }

  return new EncryptJWT(payload as Record<string, unknown>)
    .setExpirationTime(expirationTime)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .encrypt(decodeJweSecret(secret))
}

export async function decryptJWE<T extends string | object = string | object>(
  cyphertext: string,
  secret: string | undefined = process.env.JWE_SECRET,
): Promise<T | undefined> {
  if (!secret) {
    throw new Error('Missing JWE secret')
  }

  if (typeof cyphertext !== 'string') return

  try {
    const { payload } = await jwtDecrypt(cyphertext, decodeJweSecret(secret))
    const decoded = payload as T
    if (typeof decoded === 'object' && decoded !== null) {
      delete (decoded as Record<string, unknown>).iat
      delete (decoded as Record<string, unknown>).exp
    }
    return decoded
  } catch {
    // Do nothing
  }
}
