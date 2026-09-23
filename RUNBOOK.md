# RUNBOOK — join-west-peek-main

Read this before changing anything. It is the file an AI employee (Porter in West Peek OS,
Danielle in Boss OS) reads at plan time; `scripts/validate_runbook.mjs` fails the build if the
paths and scripts named here stop existing.

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
- **Community visual system (23 Sep 2026 redesign)**: black background, one orange token
  (`--wp-orange: #c45a3c`, the value already live on ventures), Maax self-hosted from
  `sites/community/assets/fonts/`, no script/cursive type and no italics as a stylistic device
  anywhere on the site. Its own stylesheet is `sites/community/assets/community.css` —
  `shared/assets/base.css` is untouched by this and still serves the other two sites.
- **Community nav is one list, same on every page**: Podcast &middot; Update &middot; Pitch &middot;
  Workshops &middot; Dinners &rarr; `/episodes`, `/update`, `/pitch`, `/workshops`, `/#dinners`.
  No navigation from joinwestpeek.com to westpeek.ventures, westpeekproductions.com or
  westpeek.live (Scooter's 20 Sep 2026 rule, same as ventures isolation) — the JSON-LD entity
  graph on the homepage is exempt, since structured data is not navigation. `/join` carries the
  same nav and the community's sheet-writing join form, linked from the footer only. Guard:
  `npm run validate:community-site`.
- **Community homepage order is fixed**: Hero (text only, the brief's exact line, no image) &middot;
  Origin/History &middot; Podcast &middot; The Update &middot; Pitch Competition &middot; Workshops
  &middot; Dinners (copy-only, no button). `/podcast` and `/history` are retired and 301 to
  `/episodes` and `/about` respectively, in `sites/community/_redirects`.
- **Episode, winner, and history-event records live in one data file each**
  (`sites/community/assets/data/episodes.json`, `winners.json`, `history-events.json`), read at
  runtime by `assets/community.js`. No invented YouTube id, headshot, winner, or event may ship —
  a missing record is a structured placeholder, never a guess.

## How to make a change
1. Branch `work/<slug>` off `main` (CI runs on `work/**` pushes and on the PR).
2. Edit under `sites/<site>/`. New pages need a `<title>`, canonical, and a link to `/disclosures/`
   if under `sites/ventures/`.
3. `npm run validate` — builds all three sites, then runs `validate:forms`, `validate:disclosure`,
   `validate:ventures-isolation`, `validate:community-viability`. All must pass.
4. Commit sources, then `npm run lastmod` (sitemap dates come from git history; CI fails an
   undated URL), `npm run build`, commit `shared/lastmod.json` + `dist/`.
5. Look at it: serve `dist/<site>` locally, screenshot desktop and 390px (drawer open and closed
   for ventures). Curl every external link you added.
6. PR with the change spelled out; `~/bin/land <pr>` verifies green, merges, watches `main`. Pages
   deploys on push to `main`; prove it live with curl (nav present, no sister hrefs, assets 200).

## Guards, and what each pins
| Script | Pins |
|---|---|
| `scripts/validate_forms.mjs` | every form transmits; no success message without a server response; every transmitting form is in `shared/forms-register.json` with a destination, and every form registered as reaching the sheet is actually wired through `functions/api/lead.js` to the Network OS intake door (FORM-10) |
| `scripts/validate_disclosure.mjs` | `/disclosures` carries the approved language; every ventures page links to it, none inline; outbound links carry `rel="noopener"` |
| `scripts/validate_ventures_isolation.mjs` | no sister-site links; canonical nav on every ventures page with the mobile toggle; anchors resolve; retired pages redirect |
| `scripts/validate_community_viability.mjs` | the Community assessment route and gates |
| `scripts/validate_community_site.mjs` | the community redesign: shared nav on every page, exact homepage order, text-only hero with the brief's line, no italic/script markup, no sister-property links, `/podcast` and `/history` redirect, every episode's YouTube id and headshot real |
| `.github/workflows/entity-validation.yml` | the JSON-LD entity graph on the three index pages; Organization schema on every built page; dated sitemaps |
| `scripts/validate_runbook.mjs` | this file names real paths and scripts |

Prove a new guard negatively before merging: plant the defect, watch it fail, remove it.
