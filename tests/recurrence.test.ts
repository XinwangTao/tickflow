import { describe, expect, it } from 'vitest'
import { RRule } from 'rrule'
import {
  normalizeRecurrenceRule,
  parseQuickAdd,
  parseRecurrenceRule
} from '../src/shared/quick-add'
import { describeRecurrence } from '../src/renderer/src/lib/format'

describe('normalizeRecurrenceRule', () => {
  it('统一大小写、去空格并规范 BYDAY 顺序', () => {
    expect(normalizeRecurrenceRule('freq=weekly;byday=fr,mo')).toBe(
      'FREQ=WEEKLY;BYDAY=MO,FR'
    )
    expect(normalizeRecurrenceRule('RRULE: FREQ=DAILY')).toBe('FREQ=DAILY')
    expect(normalizeRecurrenceRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;INTERVAL=2')).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR'
    )
  })

  it('丢弃非法 INTERVAL/COUNT/BYDAY，而不是让整条规则失效', () => {
    expect(normalizeRecurrenceRule('FREQ=DAILY;INTERVAL=0;BYDAY=XX')).toBe('FREQ=DAILY')
    expect(normalizeRecurrenceRule('FREQ=DAILY;COUNT=0')).toBe('FREQ=DAILY')
    expect(normalizeRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=32,1,-1,0')).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=1,-1'
    )
    expect(normalizeRecurrenceRule('FREQ=YEARLY;BYMONTH=13,3;BYMONTHDAY=5')).toBe(
      'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=5'
    )
  })

  it('保留每月第 N 个星期的 BYSETPOS 与 UNTIL', () => {
    expect(normalizeRecurrenceRule('FREQ=MONTHLY;BYDAY=mo;BYSETPOS=-1')).toBe(
      'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1'
    )
    expect(normalizeRecurrenceRule('FREQ=MONTHLY;BYDAY=2tu,4tu')).toBe(
      'FREQ=MONTHLY;BYDAY=2TU,4TU'
    )
    expect(normalizeRecurrenceRule('FREQ=WEEKLY;UNTIL=20261231T235959Z')).toBe(
      'FREQ=WEEKLY;UNTIL=20261231T235959Z'
    )
  })

  it('未知 FREQ 或中文重复短语不直接落库', () => {
    expect(normalizeRecurrenceRule('FREQ=HOURLY')).toBeNull()
    expect(normalizeRecurrenceRule('每周一三五')).toBeNull()
    expect(normalizeRecurrenceRule(42)).toBeNull()
  })

  it('parseRecurrenceRule 可把 AI 返回的中文短语翻译成 RRULE', () => {
    const now = new Date(2026, 10, 5, 9, 0, 0)
    expect(parseRecurrenceRule('每周一三五', now)).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR')
    expect(parseRecurrenceRule('每月最后一个周五', now)).toBe(
      'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1'
    )
    expect(parseRecurrenceRule('不是重复', now)).toBeNull()
  })
})

describe('生成的 RRULE 可被 rrule 正常展开', () => {
  const NOW = new Date(2026, 10, 5, 9, 0, 0)

  function firstOccurrence(input: string): { dueDate: string; first: string } {
    const result = parseQuickAdd(input, NOW)
    expect(result.recurrence).toBeTruthy()
    const start = result.dueDate?.replace(/-/g, '') ?? ''
    const rule = RRule.fromString(
      `DTSTART:${start}T090000\nRRULE:${result.recurrence}`
    )
    const first = rule.all()[0]
    expect(first).toBeTruthy()
    const pad = (value: number): string => String(value).padStart(2, '0')
    return {
      dueDate: result.dueDate ?? '',
      first: `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(first.getDate())}`
    }
  }

  it('自然季度第一/最后一天不会算出空集', () => {
    expect(firstOccurrence('每季度第一天 复盘')).toEqual({
      dueDate: '2027-01-01',
      first: '2027-01-01'
    })
    expect(firstOccurrence('每季度最后一天 结转')).toEqual({
      dueDate: '2026-12-31',
      first: '2026-12-31'
    })
  })

  it('多日期、多序号与最后一个工作日从首次日期开始展开', () => {
    expect(firstOccurrence('每月的1号和15号 对账')).toEqual({
      dueDate: '2026-11-15',
      first: '2026-11-15'
    })
    expect(firstOccurrence('每月第2个和第4个周二 复盘')).toEqual({
      dueDate: '2026-11-10',
      first: '2026-11-10'
    })
    expect(firstOccurrence('每月最后一个工作日 对账')).toEqual({
      dueDate: '2026-11-30',
      first: '2026-11-30'
    })
  })
})

describe('describeRecurrence', () => {
  it('展示间隔重复，而不是笼统的每天/每周', () => {
    expect(describeRecurrence('FREQ=DAILY;INTERVAL=3')).toBe('每3天')
    expect(describeRecurrence('FREQ=WEEKLY;INTERVAL=2')).toBe('每2周')
    expect(describeRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')).toBe(
      '每2周的周一、周三'
    )
    expect(describeRecurrence('FREQ=MONTHLY;INTERVAL=3')).toBe('每3个月')
    expect(describeRecurrence('FREQ=YEARLY;INTERVAL=2')).toBe('每2年')
  })

  it('展示星期、每月第 N 个星期与月末', () => {
    expect(describeRecurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe('每周一、三、五')
    expect(describeRecurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('工作日')
    expect(describeRecurrence('FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1')).toBe('每月第1个周一')
    expect(describeRecurrence('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1')).toBe(
      '每月最后一个周五'
    )
    expect(describeRecurrence('FREQ=MONTHLY;BYMONTHDAY=1,15')).toBe('每月1日、15日')
    expect(describeRecurrence('FREQ=MONTHLY;BYMONTHDAY=-1')).toBe('每月最后一天')
    expect(describeRecurrence('FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=5')).toBe('每年3月5日')
  })

  it('展示多个“每月第 N 个星期”与最后一个工作日', () => {
    expect(describeRecurrence('FREQ=MONTHLY;BYDAY=2TU,4TU')).toBe(
      '每月第2个、第4个周二'
    )
    expect(describeRecurrence('FREQ=MONTHLY;BYDAY=2TH,4TH')).toBe(
      '每月第2个、第4个周四'
    )
    expect(describeRecurrence('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1')).toBe(
      '每月最后一个工作日'
    )
    expect(describeRecurrence('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1')).toBe(
      '每月第1个工作日'
    )
  })

  it('展示自然季度边界，而不是每3个月N日', () => {
    expect(
      describeRecurrence('FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=1')
    ).toBe('每季度第一天')
    expect(
      describeRecurrence('FREQ=YEARLY;BYMONTH=3,6,9,12;BYMONTHDAY=-1')
    ).toBe('每季度最后一天')
  })

  it('无法识别时原样返回规则', () => {
    expect(describeRecurrence('FREQ=HOURLY;INTERVAL=2')).toBe('FREQ=HOURLY;INTERVAL=2')
  })
})
