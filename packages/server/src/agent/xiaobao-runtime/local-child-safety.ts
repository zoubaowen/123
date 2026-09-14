export type LocalSafetyDecision = { allowed: true } | { allowed: false; reason: string }

const unsafeRequestReason = '这个请求不能安全处理，请换一个学习或写作问题'
const privacyRequestReason = '这个请求可能涉及个人隐私，请换一种安全的说法'
const maximumPromptCodePoints = 10_000

const privacyRequestPattern =
  /(?:把|提供|告诉|发送|发给|分享|泄露).{0,80}(?:家庭住址|住址|电话|手机号|联系方式|身份证号?|密码(?!学)|银行卡号?|真实姓名)|(?:家庭住址|住址|电话|手机号|联系方式|身份证号?|密码(?!学)|银行卡号?|真实姓名).{0,80}(?:发给我|告诉我|提供给我|分享给我)/u
const bypassRequestPattern = /(?:忽略|绕过|取消).*(?:安全规则|安全限制|内容限制)|越狱/u
const safetyEducationPatterns = [
  /(?:为什么不能|为什么不该|为什么不要)(?:泄露|分享|提供)(?:我的|个人的)?(?:个人)?(?:信息|隐私|密码|家庭住址|住址|电话|手机号|联系方式|身份证号?|银行卡号?|真实姓名)/u,
  /(?:为什么不能|为什么不该|为什么不要)(?:把)?(?:我的|个人的)?(?:家庭住址|住址|电话|手机号|联系方式|身份证号?|密码(?!学)|银行卡号?|真实姓名)?(?:告诉|分享|提供)(?:给)?(?:陌生人|别人|他人)/u,
  /(?:怎么|如何)?(?:制作|编写|创作)(?:反诈骗|防诈骗|预防诈骗)(?:宣传材料|宣传海报|海报|材料)/u,
]
const harmfulActionBeforePattern =
  /(?:怎么|怎样|如何)(?:做|制作|实施|进行).{0,10}(?:制毒|炸弹|盗窃|诈骗|黑客攻击)|(?:制作|实施|进行)(?:制毒|炸弹|盗窃|诈骗|黑客攻击)|(?:教我|指导我|提供).{0,20}(?:制作|实施|进行|怎么做|如何做|怎样做).{0,10}(?:制毒|炸弹|盗窃|诈骗|黑客攻击)/u
const harmfulActionAfterPattern =
  /(?:制毒|炸弹|盗窃|诈骗|黑客攻击).{0,10}(?:怎么做|如何做|怎样做|怎么制作|如何制作|怎样制作|怎么实施|如何实施|怎样实施|怎么进行|如何进行|怎样进行)/u
const unsafeRequestPatterns = [
  /(?:怎么|怎样|如何)(?:获取|制作|发送).{0,10}(?:色情|裸照|性行为|强奸)/u,
  /(?:怎样|怎么|如何)(?:自残|自杀|割腕)|(?:自残|自杀|割腕).{0,10}(?:怎么做|如何做|怎样做)/u,
  harmfulActionBeforePattern,
  harmfulActionAfterPattern,
]

export function checkLocalChildSafety(prompt: string): LocalSafetyDecision {
  if (prompt.trim() === '' || Array.from(prompt).length > maximumPromptCodePoints) {
    return { allowed: false, reason: unsafeRequestReason }
  }

  const normalizedPrompt = prompt.replace(/\s+/gu, ' ')

  if (bypassRequestPattern.test(normalizedPrompt)) {
    return { allowed: false, reason: unsafeRequestReason }
  }

  let promptToCheck = normalizedPrompt
  for (const pattern of safetyEducationPatterns) {
    promptToCheck = promptToCheck.replace(pattern, ' ')
  }

  if (privacyRequestPattern.test(promptToCheck)) {
    return { allowed: false, reason: privacyRequestReason }
  }

  if (unsafeRequestPatterns.some((pattern) => pattern.test(promptToCheck))) {
    return { allowed: false, reason: unsafeRequestReason }
  }

  return { allowed: true }
}
