import type { ReactNode } from 'react'

export function Icon({ name, size = 20 }: { name: string; size?: number }): ReactNode {
  const paths: Record<string, ReactNode> = {
    today: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M8 12.5l2.5 2.5L16 9.5" />
      </>
    ),
    lists: (
      <>
        <path d="M8 6h12M8 12h12M8 18h12" />
        <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
        <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    calendar: (
      <>
        <rect x="3.5" y="5" width="17" height="15" rx="3" />
        <path d="M8 3v4M16 3v4M3.5 10h17" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="10" cy="17" r="2" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </>
    ),
    habit: (
      <>
        <path d="M20 12a8 8 0 1 1-3.2-6.4" />
        <path d="M20 4v5h-5" />
        <path d="M9 12.5l2 2 4-4.5" />
      </>
    ),
    timer: (
      <>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 13V9M9 3h6M18.5 6.5l1.5-1.5" />
      </>
    ),
    stats: <path d="M4 20V12M10 20V6M16 20v-8M22 20H2" />,
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4 4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="M5 12.5l4.2 4.2L19 7.5" />,
    select: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M8.5 12.2l2.3 2.3 4.7-5" />
      </>
    ),
    bell: (
      <>
        <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </>
    ),
    back: <path d="M15 6l-6 6 6 6" />,
    chevronRight: <path d="M9 6l6 6-6 6" />,
    chevronDown: <path d="M6 9l6 6 6-6" />,
    trash: (
      <>
        <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        <path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12" />
      </>
    ),
    sync: (
      <>
        <path d="M20 12a8 8 0 1 1-2.3-5.7" />
        <path d="M20 4v5h-5" />
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
    close: <path d="M6 6l12 12M18 6L6 18" />
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
