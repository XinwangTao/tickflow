import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from '../src/shared/quick-add'

const NOW = new Date(2026, 10, 5, 9, 0, 0) // 2026-11-05 周四 09:00

describe('parseQuickAdd', () => {
  it('解析日期、时间、标签和优先级', () => {
    const result = parseQuickAdd('明天下午3点 交周报 #工作 !高', NOW)
    expect(result.title).toBe('交周报')
    expect(result.dueDate).toBe('2026-11-06')
    expect(result.dueTime).toBe('15:00')
    expect(result.allDay).toBe(false)
    expect(result.priority).toBe(3)
    expect(result.tags).toEqual(['工作'])
    expect(result.listName).toBeNull()
    expect(result.recurrence).toBeNull()
  })

  it('解析每周重复并给出下一次日期', () => {
    const result = parseQuickAdd('每周一 晨会', NOW)
    expect(result.title).toBe('晨会')
    expect(result.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(result.dueDate).toBe('2026-11-09')
    expect(result.allDay).toBe(true)
  })

  it('解析今天与全天任务', () => {
    const result = parseQuickAdd('今天 买菜', NOW)
    expect(result.title).toBe('买菜')
    expect(result.dueDate).toBe('2026-11-05')
    expect(result.dueTime).toBeNull()
    expect(result.allDay).toBe(true)
  })

  it('过去的月日自动顺延到明年', () => {
    const result = parseQuickAdd('3月5日 体检', NOW)
    expect(result.title).toBe('体检')
    expect(result.dueDate).toBe('2027-03-05')
  })

  it('解析中文半点', () => {
    const result = parseQuickAdd('下午3点半 开会', NOW)
    expect(result.dueTime).toBe('15:30')
    expect(result.dueDate).toBe('2026-11-05')
  })

  it('解析显式日期与时间', () => {
    const result = parseQuickAdd('2026-11-10 14:30 会议', NOW)
    expect(result.title).toBe('会议')
    expect(result.dueDate).toBe('2026-11-10')
    expect(result.dueTime).toBe('14:30')
  })

  it('解析清单 token', () => {
    const result = parseQuickAdd('~工作 写周报', NOW)
    expect(result.title).toBe('写周报')
    expect(result.listName).toBe('工作')
  })

  it('解析每天重复', () => {
    const result = parseQuickAdd('每天 喝水', NOW)
    expect(result.title).toBe('喝水')
    expect(result.recurrence).toBe('FREQ=DAILY')
    expect(result.dueDate).toBe('2026-11-05')
  })

  it('无日期任务保持纯标题', () => {
    const result = parseQuickAdd('无日期任务', NOW)
    expect(result.title).toBe('无日期任务')
    expect(result.dueDate).toBeNull()
    expect(result.dueTime).toBeNull()
    expect(result.allDay).toBe(true)
    expect(result.priority).toBe(0)
  })

  it('标签去重', () => {
    const result = parseQuickAdd('写周报 #工作 #工作 #重要', NOW)
    expect(result.tags).toEqual(['工作', '重要'])
  })

  it('解析带数量的重复周期（每3天 / 每隔两天 / 每两周）', () => {
    expect(parseQuickAdd('每3天 浇花', NOW).recurrence).toBe('FREQ=DAILY;INTERVAL=3')
    expect(parseQuickAdd('每隔两天 复盘', NOW).recurrence).toBe('FREQ=DAILY;INTERVAL=3')
    expect(parseQuickAdd('每两周 大扫除', NOW).recurrence).toBe('FREQ=WEEKLY;INTERVAL=2')
    expect(parseQuickAdd('每3天 浇花', NOW).title).toBe('浇花')
  })

  it('解析周一到周五这类区间', () => {
    const result = parseQuickAdd('周一到周五 打卡', NOW)
    expect(result.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    expect(result.title).toBe('打卡')
    // 今天是周四，落在周一到周五区间内，就从今天开始
    expect(result.dueDate).toBe('2026-11-05')
    expect(parseQuickAdd('周日到周二 值班', NOW).recurrence).toBe(
      'FREQ=WEEKLY;BYDAY=SU,MO,TU'
    )
  })

  it('区间不吞掉普通星期列表', () => {
    expect(parseQuickAdd('每周一三五 晨会', NOW).recurrence).toBe(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR'
    )
  })
})
