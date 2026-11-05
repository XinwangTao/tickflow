import type { ReactNode } from 'react'

export type IconName =
  | 'check'
  | 'tasks'
  | 'calendar'
  | 'calendar-range'
  | 'board'
  | 'stats'
  | 'play'
  | 'pause'
  | 'filter'
  | 'grid'
  | 'timer'
  | 'habit'
  | 'search'
  | 'inbox'
  | 'sun'
  | 'moon'
  | 'settings'
  | 'bell'
  | 'help'
  | 'plus'
  | 'more'
  | 'flag'
  | 'tag'
  | 'star'
  | 'trash'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'close'
  | 'pencil'
  | 'grip'
  | 'rotate'
  | 'list'
  | 'check-circle'
  | 'folder'

const ICONS: Record<IconName, ReactNode> = {
  check: <path d="M5 12.5l4.2 4.2L19 7.5" />,
  tasks: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M8 9.5l1.5 1.5L12 8.5" />
      <path d="M14 9.5h3M8 15h9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </>
  ),
  'calendar-range': (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17M7.5 14h4M12.5 14h4M7.5 17h3" />
    </>
  ),
  board: (
    <>
      <rect x="4" y="4" width="4.5" height="16" rx="1.5" />
      <rect x="9.75" y="4" width="4.5" height="16" rx="1.5" />
      <rect x="15.5" y="4" width="4.5" height="16" rx="1.5" />
    </>
  ),
  stats: <path d="M4 20V12M10 20V6M16 20v-8M22 20H2" />,
  play: <path d="M8 5l11 7-11 7z" />,
  pause: (
    <>
      <rect x="7" y="5" width="3.5" height="14" rx="1" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
    </>
  ),
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8z" />,
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 13V9M9 3h6M18.5 6.5l1.5-1.5" />
    </>
  ),
  habit: (
    <>
      <path d="M20 12a8 8 0 1 1-3.2-6.4" />
      <path d="M20 4v5h-5" />
      <path d="M9 12.5l2 2 4-4.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" />
      <path d="M4 13h4l1.5 2h5L16 13h4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />,
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-.9.7-1.5 1.2-1.5 2.5" />
      <path d="M12 17.2v.1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  more: (
    <>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  flag: (
    <>
      <path d="M6 21V4" />
      <path d="M6 4h11l-2 3.5L17 11H6" />
    </>
  ),
  tag: (
    <>
      <path d="M4 4h7l9 9-7 7-9-9z" />
      <circle cx="8.5" cy="8.5" r="1.2" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  minimize: <path d="M5 12h14" />,
  maximize: <rect x="5" y="5" width="14" height="14" rx="2" />,
  restore: (
    <>
      <rect x="4" y="8" width="12" height="12" rx="2" />
      <path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  pencil: (
    <>
      <path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
      <path d="M13.5 7.5l3 3" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  rotate: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </>
  ),
  folder: (
    <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" />
  )
}

interface IconProps {
  name: IconName
  size?: number
  className?: string
  filled?: boolean
}

export function Icon({ name, size = 18, className, filled = false }: IconProps): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  )
}
