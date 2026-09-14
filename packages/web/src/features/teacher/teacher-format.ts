/**
 * 教师端数值展示助手。
 *
 * 后端把"无法确定"和"尚未接入"都表达为 `null` / 缺省，界面**必须显示占位符而不是 0**：
 * "完成率 0%" 与"完成率未知"看起来一样，但后者不该被读成学生一点没做。
 */

const PLACEHOLDER = '—'

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? PLACEHOLDER : `${value}%`
}

export function formatCount(value: number | null | undefined, unit: string): string {
  return value === null || value === undefined ? PLACEHOLDER : `${value}${unit}`
}

/** 进度条只接受数字：未知时用 0 长度，文字由 `formatPercent` 负责说明是未知。 */
export function progressBarValue(value: number | null | undefined): number {
  return value ?? 0
}

/** 合计：任一组成项未知则合计也未知，不把未知当成 0 计入。 */
export function sumOrUnknown(values: Array<number | null | undefined>): number | null {
  let total = 0
  for (const value of values) {
    if (value === null || value === undefined) return null
    total += value
  }
  return total
}

/**
 * 平均值：只对**已知**项求平均；全部未知时返回 null。
 *
 * 不把未知项当成 0 参与平均——那会把"还没接入"算成"进度很差"。
 */
export function averageOrUnknown(values: Array<number | null | undefined>): number | null {
  const known = values.filter((value): value is number => value !== null && value !== undefined)
  if (known.length === 0) return null
  return Math.round(known.reduce((total, value) => total + value, 0) / known.length)
}
