export const LIST_COLORS = [
  '#f5c542',
  '#e5484d',
  '#f76b15',
  '#30a46c',
  '#0091ff',
  '#8e4ec6',
  '#e93d82',
  '#6e7681'
]

export const PRIORITY_LABELS = ['无', '低', '中', '高'] as const

export const PRIORITY_COLORS: Record<number, string> = {
  0: 'var(--muted)',
  1: 'var(--low)',
  2: 'var(--medium)',
  3: 'var(--high)'
}
