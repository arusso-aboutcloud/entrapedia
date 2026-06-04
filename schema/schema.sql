-- Entrapedia D1 schema (chunk 2: storage tier)
--
-- Applied to the `entrapedia` D1 database. Timestamps are INTEGER unix-epoch
-- seconds. The source / trust / content_type / license / attribution fields
-- follow DESIGN.md sections 3-4. ASCII-only.

CREATE TABLE IF NOT EXISTS documents (
  doc_id        TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  trust         TEXT NOT NULL,
  source_url    TEXT,
  license       TEXT,
  attribution   TEXT,
  content_hash  TEXT,
  fetched_at    INTEGER,
  updated_at    INTEGER
);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id     TEXT PRIMARY KEY,
  doc_id       TEXT NOT NULL REFERENCES documents(doc_id),
  chunk_index  INTEGER NOT NULL,
  r2_key       TEXT NOT NULL,
  vector_id    TEXT,
  token_count  INTEGER
);

CREATE TABLE IF NOT EXISTS answer_cache (
  question_hash  TEXT PRIMARY KEY,
  answer         TEXT,
  citations      TEXT,
  created_at     INTEGER,
  hit_count      INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_state (
  source       TEXT PRIMARY KEY,
  last_run_at  INTEGER,
  last_cursor  TEXT,
  last_etag    TEXT,
  status       TEXT
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
