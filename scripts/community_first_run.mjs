#!/usr/bin/env node
/**
 * first-run (community): plays Scooter's first session on a joinwestpeek.com preview.
 *
 *   node scripts/community_first_run.mjs --url https://<branch>.<project>.pages.dev
 *
 * 1. The homepage: six tiles in his order, each a button; his rotating line; Core Values word for
 *    word; Give and Take's line; no hover/tap instruction; no placeholder.
 * 2. The podcast: episodes.json newest first (6 Kimberly coming soon, 5 Ila, 4 Meka, 3, 2, 1), Ila's
 *    and Meka's YouTube ids, every episode page 200, /api/podcast-feed answering.
 * 3. Workshops: /api/workshops answers ok with an `upcoming` list (each with a title, start and link).
 * 4. Give and Take, end to end, with a marked TEST ask (a preview only; refused on any other host):
 *    submit → saved as waiting and NOT on the board → the signed Approve link shows a button and
 *    changes nothing on GET → pressing it puts the ask on the board → the board, read again as a
 *    second device, shows the words with no name or email → an offer is saved → the board still
 *    shows no offer, name or email → Take down clears the TEST ask off the board again.
 * Prints `FIRST_RUN OK` when every step passed; exits 1 on any failure.
 */
const urlsIn = (v) => String(v || "").match(/https?:\/\/[^\s,·]+/g) || [];
const urls = [];
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === "--url" && process.argv[i + 1]) urls.push(...urlsIn(process.argv[++i]));
  else if (process.argv[i].startsWith("--url=")) urls.push(...urlsIn(process.argv[i].slice(6)));
}
if (!urls.length) urls.push(...urlsIn(process.env.FIRST_RUN_URL));
if (!urls.length) { console.error("FIRST_RUN FAIL no URL: pass --url <preview>"); process.exit(1); }
const base = new URL(urls[0]).origin;
const host = new URL(base).hostname;
const isPreview = host.endsWith(".pages.dev") || host === "localhost" || host === "127.0.0.1";

const fails = [];
let steps = 0;
const ok = (name, cond, detail = "") => { steps += 1; if (cond) console.log(`  ok   ${name}`); else { fails.push(name); console.log(`  FAIL ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`); } };
const get = async (path, init = {}) => {
  const r = await fetch(base + path, { redirect: "manual", ...init, headers: { "user-agent": init.ua || "wp-first-run/1 (device A)", ...(init.headers || {}) } });
  return { status: r.status, text: await r.text(), headers: r.headers };
};
const PLACEHOLDER = /lorem ipsum|\bTODO\b|\{\{[A-Z_]+\}\}|\bTBD\b/i;
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ").replace(/&[a-z]+;|&#\d+;/g, " ").replace(/\s+/g, " ");

// 1. Homepage
const home = await get("/");
ok("homepage 200", home.status === 200, home.status);
const tiles = [...home.text.matchAll(/data-tile="([a-z]+)"/g)].map((m) => m[1]);
ok("six tiles in his order", tiles.join() === "about,values,give,podcasts,pitch,workshops", tiles.join());
ok("each tile title is a button with aria-expanded", (home.text.match(/class="wpc-tile__btn"[^>]*aria-expanded=/g) || []).length === 6);
ok("one rotating line with his four phrases", (home.text.match(/data-phrases=/g) || []).length === 1 && /less lonely building companies/.test(home.text) && /new ideas, opportunities, and relationships/.test(home.text));
for (const line of ["There is enough to go around. We share what we know and who we know.", "We say what is true, including what we need.", "Nobody builds alone. Our strength is how we are connected."]) ok(`Core Values: "${line.slice(0, 30)}…"`, home.text.includes(line));
ok("Give and Take line", home.text.includes("Ask for what you need. Give what you can."));
ok("no hover/tap instruction", !/\b(hover|tap)\b[^.]{0,60}\b(computer|phone)\b/i.test(text(home.text)));
ok("no placeholder on the homepage", !PLACEHOLDER.test(text(home.text)));

// 2. Podcast
const epRes = await get("/assets/data/episodes.json");
let eps = [];
try { eps = JSON.parse(epRes.text); } catch {}
const sorted = eps.slice().sort((a, b) => b.number - a.number);
ok("episodes newest first: 6 Kimberly, 5 Ila, 4 Meka, 3, 2, 1", sorted.map((e) => e.number).join() === "6,5,4,3,2,1" && /Kimberly/.test(sorted[0]?.guest) && /Ila/.test(sorted[1]?.guest) && /Meka/.test(sorted[2]?.guest), sorted.map((e) => `${e.number}:${e.guest}`).join(" "));
ok("Kimberly coming soon (no video), releaseDate 2026-11-30", !sorted[0]?.youtube && sorted[0]?.releaseDate === "2026-11-30");
ok("Ila's video TO_ReslR9hc, Meka's mAlul3Tfal4", sorted[1]?.youtube === "TO_ReslR9hc" && sorted[2]?.youtube === "mAlul3Tfal4");
for (const e of sorted) {
  const p = await get(`/episodes/${e.slug}/`);
  ok(`/episodes/${e.slug}/ 200, no placeholder`, p.status === 200 && !PLACEHOLDER.test(text(p.text)), p.status);
}
const kim = await get("/episodes/kimberly-gant/");
ok("Kimberly's page says Episode 6 and has no video", /Episode 6/.test(text(kim.text)) && !/youtube(-nocookie)?\.com\/embed/.test(kim.text));
const img = await get("/assets/img/episodes/ep6-kimberly-gant.webp");
ok("Kimberly's image renumbered ep6", img.status === 200, img.status);
const feed = await get("/api/podcast-feed");
let feedBody = {};
try { feedBody = JSON.parse(feed.text); } catch {}
ok("/api/podcast-feed answers with an items list", feed.status === 200 && Array.isArray(feedBody.items), feed.status);

// 3. Workshops
const ws = await get("/api/workshops");
let wsBody = {};
try { wsBody = JSON.parse(ws.text); } catch {}
ok("/api/workshops answers ok with an upcoming list", ws.status === 200 && wsBody.ok === true && Array.isArray(wsBody.upcoming), ws.text.slice(0, 200));
ok("every upcoming workshop has a title, start and link", (wsBody.upcoming || []).every((e) => e.title && e.start && e.url));

// 4. Give and Take
const gtPage = await get("/give-and-take");
ok("/give-and-take 200 with the ask box and the board", gtPage.status === 200 && /give_and_take_ask/.test(gtPage.text) && /id="gt-board"/.test(gtPage.text));
const board = async (ua) => { const r = await get("/api/give-take/board", { ua, headers: { "cache-control": "no-store" } }); let b = {}; try { b = JSON.parse(r.text); } catch {} return { ...r, body: b }; };
const b0 = await board();
ok("board answers ok (store bound on this environment)", b0.status === 200 && b0.body.ok === true, b0.text.slice(0, 200));

if (!isPreview) {
  console.log("  note: not a preview host, so no TEST ask is submitted here");
} else if (b0.body.ok) {
  const stamp = Date.now().toString(36);
  const askWords = `TEST ask ${stamp}: an introduction to someone who has run a first-time founder workshop.`;
  const post = async (fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ site: "community", website: "", "cf-turnstile-response": "XXXX.DUMMY.TOKEN.XXXX", ...fields })) fd.append(k, v);
    const r = await fetch(base + "/api/lead", { method: "POST", body: fd, headers: { origin: base, referer: base + "/give-and-take" } });
    let body = {};
    try { body = await r.json(); } catch {}
    return { status: r.status, body };
  };
  const ask = await post({ lead_type: "give_and_take_ask", name: "TEST Asker", email: `first-run-asker-${stamp}@example.test`, ask: askWords, help_kind: "Introduction" });
  ok("TEST ask submitted and saved", ask.status === 200 && ask.body.give_take === "saved" && ask.body.review?.approve, JSON.stringify(ask.body));
  ok("the ask never touched the network list", ask.body.sheet === "not_applicable", ask.body.sheet);
  const onBoard = (b) => (b.body.asks || []).find((a) => a.ask === askWords);
  ok("waiting ask is NOT on the board", !onBoard(await board()));
  const links = ask.body.review || {};
  if (links.approve) {
    const t = new URL(links.approve).searchParams.get("t");
    const g = await get(new URL(links.approve).pathname + "?t=" + encodeURIComponent(t));
    ok("approve link shows one button and changes nothing on open", g.status === 200 && /<form method="POST"/.test(g.text) && !onBoard(await board()));
    const forged = await fetch(base + "/api/give-take/review", { method: "POST", headers: { origin: base, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: t.slice(0, -2) + (t.endsWith("AA") ? "BB" : "AA") }) });
    ok("a forged review link is refused", forged.status === 400, forged.status);
    const press = await fetch(base + "/api/give-take/review", { method: "POST", headers: { origin: base, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t }) });
    ok("pressing Approve puts it on the board", press.status === 200 && /On the board/.test(await press.text()));
    const b1 = await board("wp-first-run/1 (device A, reload)");
    const b2 = await board("wp-first-run/1 (device B, phone)");
    const item = onBoard(b1);
    ok("approved ask on the board after a reload", Boolean(item));
    ok("…and on a second device", Boolean(onBoard(b2)));
    ok("board carries no name, email or avatar", !/TEST Asker|example\.test|avatar|"name"|"email"/i.test(b1.text), b1.text.slice(0, 300));
    if (item) {
      const offer = await post({ lead_type: "give_and_take_offer", ask_id: item.id, name: "TEST Helper", email: `first-run-helper-${stamp}@example.test`, offer: "TEST offer: I ran one last spring and can share the run of show.", share_consent: "yes" });
      ok("TEST offer saved against the ask", offer.status === 200 && offer.body.give_take === "saved", JSON.stringify(offer.body));
      const again = await post({ lead_type: "give_and_take_offer", ask_id: item.id, name: "TEST Helper", email: `first-run-helper-${stamp}@example.test`, offer: "TEST offer twice", share_consent: "yes" });
      ok("a second offer from the same helper is refused", again.status === 409 && again.body.error === "already_offered", JSON.stringify(again.body));
      const b3 = await board();
      ok("the offer is never shown on the board", !/TEST Helper|TEST offer|first-run-helper/i.test(b3.text));
    }
    const td = new URL(links.take_down).searchParams.get("t");
    const down = await fetch(base + "/api/give-take/review", { method: "POST", headers: { origin: base, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: td }) });
    ok("Take down clears the TEST ask off the board", down.status === 200 && !onBoard(await board()));
  }
}

if (fails.length) { console.log(`FIRST_RUN FAIL community ${fails.length} of ${steps} step(s): ${fails.join("; ")}`); process.exit(1); }
console.log(`FIRST_RUN OK community ${steps} step(s) on ${base}`);
