import type Database from "better-sqlite3";

const migrations: Array<{ id: number; name: string; sql: string }> = [
  {
    id: 1,
    name: "create_addons",
    sql: `
      CREATE TABLE IF NOT EXISTS addons (
        id TEXT PRIMARY KEY,
        manifest_url TEXT NOT NULL UNIQUE,
        name TEXT,
        version TEXT,
        description TEXT,
        supported_resources_json TEXT NOT NULL DEFAULT '[]',
        supported_types_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'unknown',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_checked_at TEXT,
        last_error TEXT,
        response_time_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_addons_enabled ON addons(enabled);
      CREATE INDEX IF NOT EXISTS idx_addons_status ON addons(status);
    `
  }
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row) => (row as { id: number }).id)
  );

  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    const transaction = db.transaction(() => {
      db.exec(migration.sql);
      insertMigration.run(migration.id, migration.name, new Date().toISOString());
    });

    transaction();
  }
}
