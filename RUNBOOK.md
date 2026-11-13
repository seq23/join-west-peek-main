# RUNBOOK — join-west-peek-main

Read this before changing anything. It is the file an AI employee (Porter in West Peek OS,
Danielle in Boss OS) reads at plan time; keep the paths and scripts named here current.

## What this repo is
Three static sites, one repo, three Cloudflare Pages projects that each build from `main` on push:

| Site | Source | Build | Domain |
|---|---|---|---|
| West Peek Ventures | `sites/ventures/` | `npm run build:ventures` → `dist/ventures` | westpeek.ventures (alias ventures.joinwestpeek.com) |
| West Peek Productions (agency) | `sites/productions/` | `npm run build:productions` → `dist/productions` | westpeekproductions.com |
| West Peek Community | `sites/community/` | `npm run build:community` → `dist/community` | joinwestpeek.com |

`shared/assets/` is copied into every site's `dist/<site>/assets/`. `dist/` is committed; rebuild
before committing so it never drifts from `sites/`. Forms POST to `/api/lead`
(`functions/api/lead.js`).

**Community and ventures forms add the person to the master network sheet. Productions forms do
not** — Sequoia, 22 Sep 2026: *"the productions website forms should not go to the network tab -
those are clients who should go to scooter."* The three sites share one handler, so the decision is
made from the REQUEST HOSTNAME (`siteForHost` / `writesToSheet` in `functions/api/lead.js`), never
from an attribute a new page could forget; an unrecognised host does not write. `functions/api/lead.js` emails Scooter always, and for community and ventures
also posts the submission to the West Peek Network OS intake door, which appends or updates a row on
the `contacts` tab. The email is still what the visitor's success means: if the sheet write fails the
visitor is not punished for it, but the failure is never silent — the response carries a `sheet`
field (`ok` / `failed` / `not_configured` / `skipped`), the failure is logged with the form and host,
and Network OS's `/api/health` reports the door's readiness under `siteFormIntake`. Which forms go
where is declared in `shared/forms-register.json` and enforced by rule FORM-10.

## Standing rules (owners' decisions, dated)
- **No navigation between the three properties** (Scooter, 20 Sep 2026). Ventures pages may not link
  to joinwestpeek.com, westpeekproductions.com or westpeek.live; `dilution.joinwestpeek.com` is the
  one allowed sister host. Structured data (JSON-LD) may still reference the family — it is not
  navigation. Guard: `npm run validate:ventures-isolation`.
- **Ventures forms are bot-checked on the server** (Scooter, 8 Oct 2026: spam posted straight to
  `/api/lead`). On ventures hosts only, `functions/api/lead.js` drops a POST with a missing or foreign
  `Origin`/`Referer` (200 `sheet:"skipped"`, no email, no row), and it requires a valid Cloudflare Turnstile token (400
  `bot_check_failed`; siteverify unreachable → 503). The hidden `website` honeypot stays. Every drop is
  logged with its reason; responses carry `bot_check`. Every ventures form carries
  `data-bot-check="turnstile"`; `forms.js` renders an interaction-only widget when `GET /api/lead` returns
  a site key. Guard: rule FORM-13 in `npm run validate:forms`.
- **Every site's `/api/lead` is limited per IP** (security sweep, 3 Nov 2026): 5 POSTs an hour per
  address (Cache API counter, per data centre), then 429 `rate_limited` before the body is read; the
  form shows its email fallback. Guard: rule FORM-14 in `npm run validate:forms`.
- **Ventures visual system is frozen** — colours, fonts, styling stay; changes are structure and
  content. The WP monogram (`sites/ventures/assets/img/wp-monogram.png`, black ink) is rendered
  white with `filter: invert(1)` (approved 20 Sep 2026).
- **Securities disclosure lives on `/disclosures` only** (Sequoia, 20 Sep 2026); every other ventures
  page links to it and carries no inline block. Guard: `npm run validate:disclosure`.
- **Ventures nav is one list**: Home · Thesis · What We Look For · Portfolio · Team · Community ·
  Resources ▾ · Submit Your Company, held in `scripts/validate_ventures_isolation.mjs`. Change the
  list there and in every page's `<nav class="wp-nav">` together.
- **Portfolio records** live in the markup of `sites/ventures/index.html#portfolio` and are mirrored
  on `sites/ventures/companies.html`. Each company: logo on a cream tile, founder photo, name,
  founders, Website + Instagram links (`target="_blank" rel="noopener noreferrer"`). Assets in
  `sites/ventures/assets/img/portfolio/`, registered in the build contract in `scripts/build.mjs`.
- **Retired pages redirect, never 404**: `sites/ventures/_redirects`.
- **Every form defaults to the master network sheet** (Sequoia, 22 Sep 2026): *"make all forms
  automatically default to adding names to our master network sheet."* A new transmitting form needs
  a hidden `lead_type` (or `lead_source`) and a row in `shared/forms-register.json`. A form that
  should go somewhere else is recorded in that file with a reason, a namer and a date — never a note
  in chat. **A form belongs in the sheet only when the people filling it in are West Peek's own
  contacts.** A client-service property's submissions belong to the client, so routing them into
  West Peek's sheet would take client data into a West Peek asset; those are `excluded_not_ours`,
  which is SETTLED and must never be read as an unwired gap. Two standing examples, both Sequoia,
  22 Sep 2026: **westpeekproductions.com** (agency enquiries are its clients, who go to Scooter) and
  **westpeek.live**. Only `pending_decision` means "not done yet". FORM-10 executes
  `writesToSheet()` from `lead.js` against every registered host in BOTH directions, so a
  productions form that reached the sheet door would fail the build. Guard:
  `npm run validate:forms`.
- **Decisions an employee must ask, not make**: brand or colourway, copy meaning, legal or
  regulatory wording, removing a public claim, image rights, anything about money. Structure, CSS,
  validators, redirects, asset handling: decide, record on the card, keep going.
- **Community visual system (23 Sep 2026 redesign; brightened 27 Sep 2026)**: white background,
  body ink `#343F49`, one orange token for buttons/links (`--wp-orange: #e0632f`, lifted from the
  original `#c45a3c` per Scooter's 27 Sep 2026 note that black read too dark), and the deeper
  tones from "website design thoughts.pdf" (page 3) as section accents
  (`--wp-accent-red/amber/gold/teal/plum/violet/olive`). Maax self-hosted from
  `sites/community/assets/fonts/`, no script/cursive type and no italics as a stylistic device
  anywhere on the site. Its own stylesheet is `sites/community/assets/community.css` —
  `shared/assets/base.css` is untouched by this and still serves the other two sites. Scroll
  motion on the homepage and about page (`[data-parallax-speed]` elements, transform-only, JS in
  `assets/community.js`) is off under `prefers-reduced-motion`.
- **Community nav is one list, same on every page**: Podcast &middot; Update &middot; Pitch &middot;
  Workshops &rarr; `/episodes`, `/update`, `/pitch`, `/workshops`. Dinners was removed from the
  nav and the homepage 27 Sep 2026 (Scooter: no photos yet); the copy and code are not deleted,
  only unlinked, so it can come back with a nav row and a homepage section when there are photos.
  No navigation from joinwestpeek.com to westpeek.ventures, westpeekproductions.com or
  westpeek.live (Scooter's 20 Sep 2026 rule, same as ventures isolation) — the JSON-LD entity
  graph on the homepage is exempt, since structured data is not navigation. `/join` carries the
  same nav and the community's sheet-writing join form, reachable from the hero Join button and
  the footer. **Footer carries no LinkedIn link** (27 Sep 2026). Guard (sister links, personal address, Update consent and gate): `npm run validate:community-site`.
- **Community homepage order is fixed**: Hero (the brief's exact line, a Join button, and a photo
  slot that stays hidden until `assets/data/hero.json` names a photo) &middot; Origin/History
  &middot; Podcast &middot; The Update &middot; Pitch Competition &middot; Workshops. `/podcast`
  and `/history` are retired and 301 to `/episodes` and `/about` respectively, in
  `sites/community/_redirects`.
- **The hero is live** (Scooter, 28 Sep 2026): "West Peek" stays fixed while the phrases in the
  h1's `data-phrases` type out, backspace and rotate (`assets/community.js`, `heroTyping`). The
  brief's exact line remains the h1's real shipped text (`#hero-line`) - what no-JS and
  `prefers-reduced-motion` visitors see and what screen readers hear; the typed copy is
  `aria-hidden`. Change the phrases in `sites/community/index.html`.
- **Pitch competition naming** (Scooter, 28 Sep 2026): it is "the pitch competition" or the
  "Sengo pitch competition", never "West Peek pitch competition"; the partner is spelled Sengo (owner, 28 Sep 2026; "Sango" was a misspelling).
  `/pitch` carries one winners heading, not a tag plus an h2.
- **No personal address on the community site** (28 Sep 2026): the "if the form fails, email
  scooter@…" line is gone; every community form carries
  `data-fallback-email="os@joinwestpeek.com"` (the West Peek OS inbox, routed) and must load
  `shared/assets/js/forms.js` (rule FORM-12 in `scripts/validate_forms.mjs`). A confirmed
  submission is answered with a thank-you panel that replaces the form (`data-success-panel`),
  never a one-line status.
- **`/welcome` is the friends-testing link** (Scooter, 28 Sep 2026): `sites/community/welcome.html`,
  noindex (so `scripts/build.mjs` keeps it out of the sitemap), his note verbatim, one button
  into the site, same nav as every page.
- **Episode, winner, and history-event records live in one data file each**
  (`sites/community/assets/data/episodes.json`, `winners.json`, `history-events.json`), read at
  runtime by `assets/community.js`. No invented YouTube id, headshot, winner, or event may ship —
  a missing record is a structured placeholder, never a guess. Each history-event record carries a
  `photos` array (`{src, name}`, `name` null when neither the source filename nor the flyer
  itself carries one - a name printed on the flyer counts and is recorded with `nameSource`)
  rendered as a flyer carousel; `flyer` stays as the first photo for the collapsed-row thumbnail. Each episode
  gets its own page at `/episodes/<slug>`, generated at build time by `scripts/build.mjs` from
  `sites/community/episode-template.html` — one template, not one file per guest, so a new episode
  is a JSON row, not a new page to remember to write.

- **The Productions dashboard is at westpeekproductions.com/dashboard, behind a password**
  (Scooter, 13 Nov 2026: "No dashboard page or data without the password. Private figures never in
  the repo or any public file: read server-side from a private store."). Server-rendered by
  `functions/dashboard/[[path]].js` → `functions/_lib/productions-dashboard.mjs`; Productions hosts
  only (404 elsewhere). **Who signs in** (Scooter, 13 Nov 2026, after the second preview: "The
  Productions dashboard is for Scooter only ... the owners list is Scooter alone, and nobody else can
  be added except by Scooter asking"): Scooter alone, with his own firm email and his own password,
  seeing everything including Money. There is no team sign-in, no team view and no shared password:
  a password typed without an email opens nothing. The owners list is `OWNER_IDS` in
  `functions/_lib/productions-dashboard.mjs` (`['scooter']`); a store record under any other id opens
  nothing and `dashboard:owners` refuses it, so adding someone is a code change made only when
  Scooter asks. The owner's first password is a one-time password emailed to their own firm email by the
  site's existing mail sender (Cloudflare email, then Resend, to that address only); signing in with
  it uses it up and the next screen makes them choose a password before anything is shown; unused, it
  stops working after 7 days. "Change password" on the dashboard; "Forgot it?" on the sign-in screen
  sends a fresh one-time password to the owner's address on record only (at most one per 5 minutes).
  Owner records (address, salted PBKDF2 hashes, `gen`) live only in the private store under `owners`,
  loaded by `npm run dashboard:owners` from a file outside this repo; never in the repo or a log.
  Wrong tries: 10 per connection and 5 per owner per 15 minutes.
  Figures live only in the KV namespace bound as `PRODUCTIONS_DASHBOARD`
  (keys `team`, `finance`, `meta`; plus `owners` and `session_key` for sign-in), loaded by `npm run dashboard:store` from a file that lives
  outside this repo. Cold email sending is off in code (`COLD_EMAIL_SENDING`); there is no sender
  here. Guard: `npm run test:dashboard`.

## Lead delivery and alarms
**A lead has two independent ways out** (outage 2 Nov to 6 Nov 2026: the Resend key behind every
form was deleted, every submission failed with 502, and only `console.error` knew). Code and the
full why: `functions/_lib/lead-delivery.mjs`; guard: `npm run test:lead` (`scripts/test_lead_delivery.mjs`).
- **Channel 1, Cloudflare email (primary, Sequoia 6 Nov 2026)**: the Worker `west-peek-forms-mailer`
  (`workers/forms-mailer/`), with a `send_email` binding on joinwestpeek.com Email Routing, reached
  from each Pages project by the service binding `FORMS_MAILER`. Cloudflare email reaches only the
  account's verified destination addresses, so channel 1 sends every lead to `FORMS_PROBE_CF_TO`
  (one verified destination; vault `WP_FORMS_PROBE_CF_TO`), and when that is not `LEAD_TO`, Resend
  also sends the lead to `LEAD_TO`, so the lead recipient gets every lead (7 Nov 2026: `LEAD_TO` was
  added as a destination on 6 Nov but never verified, so every Cloudflare leg failed with
  "destination address is not a verified address"). An unverified recipient answers 422
  `recipient_unverified` with the address, never 502; a real submission raises
  `cloudflare_unverified` (at most once a day, naming the address), and the probe logs it as a note.
  Deploy it with `npm run mailer:deploy`.
- **Channel 2, Resend (backup)**: Pages secret `RESEND_API_KEY` (vault `WP_FORMS_RESEND_API_KEY`, a
  key used only by these forms). Tried only when channel 1 did not deliver. **This key belongs to
  the forms only; rotating another product's key never touches it.** The outage began when the old
  key, shared with westpeek.live, was replaced by a new "Westpeek-live" key on 2 Nov 2026.
- **Only when both fail** does the visitor get a non-ok answer and see the email fallback.
- **The alarm**: any channel failure, `delivery_failed`, `delivery_not_configured`,
  `bot_check_not_configured` or `bot_check_unavailable` emails every address in `FORMS_ALARM_TO`.
  It goes out through a channel that did not fail, at most once per problem per hour (KV
  `west-peek-forms-alarms`), and a "Fixed" email follows once a later submission proves it healthy.
  If the Worker itself cannot be reached, `lead.js` sends the alarm through Resend directly.
- **The probe**: the Worker's cron runs at 8 AM Central (`0 13,14 * * *` UTC; `probeSitesFor()`
  keeps only the run that is 8 AM in Chicago): westpeek.ventures **every day** (Sequoia, 7 Nov
  2026), all three sites on Mondays. It POSTs to `/api/lead` with a signed `x-wp-forms-probe` header (HMAC-SHA256 over `t.host`, secret
  `FORMS_PROBE_SECRET`, 10 minutes valid). That skips the rate limit and bot checks, writes nothing to
  the sheet, and mails through BOTH channels: Resend to `os@joinwestpeek.com`, Cloudflare to
  `FORMS_PROBE_CF_TO`. Anything short of both channels OK on every site probed emails `FORMS_ALARM_TO`
  (a channel-1 address still waiting for its verification click is a note, not a failure). Each run
  logs one `OUTPUT probe daily|weekly ok=n/m` line (Worker logs), with any `note:`. Zero sites is
  `NAMED_STOP=NO_SITES_SELECTED`. A bad signature gets 401 `probe_refused`.
- **Run by hand** (needs `FORMS_MAILER_SECRET` from the vault): `POST <worker workers.dev URL>/probe`
  runs the probe now (body `{"sites":["westpeek.ventures"]}` for one site); `POST /test-alarm` sends a TEST alarm through each channel.

## How to make a change
1. Branch `work/<slug>` off `main` (CI runs on `work/**` pushes and on the PR).
2. Edit under `sites/<site>/`. New pages need a `<title>`, canonical, and a link to `/disclosures/`
   if under `sites/ventures/`.
3. `npm run validate` — builds all three sites, then runs `validate:forms`, `validate:disclosure` and
   `validate:ventures-isolation`. All must pass.
4. Commit sources, then `npm run lastmod` (sitemap dates come from git history), `npm run build`, commit `shared/lastmod.json` + `dist/`.
5. Look at it: serve `dist/<site>` locally, screenshot desktop and 390px (drawer open and closed
   for ventures). Curl every external link you added.
6. PR with the change spelled out; `~/bin/land <pr>` verifies green, merges, watches `main`. Pages
   deploys on push to `main`; prove it live with curl (nav present, no sister hrefs, assets 200).

## Guards, and what each pins
| Script | Pins |
|---|---|
| `scripts/validate_forms.mjs` | every form transmits; no success message without a server response; the thank-you panel appears only on a confirmed success (FORM-7); every page with a `data-westpeek-form` loads `shared/assets/js/forms.js` (FORM-12); every transmitting form is in `shared/forms-register.json` with a destination, and every form registered as reaching the sheet is actually wired through `functions/api/lead.js` to the Network OS intake door (FORM-10); the ventures bot check — Origin gate and Turnstile verification executed against a stubbed fetch, every ventures form carries `data-bot-check` (FORM-13) |
| `scripts/test_dashboard.mjs` | /dashboard: no page or store read without a password; Scooter alone signs in, with his own email and password (`OWNER_IDS`), and sees everything including Money; a password typed without an email opens nothing; a store record off the owners list opens nothing and gets no one-time password; no password setting is read; a one-time password goes to the owner's own address only, is stored hashed, works once, forces a new password before anything shows, and expires after 7 days; change password signs other sessions out; per-owner lockout; forged, stale or old team cookies refused; a session signed before the team sign-in was removed still opens; other hosts 404; cross-site sign-in refused; missing store said, never shown as clear; sending off; store text escaped; no store file committed |
| `scripts/validate_disclosure.mjs` | `/disclosures` carries the approved language; every ventures page links to it, none inline; outbound links carry `rel="noopener"` |
| `scripts/validate_ventures_isolation.mjs` | no sister-site links; canonical nav on every ventures page with the mobile toggle; anchors resolve; retired pages redirect |
| `scripts/validate_community_site.mjs` | no sister-property links on the community site; no personal address, OS-inbox fallback on every form; The Update's Yes/No consent radios, intake field names and server-side gate |
| `.github/workflows/entity-validation.yml` | runs the build and the guards above on every push and PR |

Prove a new guard negatively before merging: plant the defect, watch it fail, remove it.

## Porter may run

Derived by Porter from this repo's `package.json` because the RUNBOOK had no such section. Edit it freely — a human's list here wins over the derivation, and a job that needs a data-op the repo lacks writes the script and names it here in the same PR.

- `build` — `node scripts/build.mjs community && node scripts/build.mjs ventures && node scripts/build.mjs productions`
- `build:community` — `node scripts/build.mjs community`
- `build:productions` — `node scripts/build.mjs productions`
- `build:ventures` — `node scripts/build.mjs ventures`
- `test:lead` — `node scripts/test_lead_delivery.mjs`
- `validate` — `npm run build && npm run test:lead && npm run validate:forms && npm run validate:disclosure && npm run validate:ventures-isolation && npm run validate:community-site`
- `validate:community-site` — `node scripts/validate_community_site.mjs`
- `validate:disclosure` — `node scripts/validate_disclosure.mjs`
- `validate:forms` — `node scripts/validate_forms.mjs`
- `validate:ventures-isolation` — `node scripts/validate_ventures_isolation.mjs`
- `test:dashboard` — `node scripts/test_dashboard.mjs`
- `dashboard:store` — `node scripts/dashboard_store.mjs --env preview|production --file <store JSON outside the repo>`: checks the file, finds or creates the KV namespace, binds it to west-peek-productions as `PRODUCTIONS_DASHBOARD` for that environment, writes `team`, `finance`, `meta`. Prints counts only. Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- `dashboard:owners` — `node scripts/dashboard_owners.mjs --env preview|production --file <owners JSON outside the repo> [--url https://<site>] [--send]`: writes the owners (`{"owners":[{"id","name","email"}]}`, every id on `OWNER_IDS`, i.e. Scooter alone) into that environment's store under `owners`; the file is the whole list, so anyone else in the store is removed (an unchanged email keeps its password and session); with `--url`, proves the sign-in on that live site with a throwaway owner that opens for 30 minutes at most (signed out shows nothing; a one-time password forces a new password, then stops working; Money shows; a password typed without an email opens nothing; a record not on the owners list opens nothing with its own email and password; the store's owners are the file's) and removes it; with `--send`, only after the proof passes, presses "Forgot it?" for each owner so the site emails their one-time password, and reads back the channel. An owner with a password or an unused one already sent is skipped: one email each. Prints ids and counts only. Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Secrets
Per Pages project; set through `pages_env`, never by hand.
- All three site projects (production): `RESEND_API_KEY` (vault `WP_FORMS_RESEND_API_KEY`), service
  binding `FORMS_MAILER` → `west-peek-forms-mailer`, `FORMS_MAILER_SECRET`, `FORMS_PROBE_SECRET`,
  `FORMS_ALARM_TO` (the alarm addresses; vault `WP_FORMS_ALARM_TO`, never committed), `FORMS_PROBE_CF_TO` (vault `WP_FORMS_PROBE_CF_TO`). The Worker holds
  the same `FORMS_MAILER_SECRET`, `FORMS_PROBE_SECRET`, `FORMS_ALARM_TO` and `RESEND_API_KEY`.
- `west-peek-ventures`: `TURNSTILE_SITE_KEY` (plain var, public) and `TURNSTILE_SECRET_KEY` (secret) — the Turnstile widget's keys. Both are set (production and preview; vault `WEST_PEEK_VENTURES_TURNSTILE_SITE_KEY` / `_SECRET_KEY`, 3 Nov 2026). Unset, every ventures POST is refused 503 `bot_check_not_configured` (fail closed; was: Turnstile off, `bot_check: "not_configured"`).
- `west-peek-productions`: the dashboard needs no password setting; Scooter's record is in the
  private store (`dashboard:owners`). Without the store, /dashboard is shut and reads nothing (fail
  closed). One-time
  passwords need the forms' mail sender on this project (`FORMS_MAILER` + `FORMS_MAILER_SECRET`, or
  `RESEND_API_KEY` + `EMAIL_FROM`) for that environment.
  KV binding `PRODUCTIONS_DASHBOARD` is set by `npm run dashboard:store`, not by hand.
