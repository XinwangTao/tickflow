import { describe, expect, it } from 'vitest'
import {
  parseRecentSearches,
  pushRecentSearch
} from '../mobile/src/recent-searches'

describe('mobile recent searches', () => {
  it('坏数据与空值按空列表处理', () => {
    expect(parseRecentSearches(null)).toEqual([])
    expect(parseRecentSearches('not-json')).toEqual([])
    expect(parseRecentSearches('{"a":1}')).toEqual([])
  })

  it('过滤非字符串与空串，最多保留 5 条', () => {
    const raw = JSON.stringify(['一', 2, '', '二', '三', '四', '五', '六'])
    expect(parseRecentSearches(raw)).toEqual(['一', '二', '三', '四', '五'])
  })

  it('新词置顶，大小写去重，未提交空白不记录', () => {
    expect(pushRecentSearch(['周报', '会议'], ' 周报 ')).toEqual(['周报', '会议'])
    expect(pushRecentSearch(['Report'], 'report')).toEqual(['report'])
    expect(pushRecentSearch(['周报'], '   ')).toEqual(['周报'])
  })

  it('超过 5 条时丢弃最旧记录', () => {
    let list: string[] = []
    for (const term of ['a', 'b', 'c', 'd', 'e', 'f']) list = pushRecentSearch(list, term)
    expect(list).toEqual(['f', 'e', 'd', 'c', 'b'])
  })
})
