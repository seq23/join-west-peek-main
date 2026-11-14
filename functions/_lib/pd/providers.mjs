/**
 * The accounts Scooter connects, each through that service's own OAuth screen (v1.0 ruling, 13 Nov
 * 2026: "never a password, never bank logins; we never see or store his passwords").
 *
 * Every client id and secret is a Worker secret on the west-peek-productions Pages project, made
 * by Scooter in that service's developer console (Help → "Setting up the Google sign-in app" and
 * the rows below). Until one exists its row says so calmly and offers the Help steps.
 * Refresh tokens are stored only AES-GCM encrypted (core.encryptJson). Disconnect revokes at the
 * provider where the provider offers it, then deletes the token row.
 */
import { dbOf, ensureSchema } from './schema.mjs';
import { b64url, canEncrypt, decryptJson, encryptJson, enc, randomToken } from './core.mjs';

const GOOGLE_SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly'
];

export const PROVIDERS = {
  google: {
    label: 'Google: Drive, Sheets, Gmail drafts, Calendar',
    idEnv: 'GOOGLE_OAUTH_CLIENT_ID', secretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    scopes: GOOGLE_SCOPES, pkce: true, extra: { access_type: 'offline', prompt: 'consent' },
    unlocks: 'Your projects, deals, money and agents sheets; finding documents; reminder drafts in Gmail; your next client meeting.',
    gives: 'Reads your sheets and Drive; writes only to the sheets you name here and the Finance tabs of the client binders your Projects tab links (when you mark an invoice there paid); creates Gmail drafts; reads your calendar.',
    never: 'Never sends an email, never deletes a file, never changes your calendar.'
  },
  dropbox: {
    label: 'Dropbox',
    idEnv: 'DROPBOX_APP_KEY', secretEnv: 'DROPBOX_APP_SECRET',
    auth: 'https://www.dropbox.com/oauth2/authorize', token: 'https://api.dropboxapi.com/oauth2/token',
    scopes: ['account_info.read', 'files.metadata.read'], scopeSep: ' ', pkce: true, extra: { token_access_type: 'offline' },
    unlocks: 'Finding video and raw media files from the search box.',
    gives: 'Reads file names and folders.', never: 'Never uploads, moves, shares or deletes anything.'
  },
  docusign: {
    label: 'DocuSign',
    idEnv: 'DOCUSIGN_INTEGRATION_KEY', secretEnv: 'DOCUSIGN_SECRET_KEY',
    auth: 'https://account.docusign.com/oauth/auth', token: 'https://account.docusign.com/oauth/token',
    scopes: ['signature'], basic: true,
    unlocks: 'Whether each SOW is sent, signed or waiting, on the client page.',
    gives: 'Reads the status of the envelopes your projects sheet names.', never: 'Never sends, voids or signs an envelope.'
  },
  quickbooks: {
    label: 'QuickBooks',
    idEnv: 'QUICKBOOKS_CLIENT_ID', secretEnv: 'QUICKBOOKS_CLIENT_SECRET',
    auth: 'https://appcenter.intuit.com/connect/oauth2', token: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    revoke: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
    scopes: ['com.intuit.quickbooks.accounting'], basic: true,
    unlocks: 'Cash now, from your bank accounts as QuickBooks sees them.',
    gives: 'Reads account balances.', never: 'Never creates, changes or pays anything. Never your bank login.'
  },
  xero: {
    label: 'Xero',
    idEnv: 'XERO_CLIENT_ID', secretEnv: 'XERO_CLIENT_SECRET',
    auth: 'https://login.xero.com/identity/connect/authorize', token: 'https://identity.xero.com/connect/token',
    revoke: 'https://identity.xero.com/connect/revocation',
    scopes: ['openid', 'email', 'offline_access', 'accounting.reports.read'], pkce: true, basic: true,
    unlocks: 'Cash now, from the bank summary in Xero.',
    gives: 'Reads reports.', never: 'Never creates, changes or pays anything. Never your bank login.'
  }
};
/** Every Worker secret the connections read (names only; for Help and the job's missing_secrets). */
export const OAUTH_SECRET_NAMES = Object.values(PROVIDERS).flatMap((p) => [p.idEnv, p.secretEnv]);

export function providerReady(env, name) {
  const p = PROVIDERS[name];
  return Boolean(p && String(env?.[p.idEnv] || '').trim() && String(env?.[p.secretEnv] || '').trim());
}

async function pkcePair() {
  const verifier = randomToken(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
  return { verifier, challenge };
}

/**
 * The URL to send the browser to. purpose 'signin' (Google sign-in, openid email only) or
 * 'connect'. The state row lives 15 minutes.
 */
export async function startOAuth(env, { provider, purpose, ownerId = null, remember = false, origin }, now = Date.now()) {
  const p = PROVIDERS[provider];
  const db = dbOf(env);
  await ensureSchema(db);
  const state = randomToken(24);
  const { verifier, challenge } = p.pkce ? await pkcePair() : {};
  await db.prepare('DELETE FROM oauth_state WHERE created_at < ?').bind(now - 15 * 60000).run();
  await db.prepare('INSERT INTO oauth_state (state, purpose, provider, verifier, owner_id, remember, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(state, purpose, provider, verifier || null, ownerId, remember ? 1 : 0, now).run();
  const scopes = purpose === 'signin' ? ['openid', 'email'] : p.scopes;
  const q = new URLSearchParams({
    client_id: String(env[p.idEnv]).trim(),
    redirect_uri: `${origin}/dashboard/oauth/callback`,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    ...(purpose === 'signin' ? { prompt: 'select_account' } : p.extra || {}),
    ...(p.pkce ? { code_challenge: challenge, code_challenge_method: 'S256' } : {})
  });
  return `${p.auth}?${q}`;
}

async function tokenCall(env, p, params) {
  const id = String(env[p.idEnv]).trim();
  const secret = String(env[p.secretEnv]).trim();
  const body = new URLSearchParams(params);
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (p.basic) headers.authorization = `Basic ${btoa(`${id}:${secret}`)}`;
  else { body.set('client_id', id); body.set('client_secret', secret); }
  const res = await fetch(p.token, { method: 'POST', headers, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw Object.assign(new Error(json.error || `token_${res.status}`), { oauth: json.error || `http_${res.status}` });
  return json;
}

function jwtPayload(jwt) {
  try {
    const part = String(jwt).split('.')[1];
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
  } catch { return null; }
}

/** After the provider sends the browser back. Returns { purpose, provider, ownerId, remember, email?, error? }. */
export async function finishOAuth(env, url, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const state = url.searchParams.get('state') || '';
  const row = state ? await db.prepare('SELECT * FROM oauth_state WHERE state = ?').bind(state).first() : null;
  if (!row || now - Number(row.created_at) > 15 * 60000) return { error: 'expired' };
  await db.prepare('DELETE FROM oauth_state WHERE state = ?').bind(state).run();
  const base = { purpose: row.purpose, provider: row.provider, ownerId: row.owner_id, remember: Boolean(row.remember) };
  if (url.searchParams.get('error')) return { ...base, error: url.searchParams.get('error') === 'access_denied' ? 'declined' : 'provider_error' };
  const p = PROVIDERS[row.provider];
  if (!p || !providerReady(env, row.provider)) return { ...base, error: 'not_set_up' };
  let tok;
  try {
    tok = await tokenCall(env, p, {
      grant_type: 'authorization_code', code: url.searchParams.get('code') || '',
      redirect_uri: `${url.origin}/dashboard/oauth/callback`,
      ...(row.verifier ? { code_verifier: row.verifier } : {})
    });
  } catch (err) {
    console.error(`dashboard oauth token exchange failed provider=${row.provider} reason=${err.oauth || 'network'}`);
    return { ...base, error: 'exchange_failed' };
  }

  if (row.purpose === 'signin') {
    // The id_token came straight from Google's token endpoint over TLS, so its claims are trusted
    // as issued; still check it was issued to this app and is current.
    const c = jwtPayload(tok.id_token);
    const okIss = c && ['https://accounts.google.com', 'accounts.google.com'].includes(c.iss);
    if (!c || !okIss || c.aud !== String(env[p.idEnv]).trim() || Number(c.exp) * 1000 < now || !c.email_verified) return { ...base, error: 'not_verified' };
    return { ...base, email: c.email };
  }

  if (!(await canEncrypt(env))) return { ...base, error: 'no_token_key' };
  const meta = {};
  let account = '';
  try {
    if (row.provider === 'google') account = jwtPayload(tok.id_token)?.email || '';
    if (row.provider === 'quickbooks') meta.realm = url.searchParams.get('realmId') || '';
    if (row.provider === 'dropbox') {
      const r = await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: { authorization: `Bearer ${tok.access_token}` } });
      account = (await r.json().catch(() => ({})))?.email || '';
    }
    if (row.provider === 'docusign') {
      const r = await fetch('https://account.docusign.com/oauth/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } });
      const u = await r.json().catch(() => ({}));
      const acct = (u.accounts || []).find((a) => a.is_default) || (u.accounts || [])[0] || {};
      account = u.email || '';
      Object.assign(meta, { account_id: acct.account_id, base_uri: acct.base_uri });
    }
    if (row.provider === 'xero') {
      const r = await fetch('https://api.xero.com/connections', { headers: { authorization: `Bearer ${tok.access_token}` } });
      const list = await r.json().catch(() => []);
      meta.tenant = list?.[0]?.tenantId || '';
      account = list?.[0]?.tenantName || jwtPayload(tok.id_token)?.email || '';
    }
  } catch { /* the account label is a nicety; the connection still stands */ }
  const secret = { access_token: tok.access_token, refresh_token: tok.refresh_token || null, expires_at: now + (Number(tok.expires_in) || 3600) * 1000 };
  await db.prepare('INSERT INTO connection (provider, account, status, scopes, token_enc, connected_at, last_sync, last_error, meta) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET account=excluded.account, status=excluded.status, scopes=excluded.scopes, token_enc=excluded.token_enc, connected_at=excluded.connected_at, last_error=NULL, meta=excluded.meta')
    .bind(row.provider, account, 'ok', String(tok.scope || p.scopes.join(' ')), await encryptJson(env, secret), now, null, null, JSON.stringify(meta)).run();
  await db.prepare('DELETE FROM setting WHERE key = ?').bind(`disconnected:${row.provider}`).run();
  console.log(`OUTPUT dashboard connected provider=${row.provider}`);
  return base;
}

export async function connectionRow(env, provider) {
  const db = dbOf(env);
  if (!db) return null;
  await ensureSchema(db);
  const r = await db.prepare('SELECT provider, account, status, scopes, connected_at, last_sync, last_error, meta FROM connection WHERE provider = ?').bind(provider).first();
  return r ? { ...r, meta: r.meta ? JSON.parse(r.meta) : {} } : null;
}
export async function listConnections(env) {
  const db = dbOf(env);
  if (!db) return [];
  await ensureSchema(db);
  const rows = (await db.prepare('SELECT provider, account, status, connected_at, last_sync, last_error, meta FROM connection').all()).results || [];
  return rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : {} }));
}
export async function markConnection(env, provider, { status, error = null, synced = null }) {
  const db = dbOf(env);
  await db.prepare(`UPDATE connection SET status = ?, last_error = ?${synced ? ', last_sync = ?' : ''} WHERE provider = ?`)
    .bind(...[status, error, ...(synced ? [synced] : []), provider]).run();
}

/** A current access token, refreshed when it is within a minute of expiring. Throws 'needs_reconnect'. */
export async function accessToken(env, provider, now = Date.now()) {
  const db = dbOf(env);
  const r = await db.prepare('SELECT token_enc FROM connection WHERE provider = ?').bind(provider).first();
  const tok = r ? await decryptJson(env, r.token_enc) : null;
  if (!tok) throw Object.assign(new Error('needs_reconnect'), { reason: r ? 'cannot_read_token' : 'not_connected' });
  if (tok.expires_at - 60000 > now) return tok.access_token;
  if (!tok.refresh_token || !providerReady(env, provider)) throw Object.assign(new Error('needs_reconnect'), { reason: 'expired' });
  try {
    const fresh = await tokenCall(env, PROVIDERS[provider], { grant_type: 'refresh_token', refresh_token: tok.refresh_token });
    const next = { access_token: fresh.access_token, refresh_token: fresh.refresh_token || tok.refresh_token, expires_at: now + (Number(fresh.expires_in) || 3600) * 1000 };
    await db.prepare('UPDATE connection SET token_enc = ? WHERE provider = ?').bind(await encryptJson(env, next), provider).run();
    return next.access_token;
  } catch (err) {
    await markConnection(env, provider, { status: 'broken', error: 'needs_reconnect' });
    throw Object.assign(new Error('needs_reconnect'), { reason: err.oauth || 'refresh_failed' });
  }
}

/** Revokes at the provider where it can, then deletes the token. Returns 'revoked' | 'deleted_only'. */
export async function disconnect(env, provider) {
  const db = dbOf(env);
  const r = await db.prepare('SELECT token_enc FROM connection WHERE provider = ?').bind(provider).first();
  const tok = r ? await decryptJson(env, r.token_enc) : null;
  let how = 'deleted_only';
  try {
    if (tok && provider === 'google') {
      const res = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok.refresh_token || tok.access_token)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      if (res.ok) how = 'revoked';
    } else if (tok && provider === 'dropbox') {
      const res = await fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { authorization: `Bearer ${tok.access_token}` } });
      if (res.ok) how = 'revoked';
    } else if (tok && PROVIDERS[provider]?.revoke && providerReady(env, provider)) {
      const p = PROVIDERS[provider];
      const body = provider === 'quickbooks' ? JSON.stringify({ token: tok.refresh_token || tok.access_token }) : new URLSearchParams({ token: tok.refresh_token || tok.access_token });
      const res = await fetch(p.revoke, { method: 'POST', headers: { authorization: `Basic ${btoa(`${String(env[p.idEnv]).trim()}:${String(env[p.secretEnv]).trim()}`)}`, 'content-type': provider === 'quickbooks' ? 'application/json' : 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
      if (res.ok) how = 'revoked';
    }
  } catch { /* the token is deleted below either way */ }
  await db.prepare('DELETE FROM connection WHERE provider = ?').bind(provider).run();
  // Remembered so Today can say what stopped working until he connects it again.
  await db.prepare('INSERT OR REPLACE INTO setting (key, value) VALUES (?, ?)').bind(`disconnected:${provider}`, JSON.stringify(Date.now())).run();
  console.log(`OUTPUT dashboard disconnected provider=${provider} how=${how}`);
  return how;
}
