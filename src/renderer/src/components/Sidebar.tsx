import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'
import { FilterModal } from './FilterModal'
import { Modal } from './Modal'
import { useAppStore } from '../store/useAppStore'

interface SmartItemProps {
  icon: IconName
  label: string
  count: number
  active: boolean
  onClick: () => void
}

function SmartItem({ icon, label, count, active, onClick }: SmartItemProps): React.ReactNode {
  return (
    <button
      type="button"
      className={`side-item ${active ? 'active' : ''}`}
      onClick={onClick}
      title={label}
    >
      <Icon name={icon} size={16} className="side-icon" />
      <span className="side-label">{label}</span>
      {count > 0 ? <span className="side-count">{count > 99 ? '99+' : count}</span> : null}
    </button>
  )
}

export function Sidebar(): React.ReactNode {
  const lists = useAppStore((state) => state.lists)
  const tags = useAppStore((state) => state.tags)
  const filters = useAppStore((state) => state.filters)
  const counts = useAppStore((state) => state.counts)
  const view = useAppStore((state) => state.view)
  const selectView = useAppStore((state) => state.selectView)
  const setNewListOpen = useAppStore((state) => state.setNewListOpen)
  const updateList = useAppStore((state) => state.updateList)
  const deleteList = useAppStore((state) => state.deleteList)
  const deleteFilter = useAppStore((state) => state.deleteFilter)
  const setSearchOpen = useAppStore((state) => state.setSearchOpen)

  const [menuId, setMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [filterDeleteTarget, setFilterDeleteTarget] = useState<{
    id: string
    name: string
  } | null>(null)
  const renameInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) renameInput.current?.focus()
  }, [editingId])

  useEffect(() => {
    if (!menuId) return
    const close = (): void => setMenuId(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuId])

  const startRename = (id: string, name: string): void => {
    setEditingId(id)
    setDraftName(name)
    setMenuId(null)
  }

  const commitRename = (): void => {
    if (!editingId) return
    const name = draftName.trim()
    if (name) void updateList(editingId, { name })
    setEditingId(null)
  }

  return (
    <aside className="sidebar" aria-label="清单导航">
      <div className="sidebar-scroll">
        <nav className="side-group" aria-label="智能清单">
          <SmartItem
            icon="tasks"
            label="今天"
            count={counts.today}
            active={view === 'today'}
            onClick={() => void selectView('today')}
          />
          <SmartItem
            icon="calendar-range"
            label="最近 7 天"
            count={counts.next7}
            active={view === 'next7'}
            onClick={() => void selectView('next7')}
          />
          <SmartItem
            icon="inbox"
            label="收集箱"
            count={counts.inbox}
            active={view === 'inbox'}
            onClick={() => void selectView('inbox')}
          />
        </nav>

        <div className="side-heading">
          <span>清单</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="新建清单"
            title="新建清单"
            onClick={() => setNewListOpen(true)}
          >
            <Icon name="plus" size={15} />
          </button>
        </div>

        <div className="side-group">
          {lists.filter((list) => !list.isInbox).map((list) => {
            const active = view === `list:${list.id}`
            return (
              <div className="side-row" key={list.id}>
                <button
                  type="button"
                  className={`side-item ${active ? 'active' : ''}`}
                  onClick={() => void selectView(`list:${list.id}`)}
                  onDoubleClick={() => startRename(list.id, list.name)}
                  title={list.name}
                >
                  <span className="list-dot" style={{ background: list.color }} />
                  {editingId === list.id ? (
                    <input
                      ref={renameInput}
                      className="inline-input"
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename()
                        if (event.key === 'Escape') setEditingId(null)
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : (
                    <span className="side-label">{list.name}</span>
                  )}
                  {list.openCount > 0 ? (
                    <span className="side-count">{list.openCount > 99 ? '99+' : list.openCount}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="side-more"
                  aria-label={`${list.name} 更多操作`}
                  title="更多"
                  onClick={(event) => {
                    event.stopPropagation()
                    setMenuId(menuId === list.id ? null : list.id)
                  }}
                >
                  <Icon name="more" size={14} />
                </button>
                {menuId === list.id ? (
                  <div className="side-popover" onMouseDown={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => startRename(list.id, list.name)}
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        setDeleteTarget({ id: list.id, name: list.name })
                        setMenuId(null)
                      }}
                    >
                      删除清单
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        {tags.length > 0 ? (
          <>
            <div className="side-heading">
              <span>标签</span>
            </div>
            <div className="side-group">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="side-item"
                  title={`搜索标签 ${tag.name}`}
                  onClick={() => setSearchOpen(true, `#${tag.name}`)}
                >
                  <Icon name="tag" size={15} className="side-icon" />
                  <span className="side-label">{tag.name}</span>
                  {tag.taskCount > 0 ? (
                    <span className="side-count">{tag.taskCount > 99 ? '99+' : tag.taskCount}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </>
        ) : null}

        <div className="side-heading">
          <span>过滤器</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="新建过滤器"
            title="新建过滤器"
            onClick={() => setFilterModalOpen(true)}
          >
            <Icon name="plus" size={15} />
          </button>
        </div>
        <div className="side-group">
          {filters.map((filter) => (
            <div className="side-row" key={filter.id}>
              <button
                type="button"
                className={`side-item ${
                  view === `filter:${filter.id}` ? 'active' : ''
                }`}
                title={filter.name}
                onClick={() => void selectView(`filter:${filter.id}`)}
              >
                <Icon name="filter" size={15} className="side-icon" />
                <span className="side-label">{filter.name}</span>
              </button>
              <button
                type="button"
                className="side-more"
                aria-label={`删除过滤器 ${filter.name}`}
                title="删除过滤器"
                onClick={() =>
                  setFilterDeleteTarget({ id: filter.id, name: filter.name })
                }
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>

        <div className="side-heading">
          <span>模板</span>
        </div>
        <div className="side-group">
          <button
            type="button"
            className={`side-item ${view === 'templates' ? 'active' : ''}`}
            title="任务模板"
            onClick={() => void selectView('templates')}
          >
            <Icon name="list" size={15} className="side-icon" />
            <span className="side-label">任务模板</span>
          </button>
        </div>
      </div>

      <div className="sidebar-footer">
        <SmartItem
          icon="check-circle"
          label="已完成"
          count={counts.completed}
          active={view === 'completed'}
          onClick={() => void selectView('completed')}
        />
        <SmartItem
          icon="close"
          label="已放弃"
          count={counts.abandoned}
          active={view === 'abandoned'}
          onClick={() => void selectView('abandoned')}
        />
        <SmartItem
          icon="trash"
          label="垃圾箱"
          count={counts.trash}
          active={view === 'trash'}
          onClick={() => void selectView('trash')}
        />
      </div>

      {deleteTarget ? (
        <Modal
          title="删除清单"
          onClose={() => setDeleteTarget(null)}
          width={400}
        >
          <p className="modal-text">
            清单「{deleteTarget.name}」及其任务会移入垃圾箱，可在垃圾箱恢复。
          </p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setDeleteTarget(null)}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                void deleteList(deleteTarget.id)
                setDeleteTarget(null)
              }}
            >
              删除
            </button>
          </div>
        </Modal>
      ) : null}

      {filterModalOpen ? (
        <FilterModal
          onClose={() => setFilterModalOpen(false)}
          onSaved={() => setFilterModalOpen(false)}
        />
      ) : null}

      {filterDeleteTarget ? (
        <Modal
          title="删除过滤器"
          onClose={() => setFilterDeleteTarget(null)}
          width={400}
        >
          <p className="modal-text">
            过滤器「{filterDeleteTarget.name}」会被删除，任务本身不会被删除。
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setFilterDeleteTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                void deleteFilter(filterDeleteTarget.id)
                setFilterDeleteTarget(null)
              }}
            >
              删除
            </button>
          </div>
        </Modal>
      ) : null}
    </aside>
  )
}
