import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import type { Priority } from '@shared/types'
import { INBOX_ID } from '@shared/types'
import type { SyncTask } from '@shared/sync'
import { parseQuickAdd } from '@shared/quick-add'
import { formatDateLabel, isOverdue, toDateKey, todayKey } from '@shared/dates'
import { R2_CORS_POLICY } from '@shared/r2-cors'
import {
  createList,
  createTask,
  deleteList,
  ensureSeed,
  getDeviceId,
  getSettingsMap,
  listLists,
  queryTasks,
  removeTask,
  removeTasks,
  renameList,
  saveSettings,
  setTasksStatus,
  toggleTask,
  updateTask,
  type ListWithCount
} from './db'
import { Icon } from './Icon'
import { MoreTab } from './MoreTab'
import { buildBackupJson, importBackupJson } from './backup'
import { autoSync, getSyncUsage, syncNow, testSync } from './sync'

const PRIORITY_LABELS = ['无', '低', '中', '高']
const PRIORITY_COLORS = ['var(--muted)', 'var(--low)', 'var(--medium)', 'var(--high)']
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

type Tab = 'today' | 'lists' | 'calendar' | 'more' | 'settings'
type ToastKind = 'info' | 'success' | 'error'


function monthDays(monthKey: string): Date[] {
  const [year, month] = monthKey.split('-').map(Number)
  const first = new Date(year, month - 1, 1)
  const offset = first.getDay() === 0 ? 6 : first.getDay() - 1
  const start = new Date(first)
  start.setDate(first.getDate() - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function TaskRow({
  task,
  lists,
  onOpen,
  onToggle,
  selectionMode = false,
  selected = false,
  onSelect,
  onLongPress
}: {
  task: SyncTask
  lists: ListWithCount[]
  onOpen: () => void
  onToggle: () => void
  selectionMode?: boolean
  selected?: boolean
  onSelect?: () => void
  onLongPress?: () => void
}): ReactNode {
  const overdue = isOverdue(task.dueDate, task.dueTime, task.allDay)
  const list = lists.find((item) => item.id === task.listId)
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)

  const clearPress = (): void => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  useEffect(() => clearPress, [])

  const startPress = (): void => {
    if (selectionMode) return
    longPressed.current = false
    clearPress()
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      onLongPress?.()
    }, 450)
  }

  const activate = (): void => {
    if (longPressed.current) {
      longPressed.current = false
      return
    }
    if (selectionMode) onSelect?.()
    else onOpen()
  }

  return (
    <div
      className={`task-row ${task.status === 'completed' ? 'done' : ''} ${
        selectionMode ? 'selecting' : ''
      } ${selected ? 'selected' : ''}`}
      onClick={activate}
      role="button"
      tabIndex={0}
      onPointerDown={startPress}
      onPointerUp={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
      onContextMenu={(event) => {
        if (selectionMode) return
        event.preventDefault()
        clearPress()
        longPressed.current = true
        onLongPress?.()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          activate()
        }
      }}
    >
      {selectionMode ? (
        <span className={`select-dot ${selected ? 'on' : ''}`} aria-hidden="true">
          {selected ? <Icon name="check" size={12} /> : null}
        </span>
      ) : (
        <button
          type="button"
          className={`task-check ${task.status === 'completed' ? 'checked' : ''}`}
          aria-label={task.status === 'completed' ? '标记为未完成' : '标记为已完成'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
        >
          {task.status === 'completed' ? <Icon name="today" size={13} /> : null}
        </button>
      )}
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {task.dueDate ? (
            <span className={overdue ? 'overdue' : ''}>
              <Icon name="calendar" size={12} />
              {formatDateLabel(task.dueDate)}
              {task.allDay || !task.dueTime ? '' : ` ${task.dueTime}`}
            </span>
          ) : null}
          {task.priority > 0 ? (
            <span style={{ color: PRIORITY_COLORS[task.priority] }}>
              <Icon name="flag" size={12} />
              {PRIORITY_LABELS[task.priority]}
            </span>
          ) : null}
          {task.tagNames.slice(0, 2).map((tag) => (
            <span className="tag" key={tag}>
              #{tag}
            </span>
          ))}
          {list ? (
            <span className="list-chip">
              <i style={{ background: list.color }} />
              {list.name}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function QuickAddSheet({
  lists,
  defaultListId,
  defaultDueDate,
  onClose,
  onAdded
}: {
  lists: ListWithCount[]
  defaultListId: string
  defaultDueDate: string | null
  onClose: () => void
  onAdded: (message: string, kind: ToastKind) => void
}): ReactNode {
  const [value, setValue] = useState('')
  const parsed = useMemo(() => parseQuickAdd(value), [value])

  const add = async (): Promise<void> => {
    const text = value.trim()
    if (!text) return
    const result = parseQuickAdd(text)
    const matched = lists.find(
      (list) => list.name.toLowerCase() === (result.listName ?? '').toLowerCase()
    )
    const fallback =
      lists.find((list) => list.id === defaultListId) ??
      lists.find((list) => list.isInbox) ??
      lists[0]
    const target = matched ?? fallback
    if (!target) {
      onAdded('没有可用清单，请先新建清单', 'error')
      return
    }
    await createTask({
      listId: target.id,
      title: result.title,
      priority: result.priority,
      dueDate: result.dueDate ?? defaultDueDate,
      dueTime: result.dueTime,
      allDay: result.dueTime ? false : true,
      tagNames: result.tags,
      recurrence: result.recurrence
    })
    onAdded('已添加任务', 'success')
    onClose()
  }

  return (
    <div className="sheet-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>快速添加</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={18} />
          </button>
        </div>
        <input
          className="quick-input"
          autoFocus
          value={value}
          placeholder="明天下午3点 交周报 #工作 !高"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add()
          }}
        />
        <div className="preview">
          {parsed.dueDate ? (
            <span className="chip">
              <Icon name="calendar" size={12} />
              {formatDateLabel(parsed.dueDate)} {parsed.dueTime ?? ''}
            </span>
          ) : null}
          {parsed.priority > 0 ? (
            <span className="chip" style={{ color: PRIORITY_COLORS[parsed.priority] }}>
              <Icon name="flag" size={12} />
              {PRIORITY_LABELS[parsed.priority]}
            </span>
          ) : null}
          {parsed.tags.map((tag) => (
            <span className="chip" key={tag}>
              <Icon name="tag" size={12} />#{tag}
            </span>
          ))}
          {parsed.listName ? <span className="chip">{parsed.listName}</span> : null}
        </div>
        <p className="hint">支持：明天下午 3 点 · 每周一 · #标签 · !高 · ~清单</p>
        <button type="button" className="primary-btn" disabled={!value.trim()} onClick={() => void add()}>
          添加任务
        </button>
      </div>
    </div>
  )
}

function TaskDetailSheet({
  task,
  lists,
  onClose,
  onChanged,
  onToast
}: {
  task: SyncTask
  lists: ListWithCount[]
  onClose: () => void
  onChanged: () => void
  onToast: (message: string, kind: ToastKind) => void
}): ReactNode {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const [listId, setListId] = useState(task.listId)
  const [priority, setPriority] = useState<Priority>(task.priority)
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [dueTime, setDueTime] = useState(task.dueTime ?? '')
  const [tags, setTags] = useState(task.tagNames.join(', '))

  const save = async (): Promise<void> => {
    if (!title.trim()) return
    const tagNames = tags
      .split(/[,，\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    await updateTask(task.id, {
      title,
      notes,
      listId,
      priority,
      dueDate: dueDate || null,
      dueTime: dueTime || null,
      allDay: !dueTime,
      tagNames
    })
    onChanged()
    onClose()
  }

  const remove = async (): Promise<void> => {
    await removeTask(task.id)
    onChanged()
    onClose()
    onToast('任务已删除', 'info')
  }

  return (
    <div className="sheet-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="sheet sheet-tall">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>任务详情</h2>
          <div className="sheet-actions">
            <button
              type="button"
              className="icon-btn danger"
              onClick={() => void remove()}
              aria-label="删除任务"
            >
              <Icon name="trash" size={18} />
            </button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>
        <div className="detail-scroll">
          <input
            className="detail-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="任务标题"
          />
          <textarea
            className="detail-notes-input"
            value={notes}
            rows={4}
            placeholder="添加备注…"
            onChange={(event) => setNotes(event.target.value)}
          />
          <label className="field">
            <span>清单</span>
            <select
              className="input"
              value={listId}
              onChange={(event) => setListId(event.target.value)}
            >
              {lists.map((list) => (
                <option value={list.id} key={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>优先级</span>
            <div className="priority-row">
              {PRIORITY_LABELS.map((label, value) => (
                <button
                  key={label}
                  type="button"
                  className={`priority-choice ${priority === value ? 'selected' : ''}`}
                  style={
                    priority === value && value > 0
                      ? { color: PRIORITY_COLORS[value], borderColor: PRIORITY_COLORS[value] }
                      : undefined
                  }
                  onClick={() => setPriority(value as Priority)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>截止日期</span>
            <div className="date-row">
              <input
                className="input"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
              <input
                className="input time-input"
                type="time"
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
              />
            </div>
          </div>
          <label className="field">
            <span>标签</span>
            <input
              className="input"
              value={tags}
              placeholder="用逗号分隔"
              onChange={(event) => setTags(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary-btn"
            onClick={async () => {
              await toggleTask(task.id)
              onChanged()
              onClose()
            }}
          >
            {task.status === 'completed' ? '标记为未完成' : '标记为已完成'}
          </button>
        </div>
        <button type="button" className="primary-btn" onClick={() => void save()}>
          保存
        </button>
      </div>
    </div>
  )
}

function SearchSheet({
  lists,
  onClose,
  onOpenTask,
  onToggle
}: {
  lists: ListWithCount[]
  onClose: () => void
  onOpenTask: (task: SyncTask) => void
  onToggle: (task: SyncTask) => void
}): ReactNode {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SyncTask[]>([])

  useEffect(() => {
    const text = q.trim()
    if (!text) {
      setResults([])
      return
    }
    const timer = window.setTimeout(() => {
      void queryTasks({ kind: 'search', q: text }).then(setResults)
    }, 150)
    return () => window.clearTimeout(timer)
  }, [q])

  return (
    <div className="sheet-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="sheet sheet-tall">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>搜索</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={18} />
          </button>
        </div>
        <input
          className="quick-input"
          autoFocus
          value={q}
          placeholder="搜索任务、备注、标签"
          onChange={(event) => setQ(event.target.value)}
        />
        <div className="search-results">
          {results.length === 0 && q.trim() ? <p className="hint">没有匹配结果</p> : null}
          {results.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              lists={lists}
              onOpen={() => onOpenTask(task)}
              onToggle={() => onToggle(task)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function AddListSheet({
  onClose,
  onAdded
}: {
  onClose: () => void
  onAdded: () => void
}): ReactNode {
  const [name, setName] = useState('')
  return (
    <div className="sheet-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>新建清单</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={18} />
          </button>
        </div>
        <input
          className="quick-input"
          autoFocus
          value={name}
          placeholder="清单名称"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim()) {
              void createList(name).then(() => {
                onAdded()
                onClose()
              })
            }
          }}
        />
        <button
          type="button"
          className="primary-btn"
          disabled={!name.trim()}
          onClick={() => {
            void createList(name).then(() => {
              onAdded()
              onClose()
            })
          }}
        >
          创建清单
        </button>
      </div>
    </div>
  )
}

function SettingsTab({
  settings,
  theme,
  onThemeChange,
  onSaved,
  onToast
}: {
  settings: Record<string, string>
  theme: string
  onThemeChange: (theme: string) => void
  onSaved: () => void
  onToast: (message: string, kind: ToastKind) => void
}): ReactNode {
  const [r2, setR2] = useState({
    endpoint: settings.r2Endpoint ?? '',
    bucket: settings.r2Bucket ?? '',
    accessKeyId: settings.r2AccessKeyId ?? '',
    secretAccessKey: settings.r2SecretAccessKey ?? '',
    prefix: settings.r2Prefix || 'tickflow/snapshots/',
    autoSync: settings.r2AutoSync === '1'
  })
  const [deviceId, setDeviceId] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [usage, setUsage] = useState<{ objects: number; bytes: number } | null>(null)
  const [usageBusy, setUsageBusy] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    void getDeviceId().then(setDeviceId)
  }, [])

  const save = async (): Promise<void> => {
    await saveSettings({
      r2Endpoint: r2.endpoint.trim(),
      r2Bucket: r2.bucket.trim(),
      r2AccessKeyId: r2.accessKeyId.trim(),
      r2SecretAccessKey: r2.secretAccessKey.trim(),
      r2Prefix: r2.prefix.trim() || 'tickflow/snapshots/',
      r2AutoSync: r2.autoSync ? '1' : '0'
    })
    onToast('同步配置已保存', 'success')
    onSaved()
  }

  const test = async (): Promise<void> => {
    await save()
    const result = await testSync()
    onToast(result.message, result.ok ? 'success' : 'error')
  }

  const sync = async (): Promise<void> => {
    await save()
    setSyncing(true)
    const result = await syncNow()
    setSyncing(false)
    onToast(result.message, result.ok ? 'success' : 'error')
    if (result.ok) onSaved()
  }

  const checkUsage = async (): Promise<void> => {
    await save()
    setUsageBusy(true)
    try {
      setUsage(await getSyncUsage())
    } catch (error) {
      onToast(String(error), 'error')
    } finally {
      setUsageBusy(false)
    }
  }

  const exportBackup = async (): Promise<void> => {
    setBackupBusy(true)
    try {
      const json = await buildBackupJson()
      const file = new File([json], `tickflow-backup-${todayKey()}.json`, {
        type: 'application/json'
      })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: '刻度清单备份' })
        onToast('已打开分享面板', 'success')
      } else {
        await navigator.clipboard.writeText(json)
        onToast(`备份已复制到剪贴板（${(json.length / 1024).toFixed(1)} KB）`, 'success')
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        onToast(String(error), 'error')
      }
    } finally {
      setBackupBusy(false)
    }
  }

  const runImport = async (): Promise<void> => {
    if (!importText.trim()) return
    setImporting(true)
    try {
      const counts = await importBackupJson(importText)
      onToast(
        `导入完成：${counts.tasks} 个任务、${counts.habits} 个习惯、${counts.sessions} 条番茄`,
        'success'
      )
      setImportOpen(false)
      setImportText('')
      onSaved()
    } catch (error) {
      onToast(String(error), 'error')
    } finally {
      setImporting(false)
    }
  }

  const copyCors = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(R2_CORS_POLICY)
      onToast('CORS 配置已复制', 'success')
    } catch {
      onToast('复制失败', 'error')
    }
  }

  return (
    <div className="settings">
      <section className="settings-section">
        <h3>外观</h3>
        <div className="segmented">
          {[
            { value: 'dark', label: '深色' },
            { value: 'light', label: '浅色' },
            { value: 'system', label: '跟随系统' }
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className={theme === option.value ? 'selected' : ''}
              onClick={() => {
                onThemeChange(option.value)
                void saveSettings({ theme: option.value })
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h3>同步（Cloudflare R2）</h3>
        <label className="field">
          <span>Endpoint</span>
          <input
            className="input"
            value={r2.endpoint}
            placeholder="https://<account>.r2.cloudflarestorage.com"
            onChange={(event) => setR2({ ...r2, endpoint: event.target.value })}
          />
        </label>
        <div className="date-row">
          <label className="field">
            <span>Bucket</span>
            <input
              className="input"
              value={r2.bucket}
              onChange={(event) => setR2({ ...r2, bucket: event.target.value })}
            />
          </label>
          <label className="field">
            <span>前缀</span>
            <input
              className="input"
              value={r2.prefix}
              onChange={(event) => setR2({ ...r2, prefix: event.target.value })}
            />
          </label>
        </div>
        <label className="field">
          <span>Access Key ID</span>
          <input
            className="input"
            value={r2.accessKeyId}
            onChange={(event) => setR2({ ...r2, accessKeyId: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Secret Access Key</span>
          <input
            className="input"
            type="password"
            value={r2.secretAccessKey}
            onChange={(event) => setR2({ ...r2, secretAccessKey: event.target.value })}
          />
        </label>
        <div className="switch-row">
          <span>启动时自动同步</span>
          <button
            type="button"
            className={`switch ${r2.autoSync ? 'on' : ''}`}
            role="switch"
            aria-checked={r2.autoSync}
            onClick={() => setR2({ ...r2, autoSync: !r2.autoSync })}
          >
            <span />
          </button>
        </div>
        <div className="button-row">
          <button type="button" className="secondary-btn" onClick={() => void save()}>
            保存
          </button>
          <button type="button" className="secondary-btn" onClick={() => void test()}>
            测试连接
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={syncing}
            onClick={() => void sync()}
          >
            {syncing ? '同步中…' : '立即同步'}
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={usageBusy}
            onClick={() => void checkUsage()}
          >
            {usageBusy ? '查询中…' : '查看用量'}
          </button>
        </div>
        <p className="hint">
          上次同步：{settings.r2LastSync ? new Date(settings.r2LastSync).toLocaleString('zh-CN') : '从未'}
        </p>
        <p className="hint">
          {usage
            ? `云端 ${usage.objects} 份快照 · ${(usage.bytes / 1024).toFixed(1)} KB（R2 免费额度 10GB）`
            : '仅同步清单与任务，每台设备覆盖写一份快照，单份上限 5 MiB。'}
        </p>
        <p className="hint">
          Android 需要给桶配置 CORS（允许 https://localhost）。
        </p>
        <button type="button" className="secondary-btn" onClick={() => void copyCors()}>
          复制 CORS 配置
        </button>
      </section>

      <section className="settings-section">
        <h3>本地备份</h3>
        <p className="hint">导出清单/任务/习惯/番茄；R2 与 AI 凭据不会写入备份。</p>
        <div className="button-row">
          <button
            type="button"
            className="secondary-btn"
            disabled={backupBusy}
            onClick={() => void exportBackup()}
          >
            {backupBusy ? '导出中…' : '导出 JSON'}
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setImportOpen(true)}
          >
            导入 JSON
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>设备</h3>
        <p className="hint">设备 ID：{deviceId}</p>
        <p className="hint">刻度清单 Android 0.1.0 · 本地优先 · R2 快照同步</p>
      </section>

      {importOpen ? (
        <div
          className="sheet-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setImportOpen(false)
          }}
        >
          <div className="sheet sheet-tall">
            <div className="sheet-handle" />
            <div className="sheet-header">
              <h2>导入 JSON 备份</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="关闭"
                onClick={() => setImportOpen(false)}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <textarea
              className="backup-textarea"
              value={importText}
              placeholder="粘贴从「导出 JSON」得到的备份内容"
              onChange={(event) => setImportText(event.target.value)}
            />
            <button
              type="button"
              className="primary-btn"
              disabled={importing || !importText.trim()}
              onClick={() => void runImport()}
            >
              {importing ? '导入中…' : '开始导入'}
            </button>
            <p className="hint">按 ID 合并，已存在的记录会跳过，不会删除现有数据。</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CompletedSection({
  tasks,
  lists,
  open,
  onToggleOpen,
  onOpenTask,
  onToggle
}: {
  tasks: SyncTask[]
  lists: ListWithCount[]
  open: boolean
  onToggleOpen: () => void
  onOpenTask: (id: string) => void
  onToggle: (task: SyncTask) => void
}): ReactNode {
  if (tasks.length === 0) return null
  return (
    <div className="completed-section">
      <button
        type="button"
        className="completed-toggle"
        aria-expanded={open}
        onClick={onToggleOpen}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} />
        <span>已完成 {tasks.length}</span>
      </button>
      {open ? (
        <div className="task-list completed-list">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              lists={lists}
              onOpen={() => onOpenTask(task.id)}
              onToggle={() => onToggle(task)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function App(): ReactNode {
  const [tab, setTab] = useState<Tab>('today')
  const [listId, setListId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<SyncTask[]>([])
  const [allTasks, setAllTasks] = useState<SyncTask[]>([])
  const [lists, setLists] = useState<ListWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [quickOpen, setQuickOpen] = useState(false)
  const [addListOpen, setAddListOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [toast, setToast] = useState<{ id: number; message: string; kind: ToastKind } | null>(null)
  const [theme, setTheme] = useState('dark')
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [calendarMonth, setCalendarMonth] = useState(todayKey().slice(0, 7))
  const [selectedDate, setSelectedDate] = useState(todayKey())
  const [refreshKey, setRefreshKey] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [listMenuId, setListMenuId] = useState<string | null>(null)
  const [renamingListId, setRenamingListId] = useState<string | null>(null)
  const [listDraft, setListDraft] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const commitListRename = async (): Promise<void> => {
    if (!renamingListId) return
    try {
      await renameList(renamingListId, listDraft)
      showToast('清单已重命名', 'success')
      setRefreshKey((value) => value + 1)
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setRenamingListId(null)
    }
  }

  const removeList = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`删除清单「${name}」？其中的任务会一并删除。`)) return
    try {
      await deleteList(id)
      setListMenuId(null)
      setRefreshKey((value) => value + 1)
      showToast('清单已删除', 'info')
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const showToast = (message: string, kind: ToastKind = 'info'): void => {
    const id = Date.now()
    setToast({ id, message, kind })
    window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current))
    }, 2600)
  }

  useEffect(() => {
    let removed = false
    let handle: { remove: () => Promise<void> } | null = null
    void CapacitorApp.addListener('backButton', () => {
      if (selectionMode) {
        setSelectionMode(false)
        setSelectedIds([])
        return
      }
      if (detailId) {
        setDetailId(null)
        return
      }
      if (quickOpen) {
        setQuickOpen(false)
        return
      }
      if (addListOpen) {
        setAddListOpen(false)
        return
      }
      if (searchOpen) {
        setSearchOpen(false)
        return
      }
      if (listMenuId) {
        setListMenuId(null)
        return
      }
      if (renamingListId) {
        setRenamingListId(null)
        return
      }
      if (tab !== 'today' || listId) {
        setTab('today')
        setListId(null)
        return
      }
      void CapacitorApp.minimizeApp()
    })
      .then((listener) => {
        handle = listener
        if (removed) void listener.remove()
      })
      .catch(() => undefined)
    return () => {
      removed = true
      void handle?.remove()
    }
  }, [
    addListOpen,
    detailId,
    listId,
    listMenuId,
    quickOpen,
    renamingListId,
    searchOpen,
    selectionMode,
    tab
  ])

  const reload = async (): Promise<void> => {
    const [nextLists, all] = await Promise.all([
      listLists(),
      queryTasks({ kind: 'all' })
    ])
    setLists(nextLists)
    setAllTasks(all)
    if (tab === 'today') setTasks(await queryTasks({ kind: 'today' }))
    else if (tab === 'lists' && listId) setTasks(await queryTasks({ kind: 'list', listId }))
    else if (tab === 'lists') setTasks([])
    else if (tab === 'calendar') setTasks(all)
    else setTasks([])
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await ensureSeed()
      const map = await getSettingsMap()
      if (cancelled) return
      setSettings(map)
      const nextTheme =
        map.theme === 'light' || map.theme === 'system' ? map.theme : 'dark'
      setTheme(nextTheme)
      document.documentElement.dataset.theme = nextTheme
      await reload()
      const result = await autoSync()
      if (!cancelled && result) {
        showToast(result.message, result.ok ? 'success' : 'error')
        if (result.ok) await reload()
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const resolved =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolved
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, listId, refreshKey])

  const detailTask = detailId
    ? allTasks.find((task) => task.id === detailId) ??
      tasks.find((task) => task.id === detailId) ??
      null
    : null

  const defaultListId = listId ?? INBOX_ID
  const defaultDueDate = tab === 'today' ? todayKey() : tab === 'calendar' ? selectedDate : null

  const currentList = listId ? lists.find((list) => list.id === listId) : null
  const title =
    tab === 'today'
      ? '今天'
      : tab === 'lists'
        ? currentList?.name ?? '清单'
        : tab === 'calendar'
          ? '日历'
          : tab === 'more'
            ? '更多'
            : '设置'
  const subtitle =
    tab === 'today'
      ? new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(
          new Date()
        )
      : tab === 'lists' && !listId
        ? `${lists.length} 个清单`
        : tab === 'more'
          ? '习惯 · 番茄 · 统计'
          : ''
  const canSelect =
    tab === 'today' || (tab === 'lists' && Boolean(listId)) || tab === 'calendar'

  const handleSync = async (): Promise<void> => {
    setSyncing(true)
    const result = await syncNow()
    setSyncing(false)
    showToast(result.message, result.ok ? 'success' : 'error')
    if (result.ok) {
      setRefreshKey((value) => value + 1)
      setSettings(await getSettingsMap())
    }
  }

  const toggle = async (task: SyncTask): Promise<void> => {
    await toggleTask(task.id)
    setRefreshKey((value) => value + 1)
  }

  const exitSelection = (): void => {
    setSelectionMode(false)
    setSelectedIds([])
  }

  const enterSelection = (id: string): void => {
    setSelectionMode(true)
    setSelectedIds((current) => (current.includes(id) ? current : [...current, id]))
  }

  const toggleSelected = (id: string): void => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    )
  }

  const batchComplete = async (): Promise<void> => {
    const count = await setTasksStatus(selectedIds, 'completed')
    exitSelection()
    setRefreshKey((value) => value + 1)
    showToast(`已完成 ${count} 个任务`, 'success')
  }

  const batchDelete = async (): Promise<void> => {
    if (!window.confirm(`删除选中的 ${selectedIds.length} 个任务？`)) return
    const count = await removeTasks(selectedIds)
    exitSelection()
    setRefreshKey((value) => value + 1)
    showToast(`已删除 ${count} 个任务`, 'info')
  }

  useEffect(() => {
    setSelectionMode(false)
    setSelectedIds([])
  }, [tab, listId])

  const dayTasks = allTasks
    .filter((task) => task.dueDate === selectedDate)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1
      return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99')
    })
  const todayStr = todayKey()
  const completedToday = allTasks.filter(
    (task) =>
      !task.parentId &&
      task.status === 'completed' &&
      task.completedAt != null &&
      toDateKey(new Date(task.completedAt)) === todayStr
  )
  const completedInList = listId
    ? allTasks.filter(
        (task) => !task.parentId && task.status === 'completed' && task.listId === listId
      )
    : []
  const completedRows = tab === 'today' ? completedToday : completedInList
  const byDate = new Map<string, SyncTask[]>()
  for (const task of allTasks) {
    if (!task.dueDate) continue
    const bucket = byDate.get(task.dueDate) ?? []
    bucket.push(task)
    byDate.set(task.dueDate, bucket)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          {tab === 'lists' && listId ? (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setListId(null)}
              aria-label="返回清单"
            >
              <Icon name="back" size={20} />
            </button>
          ) : null}
          <div>
            <h1>{selectionMode ? `已选 ${selectedIds.length} 项` : title}</h1>
            {!selectionMode && subtitle ? <span>{subtitle}</span> : null}
          </div>
        </div>
        <div className="topbar-actions">
          {selectionMode ? (
            <button type="button" className="text-btn" onClick={exitSelection}>
              取消
            </button>
          ) : (
            <>
              {tab !== 'settings' ? (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setSearchOpen(true)}
                  aria-label="搜索"
                >
                  <Icon name="search" size={20} />
                </button>
              ) : null}
              {canSelect && tasks.length > 0 ? (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setSelectionMode(true)}
                  aria-label="多选任务"
                >
                  <Icon name="select" size={20} />
                </button>
              ) : null}
              <button
                type="button"
                className={`icon-btn ${syncing ? 'spinning' : ''}`}
                onClick={() => void handleSync()}
                aria-label="同步"
                disabled={syncing}
              >
                <Icon name="sync" size={20} />
              </button>
            </>
          )}
        </div>
      </header>

      <main className={`content ${selectionMode ? 'with-batch' : ''}`}>
        {loading ? (
          <div className="loading">加载中…</div>
        ) : tab === 'today' ? (
          <>
            {tasks.length === 0 ? (
              completedToday.length === 0 ? (
                <div className="empty">
                  <div className="empty-mark">✓</div>
                  <h2>今天没有安排</h2>
                  <p>点右下角 + 添加一个任务。</p>
                </div>
              ) : (
                <p className="hint">今天没有未完成任务。</p>
              )
            ) : (
              <div className="task-list">
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    lists={lists}
                    onOpen={() => setDetailId(task.id)}
                    onToggle={() => void toggle(task)}
                    selectionMode={selectionMode}
                    selected={selectedIds.includes(task.id)}
                    onSelect={() => toggleSelected(task.id)}
                    onLongPress={() => enterSelection(task.id)}
                  />
                ))}
              </div>
            )}
            <CompletedSection
              tasks={completedRows}
              lists={lists}
              open={showCompleted}
              onToggleOpen={() => setShowCompleted((value) => !value)}
              onOpenTask={setDetailId}
              onToggle={(task) => void toggle(task)}
            />
          </>
        ) : tab === 'lists' && !listId ? (
          <div className="lists">
            {lists.map((list) => (
              <div className="list-row-wrap" key={list.id}>
                <button
                  type="button"
                  className="list-row"
                  onClick={() => {
                    if (renamingListId === list.id) return
                    setListId(list.id)
                  }}
                >
                  <span className="list-dot" style={{ background: list.color }} />
                  {renamingListId === list.id ? (
                    <input
                      className="list-rename-input"
                      value={listDraft}
                      autoFocus
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setListDraft(event.target.value)}
                      onBlur={() => void commitListRename()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void commitListRename()
                        if (event.key === 'Escape') setRenamingListId(null)
                      }}
                    />
                  ) : (
                    <span className="list-name">{list.name}</span>
                  )}
                  {list.openCount > 0 ? <span className="list-count">{list.openCount}</span> : null}
                  <Icon name="chevronRight" size={16} />
                </button>
                {!list.isInbox ? (
                  <>
                    <button
                      type="button"
                      className="list-more"
                      aria-label={`${list.name} 更多操作`}
                      onClick={() =>
                        setListMenuId(listMenuId === list.id ? null : list.id)
                      }
                    >
                      <Icon name="more" size={16} />
                    </button>
                    {listMenuId === list.id ? (
                      <div className="list-popover">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingListId(list.id)
                            setListDraft(list.name)
                            setListMenuId(null)
                          }}
                        >
                          重命名
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void removeList(list.id, list.name)}
                        >
                          删除清单
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              className="list-row add"
              onClick={() => setAddListOpen(true)}
            >
              <Icon name="plus" size={18} />
              <span className="list-name">新建清单</span>
            </button>
          </div>
        ) : tab === 'lists' ? (
          <>
            {tasks.length === 0 ? (
              completedInList.length === 0 ? (
                <div className="empty">
                  <div className="empty-mark">+</div>
                  <h2>这个清单还是空的</h2>
                  <p>点右下角 + 添加第一个任务。</p>
                </div>
              ) : (
                <p className="hint">这个清单没有未完成任务。</p>
              )
            ) : (
              <div className="task-list">
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    lists={lists}
                    onOpen={() => setDetailId(task.id)}
                    onToggle={() => void toggle(task)}
                    selectionMode={selectionMode}
                    selected={selectedIds.includes(task.id)}
                    onSelect={() => toggleSelected(task.id)}
                    onLongPress={() => enterSelection(task.id)}
                  />
                ))}
              </div>
            )}
            <CompletedSection
              tasks={completedRows}
              lists={lists}
              open={showCompleted}
              onToggleOpen={() => setShowCompleted((value) => !value)}
              onOpenTask={setDetailId}
              onToggle={(task) => void toggle(task)}
            />
          </>
        ) : tab === 'calendar' ? (
          <div className="calendar">
            <div className="calendar-toolbar">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setCalendarMonth((month) => shiftMonth(month, -1))}
                aria-label="上个月"
              >
                <Icon name="back" size={18} />
              </button>
              <strong>
                {calendarMonth.slice(0, 4)} 年 {Number(calendarMonth.slice(5, 7))} 月
              </strong>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setCalendarMonth((month) => shiftMonth(month, 1))}
                aria-label="下个月"
              >
                <Icon name="chevronRight" size={18} />
              </button>
            </div>
            <div className="weekdays">
              {WEEKDAYS.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="calendar-grid">
              {monthDays(calendarMonth).map((day) => {
                const key = toDateKey(day)
                const items = byDate.get(key) ?? []
                const inMonth = key.startsWith(calendarMonth)
                return (
                  <button
                    type="button"
                    key={key}
                    className={`cal-cell ${inMonth ? '' : 'outside'} ${
                      key === todayKey() ? 'today' : ''
                    } ${key === selectedDate ? 'selected' : ''}`}
                    onClick={() => setSelectedDate(key)}
                  >
                    <span className="cal-day">{day.getDate()}</span>
                    <span className="cal-dots">
                      {items.slice(0, 3).map((task) => (
                        <i
                          key={task.id}
                          style={{
                            background:
                              lists.find((list) => list.id === task.listId)?.color ??
                              'var(--accent)'
                          }}
                        />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="day-header">
              <strong>{formatDateLabel(selectedDate)}</strong>
              <span>{dayTasks.length} 个任务</span>
            </div>
            <div className="task-list">
              {dayTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  lists={lists}
                  onOpen={() => setDetailId(task.id)}
                  onToggle={() => void toggle(task)}
                  selectionMode={selectionMode}
                  selected={selectedIds.includes(task.id)}
                  onSelect={() => toggleSelected(task.id)}
                  onLongPress={() => enterSelection(task.id)}
                />
              ))}
              {dayTasks.length === 0 ? <p className="hint">这一天还没有任务。</p> : null}
            </div>
          </div>
        ) : tab === 'more' ? (
          <MoreTab onToast={showToast} />
        ) : (
          <SettingsTab
            settings={settings}
            theme={theme}
            onThemeChange={setTheme}
            onSaved={async () => {
              setSettings(await getSettingsMap())
              setRefreshKey((value) => value + 1)
            }}
            onToast={showToast}
          />
        )}
      </main>

      {selectionMode ? (
        <div className="batch-bar" role="toolbar" aria-label="批量操作">
          <span className="batch-count">已选 {selectedIds.length} 项</span>
          <div className="batch-actions">
            <button
              type="button"
              className="batch-btn"
              disabled={selectedIds.length === 0}
              onClick={() => void batchComplete()}
            >
              <Icon name="check" size={16} />
              完成
            </button>
            <button
              type="button"
              className="batch-btn danger"
              disabled={selectedIds.length === 0}
              onClick={() => void batchDelete()}
            >
              <Icon name="trash" size={16} />
              删除
            </button>
          </div>
        </div>
      ) : null}

      <nav className="bottom-nav">
        {[
          { key: 'today', label: '今天', icon: 'today' },
          { key: 'lists', label: '清单', icon: 'lists' },
          { key: 'calendar', label: '日历', icon: 'calendar' },
          { key: 'more', label: '更多', icon: 'more' },
          { key: 'settings', label: '设置', icon: 'settings' }
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            className={`nav-item ${tab === item.key ? 'active' : ''}`}
            onClick={() => {
              setTab(item.key as Tab)
              setListId(null)
            }}
          >
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {tab !== 'settings' && tab !== 'more' && !selectionMode ? (
        <button
          type="button"
          className="fab"
          onClick={() => setQuickOpen(true)}
          aria-label="添加任务"
        >
          <Icon name="plus" size={26} />
        </button>
      ) : null}

      {quickOpen ? (
        <QuickAddSheet
          lists={lists}
          defaultListId={defaultListId}
          defaultDueDate={defaultDueDate}
          onClose={() => setQuickOpen(false)}
          onAdded={(message, kind) => {
            showToast(message, kind)
            setRefreshKey((value) => value + 1)
          }}
        />
      ) : null}

      {addListOpen ? (
        <AddListSheet
          onClose={() => setAddListOpen(false)}
          onAdded={() => {
            setRefreshKey((value) => value + 1)
            showToast('已创建清单', 'success')
          }}
        />
      ) : null}

      {detailTask ? (
        <TaskDetailSheet
          task={detailTask}
          lists={lists}
          onClose={() => setDetailId(null)}
          onChanged={() => setRefreshKey((value) => value + 1)}
          onToast={showToast}
        />
      ) : null}

      {searchOpen ? (
        <SearchSheet
          lists={lists}
          onClose={() => setSearchOpen(false)}
          onOpenTask={(task) => {
            setSearchOpen(false)
            setDetailId(task.id)
          }}
          onToggle={(task) => void toggle(task)}
        />
      ) : null}

      {toast ? <div className={`toast ${toast.kind}`}>{toast.message}</div> : null}
    </div>
  )
}
