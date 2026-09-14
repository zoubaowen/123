import type { XiaobaoClassBudgetReader } from './budget-policy.js'

/** 内部失败原因：静态字符串，不含班级 id、用户 id 或额度数字。 */
const CLASS_BUDGET_UNKNOWN = 'xiaobao class budget is unknown'
const CLASS_BUDGET_INVALID = 'xiaobao class budget is invalid'

/**
 * 解析班级共享额度所需的最小来源。
 *
 * 刻意用结构化窄接口而不是直接依赖仓储类型：读取器本身可以被测试完整覆盖，
 * 而真实装配只需要提供这三个方法。
 */
export interface ClassBudgetSource {
  /** 该学生当前在班（active 选课）的班级。null 表示无法确定。 */
  listActiveClassesForStudent(
    studentUserId: string,
  ): Promise<Array<{ id: string; xiaobaoCreditLimit?: number | null }> | null>
  /** 某班在班学生的用户 id；null 表示无法确定。 */
  listActiveStudentIds(classId: string): Promise<string[] | null>
  /** 一组用户已结算的学分合计；null 表示无法确定。 */
  sumSettledCreditsByUsers(userIds: readonly string[], since: number | null): Promise<number | null>
}

/**
 * 班级共享额度读取器：**整班共用**口径。
 *
 * 语义（全部 fail-closed，避免"以为有班级额度其实没有"）：
 * - 学生不在任何设了上限的班里 ⇒ 返回 `null`（没有班级层限制，继续回退环境默认值）；
 * - 班级列表或名单**无法确定** ⇒ 抛错，由装饰器拒绝；
 * - 班级上限不是正整数（0 / 负数 / 小数 / 非数字）⇒ 抛错，绝不当成"不限制"；
 * - 全班合计**无法确定** ⇒ 原样返回 `settledCredits: null`，由装饰器按 fail-closed 拒绝。
 *
 * 学生同时在多个设了上限的班里时取**最严格**的一个（上限相同则按班级 id 取最小），
 * 这样结果确定且偏向安全。
 */
export function createDatabaseClassBudgetReader(source: ClassBudgetSource): XiaobaoClassBudgetReader {
  return {
    async readClassBudget(userId) {
      const classes = await source.listActiveClassesForStudent(userId)
      if (classes === null) throw new Error(CLASS_BUDGET_UNKNOWN)

      const capped: Array<{ id: string; limit: number }> = []
      for (const item of classes) {
        const limit = item.xiaobaoCreditLimit
        if (limit === null || limit === undefined) continue
        if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error(CLASS_BUDGET_INVALID)
        capped.push({ id: item.id, limit })
      }

      if (capped.length === 0) return null

      const chosen = capped.reduce((strictest, candidate) => {
        if (candidate.limit < strictest.limit) return candidate
        if (candidate.limit === strictest.limit && candidate.id < strictest.id) return candidate
        return strictest
      })

      const studentIds = await source.listActiveStudentIds(chosen.id)
      if (studentIds === null) throw new Error(CLASS_BUDGET_UNKNOWN)

      // 上限与用量必须来自**同一个班**，否则等于把班级上限当个人上限用
      const settledCredits = await source.sumSettledCreditsByUsers(studentIds, null)

      return { limit: chosen.limit, settledCredits }
    },
  }
}
