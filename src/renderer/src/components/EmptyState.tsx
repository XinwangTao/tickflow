import type { ViewKey } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

const CONTENT: Record<string, { title: string; text: string; cta?: string }> = {
  today: {
    title: '今天没有安排',
    text: '新建一个任务，或按 Ctrl+N 快速添加。',
    cta: '添加任务'
  },
  next7: {
    title: '最近 7 天没有任务',
    text: '给任务加上日期，它们会出现在这里。',
    cta: '添加任务'
  },
  inbox: {
    title: '收集箱是空的',
    text: '把脑子里的想法先丢进收集箱，再慢慢整理。',
    cta: '添加任务'
  },
  completed: {
    title: '还没有已完成的任务',
    text: '完成任务后，它们会安静地待在这里。'
  },
  abandoned: {
    title: '没有已放弃的任务',
    text: '暂时不想做的任务，可以标记为已放弃。'
  },
  trash: {
    title: '垃圾箱是空的',
    text: '删除的任务会先进入垃圾箱，可随时恢复。'
  }
}

export function EmptyState({ view }: { view: ViewKey }): React.ReactNode {
  const focusQuickAdd = useAppStore((state) => state.focusQuickAdd)
  const key = view.startsWith('list:') ? 'list' : view
  const content =
    CONTENT[key] ??
    ({
      title: '这个清单还没有任务',
      text: '按 Ctrl+N 或在上方输入框添加第一个任务。',
      cta: '添加任务'
    } as const)

  return (
    <div className="empty-state">
      <svg
        className="empty-art"
        viewBox="0 0 160 130"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="30" y="18" width="100" height="94" rx="12" opacity="0.35" />
        <path d="M50 42h44" opacity="0.35" />
        <path d="M50 58h58" opacity="0.22" />
        <path d="M50 74h34" opacity="0.22" />
        <circle cx="112" cy="88" r="24" fill="var(--panel)" />
        <path d="M101 88l7 7 15-16" />
        <path d="M26 102c-8-10-12-22-10-34" opacity="0.18" />
        <path d="M134 24c8 6 13 16 13 27" opacity="0.18" />
      </svg>
      <h2>{content.title}</h2>
      <p>{content.text}</p>
      {content.cta ? (
        <button type="button" className="btn btn-primary" onClick={focusQuickAdd}>
          <Icon name="plus" size={15} />
          {content.cta}
        </button>
      ) : null}
    </div>
  )
}
