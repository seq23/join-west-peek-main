/**
 * Shared pieces of the Productions dashboard v1.0: crypto, escaping, US dates, host rules.
 * Holds SHAPES and WORDS only. No figure, client name or address lives in this repo
 * (Scooter, 13 Nov 2026: "Private figures never in the repo or any public file").
 */
import { siteForHost } from '../../api/lead.js';

export const TZ = 'America/Chicago';
export const enc = new TextEncoder();
const dec = new TextDecoder();

/* ------------------------------------------------------------------ hosts */

/** Production hosts. A sample session, the sample rows and the test identity never exist here. */
const PRODUCTION_HOSTS = ['westpeekproductions.com', 'www.westpeekproductions.com', 'west-peek-productions.pages.dev', 'productions.joinwestpeek.com', 'productions.westpeek.co'];
export function isProductionHost(hostname) {
  return PRODUCTION_HOSTS.includes(String(hostname || '').toLowerCase());
}
/** A Pages preview of this project (<hash or branch>.west-peek-productions.pages.dev) or a local run. */
export function isPreviewHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (isProductionHost(h)) return false;
  return h.endsWith('.west-peek-productions.pages.dev') || h === 'localhost' || h === '127.0.0.1';
}
/** The dashboard answers on Productions hosts and their previews only. */
export function dashboardHost(hostname) {
  return siteForHost(hostname) === 'productions' || isPreviewHost(hostname);
}

/* ------------------------------------------------------------------ crypto */

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(text) {
  const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d |= a[i] ^ b[i];
  return d === 0;
}
export const sameText = (a, b) => sameBytes(enc.encode(String(a)), enc.encode(String(b)));
export async function sha256b64(text) { return b64url(await crypto.subtle.digest('SHA-256', enc.encode(String(text)))); }
export function randomToken(bytes = 32) { return b64url(crypto.getRandomValues(new Uint8Array(bytes))); }

const PBKDF2_ITERATIONS = 100000;
async function pbkdf2(secret, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(salt), iterations }, key, 256));
}
/** A salted hash of a password or one-time password: the only form either is ever stored in. */
export async function hashSecret(secret) {
  const salt = randomToken(16);
  return { salt, hash: b64url(await pbkdf2(secret, salt, PBKDF2_ITERATIONS)), iterations: PBKDF2_ITERATIONS };
}
export async function secretMatches(secret, rec) {
  if (!rec || !rec.salt || !rec.hash || !secret) return false;
  return sameText(b64url(await pbkdf2(secret, rec.salt, rec.iterations || PBKDF2_ITERATIONS)), rec.hash);
}

/**
 * OAuth refresh tokens are kept only AES-GCM encrypted with the Worker secret
 * PRODUCTIONS_TOKEN_KEY (32 random bytes, base64url; set by `npm run dashboard:setup`).
 * No key → nothing is stored (fail closed), and Connections says so.
 */
async function tokenKey(env) {
  const raw = String(env?.PRODUCTIONS_TOKEN_KEY || '').trim();
  if (!raw) return null;
  let bytes;
  try { bytes = fromB64url(raw); } catch { return null; }
  if (bytes.length !== 32) return null;
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function canEncrypt(env) { return Boolean(await tokenKey(env)); }
export async function encryptJson(env, obj) {
  const key = await tokenKey(env);
  if (!key) throw new Error('token_key_missing');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}
export async function decryptJson(env, text) {
  const key = await tokenKey(env);
  if (!key || !text) return null;
  const [v, iv, ct] = String(text).split('.');
  if (v !== 'v1') return null;
  try {
    return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, key, fromB64url(ct))));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ words and dates */

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function toTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  // Sheets US dates (11/20/2026) and ISO (2026-11-20).
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]), 18);
  const iso = s.match(/^\d{4}-\d{2}-\d{2}$/) ? `${s}T18:00:00Z` : s;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}
/** "Fri, Nov 20" (US, Central). */
export function usDay(v) {
  const t = toTime(v);
  if (t === null) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(t));
}
/** "9:40 AM" today, or "Fri, Nov 20, 9:40 AM". */
export function usTime(v, now = Date.now()) {
  const t = toTime(v);
  if (t === null) return '';
  const d = new Date(t);
  const sameDay = usDay(t) === usDay(now);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d);
  return sameDay ? time : `${usDay(t)}, ${time}`;
}
/** Line 1 of Today: "Fri Nov 14". */
export function todayLabel(now = Date.now()) {
  return usDay(now).replace(',', '');
}
export function isoDay(now = Date.now()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  return p; // 2026-11-14
}
export function daysSince(v, now = Date.now()) {
  const t = toTime(v);
  return t === null ? null : Math.floor((now - t) / 86400000);
}
export function ageWords(days) {
  if (days === null || days === undefined) return '';
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  if (days < 14) return `${days} days`;
  const w = Math.floor(days / 7);
  return `${w} weeks`;
}
export function money(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isNaN(n) ? null : n;
}
export const normalEmail = (e) => String(e || '').trim().toLowerCase();
export const httpsOnly = (u) => (/^https:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');
