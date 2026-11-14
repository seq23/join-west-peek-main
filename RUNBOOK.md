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

- **The Productions dashboard v1.0 is at westpeekproductions.com/dashboard, Scooter only**
  (Scooter, 13 Nov 2026: "No dashboard page or data without the password. Private figures never in
  the repo or any public file"; "The Productions dashboard is for Scooter only ... the owners list is
  Scooter alone"; v1.0, Sequoia's go 13 Nov 2026: "his working phone screen onto his own Google
  files"). Code: `functions/_lib/productions-dashboard.mjs` (routes) and `functions/_lib/pd/`
  (`auth`, `providers`, `data`, `views`, `schema`, `core`). Productions hosts and their Pages
  previews only (404 elsewhere).
  - **Source of truth = his Google Sheets.** Work sheet (Projects, Waiting on client, Deals, Agent
    drafts, Agent activity, Cold email log), Money sheet (Invoices, Expected receipts, Vendor
    obligations, Project margin, Cash, Tracker; Scooter only) plus the same-named Finance tabs of
    each binder the Projects tab links, and his inquiry Form response sheet (read only; never any
    West Peek network sheet). He names each on Connections or presses "Create it for me". Quick
    actions (Mark received, Move to next stage, Mark paid, Approve/Changes/Skip) write the row found
    by its `ID` column, re-read it, and only a re-read that shows the change is "Saved and checked".
    Chase / Send reminder create Gmail DRAFTS; there is no send code.
  - **Own storage per environment**: D1 `west-peek-productions-dashboard-<env>` bound as
    `PRODUCTIONS_DB` (owner, sessions, connections, sources, last-synced rows, action log, ticks,
    choices). Preview and production never share a database, bucket or Worker. The pre-v1.0 KV
    snapshot is retired from every screen; KV `PRODUCTIONS_DASHBOARD` is read only to copy Scooter's
    existing owner record and swap a still-valid old cookie for a D1 session (nobody signed out).
  - **Sign-in**: Sign in with Google (an Internal OAuth app in his Productions Workspace that he
    creates: Help → "Setting up the Google sign-in app"); until its secrets exist the sign-in screen
    says so calmly and the emailed one-time code → own password flow is the working fallback.
    Sessions are D1 rows (cookie holds a random token, the row holds its hash), "remember this phone"
    = 30 days, sign-out revokes the row, changing the password revokes every other session. Wrong
    tries: 10 per connection and 5 per owner per 15 minutes. A password typed without an email opens
    nothing. `OWNER_IDS` (`['scooter']`) in `functions/_lib/pd/auth.mjs` is the whole owners list.
  - **Connections**: Google (Drive, Sheets, Gmail drafts, Calendar), Dropbox (read), DocuSign
    (envelope status), QuickBooks or Xero (cash now, read) — each through the service's own OAuth
    screen; refresh tokens AES-GCM encrypted with `PRODUCTIONS_TOKEN_KEY`; Disconnect revokes at the
    provider where it can and deletes the token. His open choices (accounting tool, bank cash
    source, CRM, Shared Drive, agent seat, developer view, link) are buttons on Connections.
  - **Sync**: the Worker `west-peek-productions-dashboard-<env>` (`workers/productions-dashboard/`)
    calls `POST /dashboard/cron/sync` every 15 minutes (secret checked against a hash in D1) and
    "Refresh now" does the same; blocks older than 2 hours say "may be out of date"; a failed sync
    or a broken connection is a red row on Today. Nightly (08:30 UTC) it exports every table to the
    private R2 bucket `west-peek-productions-dashboard-backups-<env>`, keeps 30 days, and logs the
    real-data check (counts only).
  - **Preview sample mode**: on a preview host only, `sample@preview.invalid` /
    `preview-sample-only` signs in to synthetic rows (`sampleRows()`), never a connection or real
    row; refused on every production host. `npm run first-run` uses it.
  - Cold email sending is off in code (`COLD_EMAIL_SENDING`), cap 25 a week.
  Guards: `npm run test:dashboard`, `npm run validate:dashboard-privacy` (sample rows and the test
  fixtures' sheet grids carry placeholder names only).

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
| `scripts/validate_dashboard_privacy.mjs` | no owners file or dashboard loader input in the repo; sample rows are all "Sample …" with example.test addresses; no address (beyond the OS inbox and test domains) or dollar figure in dashboard code; no private package document; with `DASHBOARD_PRIVATE_NAMES_FILE`, none of those names anywhere |
| `scripts/test_dashboard.mjs` | /dashboard v1.0 against a real SQLite as D1 and stubbed Google: Scooter alone; password without email opens nothing; D1 sessions remembered 30 days, revoked on sign-out, others revoked on password change; pre-v1.0 password and cookie carry across; one-time code hashed, once, 7 days; lockout (a locked password never blocks a fresh emailed code); sample identity preview-only and never sees real rows; tokens encrypted; quick actions write the row by ID and a write not seen on re-read is reported failed; reminders are drafts; ticks persist; failed sync, broken connection and a disconnected account on Today; Disconnect revokes; Google sign-in refuses other accounts; cron door needs its secret; backup + restore; sending off |
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
- `dashboard:setup` — `node scripts/dashboard_setup.mjs --env preview|production [--site-url https://…] [--prove-restore]`: finds or creates that environment's D1, applies migrations, binds it as `PRODUCTIONS_DB`, adds `PRODUCTIONS_TOKEN_KEY` if absent, finds or creates the private R2 backup bucket (30-day expiry), deploys the sync/backup Worker with a fresh cron secret (hash kept in D1), and with `--prove-restore` backs up, deletes a marker, restores and checks it came back. Safe to repeat. Bindings and the key take effect on that environment's next deployment. Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
  State: preview set up 14 Nov 2026 (D1 `west-peek-productions-dashboard-preview`, Worker `west-peek-productions-dashboard-preview`, backup bucket with 30-day expiry, one restore proven). Production runs in LAND, after Scooter's yes: `dashboard:setup -- --env production`.
- `validate:dashboard-privacy` — `node scripts/validate_dashboard_privacy.mjs`
- `first-run` — `node scripts/dashboard_first_run.mjs --url <preview>` (or `FIRST_RUN_URL`): public pages load clean; signed out shows nothing; on a preview, signs in with the sample identity, sees rows on every tab, moves one deal a stage (confirmed), reloads, sees it on a second device, signs out and proves that session dead. Prints `FIRST_RUN OK`.
- `dashboard:owners` — `node scripts/dashboard_owners.mjs --env preview|production --file <owners JSON outside the repo> [--url https://<site>] [--send]`: writes the owner row (`{"owners":[{"id","name","email"}]}`, Scooter alone) into that environment's D1; an unchanged email keeps his password and sessions; `--send` presses that site's "Forgot it?" for an owner with no password and no unused code. Prints ids and counts only.

## Secrets
Per Pages project; set through `pages_env`, never by hand.
- All three site projects (production): `RESEND_API_KEY` (vault `WP_FORMS_RESEND_API_KEY`), service
  binding `FORMS_MAILER` → `west-peek-forms-mailer`, `FORMS_MAILER_SECRET`, `FORMS_PROBE_SECRET`,
  `FORMS_ALARM_TO` (the alarm addresses; vault `WP_FORMS_ALARM_TO`, never committed), `FORMS_PROBE_CF_TO` (vault `WP_FORMS_PROBE_CF_TO`). The Worker holds
  the same `FORMS_MAILER_SECRET`, `FORMS_PROBE_SECRET`, `FORMS_ALARM_TO` and `RESEND_API_KEY`.
- `west-peek-ventures`: `TURNSTILE_SITE_KEY` (plain var, public) and `TURNSTILE_SECRET_KEY` (secret) — the Turnstile widget's keys. Both are set (production and preview; vault `WEST_PEEK_VENTURES_TURNSTILE_SITE_KEY` / `_SECRET_KEY`, 3 Nov 2026). Unset, every ventures POST is refused 503 `bot_check_not_configured` (fail closed; was: Turnstile off, `bot_check: "not_configured"`).
- `west-peek-productions` (dashboard v1.0): `PRODUCTIONS_DB` (D1) and `PRODUCTIONS_TOKEN_KEY`
  are set by `npm run dashboard:setup`, never by hand. `GOOGLE_OAUTH_CLIENT_ID` +
  `GOOGLE_OAUTH_CLIENT_SECRET` (Internal app in his Productions Workspace; Sign in with Google and the
  Drive/Sheets/Gmail/Calendar connection) are HELD in the vault (14 Nov 2026) and set on this project
  through `pages_env`; `first-run` follows the button to Google's own screen and fails on a key Google
  does not know. Still to come, each emailed to os@joinwestpeek.com as `SECRET NAME=value`: `DROPBOX_APP_KEY` +
  `DROPBOX_APP_SECRET`, `DOCUSIGN_INTEGRATION_KEY` + `DOCUSIGN_SECRET_KEY`, `QUICKBOOKS_CLIENT_ID` +
  `QUICKBOOKS_CLIENT_SECRET` or `XERO_CLIENT_ID` + `XERO_CLIENT_SECRET`. Redirect URI for every one:
  `https://westpeekproductions.com/dashboard/oauth/callback` and, for this preview,
  `https://work-wpc-c548d043-next.west-peek-productions.pages.dev/dashboard/oauth/callback`. One-time codes
  need the forms' mail sender on this project (`FORMS_MAILER` + `FORMS_MAILER_SECRET`, or
  `RESEND_API_KEY` + `EMAIL_FROM`).
