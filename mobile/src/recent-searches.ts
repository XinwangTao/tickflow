export const RECENT_SEARCH_KEY = 'tickflow.recentSearches'
export const RECENT_SEARCH_LIMIT = 5

/** 解析 localStorage 中的最近搜索；坏数据按空处理。 */
export function parseRecentSearches(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      .slice(0, RECENT_SEARCH_LIMIT)
  } catch {
    return []
  }
}

/** 新词置顶、忽略大小写重复、最多保留 5 条。 */
export function pushRecentSearch(current: string[], term: string): string[] {
  const text = term.trim()
  if (!text) return current
  return [text, ...current.filter((item) => item.toLowerCase() !== text.toLowerCase())].slice(
    0,
    RECENT_SEARCH_LIMIT
  )
}
