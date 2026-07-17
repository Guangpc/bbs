import type { SQLiteDatabase } from "expo-sqlite";

export interface VideoRow {
  id: string;
  ingest_id: string | null;
  platform: string;
  original_url: string;
  normalized_url: string | null;
  canonical_url: string | null;
  external_id: string | null;
  share_text: string | null;
  comment: string | null;
  status: string;
  is_pinned: number;
  open_count: number;
  last_opened_at: number | null;
  watched_at: number | null;
  /** Set when network enrich successfully filled share_text (XHS / X). */
  meta_enriched_at: number | null;
  /** XHS note type from page state: video | normal | multi | … */
  note_type: string | null;
  /** Cached AI summary from GLM (one-click summarize). */
  ai_summary: string | null;
  ai_summarized_at: number | null;
  /** Best-effort public cover/thumbnail URL for multimodal summarize. */
  cover_url: string | null;
  /** Best-effort public video direct URL when resolvable. */
  media_url: string | null;
  /** Last summarize media basis: video | cover | text */
  ai_summary_basis: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}


export interface WatchHistoryRow {
  id: string;
  video_id: string;
  opened_at: number;
}

async function ensureColumn(
  db: SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      ingest_id TEXT UNIQUE,
      platform TEXT NOT NULL,
      original_url TEXT NOT NULL,
      normalized_url TEXT,
      canonical_url TEXT,
      external_id TEXT,
      share_text TEXT,
      status TEXT NOT NULL DEFAULT 'unread',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      open_count INTEGER NOT NULL DEFAULT 0,
      last_opened_at INTEGER,
      watched_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS watch_history (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      opened_at INTEGER NOT NULL,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_watch_history_video
    ON watch_history(video_id, opened_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_platform_external_id
    ON videos(platform, external_id)
    WHERE external_id IS NOT NULL AND deleted_at IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_canonical_url
    ON videos(canonical_url)
    WHERE canonical_url IS NOT NULL AND deleted_at IS NULL;
  `);

  await ensureColumn(db, "videos", "is_pinned", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "videos", "open_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "videos", "last_opened_at", "INTEGER");
  await ensureColumn(db, "videos", "watched_at", "INTEGER");
  await ensureColumn(db, "videos", "comment", "TEXT");
  await ensureColumn(db, "videos", "meta_enriched_at", "INTEGER");
  await ensureColumn(db, "videos", "xhs_parser_v", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "videos", "note_type", "TEXT");
  await ensureColumn(db, "videos", "ai_summary", "TEXT");
  await ensureColumn(db, "videos", "ai_summarized_at", "INTEGER");
  await ensureColumn(db, "videos", "cover_url", "TEXT");
  await ensureColumn(db, "videos", "media_url", "TEXT");
  await ensureColumn(db, "videos", "ai_summary_basis", "TEXT");

  // Parser v5: require metadata tied to current note; video no-title uses body.
  await db.runAsync(
    `UPDATE videos
     SET meta_enriched_at = NULL,
         note_type = NULL,
         share_text = CASE WHEN ingest_id IS NOT NULL THEN NULL ELSE share_text END,
         xhs_parser_v = 5
     WHERE platform = 'xiaohongshu'
       AND IFNULL(xhs_parser_v, 0) < 5`,
  );

  // Legacy inbox rows often stored http:// short links; ATS requires https.
  await db.runAsync(
    `UPDATE videos
     SET original_url = 'https://' || substr(original_url, 8),
         updated_at = ?
     WHERE original_url LIKE 'http://%'`,
    [Date.now()],
  );
  await db.runAsync(
    `UPDATE videos
     SET normalized_url = 'https://' || substr(normalized_url, 8),
         updated_at = ?
     WHERE normalized_url LIKE 'http://%'`,
    [Date.now()],
  );
  await db.runAsync(
    `UPDATE videos
     SET canonical_url = 'https://' || substr(canonical_url, 8),
         updated_at = ?
     WHERE canonical_url LIKE 'http://%'`,
    [Date.now()],
  );
}

export function sortVideosForHome(videos: VideoRow[]): VideoRow[] {
  return [...videos].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) {
      return b.is_pinned - a.is_pinned;
    }
    return b.created_at - a.created_at;
  });
}

export async function listLiveVideos(db: SQLiteDatabase): Promise<VideoRow[]> {
  const rows = await db.getAllAsync<VideoRow>(
    "SELECT * FROM videos WHERE deleted_at IS NULL",
  );
  return sortVideosForHome(rows);
}
