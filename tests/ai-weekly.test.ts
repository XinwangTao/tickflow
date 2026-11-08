import { describe, expect, it } from 'vitest'
import {
  buildWeeklyPrompt,
  normalizeAiWeekly,
  ruleWeeklyReview,
  type AiWeeklyInput
} from '../src/shared/ai'

const input: AiWeeklyInput = {
  startDate: '2026-11-02',
  endDate: '2026-11-08',
  days: [
    { date: '2026-11-02', completed: 3, focusMinutes: 50 },
    { date: '2026-11-03', completed: 0, focusMinutes: 0 },
    { date: '2026-11-04', completed: 5, focusMinutes: 75 }
  ],
  overdue: 2,
  createdTotal: 6,
  completedTotal: 8
}

describe('AI 周复盘', () => {
  it('规则降级给出完成数、专注时长与逾期风险', () => {
    const review = ruleWeeklyReview(input)
    expect(review.summary).toContain('完成 8 个任务')
    expect(review.summary).toContain('125 分钟')
    expect(review.risks.some((item) => item.includes('2 个任务逾期'))).toBe(true)
    expect(review.nextWeek.length).toBeGreaterThan(0)
  })

  it('缺 summary 的 AI 返回判为无效，交给规则降级', () => {
    expect(normalizeAiWeekly({ wins: ['a'] })).toBeNull()
    expect(normalizeAiWeekly(null)).toBeNull()
  })

  it('提示词带上区间、新建数与每日数据', () => {
    const prompt = buildWeeklyPrompt(input)
    expect(prompt).toContain('2026-11-02 至 2026-11-08')
    expect(prompt).toContain('本周新建：6')
    expect(prompt).toContain('2026-11-04：完成 5，专注 75 分钟')
  })
})
