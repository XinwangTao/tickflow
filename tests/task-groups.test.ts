import { describe, expect, it } from 'vitest'
import { buildDateGroups } from '../src/shared/task-groups'

const TODAY = '2026-11-05'

function group(key: string) {
  const found = buildDateGroups(TODAY).find((item) => item.key === key)
  if (!found) throw new Error(`missing group ${key}`)
  return found
}

describe('date groups', () => {
  it('把任务分到今天/明天/本周/以后/无日期', () => {
    expect(group('today').matches({ dueDate: '2026-11-04' })).toBe(true)
    expect(group('today').matches({ dueDate: TODAY })).toBe(true)
    expect(group('tomorrow').matches({ dueDate: '2026-11-06' })).toBe(true)
    expect(group('week').matches({ dueDate: '2026-11-08' })).toBe(true)
    expect(group('week').matches({ dueDate: '2026-11-06' })).toBe(false)
    expect(group('later').matches({ dueDate: '2026-11-09' })).toBe(true)
    expect(group('none').matches({ dueDate: null })).toBe(true)
    expect(group('none').matches({ dueDate: '2026-11-05' })).toBe(false)
  })

  it('拖拽到列时给出对应的截止日期', () => {
    expect(group('today').dueDate).toBe(TODAY)
    expect(group('tomorrow').dueDate).toBe('2026-11-06')
    expect(group('week').dueDate).toBe('2026-11-08')
    expect(group('later').dueDate).toBe('2026-11-19')
    expect(group('none').dueDate).toBeNull()
  })
})
