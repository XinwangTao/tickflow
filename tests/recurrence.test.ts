import { describe, expect, it } from 'vitest'
import {
  normalizeRecurrenceRule,
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

  it('无法识别时原样返回规则', () => {
    expect(describeRecurrence('FREQ=HOURLY;INTERVAL=2')).toBe('FREQ=HOURLY;INTERVAL=2')
  })
})
