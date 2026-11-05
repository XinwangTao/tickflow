import { useEffect, useState } from 'react'
import type { Priority, Template } from '@shared/types'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../lib/colors'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'
import { Modal } from './Modal'

function TemplateCreateModal({
  onClose,
  onSaved
}: {
  onClose: () => void
  onSaved: () => void
}): React.ReactNode {
  const showToast = useAppStore((state) => state.showToast)
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [priority, setPriority] = useState<Priority>(0)

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    try {
      await window.api.templates.create({
        name,
        payload: {
          title: title.trim() || name.trim(),
          notes,
          priority,
          tagNames: [],
          listId: null,
          dueTime: null,
          allDay: true
        }
      })
      onSaved()
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  return (
    <Modal title="新建模板" onClose={onClose} width={460}>
      <label className="field">
        <span className="field-label">模板名称</span>
        <input
          className="input"
          autoFocus
          value={name}
          maxLength={40}
          placeholder="例如：每周复盘"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">任务标题</span>
        <input
          className="input"
          value={title}
          maxLength={200}
          placeholder="例如：整理本周进展"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">备注</span>
        <textarea
          className="detail-notes"
          rows={3}
          value={notes}
          placeholder="任务备注模板…"
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <div className="field">
        <span className="field-label">优先级</span>
        <div className="priority-group">
          {PRIORITY_LABELS.map((label, value) => (
            <button
              key={label}
              type="button"
              className={`priority-btn ${priority === value ? 'selected' : ''}`}
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
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim()}
          onClick={() => void submit()}
        >
          创建
        </button>
      </div>
    </Modal>
  )
}

export function TemplatesView(): React.ReactNode {
  const showToast = useAppStore((state) => state.showToast)
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setTemplates(await window.api.templates.list())
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const apply = async (template: Template): Promise<void> => {
    try {
      await window.api.templates.apply(template.id)
      await useAppStore.getState().refresh()
      await useAppStore.getState().selectView('today')
      showToast(`已从「${template.name}」创建任务`, 'success')
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const remove = async (id: string): Promise<void> => {
    try {
      await window.api.templates.remove(id)
      setDeleteTarget(null)
      await load()
      showToast('模板已删除', 'info')
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  return (
    <div className="templates-view">
      <div className="habits-toolbar">
        <div>
          <strong>{templates.length}</strong>
          <span> 个模板</span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setCreateOpen(true)}
        >
          <Icon name="plus" size={14} />
          新建模板
        </button>
      </div>

      {loading ? (
        <div className="skeleton-list">
          {[0, 1].map((index) => (
            <div className="skeleton-row" key={index}>
              <span className="skeleton-check" />
              <span className="skeleton-lines">
                <span className="skeleton-line w1" />
                <span className="skeleton-line w2" />
              </span>
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="empty-state">
          <Icon name="list" size={44} className="empty-icon" />
          <h2>还没有模板</h2>
          <p>把常用任务保存为模板，下次一键创建；也可以在任务详情里「保存为模板」。</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreateOpen(true)}
          >
            <Icon name="plus" size={14} />
            新建模板
          </button>
        </div>
      ) : (
        <div className="template-grid">
          {templates.map((template) => (
            <article className="template-card" key={template.id}>
              <header className="template-head">
                <div>
                  <h2>{template.name}</h2>
                  <span>{template.payload.title}</span>
                </div>
                {template.payload.priority > 0 ? (
                  <span
                    className="task-meta-item"
                    style={{ color: PRIORITY_COLORS[template.payload.priority] }}
                  >
                    <Icon name="flag" size={12} />
                    {PRIORITY_LABELS[template.payload.priority]}
                  </span>
                ) : null}
              </header>
              {template.payload.notes ? (
                <p className="template-notes">{template.payload.notes}</p>
              ) : null}
              <div className="template-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void apply(template)}
                >
                  <Icon name="plus" size={14} />
                  使用
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setDeleteTarget(template)}
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {createOpen ? (
        <TemplateCreateModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false)
            void load()
          }}
        />
      ) : null}

      {deleteTarget ? (
        <Modal
          title="删除模板"
          onClose={() => setDeleteTarget(null)}
          width={400}
        >
          <p className="modal-text">确定删除模板「{deleteTarget.name}」吗？</p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void remove(deleteTarget.id)}
            >
              删除
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
