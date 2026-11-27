-- Give and Take (joinwestpeek.com), Scooter 27 Nov 2026. Additive only.
-- One D1 per environment: west-peek-community-give-take-preview / -production, bound as GIVE_TAKE_DB
-- on the join-west-peek-main Pages project (previews at <branch>.west-peek-community.pages.dev) by `npm run give-take:setup`.
-- The same statements live in functions/_lib/give-take.mjs (MIGRATIONS), which the setup script applies;
-- scripts/test_lead_delivery.mjs fails if these files and that list ever differ.
CREATE TABLE IF NOT EXISTS gt_ask (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL, ask TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', created_at INTEGER NOT NULL, reviewed_at INTEGER, approved_at INTEGER);
CREATE INDEX IF NOT EXISTS gt_ask_board ON gt_ask (status, approved_at);
CREATE TABLE IF NOT EXISTS gt_offer (id INTEGER PRIMARY KEY AUTOINCREMENT, ask_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, offer TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gt_schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
