import type { DatabaseSync } from 'node:sqlite'
import { getDeviceId, nowIso } from './util'

export type ChangeOp = 'create' | 'update' | 'delete'

type ChangeListener = (entityType: string, op: ChangeOp) => void

let changeListener: ChangeListener | null = null

/** 注册本地写入监听（用于触发同步防抖）；传 null 取消。 */
export function setChangeListener(listener: ChangeListener | null): void {
  changeListener = listener
}

export function logChange(
  db: DatabaseSync,
  entityType: string,
  entityId: string,
  op: ChangeOp,
  payload: unknown
): void {
  db.prepare(
    `INSERT INTO change_log(entity_type, entity_id, op, payload, device_id, created_at)
     VALUES(?, ?, ?, ?, ?, ?)`
  ).run(entityType, entityId, op, JSON.stringify(payload), getDeviceId(db), nowIso())
  changeListener?.(entityType, op)
}
