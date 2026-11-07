import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TickFlowApi } from '../src/shared/ipc'

declare global {
  interface Window {
    api: TickFlowApi
  }
}

const BUCKET = 'habit-bucket'
const INBOX = '00000000-0000-7000-8000-000000000001'
const REMOTE_KEY = 'tickflow/snapshots/remote-device.json'
const REMOTE_HABIT = 'remote-habit-1'
const REMOTE_SESSION = 'remote-session-1'
let server: Server
let endpoint = ''
const objects = new Map<string, string>()

function todayKeyLocal(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function remoteSnapshot(): string {
  const now = new Date()
  const updated = new Date(now.getTime() - 60_000).toISOString()
  const today = todayKeyLocal()
  return JSON.stringify({
    version: 1,
    deviceId: 'remote-device',
    updatedAt: updated,
    lists: [
      {
        id: INBOX,
        name: '收集箱',
        color: '#f5c542',
        emoji: null,
        sortOrder: 0,
        isInbox: true,
        createdAt: updated,
        updatedAt: updated,
        deletedAt: null
      }
    ],
    tasks: [],
    habits: [
      {
        id: REMOTE_HABIT,
        name: '远端习惯',
        icon: null,
        color: '#30a46c',
        frequency: 'daily',
        targetPerWeek: 7,
        archived: false,
        sortOrder: 0,
        createdAt: updated,
        updatedAt: updated,
        deletedAt: null
      }
    ],
    habitLogs: [
      {
        id: 'remote-log-1',
        habitId: REMOTE_HABIT,
        logDate: today,
        value: 1,
        note: '',
        createdAt: updated,
        updatedAt: updated,
        deletedAt: null
      }
    ],
    pomodoroSessions: [
      {
        id: REMOTE_SESSION,
        taskId: null,
        mode: 'focus',
        durationMinutes: 25,
        startedAt: `${today}T08:00:00.000Z`,
        endedAt: `${today}T08:25:00.000Z`,
        completed: true,
        createdAt: `${today}T08:00:00.000Z`
      }
    ],
    habitReminders: [
      {
        id: 'remote-reminder-1',
        habitId: REMOTE_HABIT,
        triggerAt: new Date(now.getTime() + 3_600_000).toISOString(),
        enabled: true,
        sentAt: null,
        createdAt: updated,
        updatedAt: updated,
        deletedAt: null
      }
    ]
  })
}

test.beforeAll(async () => {
  objects.set(REMOTE_KEY, remoteSnapshot())
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? ''
      const contents = [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => `<Contents><Key>${key}</Key></Contents>`)
        .join('')
      response.writeHead(200, { 'Content-Type': 'application/xml' })
      response.end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>${contents}</ListBucketResult>`
      )
      return
    }
    const key = decodeURIComponent(url.pathname).split('/').slice(2).join('/')
    if (request.method === 'GET') {
      const body = objects.get(key)
      if (body == null) {
        response.writeHead(404)
        response.end()
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(body)
      }
      return
    }
    if (request.method === 'PUT') {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        objects.set(key, body)
        response.writeHead(200)
        response.end()
      })
      return
    }
    response.writeHead(405)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test('习惯/打卡/番茄/提醒双端合并并回传快照', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'tickflow-habit-sync-'))
  const app = await electron.launch({
    args: ['.'],
    cwd: 'F:/projects/tickflow',
    env: { ...process.env, TICKFLOW_USER_DATA: userData } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })

    await page.locator('.rail-item[title="设置"]').click()
    await expect(page.locator('.modal h2', { hasText: '设置' })).toBeVisible()
    const field = (label: string) =>
      page.locator('.sync-grid .field', { hasText: label }).locator('input')
    await field('Endpoint').fill(endpoint)
    await field('Bucket').fill(BUCKET)
    await field('Access Key ID').fill('test-key')
    await field('Secret Access Key').fill('test-secret')
    await page.getByRole('button', { name: '立即同步' }).click()
    await expect(page.locator('.toast')).toContainText('同步完成', { timeout: 15_000 })
    await page.keyboard.press('Escape')

    const remoteApplied = await page.evaluate(async (habitId) => {
      const habits = await window.api.habits.list()
      const habit = habits.find((item) => item.id === habitId)
      const sessions = await window.api.pomodoro.list(
        '2000-01-01T00:00:00.000Z',
        '2100-01-01T00:00:00.000Z'
      )
      const reminder = await window.api.habitReminders.get(habitId)
      return {
        habitName: habit?.name ?? '',
        logCount: habit?.logs.length ?? 0,
        session: sessions.some((item) => item.id === 'remote-session-1'),
        reminder: Boolean(reminder?.triggerAt)
      }
    }, REMOTE_HABIT)
    expect(remoteApplied.habitName).toBe('远端习惯')
    expect(remoteApplied.logCount).toBe(1)
    expect(remoteApplied.session).toBe(true)
    expect(remoteApplied.reminder).toBe(true)

    const local = await page.evaluate(async () => {
      const habit = await window.api.habits.create({ name: '本地习惯', color: '#0091ff' })
      const now = new Date()
      const pad = (value: number) => String(value).padStart(2, '0')
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      await window.api.habits.toggle(habit.id, today)
      await window.api.habitReminders.set(habit.id, '09:00')
      await window.api.pomodoro.create({
        mode: 'focus',
        durationMinutes: 25,
        startedAt: `${today}T09:00:00.000Z`,
        endedAt: `${today}T09:25:00.000Z`,
        completed: true
      })
      return habit.id
    })

    await page.locator('.rail-item[title="设置"]').click()
    await page.getByRole('button', { name: '立即同步' }).click()
    await expect(page.locator('.toast')).toContainText('同步完成', { timeout: 15_000 })
    await page.keyboard.press('Escape')

    const uploaded = [...objects.entries()].find(([key]) => key !== REMOTE_KEY)?.[1] ?? ''
    const payload = JSON.parse(uploaded) as {
      habits: Array<{ id: string; name: string }>
      habitLogs: Array<{ habitId: string }>
      pomodoroSessions: Array<{ id: string }>
      habitReminders: Array<{ habitId: string }>
    }
    expect(payload.habits.map((item) => item.name).sort()).toEqual(
      ['本地习惯', '远端习惯'].sort()
    )
    expect(payload.habitLogs.filter((item) => item.habitId === local)).toHaveLength(1)
    expect(payload.habitLogs.some((item) => item.habitId === REMOTE_HABIT)).toBe(true)
    expect(payload.pomodoroSessions.some((item) => item.id === REMOTE_SESSION)).toBe(true)
    expect(payload.habitReminders.filter((item) => item.habitId === local)).toHaveLength(1)
  } finally {
    await app.close()
  }
})
