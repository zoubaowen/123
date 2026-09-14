import { checkLocalChildSafety } from './local-child-safety.js'
import type { SafetyCheckRequest, SafetyCheckResult, SafetyProvider } from './ports.js'

/** Applies deterministic child-safety rules before text leaves the service for cloud moderation. */
export class ProductionSafetyProvider implements SafetyProvider {
  constructor(private readonly tmsSafety: SafetyProvider) {}

  async check(input: SafetyCheckRequest, signal: AbortSignal): Promise<SafetyCheckResult> {
    const localDecision = checkLocalChildSafety(input.prompt)
    if (!localDecision.allowed) return localDecision
    return this.tmsSafety.check(input, signal)
  }
}
