import { describe, expect, it } from 'vitest'
import {
  describeReminderOffset,
  normalizeReminderOffset,
  parseQuickAdd,
  REMINDER_MAX_OFFSET_MIN,
  reminderTriggerAt
} from '../src/shared/quick-add'

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

  it('语音转写文本能直接落成任务', () => {
    // 这条是 Vosk 真实转写结果，用来保证语音入口的语义解析不退化
    const result = parseQuickAdd('每三天浇一次花明天下午三点提醒我', NOW)
    expect(result.recurrence).toBe('FREQ=DAILY;INTERVAL=3')
    expect(result.dueDate).toBe('2026-11-06')
    expect(result.dueTime).toBe('15:00')
    expect(result.title).toContain('浇')
  })
})

describe('提前提醒解析', () => {
  it('解析“提前30分钟提醒”并从标题里移除', () => {
    const result = parseQuickAdd('明天下午3点 提前30分钟提醒 交周报', NOW)
    expect(result.title).toBe('交周报')
    expect(result.dueDate).toBe('2026-11-06')
    expect(result.dueTime).toBe('15:00')
    expect(result.reminderOffsetMin).toBe(30)
  })

  it('支持重复任务、中文数字、小时与天', () => {
    const weekly = parseQuickAdd('每周一 提前1小时提醒 晨会', NOW)
    expect(weekly.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(weekly.reminderOffsetMin).toBe(60)
    expect(weekly.title).toBe('晨会')

    expect(parseQuickAdd('提前提醒我半小时 交水电费', NOW).reminderOffsetMin).toBe(30)
    expect(parseQuickAdd('提前一天通知我 交房租', NOW).reminderOffsetMin).toBe(1440)
    expect(parseQuickAdd('提前提醒 30 分钟 复盘', NOW).reminderOffsetMin).toBe(30)
  })

  it('没有明确提醒动词的“提前30分钟出发”保持原样', () => {
    const result = parseQuickAdd('提前30分钟出发', NOW)
    expect(result.title).toBe('提前30分钟出发')
    expect(result.reminderOffsetMin).toBeNull()
  })

  it('没有截止日期时仍保留提前量，交给创建逻辑提示', () => {
    const result = parseQuickAdd('提前30分钟提醒 开会', NOW)
    expect(result.reminderOffsetMin).toBe(30)
    expect(result.dueDate).toBeNull()
    expect(reminderTriggerAt(result)).toBeNull()
  })

  it('按截止时间或全天 09:00 计算触发时刻', () => {
    expect(
      reminderTriggerAt({
        dueDate: '2026-11-06',
        dueTime: '15:00',
        reminderOffsetMin: 30
      })
    ).toBe(new Date(2026, 10, 6, 14, 30).toISOString())

    expect(
      reminderTriggerAt({
        dueDate: '2026-11-07',
        dueTime: null,
        reminderOffsetMin: 1440
      })
    ).toBe(new Date(2026, 10, 6, 9, 0).toISOString())
  })

  it('收敛并描述提前量', () => {
    expect(normalizeReminderOffset(30)).toBe(30)
    expect(normalizeReminderOffset('15')).toBe(15)
    expect(normalizeReminderOffset(-1)).toBeNull()
    expect(normalizeReminderOffset(REMINDER_MAX_OFFSET_MIN + 1)).toBeNull()
    expect(normalizeReminderOffset('abc')).toBeNull()
    expect(describeReminderOffset(0)).toBe('截止时提醒')
    expect(describeReminderOffset(30)).toBe('提前 30 分钟提醒')
    expect(describeReminderOffset(60)).toBe('提前 1 小时提醒')
    expect(describeReminderOffset(1440)).toBe('提前 1 天提醒')
    expect(describeReminderOffset(90)).toBe('提前 90 分钟提醒')
  })
})
