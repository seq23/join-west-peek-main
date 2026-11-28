-- Give and Take, Scooter's build spec (27 Nov 2026). Additive only: the optional kind of help, the
-- giver's consent time (required to offer), and a log of every review action.
-- The same statements live in functions/_lib/give-take.mjs (MIGRATIONS version 2).
ALTER TABLE gt_ask ADD COLUMN help_kind TEXT;
ALTER TABLE gt_offer ADD COLUMN help_kind TEXT;
ALTER TABLE gt_offer ADD COLUMN consent_at INTEGER;
CREATE INDEX IF NOT EXISTS gt_offer_ask ON gt_offer (ask_id, email);
CREATE TABLE IF NOT EXISTS gt_review_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ask_public_id TEXT NOT NULL, action TEXT NOT NULL, from_status TEXT, to_status TEXT, result TEXT NOT NULL, at INTEGER NOT NULL);
