/**
 * What the Productions dashboard is connected to, read from its own D1 (Scooter, 19 Nov 2026: "Please
 * confirm whether the live dashboard reads and writes my real tracker, and what's still
 * disconnected"). States, counts and times only: never a row, a name, a sheet title, an address or
 * a figure. Takes a `query(sql)` that returns rows, so the same code runs against the Cloudflare D1
 * API (scripts/dashboard_status.mjs) and the test database (scripts/test_dashboard.mjs).
 */
const PROVIDERS = ['google', 'dropbox', 'docusign', 'quickbooks', 'xero'];
const SHEETS = { tracker: 'your deal tracker', work: 'Work sheet', money: 'Money sheet', inquiries: 'inquiry form responses' };
const when = (t) => (t ? `${new Date(Number(t)).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'never');

export async function statusReport(query) {
  const one = async (sql) => (await query(sql))[0] || null;
  const owner = await one('SELECT COUNT(*) AS n FROM owner');
  const conns = await query('SELECT provider, status, last_sync, last_error FROM connection');
  const sources = (await query('SELECT kind FROM source')).map((r) => r.kind);
  const sync = await query('SELECT kind, synced_at, status, rows FROM sync_state');
  const layout = await one("SELECT COUNT(*) AS n FROM setting WHERE key = 'layout:deals'");
  const wrote = await one("SELECT MAX(at) AS at, COUNT(*) AS n FROM action_log WHERE sample = 0 AND kind = 'deals' AND outcome = 'saved'");
  const failed = await one("SELECT MAX(at) AS at, COUNT(*) AS n FROM action_log WHERE sample = 0 AND kind = 'deals' AND outcome = 'failed'");
  const site = await one('SELECT COUNT(*) AS n FROM web_inquiry');

  const byP = Object.fromEntries(conns.map((c) => [c.provider, c]));
  const connState = (p) => { const c = byP[p]; return !c ? 'not connected' : c.status === 'ok' && !c.last_error ? 'connected' : 'broken'; };
  const deals = sync.find((s) => s.kind === 'deals');
  const trackerSheet = sources.includes('tracker') ? 'tracker' : sources.includes('work') ? 'work' : '';
  const reads = Boolean(trackerSheet && connState('google') === 'connected' && deals && deals.status === 'ok' && Number(deals.rows) > 0);
  const writes = Number(wrote?.n) > 0;
  const lines = [
    `owner record: ${Number(owner?.n) ? 'present' : 'MISSING'}`,
    ...PROVIDERS.map((p) => `${p}: ${connState(p)}${byP[p] ? ` · last sync ${when(byP[p].last_sync)}` : ''}`),
    ...Object.entries(SHEETS).map(([k, label]) => `${label}: ${sources.includes(k) ? 'named' : 'not named'}`),
    ...sync.filter((s) => Number(s.rows) || s.status !== 'ok').map((s) => `synced ${s.kind}: ${s.status || 'unknown'} · ${Number(s.rows) || 0} rows · ${when(s.synced_at)}`),
    `tracker columns recognised: ${Number(layout?.n) ? 'yes' : 'no'}`,
    `reads your tracker: ${reads ? `yes (${trackerSheet === 'tracker' ? 'your deal tracker' : 'the Work sheet Deals tab'}, ${Number(deals.rows)} deals, ${when(deals.synced_at)})` : 'no'}`,
    `writes your tracker: ${writes ? `yes (${Number(wrote.n)} saved and checked, last ${when(wrote.at)})` : 'no saved and checked write yet'}${Number(failed?.n) ? ` · ${Number(failed.n)} not confirmed, last ${when(failed.at)}` : ''}`,
    `site inquiries kept: ${Number(site?.n) || 0}`
  ];
  const disconnected = PROVIDERS.filter((p) => connState(p) !== 'connected');
  const named = Object.keys(SHEETS).filter((k) => sources.includes(k));
  return {
    reads, writes, disconnected, named, ownerPresent: Boolean(Number(owner?.n)), lines,
    output: `reads_tracker=${reads ? 'yes' : 'no'} writes_tracker=${writes ? 'yes' : 'no'} connected=${PROVIDERS.filter((p) => connState(p) === 'connected').join(',') || 'none'} not_connected=${disconnected.join(',') || 'none'} sheets_named=${named.join(',') || 'none'} site_inquiries=${Number(site?.n) || 0}`
  };
}

/**
 * Is a submitter's address readable on the live Inquiries page? (Scooter, 19 Nov 2026: Inquiries shows
 * "[email protected]".) Cloudflare's Email Address Obfuscation rewrites addresses unless the response
 * says `no-transform` (the dashboard also wraps each address in email_off markers). Inputs are what
 * production actually answered: the zone setting and the live /dashboard Cache-Control header.
 *   yes        — obfuscation is off, or the live dashboard already opts out
 *   after_land — obfuscation is on and the live dashboard is still the old code (no no-transform)
 *   unknown    — either reading is missing; never reported as yes
 */
export function addressReadable({ obfuscation, cacheControl }) {
  const obf = String(obfuscation || '').split(' ')[0];
  if (obf === 'off') return 'yes';
  if (obf !== 'on' || cacheControl == null) return 'unknown';
  return /(^|[\s,])no-transform($|[\s,])/i.test(cacheControl) ? 'yes' : 'after_land';
}

/**
 * What still stands between this environment and "the dashboard reads and writes your real tracker,
 * and a submitter's address is readable" — in order, each a step someone can actually take. Inputs are
 * production's own readings; a reading that is missing never turns into "nothing to do".
 *   land               — production still serves the code before this PR (his approval, then the merge)
 *   set_google_app     — the Google sign-in app's keys are not on this Pages project (the firm's vault)
 *   connect_google     — Google is not connected here (Scooter presses Connect Google on Connections)
 *   name_tracker_sheet — neither his deal tracker nor the Work sheet is named here
 *   first_tracker_write — it reads, but no change has yet been saved and checked in his tracker
 *   check_again        — a reading was missing, so the list cannot be trusted as complete
 */
export function nextSteps({ readable, googleApp, disconnected = [], named = [], reads, writes }) {
  const steps = [];
  if (readable === 'after_land') steps.push('land');
  if (googleApp === 'not_set') steps.push('set_google_app');
  if (disconnected.includes('google')) steps.push('connect_google');
  if (!named.includes('tracker') && !named.includes('work')) steps.push('name_tracker_sheet');
  if (reads && !writes) steps.push('first_tracker_write');
  if (readable === 'unknown' || googleApp === 'unknown') steps.push('check_again');
  return steps.length ? steps : ['none'];
}
