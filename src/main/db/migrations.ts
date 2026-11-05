import type { DatabaseSync } from 'node:sqlite'

interface Migration {
  version: number
  up(db: DatabaseSync): void
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS lists (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '#f5c542',
          emoji TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_inbox INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          device_id TEXT NOT NULL
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_lists_deleted ON lists(deleted_at);

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          list_id TEXT NOT NULL REFERENCES lists(id),
          parent_id TEXT REFERENCES tasks(id),
          title TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'abandoned')),
          priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
          due_date TEXT,
          due_time TEXT,
          all_day INTEGER NOT NULL DEFAULT 1,
          start_date TEXT,
          recurrence TEXT,
          pinned INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          device_id TEXT NOT NULL
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id, status, deleted_at);
        CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date, status, deleted_at);
        CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(deleted_at);

        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          color TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          device_id TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS task_tags (
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (task_id, tag_id)
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS change_log (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          op TEXT NOT NULL,
          payload TEXT,
          device_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_change_log_entity ON change_log(entity_type, entity_id);
      `)
    }
  },
  {
    version: 2,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS reminders (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          trigger_at TEXT NOT NULL,
          sent_at TEXT,
          created_at TEXT NOT NULL,
          device_id TEXT NOT NULL
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(trigger_at, sent_at);
        CREATE INDEX IF NOT EXISTS idx_reminders_task ON reminders(task_id);
      `)
    }
  },
  {
    version: 3,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS habits (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT,
          color TEXT NOT NULL DEFAULT '#30a46c',
          frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly')),
          target_per_week INTEGER NOT NULL DEFAULT 7,
          archived INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          device_id TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS habit_logs (
          id TEXT PRIMARY KEY,
          habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
          log_date TEXT NOT NULL,
          value INTEGER NOT NULL DEFAULT 1,
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          device_id TEXT NOT NULL,
          UNIQUE(habit_id, log_date)
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(log_date);
        CREATE INDEX IF NOT EXISTS idx_habit_logs_habit ON habit_logs(habit_id, log_date);

        CREATE TABLE IF NOT EXISTS pomodoro_sessions (
          id TEXT PRIMARY KEY,
          task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
          mode TEXT NOT NULL DEFAULT 'focus' CHECK (mode IN ('focus', 'break')),
          duration_minutes INTEGER NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          device_id TEXT NOT NULL
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_pomodoro_started ON pomodoro_sessions(started_at);

        CREATE TABLE IF NOT EXISTS templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          device_id TEXT NOT NULL
        ) STRICT;
      `)
    }
  }
]

export function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `)

  const appliedRows = db
    .prepare('SELECT version FROM schema_migrations')
    .all() as unknown as Array<{ version: number }>
  const applied = new Set(appliedRows.map((row) => Number(row.version)))

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      migration.up(db)
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)').run(
        migration.version,
        new Date().toISOString()
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
