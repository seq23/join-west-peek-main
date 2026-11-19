/**
 * west-peek-productions-dashboard-<env>: the Productions dashboard's clock.
 *
 *  - every 15 minutes: asks the dashboard to sync his sheets and accounts
 *    (POST <SITE_URL>/dashboard/cron/sync with the cron secret; the site checks it against a hash
 *    in its own database). Logs one OUTPUT line with counts only.
 *  - nightly (08:30 UTC, ~2:30 AM Central): exports every dashboard table from D1 (binding DB) to
 *    the private R2 bucket (binding BACKUPS) as backups/<YYYY-MM-DD>.json, keeps 30 days, deletes
 *    older ones. Also runs the real-data check (counts only) into the log.
 *  - POST /backup and POST /restore {key} (header x-dashboard-cron: CRON_SECRET): used by
 *    `npm run dashboard:setup -- --prove-restore`, which proves one restore on preview.
 * Deployed only by `npm run dashboard:setup` (it writes this Worker's config with the right D1 and
 * R2 for preview or production); never a bare wrangler deploy.
 */
import { BACKUP_TABLES } from '../../../functions/_lib/pd/schema.mjs';

const KEEP_DAYS = 30;
const enc = new TextEncoder();
async function sha(text) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function allowed(request, env) {
  const given = request.headers.get('x-dashboard-cron') || '';
  return Boolean(env.CRON_SECRET) && given.length > 0 && (await sha(given)) === (await sha(env.CRON_SECRET));
}

export async function exportAll(db) {
  const tables = {};
  for (const t of BACKUP_TABLES) {
    try { tables[t] = (await db.prepare(`SELECT * FROM ${t}`).all()).results || []; } catch { tables[t] = null; }
  }
  return { version: 1, at: new Date().toISOString(), tables };
}
export async function backup(env, now = Date.now()) {
  const doc = await exportAll(env.DB);
  const key = `backups/${new Date(now).toISOString().slice(0, 10)}.json`;
  await env.BACKUPS.put(key, JSON.stringify(doc), { httpMetadata: { contentType: 'application/json' } });
  let removed = 0;
  const cutoff = now - KEEP_DAYS * 86400000;
  const list = await env.BACKUPS.list({ prefix: 'backups/' });
  for (const o of list.objects || []) {
    const day = Date.parse((o.key.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '');
    if (day && day < cutoff) { await env.BACKUPS.delete(o.key); removed += 1; }
  }
  const rows = Object.values(doc.tables).reduce((a, r) => a + (r ? r.length : 0), 0);
  console.log(`OUTPUT dashboard backup key=${key} tables=${Object.keys(doc.tables).length} rows=${rows} removed=${removed}`);
  return { key, rows, removed };
}
export async function restore(env, key) {
  const obj = await env.BACKUPS.get(key);
  if (!obj) return { ok: false, why: 'no_such_backup' };
  const doc = JSON.parse(await obj.text());
  const stmts = [];
  let rows = 0;
  for (const t of BACKUP_TABLES) {
    const list = doc.tables?.[t];
    if (!Array.isArray(list)) continue;
    stmts.push(env.DB.prepare(`DELETE FROM ${t}`));
    for (const r of list) {
      const cols = Object.keys(r);
      if (!cols.length || cols.some((c) => !/^[a-z_]+$/.test(c))) continue;
      stmts.push(env.DB.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...cols.map((c) => r[c])));
      rows += 1;
    }
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  console.log(`OUTPUT dashboard restore key=${key} rows=${rows}`);
  return { ok: true, rows };
}

async function syncSite(env, check = false) {
  if (!env.SITE_URL) { console.log('OUTPUT dashboard sync NAMED_STOP=NO_SITE_URL'); return; }
  try {
    const res = await fetch(`${env.SITE_URL}/dashboard/cron/sync${check ? '?check=1' : ''}`, { method: 'POST', headers: { 'x-dashboard-cron': env.CRON_SECRET } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) { console.log(`OUTPUT dashboard sync NAMED_STOP=SITE_REFUSED status=${res.status}`); return; }
    const c = body.check;
    console.log(`OUTPUT dashboard sync ok=${body.ok} failed=${body.failed}${c ? ` real_check=${c.ok ? 'pass' : 'not_yet'} ${c.lines.map((l) => `${l.kind}=${l.shown}/${l.live ?? '-'}`).join(' ')}` : ''}`);
  } catch (err) {
    console.log(`OUTPUT dashboard sync NAMED_STOP=SITE_UNREACHABLE ${String(err).slice(0, 80)}`);
  }
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === '30 8 * * *') {
      ctx.waitUntil(backup(env));
      ctx.waitUntil(syncSite(env, true));
    } else {
      ctx.waitUntil(syncSite(env));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || !(await allowed(request, env))) return new Response('Not found', { status: 404 });
    if (url.pathname === '/backup') return Response.json(await backup(env));
    if (url.pathname === '/restore') {
      const { key } = await request.json().catch(() => ({}));
      if (!/^backups\/[\w.-]+\.json$/.test(String(key || ''))) return Response.json({ ok: false, why: 'bad_key' }, { status: 400 });
      return Response.json(await restore(env, key));
    }
    if (url.pathname === '/sync') { await syncSite(env, true); return Response.json({ ok: true }); }
    return new Response('Not found', { status: 404 });
  }
};
