import { describe, expect, it } from 'vitest'
import {
  describeReminderOffset,
  normalizeReminderOffset,
  parseQuickAdd,
  parseRelativeOffset,
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

  it('解析每月第 N 个星期与最后一个个星期', () => {
    const firstMonday = parseQuickAdd('每月第一个周一 例会', NOW)
    expect(firstMonday.recurrence).toBe('FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1')
    expect(firstMonday.title).toBe('例会')
    // 11 月的第一个周一（11-02）已过，顺延到 12-07
    expect(firstMonday.dueDate).toBe('2026-12-07')

    const secondThursday = parseQuickAdd('每月第2个周四 复盘', NOW)
    expect(secondThursday.recurrence).toBe('FREQ=MONTHLY;BYDAY=TH;BYSETPOS=2')
    expect(secondThursday.dueDate).toBe('2026-11-12')

    const lastFriday = parseQuickAdd('每月最后一个周五 收尾', NOW)
    expect(lastFriday.recurrence).toBe('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1')
    expect(lastFriday.dueDate).toBe('2026-11-27')
    expect(lastFriday.title).toBe('收尾')
  })

  it('解析每季度与每半年', () => {
    expect(parseQuickAdd('每季度 复盘', NOW).recurrence).toBe(
      'FREQ=MONTHLY;INTERVAL=3'
    )
    expect(parseQuickAdd('每季度 复盘', NOW).title).toBe('复盘')
    expect(parseQuickAdd('每半年 体检', NOW).recurrence).toBe(
      'FREQ=MONTHLY;INTERVAL=6'
    )
  })

  it('解析每季度第一天/最后一天这类自然季度边界', () => {
    const first = parseQuickAdd('每季度第一天 复盘', NOW)
    expect(first.title).toBe('复盘')
    expect(first.recurrence).toBe(
      'FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=1'
    )
    // 2026-11 已进入 Q4，下一次季度第一天是 2027-01-01
    expect(first.dueDate).toBe('2027-01-01')

    const last = parseQuickAdd('每季度最后一天 结转', NOW)
    expect(last.title).toBe('结转')
    expect(last.recurrence).toBe(
      'FREQ=YEARLY;BYMONTH=3,6,9,12;BYMONTHDAY=-1'
    )
    expect(last.dueDate).toBe('2026-12-31')
  })

  it('解析“每个月”口语与多个每月日期', () => {
    const lastDay = parseQuickAdd('每个月的最后一天 对账', NOW)
    expect(lastDay.title).toBe('对账')
    expect(lastDay.recurrence).toBe('FREQ=MONTHLY;BYMONTHDAY=-1')
    expect(lastDay.dueDate).toBe('2026-11-30')
    expect(parseQuickAdd('每个月底 结转', NOW).recurrence).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=-1'
    )

    const multi = parseQuickAdd('每月的1号和15号 对账', NOW)
    expect(multi.title).toBe('对账')
    expect(multi.recurrence).toBe('FREQ=MONTHLY;BYMONTHDAY=1,15')
    // 11-01 已过，取最近的 11-15
    expect(multi.dueDate).toBe('2026-11-15')

    expect(parseQuickAdd('每月1号、15号、28号 还款', NOW).recurrence).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=1,15,28'
    )
    expect(parseQuickAdd('每月1号、15号、28号 还款', NOW).title).toBe('还款')
  })

  it('解析每月第 N 个与最后一个工作日', () => {
    const lastWorkday = parseQuickAdd('每月最后一个工作日 对账', NOW)
    expect(lastWorkday.title).toBe('对账')
    expect(lastWorkday.recurrence).toBe(
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'
    )
    // 2026-11-30 是周一，也是 11 月最后一个工作日
    expect(lastWorkday.dueDate).toBe('2026-11-30')

    const lastWorkdayOfDec = parseQuickAdd('每月最后一个工作日 对账', new Date(2026, 11, 1, 9))
    expect(lastWorkdayOfDec.dueDate).toBe('2026-12-31')
  })

  it('解析多个“每月第 N 个星期”', () => {
    const multi = parseQuickAdd('每月第2个和第4个周二 复盘', NOW)
    expect(multi.title).toBe('复盘')
    expect(multi.recurrence).toBe('FREQ=MONTHLY;BYDAY=2TU,4TU')
    expect(multi.dueDate).toBe('2026-11-10')

    const chinese = parseQuickAdd('每月第二个、第四个周四 复盘', NOW)
    expect(chinese.recurrence).toBe('FREQ=MONTHLY;BYDAY=2TH,4TH')
    expect(chinese.dueDate).toBe('2026-11-12')
  })

  it('解析工作日的前缀写法', () => {
    const everyWorkday = parseQuickAdd('每周工作日 整理周报', NOW)
    expect(everyWorkday.title).toBe('整理周报')
    expect(everyWorkday.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')

    expect(parseQuickAdd('每个工作日 打卡', NOW).title).toBe('打卡')
    expect(parseQuickAdd('工作日 交日报', NOW).title).toBe('交日报')
  })

  it('解析隔天与本周/下周/上周的星期区间', () => {
    const everyOtherDay = parseQuickAdd('隔天 浇花', NOW)
    expect(everyOtherDay.title).toBe('浇花')
    expect(everyOtherDay.recurrence).toBe('FREQ=DAILY;INTERVAL=2')
    expect(everyOtherDay.dueDate).toBe('2026-11-05')

    // “下周一到周五”是一次性日期范围：落在下周一，不是每周重复
    const nextWeek = parseQuickAdd('下周一到周五 出差', NOW)
    expect(nextWeek.title).toBe('出差')
    expect(nextWeek.recurrence).toBeNull()
    expect(nextWeek.dueDate).toBe('2026-11-09')

    const thisWeek = parseQuickAdd('本周五到周日 团建', NOW)
    expect(thisWeek.title).toBe('团建')
    expect(thisWeek.recurrence).toBeNull()
    expect(thisWeek.dueDate).toBe('2026-11-06')

    // 本周区间已整段过去：顺延到下一周的周一，避免建出立即逾期的任务
    const pastThisWeek = parseQuickAdd('本周一到周三 早会', NOW)
    expect(pastThisWeek.dueDate).toBe('2026-11-09')
    expect(pastThisWeek.recurrence).toBeNull()

    const lastWeek = parseQuickAdd('上周一到周三 复盘', NOW)
    expect(lastWeek.dueDate).toBe('2026-10-26')
    expect(lastWeek.recurrence).toBeNull()
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

describe('语义解析增强', () => {
  it('“今晚/明早/昨晚”拆成日期词与时段词', () => {
    expect(parseQuickAdd('今晚8点 看电影', NOW)).toMatchObject({
      title: '看电影',
      dueDate: '2026-11-05',
      dueTime: '20:00',
      allDay: false
    })
    expect(parseQuickAdd('明早 跑步', NOW)).toMatchObject({
      title: '跑步',
      dueDate: '2026-11-06',
      dueTime: '08:00'
    })
    expect(parseQuickAdd('昨晚 复盘', NOW)).toMatchObject({
      dueDate: '2026-11-04',
      dueTime: '20:00'
    })
  })

  it('只说时段时用该时段的默认钟点', () => {
    const expected: Array<[string, string]> = [
      ['凌晨 值机', '06:00'],
      ['早上 跑步', '08:00'],
      ['上午 体检', '09:00'],
      ['中午 午饭', '12:00'],
      ['下午 评审', '15:00'],
      ['傍晚 取快递', '18:00'],
      ['晚上 看书', '20:00']
    ]
    for (const [input, time] of expected) {
      const result = parseQuickAdd(input, NOW)
      expect(result.dueTime, input).toBe(time)
      expect(result.allDay, input).toBe(false)
      expect(result.title, input).not.toMatch(/凌晨|早上|上午|中午|下午|傍晚|晚上/)
    }
  })

  it('“下午茶/晚上好”这类普通词语不被当成时间', () => {
    expect(parseQuickAdd('下午茶 约客户', NOW).dueTime).toBeNull()
    expect(parseQuickAdd('和客户喝下午茶', NOW)).toMatchObject({
      title: '和客户喝下午茶',
      dueTime: null
    })
    expect(parseQuickAdd('晚上好 发消息', NOW).dueTime).toBeNull()
  })

  it('相对时刻支持分钟、小时与中文数字', () => {
    expect(parseRelativeOffset('30分钟后 喝水')).toMatchObject({ minutes: 30 })
    expect(parseRelativeOffset('半小时后 出发')).toMatchObject({ minutes: 30 })
    expect(parseRelativeOffset('两小时以后 出发')).toMatchObject({ minutes: 120 })
    expect(parseRelativeOffset('15分钟之后 出门')).toMatchObject({ minutes: 15 })
    expect(parseRelativeOffset('30天后 体检')).toBeNull()
    expect(parseRelativeOffset('提前30分钟提醒')).toBeNull()

    expect(parseQuickAdd('30分钟后 喝水', NOW)).toMatchObject({
      title: '喝水',
      dueDate: '2026-11-05',
      dueTime: '09:30',
      allDay: false
    })
    expect(parseQuickAdd('3小时后 充电', NOW)).toMatchObject({
      dueDate: '2026-11-05',
      dueTime: '12:00'
    })
    // 跨天时日期一起顺延
    expect(parseQuickAdd('90分钟后 关火', new Date(2026, 10, 5, 23, 0, 0))).toMatchObject({
      dueDate: '2026-11-06',
      dueTime: '00:30'
    })
  })

  it('相对日期支持中文数量与年/半年', () => {
    expect(parseQuickAdd('三天后 交材料', NOW).dueDate).toBe('2026-11-08')
    expect(parseQuickAdd('两周后 复盘', NOW).dueDate).toBe('2026-11-19')
    expect(parseQuickAdd('三个月后 复查', NOW).dueDate).toBe('2027-02-05')
    expect(parseQuickAdd('一年后 续保', NOW).dueDate).toBe('2027-11-05')
    expect(parseQuickAdd('半年后 保养', NOW).dueDate).toBe('2027-05-05')
  })

  it('月末/月初/周末落到具体日期', () => {
    expect(parseQuickAdd('月底 交房租', NOW).dueDate).toBe('2026-11-30')
    expect(parseQuickAdd('下个月底 交房租', NOW).dueDate).toBe('2026-12-31')
    expect(parseQuickAdd('12月底 盘点', NOW).dueDate).toBe('2026-12-31')
    expect(parseQuickAdd('下个月初 交房租', NOW).dueDate).toBe('2026-12-01')
    // 本月初已过：落到下一个 1 号，不建出立即逾期的任务
    expect(parseQuickAdd('本月初 复盘', NOW).dueDate).toBe('2026-12-01')
    expect(parseQuickAdd('本周末 爬山', NOW).dueDate).toBe('2026-11-07')
    expect(parseQuickAdd('下周末 露营', NOW).dueDate).toBe('2026-11-14')
    // 周日问“本周末”就是今天
    expect(parseQuickAdd('本周末 休息', new Date(2026, 10, 8, 9, 0, 0)).dueDate).toBe(
      '2026-11-08'
    )
  })

  it('周期与星期同时给出时合成 INTERVAL + BYDAY', () => {
    expect(parseQuickAdd('每两周的周二 复盘', NOW)).toMatchObject({
      title: '复盘',
      recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
      dueDate: '2026-11-10'
    })
    expect(parseQuickAdd('每2周的周一、周三 例会', NOW)).toMatchObject({
      title: '例会',
      recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      dueDate: '2026-11-09'
    })
    expect(parseQuickAdd('每两周的周一到周五 早会', NOW).recurrence).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR'
    )
    // 不带星期的周期行为不变
    expect(parseQuickAdd('每两周 大扫除', NOW).recurrence).toBe(
      'FREQ=WEEKLY;INTERVAL=2'
    )
    expect(parseQuickAdd('每周末 打扫', NOW).recurrence).toBe(
      'FREQ=WEEKLY;BYDAY=SA,SU'
    )
    expect(parseQuickAdd('每月底 结转', NOW).recurrence).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=-1'
    )
  })

  it('“每晚/每早”补成每天的重复', () => {
    expect(parseQuickAdd('每晚9点 阅读', NOW)).toMatchObject({
      title: '阅读',
      dueTime: '21:00',
      recurrence: 'FREQ=DAILY'
    })
    expect(parseQuickAdd('每早8点 跑步', NOW)).toMatchObject({
      title: '跑步',
      dueTime: '08:00',
      recurrence: 'FREQ=DAILY'
    })
    // “每早饭后”是普通说法，不当成重复与时间
    expect(parseQuickAdd('每早饭后 散步', NOW)).toMatchObject({
      title: '每早饭后 散步',
      recurrence: null,
      dueTime: null
    })
  })

  it('重复与时段同时出现时首次日期跟重复规则走', () => {
    expect(parseQuickAdd('每周五下午 总结', NOW)).toMatchObject({
      title: '总结',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      recurrence: 'FREQ=WEEKLY;BYDAY=FR'
    })
    expect(parseQuickAdd('每天 晚上8点 阅读', NOW).dueDate).toBe('2026-11-05')
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
