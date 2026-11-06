import { Modal } from './Modal'

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['Ctrl', 'N'], label: '在当前视图新建任务' },
  { keys: ['Ctrl', 'K'], label: '搜索任务、备注、标签' },
  { keys: ['Ctrl', 'Shift', 'N'], label: '全局唤起窗口并聚焦快速添加' },
  { keys: ['Ctrl', 'A'], label: '多选模式下全选任务' },
  { keys: ['空格'], label: '切换聚焦任务的完成状态' },
  { keys: ['↑', '↓'], label: '在任务之间移动焦点' },
  { keys: ['Delete'], label: '将任务移入垃圾箱（可撤销）' },
  { keys: ['Esc'], label: '关闭弹层 / 详情 / 搜索，或退出多选' },
  { keys: ['?'], label: '打开本帮助' },
  { keys: ['双击'], label: '行内编辑任务标题或清单名称' }
]

export function ShortcutHelp({ onClose }: { onClose: () => void }): React.ReactNode {
  return (
    <Modal title="快捷键" onClose={onClose} width={420}>
      <div className="shortcut-list">
        {SHORTCUTS.map((item) => (
          <div className="shortcut-row" key={item.label}>
            <span>{item.label}</span>
            <span className="shortcut-keys">
              {item.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
      <p className="settings-note">Windows 使用 Ctrl，macOS 使用 ⌘。</p>
    </Modal>
  )
}
