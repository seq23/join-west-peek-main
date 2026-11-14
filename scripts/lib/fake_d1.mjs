/**
 * A D1 stand-in for the tests and the local first-run, on Node's built-in SQLite (Node 22+).
 * Same surface the dashboard uses: prepare().bind().first()/all()/run(), batch().
 */
import { DatabaseSync } from 'node:sqlite';

export function fakeD1(file = ':memory:') {
  const sqlite = new DatabaseSync(file);
  const statements = [];
  function stmt(sql, params = []) {
    const s = {
      bind: (...p) => stmt(sql, p),
      async first() { statements.push(sql); const r = sqlite.prepare(sql).get(...params); return r ? { ...r } : null; },
      async all() { statements.push(sql); return { results: sqlite.prepare(sql).all(...params).map((r) => ({ ...r })), success: true }; },
      async run() { statements.push(sql); const r = sqlite.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
      _exec() { const p = sqlite.prepare(sql); return /^\s*(select|insert.*returning)/i.test(sql) ? p.all(...params) : p.run(...params); }
    };
    return s;
  }
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      sqlite.exec('BEGIN');
      try { const out = list.map((s) => s._exec()); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
    async exec(sql) { sqlite.exec(sql); },
    statements,
    sqlite
  };
}
