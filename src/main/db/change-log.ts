import type { DatabaseSync } from 'node:sqlite'
import { getDeviceId, nowIso } from './util'

export type ChangeOp = 'create' | 'update' | 'delete'

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
}
