import { app, dialog, shell, type BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { Attachment } from '@shared/types'
import { uuidv7 } from '@shared/uuid'
import { getDb } from './db'
import {
  createAttachment,
  deleteAttachment,
  getAttachment,
  listAttachments
} from './db/attachments'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

function mimeFor(name: string): string {
  return MIME_BY_EXTENSION[extname(name).toLowerCase()] || 'application/octet-stream'
}

export function attachmentsDir(): string {
  const dir = join(app.getPath('userData'), 'attachments')
  mkdirSync(dir, { recursive: true })
  return dir
}

export async function addAttachment(
  win: BrowserWindow | null,
  taskId: string,
  sourcePath?: string
): Promise<Attachment | null> {
  let source = sourcePath
  if (!source) {
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '添加附件',
          properties: ['openFile']
        })
      : await dialog.showOpenDialog({
          title: '添加附件',
          properties: ['openFile']
        })
    if (result.canceled || result.filePaths.length === 0) return null
    source = result.filePaths[0]
  }
  if (!existsSync(source)) throw new Error('附件文件不存在')

  const name = basename(source)
  const storedName = `${uuidv7()}${extname(name)}`
  const destination = join(attachmentsDir(), storedName)
  copyFileSync(source, destination)

  try {
    return createAttachment(getDb(), {
      taskId,
      name,
      storedName,
      size: statSync(destination).size,
      mime: mimeFor(name)
    })
  } catch (error) {
    try {
      unlinkSync(destination)
    } catch {
      // 忽略清理失败
    }
    throw error
  }
}

export async function openAttachment(id: string): Promise<void> {
  const attachment = getAttachment(getDb(), id)
  if (!attachment) throw new Error('附件不存在')
  const path = join(attachmentsDir(), attachment.storedName)
  if (!existsSync(path)) throw new Error('附件文件已丢失')
  const error = await shell.openPath(path)
  if (error) throw new Error(error)
}

export function removeAttachment(id: string): void {
  const attachment = deleteAttachment(getDb(), id)
  if (!attachment) return
  try {
    unlinkSync(join(attachmentsDir(), attachment.storedName))
  } catch {
    // 文件已被手动删除时只清数据库记录
  }
}

/** 永久删除任务前调用：清掉附件记录与磁盘文件。软删除不调用，保证可恢复。 */
export function removeTaskAttachments(taskId: string): void {
  const db = getDb()
  const attachments = listAttachments(db, taskId)
  for (const attachment of attachments) {
    deleteAttachment(db, attachment.id)
    try {
      unlinkSync(join(attachmentsDir(), attachment.storedName))
    } catch {
      // 忽略已丢失文件
    }
  }
}
