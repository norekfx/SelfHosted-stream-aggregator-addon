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
  },
  {
    id: 2,
    name: "create_search_cache",
    sql: `
      CREATE TABLE IF NOT EXISTS search_cache (
        cache_key TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        media_id TEXT NOT NULL,
        selected_original_json TEXT,
        ranked_streams_json TEXT NOT NULL DEFAULT '[]',
        stats_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'empty',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_served_at TEXT,
        refresh_started_at TEXT,
        refresh_finished_at TEXT,
        refresh_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_search_cache_media ON search_cache(type, media_id);
      CREATE INDEX IF NOT EXISTS idx_search_cache_status ON search_cache(status);
      CREATE INDEX IF NOT EXISTS idx_search_cache_updated_at ON search_cache(updated_at);

      CREATE TABLE IF NOT EXISTS search_history (
        id TEXT PRIMARY KEY,
        cache_key TEXT NOT NULL,
        type TEXT NOT NULL,
        media_id TEXT NOT NULL,
        searched_at TEXT NOT NULL,
        addon_count INTEGER NOT NULL,
        successful_addon_count INTEGER NOT NULL,
        failed_addon_count INTEGER NOT NULL,
        stream_count INTEGER NOT NULL,
        working_stream_count INTEGER NOT NULL,
        failed_stream_count INTEGER NOT NULL,
        unsupported_stream_count INTEGER NOT NULL,
        selected_original_json TEXT,
        result_json TEXT NOT NULL,
        FOREIGN KEY(cache_key) REFERENCES search_cache(cache_key) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_search_history_cache_key ON search_history(cache_key);
      CREATE INDEX IF NOT EXISTS idx_search_history_searched_at ON search_history(searched_at);
    `
  },
  {
    id: 3,
    name: "create_app_settings",
    sql: `
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    id: 4,
    name: "create_auth_tables",
    sql: `
      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT,
        FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash ON admin_sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
    `
  },
  {
    id: 5,
    name: "create_system_logs",
    sql: `
      CREATE TABLE IF NOT EXISTS system_logs (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
      CREATE INDEX IF NOT EXISTS idx_system_logs_source ON system_logs(source);
    `
  },
  {
    id: 6,
    name: "create_libraries",
    sql: `
      CREATE TABLE IF NOT EXISTS libraries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'tmdb',
        mode TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_libraries_enabled ON libraries(enabled);
      CREATE INDEX IF NOT EXISTS idx_libraries_type ON libraries(type);
      CREATE INDEX IF NOT EXISTS idx_libraries_sort_order ON libraries(sort_order);

      CREATE TABLE IF NOT EXISTS library_cache (
        cache_key TEXT PRIMARY KEY,
        library_id TEXT NOT NULL,
        page INTEGER NOT NULL,
        items_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY(library_id) REFERENCES libraries(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_library_cache_library_page ON library_cache(library_id, page);
      CREATE INDEX IF NOT EXISTS idx_library_cache_expires_at ON library_cache(expires_at);
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
