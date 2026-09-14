import * as tencentcloud from 'tencentcloud-sdk-nodejs'

function isDev(): boolean {
  return process.env.NODE_ENV === 'development'
}

export function isSmsMockEnabled(): boolean {
  return isDev() || process.env.SMS_MOCK === '1' || process.env.SMS_MOCK === 'true'
}

export async function sendSms(phone: string, code: string): Promise<void> {
  if (isDev() || isSmsMockEnabled()) {
    console.log('[SMS] Mock mode: verification code not sent')
    return
  }

  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  const appId = process.env.TENCENT_SMS_APP_ID
  const signName = process.env.TENCENT_SMS_SIGN_NAME
  const templateId = process.env.TENCENT_SMS_TEMPLATE_ID

  if (!secretId || !secretKey || !appId || !signName || !templateId) {
    console.error('[SMS] Missing configuration')
    throw new Error('SMS service not configured')
  }

  try {
    const SmsClient = tencentcloud.sms.v20210111.Client
    const client = new SmsClient({
      credential: {
        secretId,
        secretKey,
      },
      region: 'ap-guangzhou',
      profile: {
        httpProfile: {
          endpoint: 'sms.tencentcloudapi.com',
        },
      },
    })

    await client.SendSms({
      PhoneNumberSet: [phone],
      SmsSdkAppId: appId,
      SignName: signName,
      TemplateId: templateId,
      TemplateParamSet: [code],
    })

    console.log('[SMS] Verification code sent')
  } catch (err) {
    console.error('[SMS] Failed to send verification code:')
    throw err
  }
}
