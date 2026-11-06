import { describe, expect, it } from 'vitest'
import { parseCalendarAdd } from '../src/shared/calendar-add'
import { parseQuickAdd } from '../src/shared/quick-add'

// 固定在 2026-11-05 周四 09:00，避免相对日期随时钟漂移。
const NOW = new Date(2026, 10, 5, 9, 0, 0)
const DAY = '2026-11-20'

describe('日历行内添加解析', () => {
  it('只写标题时落在选中的日期，且是全天任务', () => {
    expect(parseCalendarAdd('写周报', DAY, NOW)).toMatchObject({
      title: '写周报',
      dueDate: DAY,
      dueTime: null,
      allDay: true,
      priority: 0,
      tags: [],
      listName: null,
      recurrence: null,
      reminderOffsetMin: null,
      explicitDate: false
    })
  })

  it('只写时间时仍落在选中日期，而不是被推到今天', () => {
    expect(parseCalendarAdd('9点 晨会', DAY, NOW)).toMatchObject({
      title: '晨会',
      dueDate: DAY,
      dueTime: '09:00',
      allDay: false,
      explicitDate: false
    })
  })

  it('明确写了日期时尊重输入里的日期', () => {
    expect(parseCalendarAdd('明天 10点 开会', DAY, NOW)).toMatchObject({
      title: '开会',
      dueDate: '2026-11-06',
      dueTime: '10:00',
      allDay: false,
      explicitDate: true
    })
  })

  it('只写重复规则时首次日期取选中日期', () => {
    // 快速添加会把“每3天”的首次日期推到今天，日历里应落在选中的格子。
    expect(parseQuickAdd('每3天 浇花', NOW).dueDate).toBe('2026-11-05')
    expect(parseCalendarAdd('每3天 浇花', DAY, NOW)).toMatchObject({
      title: '浇花',
      dueDate: DAY,
      recurrence: 'FREQ=DAILY;INTERVAL=3',
      explicitDate: false
    })
  })

  it('支持标签、优先级、清单、重复与提前提醒的组合写法', () => {
    expect(
      parseCalendarAdd('9点 晨会 #工作 !高 ~工作 提前15分钟提醒 每3天', DAY, NOW)
    ).toMatchObject({
      title: '晨会',
      dueDate: DAY,
      dueTime: '09:00',
      allDay: false,
      priority: 3,
      tags: ['工作'],
      listName: '工作',
      recurrence: 'FREQ=DAILY;INTERVAL=3',
      reminderOffsetMin: 15,
      explicitDate: false
    })
  })

  it('工作日与每月的重复短语照常生效', () => {
    expect(parseCalendarAdd('工作日 站会', DAY, NOW).recurrence).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    )
    expect(parseCalendarAdd('每月最后一个周五 复盘', DAY, NOW).recurrence).toBe(
      'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1'
    )
  })

  it('写全日期时以输入为准，非法日期不会被当成截止日期', () => {
    expect(parseCalendarAdd('2026-12-01 交表', DAY, NOW)).toMatchObject({
      title: '交表',
      dueDate: '2026-12-01',
      explicitDate: true
    })
    // 2026-02-30 不是合法日期，保留在标题里。
    const invalid = parseCalendarAdd('2026-02-30 报销', DAY, NOW)
    expect(invalid.dueDate).toBe(DAY)
    expect(invalid.title).toContain('2026-02-30')
  })
})
