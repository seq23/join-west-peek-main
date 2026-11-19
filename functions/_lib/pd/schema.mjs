/**
 * The dashboard's own database (Cloudflare D1, bound as PRODUCTIONS_DB): one database for preview,
 * one for production, created and bound by `npm run dashboard:setup` (never by hand).
 *
 * It holds only what the dashboard itself owns: the owner record, sessions, connection metadata
 * (with OAuth refresh tokens AES-GCM encrypted), which sheets are his sources, the last synced copy
 * of those rows, the quick-action log, ticks and his open choices. His Google Sheets stay the
 * source of truth; the copy here is a cache that every sync replaces.
 *
 * Migrations are additive only. Each is idempotent (IF NOT EXISTS) and records its version, so the
 * app may apply them on first use and the setup script may apply them again without harm.
 */
export const MIGRATIONS = [
  {
    version: 1,
    sql: [
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS owner (id TEXT PRIMARY KEY, name TEXT, email TEXT NOT NULL, pw TEXT, otp TEXT, gen INTEGER NOT NULL DEFAULT 0, fails TEXT, last_issue TEXT, updated_at INTEGER)',
      'CREATE TABLE IF NOT EXISTS session (id_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, stage TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, remember INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER, revoked_at INTEGER, gen INTEGER NOT NULL DEFAULT 0, how TEXT)',
      'CREATE INDEX IF NOT EXISTS session_owner ON session (owner_id)',
      'CREATE TABLE IF NOT EXISTS oauth_state (state TEXT PRIMARY KEY, purpose TEXT NOT NULL, provider TEXT NOT NULL, verifier TEXT, owner_id TEXT, remember INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS connection (provider TEXT PRIMARY KEY, account TEXT, status TEXT NOT NULL, scopes TEXT, token_enc TEXT, connected_at INTEGER, last_sync INTEGER, last_error TEXT, meta TEXT)',
      'CREATE TABLE IF NOT EXISTS source (kind TEXT PRIMARY KEY, spreadsheet_id TEXT NOT NULL, title TEXT, updated_at INTEGER)',
      'CREATE TABLE IF NOT EXISTS row_cache (kind TEXT NOT NULL, row_id TEXT NOT NULL, origin TEXT NOT NULL, data TEXT NOT NULL, synced_at INTEGER NOT NULL, PRIMARY KEY (kind, row_id))',
      'CREATE TABLE IF NOT EXISTS sync_state (kind TEXT PRIMARY KEY, synced_at INTEGER, status TEXT, error TEXT, rows INTEGER, origins TEXT)',
      'CREATE TABLE IF NOT EXISTS action_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, owner_id TEXT, sample INTEGER NOT NULL DEFAULT 0, kind TEXT, row_id TEXT, action TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT, link TEXT)',
      'CREATE TABLE IF NOT EXISTS tick (item TEXT PRIMARY KEY, sample INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS choice (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS sample_sheet (kind TEXT NOT NULL, row_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (kind, row_id))'
    ]
  },
  {
    // App keys Scooter pastes on Connections (Scooter, 14 Nov 2026: "app keys are pasted into the
    // dashboard, never emailed"). One row per service; the pair is AES-GCM encrypted with
    // PRODUCTIONS_TOKEN_KEY, exactly as connection tokens are. Never read back to a page.
    version: 2,
    sql: ['CREATE TABLE IF NOT EXISTS app_key (provider TEXT PRIMARY KEY, value_enc TEXT NOT NULL, saved_at INTEGER NOT NULL)']
  },
  {
    // His notes on each lead and client (Scooter, 14 Nov 2026: "one working view from lead to client
    // to cash, with notes I can update"). Kept here, never written into his tracker, so his original
    // records are not changed; every save is a row, the newest is the note.
    version: 3,
    sql: [
      'CREATE TABLE IF NOT EXISTS note (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, owner_id TEXT, at INTEGER NOT NULL, text TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS note_subject ON note (subject, sample)'
    ]
  },
  {
    // Lead to delivery (Scooter, 14 Nov 2026: "a lead comes in, becomes a deal, becomes a signed
    // client, becomes delivered work with a client portal, and the money stays mine to see").
    // web_inquiry: the Start a project form on his own site. intake: the owner and need on an inquiry
    // that is not in his tracker yet. discovery, quote, proposal: every save a row (newest wins).
    // Rates, quotes and the catalog are AES-GCM encrypted with PRODUCTIONS_TOKEN_KEY. delivery, task,
    // asset: the work side of an accepted deal. portal: a client's private page, found by a token
    // hash; one client per token, revocable.
    version: 4,
    sql: [
      'CREATE TABLE IF NOT EXISTS web_inquiry (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, form TEXT, name TEXT, org TEXT, email TEXT, need TEXT, timing TEXT, budget TEXT, heard TEXT, page TEXT)',
      'CREATE TABLE IF NOT EXISTS intake (key TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, owner TEXT, need TEXT, at INTEGER NOT NULL, PRIMARY KEY (key, sample))',
      'CREATE TABLE IF NOT EXISTS discovery (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, data TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS discovery_key ON discovery (key, sample)',
      'CREATE TABLE IF NOT EXISTS catalog (sample INTEGER PRIMARY KEY, data_enc TEXT NOT NULL, at INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS quote (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, data_enc TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS quote_key ON quote (key, sample)',
      'CREATE TABLE IF NOT EXISTS proposal (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, quote_id INTEGER, status TEXT NOT NULL, text_enc TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS proposal_key ON proposal (key, sample)',
      'CREATE TABLE IF NOT EXISTS delivery (key TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, team TEXT, PRIMARY KEY (key, sample))',
      'CREATE TABLE IF NOT EXISTS task (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, title TEXT NOT NULL, owner TEXT, due TEXT, done INTEGER NOT NULL DEFAULT 0, client INTEGER NOT NULL DEFAULT 0)',
      'CREATE INDEX IF NOT EXISTS task_key ON task (key, sample)',
      'CREATE TABLE IF NOT EXISTS asset (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, label TEXT NOT NULL, url TEXT NOT NULL, client INTEGER NOT NULL DEFAULT 0)',
      'CREATE INDEX IF NOT EXISTS asset_key ON asset (key, sample)',
      'CREATE TABLE IF NOT EXISTS portal (token_hash TEXT PRIMARY KEY, key TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, revoked_at INTEGER)',
      'CREATE INDEX IF NOT EXISTS portal_key ON portal (key, sample)'
    ]
  },
  {
    // The Get in touch form (Scooter, 15 Nov 2026): the service picked from the six, the person's
    // title, and for Virtual / hybrid event production the event's start and end dates, carried into
    // the deal. Additive columns only.
    version: 5,
    sql: [
      'ALTER TABLE web_inquiry ADD COLUMN service TEXT',
      'ALTER TABLE web_inquiry ADD COLUMN title TEXT',
      'ALTER TABLE web_inquiry ADD COLUMN event_start TEXT',
      'ALTER TABLE web_inquiry ADD COLUMN event_end TEXT'
    ]
  },
  {
    // The quote builder's team directory (Scooter, 15 Nov 2026: "a reusable team directory (owner, team
    // member and contractor types; rates per hour, month or job; add and remove people)"). One encrypted
    // list per mode, like the catalog. Additive only.
    version: 6,
    sql: ['CREATE TABLE IF NOT EXISTS team_directory (sample INTEGER PRIMARY KEY, data_enc TEXT NOT NULL, at INTEGER NOT NULL)']
  }
];

/** Every table a backup carries (restore replaces each one whole). */
export const BACKUP_TABLES = ['owner', 'session', 'connection', 'source', 'row_cache', 'sync_state', 'action_log', 'tick', 'choice', 'setting', 'sample_sheet', 'app_key', 'note', 'web_inquiry', 'intake', 'discovery', 'catalog', 'team_directory', 'quote', 'proposal', 'delivery', 'task', 'asset', 'portal', 'schema_version'];
/** What each table keeps, in his words: the Access page lists every table a backup carries. */
export const TABLE_WORDS = {
  owner: 'Your sign-in record: your work email, your name and a salted hash of your password (never the password itself)',
  session: 'Each signed-in device: a hash of its sign-in and when it ends',
  connection: 'Each connected account: its name, what it allows, and its access key, encrypted',
  source: 'Which sheets you named on Connections',
  row_cache: 'A copy of the rows read from those sheets, replaced at every sync (every 15 minutes). While Money is on, it includes your money rows',
  sync_state: 'When each part last synced, and how many rows (counts only)',
  action_log: 'What you pressed here and what your sheet showed back',
  tick: 'The fault rows you hid on the Pipeline',
  choice: 'Your choices on Connections',
  setting: 'Small settings: the last sync, signature statuses, cash now from an accounting tool, and the column names of your tracker',
  sample_sheet: 'Made-up rows for the preview\'s sample mode (never real)',
  app_key: 'App keys you pasted on Connections, encrypted',
  note: 'Every saved version of your notes (the current note is the Notes cell in your tracker, where it has one)',
  web_inquiry: 'Form requests sent from the Get in touch form on your site: name, title, organization, email, the service, event dates and what they need',
  intake: 'The owner and need you set on an inquiry that is not in your tracker yet',
  discovery: 'Your discovery answers on each deal, every saved version',
  catalog: 'Your service catalog and rates, encrypted',
  team_directory: 'The team directory: names, owner / team / contractor, and a standard rate where one is known, encrypted',
  quote: 'Each quote (the roles on each service, who is assigned, how each is billed, rates, client price, discount, owner time, overhead and tax reserve, rationale), encrypted, every version',
  proposal: 'Each proposal version and whether it was sent or accepted, encrypted',
  delivery: 'The account team on each accepted deal',
  task: 'Tasks on each accepted deal, and which ones the client sees',
  asset: 'Asset links on each accepted deal, and which ones the client sees',
  portal: 'A hash of each client portal link (never the link itself), and when it was turned off',
  schema_version: 'The database\'s version number'
};

let applied = new WeakSet();
/** Applies any missing migration once per isolate. */
export async function ensureSchema(db) {
  if (applied.has(db)) return;
  let have = 0;
  try {
    const r = await db.prepare('SELECT MAX(version) AS v FROM schema_version').first();
    have = Number(r?.v) || 0;
  } catch { have = 0; }
  for (const m of MIGRATIONS) {
    if (m.version <= have) continue;
    await db.batch([
      ...m.sql.map((s) => db.prepare(s)),
      db.prepare('INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)').bind(m.version, Date.now())
    ]);
  }
  applied.add(db);
}
export function resetSchemaMemo() { applied = new WeakSet(); }

export function dbOf(env) {
  const db = env?.PRODUCTIONS_DB;
  return db && typeof db.prepare === 'function' ? db : null;
}
