import { parseQuickAddDetailed, type QuickAddResult } from './quick-add'

export interface CalendarAddResult extends QuickAddResult {
  /** 输入里是否明确写了日期（“明天”“3月5日”），而不是由时间或重复规则推导出来的。 */
  explicitDate: boolean
}

/**
 * 日历行内添加的解析规则：沿用快速添加的自然语言能力（时间、标签、优先级、
 * 清单、重复、提前提醒），但截止日期默认落在用户选中的那一天。
 *
 * - 没写日期：用选中的日期（“9点 晨会”落在选中日的 09:00）
 * - 明确写了日期：尊重输入（“明天 10点 开会”落在明天），预览里会显示出来
 * - 只写了重复（“每3天 浇花”）：首次日期仍用选中的日期，而不是被推到“今天”
 */
export function parseCalendarAdd(
  input: string,
  day: string,
  now: Date = new Date()
): CalendarAddResult {
  const { result, explicitDate } = parseQuickAddDetailed(input, now)
  return {
    ...result,
    dueDate: explicitDate && result.dueDate ? result.dueDate : day,
    explicitDate
  }
}
