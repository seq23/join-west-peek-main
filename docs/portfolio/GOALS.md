# Portfolio goal board — measured 2026-08-26

Every row below was measured on 2026-08-26 by running the command shown. **No claim in
this file is carried forward from a previous report.** Where a previous board's claim
contradicted what was measured today, the contradiction is stated explicitly.

Scope: the 11 tracked repos under `~/GitHub` — `sprylabs-hpc-site`,
`local-guides-citation-velocity`, `WPP-llm`, `authority-backlink-network`, `p-n-p`,
`approvalprep`, `dream-wedding-builder`, `join-west-peek-main`, `local-guides-generator`,
`hicks-consulting-canonical`, `horse-legal-guide-velocity`.

Verdicts: **DONE** (measured true everywhere in scope) · **PARTIAL** (true in some
repos/domains, measurably false in others) · **NOT DONE** · **UNVERIFIABLE** (cannot be
determined from this machine; the reason is stated).

---

## Verdict summary

| Verdict | Count | Goals |
|---|---|---|
| **DONE** | **2** | 3, 20 |
| **PARTIAL** | **13** | 2, 4, 5, 7, 8, 9, 10, 11, 13, 15, 17, 18, 19 |
| **NOT DONE** | **5** | 1, 6, 12, 14, 16 |
| **UNVERIFIABLE** | **0 at goal level** | but six specific sub-claims are unverifiable — listed at the end |

---

## At a glance

| # | Goal | Verdict |
|---|---|---|
| 1 | Self-healing loop in every repo | **NOT DONE** |
| 2 | Real query discovery (measured not modelled) | PARTIAL |
| 3 | Query atlas backed by real data | **DONE** |
| 4 | Validation registry + severity matrix everywhere | PARTIAL |
| 5 | GSC + Bing connected | PARTIAL |
| 6 | All GitHub Actions green | **NOT DONE** |
| 7 | Deployed via GitHub + Cloudflare | PARTIAL |
| 8 | Conversion surfaces wired | PARTIAL |
| 9 | AEO/GEO/SEO surface quality | PARTIAL |
| 10 | Agent's advice baked into all generators | PARTIAL |
| 11 | Retrofit old surfaces | PARTIAL |
| 12 | Caching / efficiency | **NOT DONE** |
| 13 | Hosting hygiene (no fallbacks, no source exposure) | PARTIAL |
| 14 | Repo / disk size | **NOT DONE** |
| 15 | Microsoft Clarity on every live domain | PARTIAL |
| 16 | Wikidata / Wikipedia entity records | **NOT DONE** |
| 17 | Repo operator currency | PARTIAL |
| 18 | authority-backlink overhaul + more editorials | PARTIAL |
| 19 | Cadence rework | PARTIAL |
| 20 | Portfolio verification | **DONE** |

---

## The 20 goals

### 1 · Self-healing loop in every repo — **NOT DONE**

Code exists in **9 of 11** repos (`scripts/selfheal/heal_until_clean.{mjs,js}`,
`_ops/selfheal/`, or `scripts/heal_until_clean.py`), all added in one batch on 2026-08-25.
`join-west-peek-main` and `local-guides-generator` have **none**.

**It is invoked by a GitHub Actions workflow in 0 of 11 repos.** Grepping every workflow
YAML for `run selfheal|heal_until_clean|heal-until-clean|selfheal` returns NONE in all
eleven. No other npm script calls it either, and no git hook references it. It runs only
if a human types it.

Report evidence — seven of the nine reports were produced by a single manual run on
2026-08-25 between 16:19 and 19:39, seven of them with `dry_run: true`:

- `local-guides-citation-velocity` 255 B, `"dry_run": true`, `CLEAN`, `repaired: []`
- `WPP-llm` 1159 B, `dry_run: false`, `CLEAN`, 5 registered repairs
- `p-n-p` 399 B, `dry_run: true`, `validators_run: 17`, `failed: []`
- `approvalprep` 744 B, `dryRun: true`, `CLEAN`, `blocked: []`
- `dream-wedding-builder` 577 B, `dry_run: true`, `gate_exit_code: 0`, `repaired: []`
- `hicks-consulting-canonical` 1727 B, `dry_run: true`, `CLEAN`
- `authority-backlink-network` 982 B, `mode: repair`, attempt 1 failed `pages_release` then repaired via `deterministic_build.py --write`, `repair_exit: 0` — **the only repo where the loop actually repaired anything**
- **`sprylabs-hpc-site`** — writes `reports/validation/self-heal-loop.json` (line 34); **the file does not exist. It has never produced output.**
- **`horse-legal-guide-velocity`** — writes `_ops/reports/self-heal-loop.json` (line 28); **does not exist**, though 22 other reports sit in that directory. Never ran.

**A naming trap:** WPP-llm's `.github/workflows/ci.yml:32` and `distribution.yml:37` run
`npm run release:self-heal`, but that script is a validation chain
(`build && content:quality:report && actions:validate && … && validate:all`) with **no
repair step and no loop**. Grepping for wiring scores WPP-llm as wired; it is not.
Separately, three repos do wire *different, narrower* healers that are real:
hicks `autonomy:self-heal` (`autonomy-self-heal.yml:30`, weekly cron), horse-legal
`content:self-heal` (3 workflows; `data/admin/self_heal_report.json` 489 KB shows
`total 300, repaired 195, passed 300, failed 0`), and approvalprep
`automation:self-heal-attempt` in 3 workflows.

### 2 · Real query discovery (measured, not modelled) — **PARTIAL**

`source_type` counts from each `data/authority_scale/query_atlas.json`:

| repo | queries | `gsc_search_analytics` (T1) | `semrush_keyword_magic` (T2b) |
|---|---|---|---|
| sprylabs-hpc-site | 71 | 69 | 2 |
| local-guides-citation-velocity | 68 | 64 | 4 |
| horse-legal-guide-velocity | 62 | 60 | 2 |
| p-n-p | 3 | 0 | 3 |
| approvalprep | 11 | 0 | 11 |
| dream-wedding-builder | 13 | 0 | 13 |

Three repos are genuinely measured. Three are 100% modelled keyword-tool data, and tiny:
p-n-p has **3** queries covering 2 of 36 clusters; approvalprep 11 queries / 4 of 40
clusters; dream-wedding-builder 13 queries / 5 of 60 clusters.

Corroborating live GSC data elsewhere: `hicks-consulting-canonical/data/agency/gsc_snapshot.json`
`status=ok` with 46 real `topQueries` (first: `"hicks consulting"`, clicks 5, impressions
50, position 3.18); `horse-legal-guide-velocity/.../gsc_snapshot.json` `status=ok`, 60
topQueries; `WPP-llm/data/signals/gsc_query_signals.json` `status=collected`, **897
records** for `sc-domain:virtualagency-os.com`.

**Contradiction inside sprylabs:** its atlas claims 69 T1 `gsc_search_analytics` rows, but
`data/search_intelligence/gsc_truth.json` reads `provider_state="UNAVAILABLE"`,
`overall_status=UNAVAILABLE`, `status_is_healthy=false`,
`unavailable_note="No Google Search Console Search Analytics export available for this run."`
The T1 rows are real but were ingested earlier; the ingest is broken now (goal 5/6).
`p-n-p`'s `gsc_truth.json` is likewise `UNAVAILABLE`, dated 2026-08-07.

### 3 · Query atlas backed by real data — **DONE**

This was one of the three false claims on the last board. It is true now, and the rebuild
is in git:

- `git log -1 -- data/authority_scale/query_atlas.json` — sprylabs and horse-legal: `2026-08-26 Rebuild the query atlas from the evidence that was already ingested`; local-guides-citation-velocity: `2026-08-26 query evidence refresh: measured GSC demand -> atlas`; p-n-p / approvalprep / dream-wedding-builder: `2026-08-24 feat(atlas): evidence-gated query atlas (WO-12/WO-2)`.
- Every atlas reports `unmatched_count=0` with `evidence_backed_count` equal to its query count — no unbacked rows.
- Published and live: `https://virtualagency-os.com/query-atlas` → 200, with **83 `query-atlas` entries in the live `sitemap.xml`** (3,240 `<loc>` total, matching the on-disk build exactly). `https://hicksconsulting.org/llm-atlas/` → 200. `https://theindustryguides.com/atlas/` → 200.

Caveat from goal 2: three of six atlases rest on modelled evidence, and cluster coverage
is thin (sprylabs: 16 of 40 clusters have evidence, 29 reserve-only).

### 4 · Validation registry + severity matrix everywhere — **PARTIAL**

Registry file in **6 of 11** repos; a `severity` field in **4**.

| repo | registry file | severity fields |
|---|---|---|
| sprylabs-hpc-site | `_validation_registry.json` (209,381 b) | **none** — uses `proposed_severity` (`HARD_FAIL`), not `severity` |
| local-guides-citation-velocity | `_validation_registry.json` (171,890 b) | `severity`, `warning`, `advisory` |
| approvalprep | `_repo_validation_registry.json` (41,375 b) | `severity` |
| hicks-consulting-canonical | `_repo_validation_registry.json` (34,252 b) | `severity` |
| dream-wedding-builder | `_repo_validation_registry.json` (8,104 b) | `severity`, `advisory` |
| p-n-p | `data/ops/repo_validation_registry.json` (8,800 b) | **none** |
| WPP-llm · authority-backlink-network · local-guides-generator · horse-legal-guide-velocity · join-west-peek-main | **none** | — |

Only sprylabs and approvalprep expose `npm run validate:validation-registry`; the other
four registries have no runner wired to them.

### 5 · GSC + Bing connected — **PARTIAL** (GSC mostly; Bing is 1 of 11)

**GSC secrets** (`gh secret list`): `GSC_SERVICE_ACCOUNT_JSON` in 7 repos — sprylabs,
local-guides-citation-velocity, WPP-llm, p-n-p, local-guides-generator, hicks,
horse-legal. **Absent** in authority-backlink-network, approvalprep,
dream-wedding-builder, join-west-peek-main — the last two have **no secrets at all**.

**GSC actually returning data**: yes for hicks (46 queries), horse-legal (60), WPP-llm
(897 records, collected 2026-08-26T08:51Z). **No** for sprylabs (`UNAVAILABLE`), p-n-p
(`UNAVAILABLE`, 2026-08-07), and local-guides-citation-velocity, whose `gsc_truth.json` is
144 bytes reading `"state": "NOT_CONFIGURED", "evidence": []`.

**Bing**: `BING_WEBMASTER_API_KEY` is set in **exactly one repo**, hicks-consulting-canonical,
and it is genuinely wired (`.github/workflows/agency-seo-monitor.yml:25` →
`scripts/agency/refresh_search_health.js:51`). Its snapshot is `status:"ok"` — but every
data point is empty: `{"Clicks":0,"Impressions":0}` across the series.
horse-legal's `bing_snapshot.json` says it outright: `"status":"not_connected" …
"message":"Add BING_WEBMASTER_API_KEY and BING_SITE_URL to GitHub Actions."` The other 9
repos have no Bing integration at all.

### 6 · All GitHub Actions green — **NOT DONE**

Measured with `gh api repos/seq23/<repo>/actions/workflows`, then per-workflow
`/runs?per_page=1`, then `/actions/runs/<id>/jobs` for job counts.

**96 registered workflows: 67 green · 8 failing · 2 stuck queued with zero jobs · 19 never ran.**

| repo | total | green | failing | queued 0-jobs | never ran |
|---|---|---|---|---|---|
| sprylabs-hpc-site | 9 | 4 | 2 | 0 | 3 |
| local-guides-citation-velocity | 9 | 4 | 3 | 1 | 1 |
| WPP-llm | 8 | 6 | 1 | 0 | 1 |
| authority-backlink-network | 4 | 3 | 0 | 1 | 0 |
| p-n-p | 4 | 3 | 0 | 0 | 1 |
| approvalprep | 16 | 13 | 0 | 0 | 3 |
| dream-wedding-builder | 4 | 2 | 2 | 0 | 0 |
| join-west-peek-main | 1 | 1 | 0 | 0 | 0 |
| local-guides-generator | 11 | 10 | 0 | 0 | 1 |
| hicks-consulting-canonical | 14 | 13 | 0 | 0 | 1 |
| horse-legal-guide-velocity | 16 | 8 | 0 | 0 | 8 |

**Failing, with the actual cause from `gh run view --log-failed`:**

- sprylabs / **Search Intelligence Cycle** — `FileNotFoundError: [Errno 2] No such file or directory: 'data/search_intelligence/provider_inputs/gsc_bhpc.json'`. The directory was created afterwards (commit `ebc196063`), but `ls` today shows only `.gitkeep` — **the file the cycle needs still does not exist, so the fix is unproven.**
- sprylabs / **Deploy Distribution** — failure; no failed-step log retrievable.
- local-guides-citation-velocity / **Validate Repo** — `OPERATOR DOC CURRENCY FAIL: 1 stale reference(s) of 85 checked` → `VALIDATION SUMMARY: FAIL {"PASS":11,"FAIL":1,"NOT_RUN_AFTER_BLOCK":92}`. One stale doc reference blocks 92 downstream validators.
- local-guides-citation-velocity / **Postdeploy Public Audit** — `PUBLIC CLICK AUDIT FAIL: 36/36`, every page on the same CSP violation (goal 15).
- local-guides-citation-velocity / **Velocity Content Release** — `AGENT EXACT IMPLEMENTATION TRACE FAIL` → `{"PASS":3,"FAIL":1,"NOT_RUN_AFTER_BLOCK":4}`.
- dream-wedding-builder / **Full Safe Autonomy** — `[authority:flow] FAIL: rejection rate 30.9% exceeds 25% ceiling - registry likely broken, not merely incomplete`.
- dream-wedding-builder / **Search Intelligence** — `error: cannot pull with rebase: You have unstaged changes.` … `exit code 128`. The workflow dirties its own tree, then cannot rebase.
- WPP-llm / **`auto_publish_insights.yml`** — a **ghost registration**. The file was deleted from disk in commit `924f9707` (2026-06-25); GitHub still lists the workflow and its last run (2026-06-25) failed with **0 jobs**.

**Stuck queued with zero jobs** (the `total_count: 0` startup-failure case):

- local-guides-citation-velocity / **Deploy Distribution** — created `2026-08-26T15:05:48Z`, still `queued`, `jobs: 0` over an hour later.
- authority-backlink-network / **Release Validation** (`hostile-review.yml`) — created `2026-08-26T15:31:47Z`, still `queued`, `jobs: 0`.

**Never ran (19).** sprylabs: Spry Full Rebuild, Admin Command, Admin Operations ·
local-guides-citation-velocity: Velocity Full Rebuild · WPP-llm: Admin Command · p-n-p:
Search Intelligence Cycle · approvalprep: Admin Manifest Check, Artifact Validation,
Release Report · local-guides-generator: Add City Request · hicks: Full Safe Autonomy
Cycle · **horse-legal-guide-velocity: 8 of its 16** — Admin Bulk Content Actions, Admin
Maintenance, **Build Repo**, Owner Approved Page Remediation, **Manual Publish**,
**Provider Query Intelligence**, Owner Approved Query Page Repair, **Sitemap And Indexing**.

**Stale by months** (last run; today = 2026-08-26): local-guides-generator / Distribution
**2026-04-07 (~4.6 mo)**; local-guides-generator / Refresh Verification Page **2026-04-14
(~4.4 mo)**; local-guides-generator / Promote Reference 2026-06-19 (~2.2 mo); horse-legal
/ Deploy Distribution 2026-06-23 (~2.1 mo); WPP-llm / auto_publish_insights 2026-06-25
(~2.0 mo); hicks / Sitemap Indexing Check 2026-07-08 (~1.6 mo); local-guides-generator /
Build Starter Pack 2026-07-15 (~1.4 mo).

### 7 · Deployed via GitHub + Cloudflare — **PARTIAL**

The sites are live on Cloudflare — `curl -sI` returns `server: cloudflare` on all ten
domains checked. But **no repo deploys from GitHub Actions.** Grepping all 11
`.github/workflows/` trees for `wrangler deploy|wrangler pages deploy|cloudflare/wrangler-action|cloudflare/pages-action`
returns **0 hits in all 96 workflow files**. Deployment happens through Cloudflare Pages'
Git integration, configured dashboard-side with no source-controlled record.

The only `CLOUDFLARE_*` secret used anywhere in workflow YAML is not a deploy:
`approvalprep/.github/workflows/citation-os-weekly.yml:46-48` passes
`CLOUDFLARE_ACCOUNT_ID`/`ZONE_ID`/`API_TOKEN` to
`scripts/intelligence/ingest-cloudflare-crawler-logs.mjs` (analytics), with
`RUN_MODE: dry_run`.

wrangler config present in **6 of 11**: sprylabs (`pages_build_output_dir="./.pages-output"`),
local-guides-citation-velocity (`dist`), approvalprep (`dist`, + D1/KV/R2),
hicks (`dist`, KV+R2), horse-legal (`dist`), and dream-wedding-builder
(`wrangler.jsonc`, `main=".open-next/worker.js"`, `assets.directory=".open-next/assets"`).
WPP-llm, authority-backlink-network, p-n-p, join-west-peek-main and local-guides-generator
have none.

That Pages really builds these repos is proven, not assumed:
`md5 horse-legal-guide-velocity/dist/index.html` = `35b25160d95c60d95e6508f486e3600b` =
the md5 of `curl https://horselegalguide.com/`. The repo has no root `index.html`, so
Pages is serving `dist/`.

The repos concede the gap themselves —
`authority-backlink-network/docs/BASELINE-DEEP-VALIDATION-REPORT.md:51`: *"Direct
Cloudflare deploy workflows were removed because Cloudflare is already connected to
GitHub."* And `WPP-llm/docs/operator/DEPLOYMENT.md:9`: *"it does not contain the
authoritative Cloudflare Pages project binding or an in-repo deploy workflow…
deployment-provider status is `EXTERNAL_CONFIG_UNPROVEN`."*

**`dream-wedding-builder` is unaccounted for.** It is configured as a Worker (`main` +
`assets`), which Pages Git integration cannot deploy, and there is no Actions deploy.
Someone must run `wrangler deploy` by hand. Whether it has ever been deployed is
**UNVERIFIABLE** from here.

### 8 · Conversion surfaces wired — **PARTIAL**

| domain | surface | target status |
|---|---|---|
| billionairehighperformancecoach.com | Gumroad `https://sprylabs.gumroad.com/l/billionaire-high-performance-coach` (6,521 refs in repo); 0 `<form>` | **WORKING** — 200 |
| approvalprep.com | Stripe via `fetch("/api/create-checkout-session")` | **WORKING** — `POST {}` → `400 {"ok":false,"error":"MISSING_PRODUCT"}`; `GET /api/products` → 200, live catalog (`letter-of-explanation` $39.00, `status:"live"`) |
| hicksconsulting.org | SimplePractice booking + `/organizational-training-inquiry/` | **WORKING** — booking 200; `POST /api/training-inquiry {}` → `400 … "Missing required fields: firstName, lastName, company, email, …"`; `POST /api/lead-magnet {}` → `400 … "firstName, email, consent"` |
| porchandparty901.com | Google Form `https://forms.gle/vHjfKtRRAnGV3HxFA` | **WORKING** — 302 → live Google Form |
| dentistryguides.com | real HTML `<form … action="/api/request-assistance">` | **WORKING** — `POST {}` → `400 {"ok":false,"error":"provider_type"}`, live Pages Function |
| westpeekproductions.com | `https://forms.gle/qUrkAwHruFsh8WLC8` | **WORKING** — 302 → live Google Form |
| weddingchecklistpdf.com (dream-wedding-builder) | `/api/checkout` | **WORKING** — `POST {}` → `400 {"error":"Unknown SKU"}` |
| **joinwestpeek.com** | contact forms POST to `/api/lead` | **BROKEN — silently.** See below |
| **horselegalguide.com** | **none** — no form, no mailto, no booking, no payment; only 3 outbound referral links to `wisecovington.com` | no conversion surface at all |
| **theindustryguides.com** | **none of its own** — links out to 5 sibling domains; its own `/request-assistance/` → **404**, `POST /api/request-assistance` → **405** (repo has no `functions/` dir) | no on-site conversion |

**The silent failure.** `join-west-peek-main/README_DEPLOY.md:28` states *"Each site
includes a real contact form that POSTs to `/api/lead` (expected to be powered by a
Cloudflare Worker)."* `/api/lead` appears 8× across `shared/assets/js/forms.js`,
`dist/community/index.html`, `dist/ventures/pitch.html`,
`dist/productions/assets/js/forms.js`. **There is no `functions/` directory in the repo and
no Worker.** Probed against a control path:

```
POST https://joinwestpeek.com/api/lead                 -> 405
GET  https://joinwestpeek.com/api/lead                 -> 404
POST https://joinwestpeek.com/api/zzz-nonexistent-xyz  -> 405   <- identical
GET  https://joinwestpeek.com/api/zzz-nonexistent-xyz  -> 404   <- identical
```

`/api/lead` responds exactly like a path that does not exist. **Every lead submitted
through the West Peek community, ventures and productions contact forms is discarded.**

Also worth noting: only dentistryguides.com has a native HTML form. Every other surface is
an outbound link or a JS-driven call.

### 9 · AEO/GEO/SEO surface quality — **PARTIAL**

Each repo's `validate_content_pattern_contract.js` run read-only (horse-legal keeps its
copy at `_ops/validators/`; `join-west-peek-main` and `local-guides-generator` have **no
such validator**). Blocking-pattern results, verbatim:

```
sprylabs-hpc-site        CONTENT PATTERN CONTRACT: 2887 pages checked (enforcement: block)
  BLOCKING direct_answer          coverage   100%  missing on 0
  BLOCKING query_in_heading       coverage   100%  missing on 0
  BLOCKING no_empty_table_cells   coverage   100%  missing on 0
  BLOCKING conversion_path        coverage   100%  missing on 0
CONTENT PATTERN CONTRACT PASS

local-guides-citation-velocity  CONTENT PATTERN CONTRACT: 2342 pages checked
  BLOCKING direct_answer          coverage  99.7%  missing on 7
CONTENT PATTERN CONTRACT FAIL: 7 blocking gap(s)

WPP-llm                  CONTENT PATTERN CONTRACT: 3240 pages checked (enforcement: report)
  BLOCKING direct_answer          coverage  95.6%  missing on 143
CONTENT PATTERN CONTRACT: 143 blocking gap(s)
  reported, not blocking: STRONG_WARNING while the backlog above is worked.

authority-backlink-network  CONTENT PATTERN CONTRACT: 562 pages checked (enforcement: block)
  all four BLOCKING patterns 100% - CONTENT PATTERN CONTRACT PASS

p-n-p                    CONTENT PATTERN CONTRACT: 101 pages checked (enforcement: block)
  all four BLOCKING patterns 100% - CONTENT PATTERN CONTRACT PASS

approvalprep             [content-pattern-contract] 94 pages checked (enforcement: block)
  all four BLOCKING patterns 100% - [content-pattern-contract] OK

dream-wedding-builder    content-pattern-contract: 79 content pages checked (enforcement: block)
  all four BLOCKING patterns 100% - content-pattern-contract passed
  2 documented exception(s): /printable-wedding-checklist, /wedding-seating-chart :: no_empty_table_cells

hicks-consulting-canonical  Content pattern contract: 259 published pages checked.
  BLOCKING conversion_path        coverage  97.3%  missing on 7
  VALIDATION_FINDING check=unregistered-check summary=blocking=7
  7 page(s) miss a blocking content block.   (all seven are pages/llm-atlas/*/index.html)

horse-legal-guide-velocity  (557 pages)
  BLOCKING direct_answer          coverage  96.1%  missing on 22  (of 557)
  AUDIT REPORT: validate_content_pattern_contract found 29 issue(s).
```

Three repos have live blocking failures: local-guides-citation-velocity (7 pages — all
`atlas/*/index.html` plus `index.html`), hicks (7 `llm-atlas` pages with **no conversion
path** — *"an answer-engine citation lands with nowhere to go"*), and horse-legal (22 hub
and section index pages with no quick-answer block). **WPP-llm's 143 gaps are real but its
enforcement is set to `report`, not `block` — it passes by configuration, not by quality.**

Live spot checks corroborate the validators. Every homepage checked has
`application/ld+json`, `rel="canonical"`, `name="description"` and exactly one `<h1>`. But
`https://horselegalguide.com/hubs/liability-waivers-insurance/` returns 200 with
`data-answer-summary: 0` and no recommendation summary, exactly as reported.
`https://approvalprep.com/` carries only `Organization` schema — thin next to
billionairehighperformancecoach.com's 15 `@type`s.

### 10 · Agent's advice baked into all generators — **PARTIAL**

`.clarity/content-pattern-spec.json` exists in 8 of the 9 repos that have the validator
(missing in authority-backlink-network). Grepping generator scripts (excluding validators)
for references to it:

- **Generators do consume it**: sprylabs; local-guides-citation-velocity (`scripts/build_site.js`); WPP-llm (`build_wo3_production_pages.mjs`, `build_community_authority_foundation.mjs`, `build_insights.js`); dream-wedding-builder (`run-full-flow.mjs`, `publish_authority_batch.mjs`).
- **Spec present but no generator reads it**: **p-n-p, hicks-consulting-canonical, horse-legal-guide-velocity.** In those three the spec is inert — which is exactly why their retrofit coverage is worst (goal 11).
- approvalprep and authority-backlink-network reference it only from `retrofit_recommendation_summary.js`, a one-shot backfill, not a generator.

### 11 · Retrofit old surfaces — **PARTIAL** (the `recommendation_summary` claim is false in two repos)

Verbatim `recommendation_summary` lines:

| repo | line |
|---|---|
| sprylabs-hpc-site | `gap      recommendation_summary coverage   100%  missing on 1` |
| dream-wedding-builder | `gap      recommendation_summary coverage   100%  missing on 0` |
| approvalprep | `gap      recommendation_summary coverage  95.7%  missing on 4` |
| WPP-llm | `gap      recommendation_summary coverage  91.6%  missing on 272` |
| p-n-p | `gap      recommendation_summary coverage  82.2%  missing on 18` |
| local-guides-citation-velocity | `gap      recommendation_summary coverage  53.4%  missing on 1091` |
| horse-legal-guide-velocity | `gap      recommendation_summary coverage  16.2%  missing on 467  (of 557)` |
| hicks-consulting-canonical | `gap      recommendation_summary coverage     0%  missing on 259` |
| authority-backlink-network | pattern **not in its contract at all** — its validator checks only 10 patterns |

**"A `recommendation_summary` block was retrofitted across content repos" is not true.**
hicks is at **0% — all 259 pages**. horse-legal is at 16.2% (467 pages missing).
local-guides-citation-velocity is at 53.4% (1,091 missing). The retrofit script
`scripts/retrofit_recommendation_summary.js` exists in sprylabs,
local-guides-citation-velocity, WPP-llm, authority-backlink-network and approvalprep, and
is **absent** from p-n-p, dream-wedding-builder, hicks and horse-legal. Live confirmation:
`https://horselegalguide.com/hubs/liability-waivers-insurance/` has no recommendation
summary in the served HTML.

Other patterns are far worse and should not be read as "retrofitted": `prompt_template` is
0% in WPP-llm (3,240 pages), p-n-p (101), dream-wedding-builder (79) and approvalprep (94);
`trust_block` is 0% in WPP-llm (3,240), p-n-p, dream-wedding-builder and horse-legal (557);
`named_sources` is 0% in p-n-p, dream-wedding-builder and horse-legal; `definition_callout`
is 0% in local-guides-citation-velocity (all 2,342 pages).

### 12 · Caching / efficiency — **NOT DONE**

**Edge caching is absent.** Every homepage checked returns `cf-cache-status: DYNAMIC`:

| domain | cache-control | cf-cache-status |
|---|---|---|
| billionairehighperformancecoach.com | `public, max-age=0, must-revalidate` | DYNAMIC |
| approvalprep.com | `public, max-age=0, must-revalidate` | DYNAMIC |
| horselegalguide.com | `public, max-age=0, must-revalidate` | DYNAMIC |
| theindustryguides.com | `public, max-age=300, s-maxage=3600` | DYNAMIC |
| hicksconsulting.org | `public, max-age=0, must-revalidate` | DYNAMIC |
| porchandparty901.com | `public, max-age=0, must-revalidate` | DYNAMIC |

**One repo out of eleven sets asset cache headers**, and it is the only one producing an
edge hit: `local-guides-citation-velocity/_headers` sets `/assets/*` to
`public, max-age=31536000, immutable`, and `theindustryguides.com/assets/site.css` returns
`cf-cache-status: HIT, age: 2256`. Everything else falls back to the zone default
`max-age=14400` and shows `MISS`/`REVALIDATED`.

**hicksconsulting.org is the worst**: CSS and JS come back `public, max-age=60, must-revalidate`.
That value appears **nowhere in the repo** (`grep -rn "max-age=60"` → 0 hits;
`_headers` and `dist/_headers` set no `Cache-Control` at all). It is a dashboard-side
Cloudflare Cache Rule with no source-controlled record.

**The "caches were pruned" claim is false.** This was one of the three false entries on
the last board, and it is still false:

| repo | cache dir | size | gitignored | tracked files |
|---|---|---|---|---|
| **sprylabs-hpc-site** | `.validation-cache` | **381M** (97,003 files) | yes | 0 |
| **dream-wedding-builder** | `.next/cache` | **153M** | yes | 0 |
| **authority-backlink-network** | `.validation-cache` | **14M** (3,130 files) | yes | 0 |
| local-guides-citation-velocity | `.build` | 7.3M | yes | 0 |
| **horse-legal-guide-velocity** | `.build` | **3.4M** | **NO** | **542 files COMMITTED** |
| WPP-llm | `.build` | 2.3M | — | 0 |
| approvalprep | `.wrangler` | 708K | yes | 0 |

`sprylabs-hpc-site/.validation-cache` is 381M across 97,003 files, and its newest entry
(`v1/page-index.json`) was written days ago — actively growing, definitively not pruned.
`horse-legal-guide-velocity/.build` is the **only cache directory committed to git** (542
tracked files); `.build` is missing from that repo's `.gitignore` though it is present in
the other four repos that have one.

### 13 · Hosting hygiene (no fallbacks, no source exposure) — **PARTIAL** (18 of 19 clean)

`curl -sI` on the homepage, a nonexistent path, `/package.json`, `/README.md` and
`/AGENTS.md` for all 19 live domains, plus `/.git/config`, `/.env`, `/wrangler.toml`,
`/node_modules/` and `/.github/workflows/validate.yml` on eight of them. **No source file
is exposed anywhere — every probe returned 404.**

**The previous board was wrong here, in the alarming direction.** It listed
virtualagency-os.com, porchandparty901.com and partyandporch.com as `source_exposed: YES`.
They are not. Those three return `301` on `/package.json`, and following the redirect
(`curl -L`) lands on `/_not-found` with **HTTP 404**. The old check recorded the 301 and
stopped. A stale comment in `horse-legal-guide-velocity/_headers` making the same claim
about `horselegalguide.com/README.md` is also now false — it returns 404.

**The one real violation is aplayermode.com.** It has no 404 behaviour at all — every path
301-redirects to a page that returns 200:

```
https://aplayermode.com/                      -> 301 -> https://billionairehighperformancecoach.com/download  200
https://aplayermode.com/__no_such_path_zz9__  -> 301 -> https://billionairehighperformancecoach.com/download  200
https://aplayermode.com/README.md             -> 301 -> https://billionairehighperformancecoach.com/download  200
```

That is a blanket catch-all fallback: a crawler asking for any nonexistent URL is told the
page exists. It is a soft-404 generator across the whole domain. The other 18 domains
return 200 on `/` and a genuine 404 on a nonexistent path.

### 14 · Repo / disk size — **NOT DONE** (measured; nothing has been reduced)

`du -sh` per repo, `du -sc` for the total:

| repo | size |
|---|---|
| dream-wedding-builder | 934M |
| sprylabs-hpc-site | 838M |
| local-guides-citation-velocity | 621M |
| approvalprep | 390M |
| WPP-llm | 274M |
| horse-legal-guide-velocity | 123M |
| p-n-p | 66M |
| hicks-consulting-canonical | 58M |
| authority-backlink-network | 43M |
| local-guides-generator | 41M |
| join-west-peek-main | 29M |

**Real total: `7020360` KB = 6.7 GB** across the 11 tracked repos. For context, all of
`~/GitHub` — 29 directories, not 11 — is **9.0 G**. A disk figure quoted for "the
portfolio" must say which of these two numbers it means; conflating them is roughly how a
6x error happens.

Composition: `node_modules` across the 11 totals **2230784 KB (2.13 GB)**; `.git` totals
**1403608 KB (1.34 GB)** — together 3.47 GB, over half. Worst cases:
`dream-wedding-builder/node_modules` 706M, `approvalprep/node_modules` 347M,
`local-guides-citation-velocity/.git` 241M, `sprylabs-hpc-site/.git` 136M,
`WPP-llm/.git` 117M, `horse-legal-guide-velocity/.git` 78M. sprylabs also carries **85M of
`reports/`** and **96M of `data/`** in the working tree, and 381M of `.validation-cache`
(goal 12).

### 15 · Microsoft Clarity on every live domain — **PARTIAL** (present on 19/19, blocked on at least 2)

Every one of the 19 domains carries Clarity. **The previous board's "No Clarity tag" list
was wrong** — it named aplayermode.com, hormonesivhair.com, uscisexam.com,
theaccidentguides.com, neuroevalguides.com and dentistryguides.com, all six of which do
have it, via a same-origin loader the old check did not follow.

Six domains load `/assets/clarity-loader.js` (HTTP 200, `application/javascript`), which
maps hostname → project id:

```
{"theaccidentguides.com":"y7l0ezo9ll","dentistryguides.com":"y7la6o60w8",
 "hormonesivhair.com":"y7lbnfl7e4","neuroevalguides.com":"y7leg12n54",
 "uscisexam.com":"y7l12fhi6v"}
```

theindustryguides.com serves its own (`y7ktdoryc2`). The rest carry the map inline:
billionairehighperformancecoach.com `y7knv03yfx`, spryexecutiveos.com `y7kuhznig9`,
aplayermode.com (inherits the Spry map), virtualagency-os.com `y7l1m6cxec`,
porchandparty901.com / partyandporch.com `y7l3djg8o6`, approvalprep.com `y7kwsu0jg8`,
horselegalguide.com `y7l45bndb4`, founderoperatorlibrary.com `y7l4zlnpql`,
memphisvendorlibrary.com `y7l5cj8s28`, professionalresourcelibrary.com `y7l5omyh1t`.
hicksconsulting.org and westpeekproductions.com use an inline single-id form.

**But two CSPs interfere, and both are proven to degrade or break collection.**

`hicksconsulting.org` sends
`script-src 'self' 'unsafe-inline' https://www.googletagmanager.com` and
`connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com`
— **`clarity.ms` appears in neither.** The browser will refuse both to load
`https://www.clarity.ms/tag/<id>` and to beacon back. **The tag is present and not
collecting on that domain.**

`theindustryguides.com` sends `img-src 'self' data: https://*.clarity.ms`, which admits
Clarity's own script but not its Bing sync pixel on `c.bing.com`. The repo's own CI proves
it — local-guides-citation-velocity / Postdeploy Public Audit, `PUBLIC CLICK AUDIT FAIL: 36/36`,
every page reporting:

```
Loading the image 'https://c.bing.com/c.gif?ctsa=mr&CtsSyncId=...&RedC=c.clarity.ms&MXFR=...'
violates the following Content Security Policy directive: "img-src 'self' data: https://*.clarity.ms".
The action has been blocked.
```

The remaining 17 domains send no CSP header, so nothing blocks the chain there.

### 16 · Wikidata / Wikipedia entity records — **NOT DONE**

**`wikidata.org` string count across all 11 repos: 0.** No brand has a Q-ID.

The `wikipedia.org` hits (126 in sprylabs, 2 in local-guides-citation-velocity, 0 elsewhere)
are **not entity records** — they are LLM answer-tracking logs recording what Perplexity
and GPT-4o cited, e.g.
`"cited_sources":"bennettlegal.com, finra.org, law.pepperdine.edu, wikipedia.org, forthepeople.com"`.
The distinct URLs are third-party concept pages (`/Knowledge_distillation`, `/Straw_man`,
`/Testosterone_cypionate`). None is a portfolio entity.

Every `sameAs` in every repo points at social profiles, never Wikidata — WPP-llm 6,551
(`linkedin.com/in/scootertaylor`, `westpeekproductions.com`), horse-legal 560
(`wisecovington.com`), sprylabs 77 (`sequoiataylor.com`), hicks 19 (instagram/facebook/
linkedin), join-west-peek-main 5 (`linkedin.com/company/west-peek-group`, `instagram.com/westpeek`,
`x.com/WestPeek`).

Six Q-IDs appear, all in draft markdown, all generic classes. Each was curled against
`Special:EntityData/<QID>.json` — **all six exist and none is fabricated**: Q4830453
(business), Q60 (New York City), Q30 (United States), Q5 (human), Q131524 (entrepreneur),
Q43229 (organization). These are the *values* a future item would carry
(`instance of (P31) → business`), not an identifier for any portfolio brand.

What exists is **three unsubmitted drafts**, all created 2026-08-24:
`WPP-llm/docs/wikidata-westpeek-draft.md` (113 lines, *"Status: draft for human submission.
Nothing here has been submitted"*, with four rows marked **UNVERIFIED — confirm before
submitting**), `join-west-peek-main/docs/wikidata-entity-draft.md` (94 lines), and
`sprylabs-hpc-site/docs/wikidata-sequoia-taylor-draft.md` (59 lines). The status file
`sprylabs-hpc-site/data/authority/wikidata_wikipedia_readiness.json` reads in full:

```json
{"schema_version":"1.0","generated_at":"2026-06-21",
 "status":"not_submitted_defensibility_review_required",
 "public_claim_allowed":false}
```

**`entity-validation.yml` does not validate Wikidata at all.** It is an inline Python
heredoc asserting local JSON-LD shape only — that each of
`sites/{community,ventures,productions}/index.html` has a `<script type="application/ld+json">`
with `@context == 'https://schema.org'`, a `@graph`, the expected `#organization` `@id`,
that `ventures` lists both `#person` nodes as `member` with `jobTitle == 'General Partner'`,
and that `relatedLink` cross-references resolve. The word "wikidata" appears **zero times**
in that repo outside `docs/`.

The drafts are honest about this and correctly reason that Wikipedia notability is not met.
This goal is currently a documentation deliverable, not an entity deliverable.

### 17 · Repo operator currency — **PARTIAL**

The validator exists in **10 of 11** repos (all byte-identical 160-line files) and passes
everywhere it exists:

| repo | output | exit |
|---|---|---|
| sprylabs-hpc-site | `OPERATOR DOC CURRENCY PASS: 92 path reference(s) checked, all present` | 0 |
| local-guides-citation-velocity | `PASS: 85 path reference(s) checked` | 0 |
| WPP-llm | `PASS: 8 path reference(s) checked` | 0 |
| authority-backlink-network | `PASS: 10 path reference(s) checked` | 0 |
| p-n-p | `PASS: 13 path reference(s) checked` | 0 |
| approvalprep | `PASS: 13 path reference(s) checked` | 0 |
| dream-wedding-builder | **`PASS: 0 path reference(s) checked`** | 0 |
| join-west-peek-main | `PASS: 12 path reference(s) checked` | 0 |
| local-guides-generator | `PASS: 273 path reference(s) checked` | 0 |
| horse-legal-guide-velocity | `PASS: 40 path reference(s) checked` | 0 |
| **hicks-consulting-canonical** | **NO VALIDATOR AT ALL** — zero hits for `operator.doc.currency` | n/a |

**dream-wedding-builder is a vacuous pass** — `docs/runbooks/` holds two files
(`deployment.md`, `local-development.md`) and neither contains a repo path reference.
Exit 0 proves nothing.

**CI wiring is the real gap.** Grepping every workflow YAML in all 11 repos for
`operator-doc-currency` returns **NONE**. Tracing indirect chains: it is genuinely wired in
only **two** repos —

- **sprylabs**: `validate-repo.yml:40` → `release:ci-validate` → `container_prepush.mjs` → `validate:profile container-prepush` → `validate:repo` → `validate:operator-doc-currency`.
- **local-guides-citation-velocity**: registered `"status":"ACTIVE"`, `"severity":"HARD_FAIL"`, profiles `["audit","core","local","release","strict"]` in `_validation_registry.json:5800`. Proof it runs: **37** `artifacts/validation/runtime/*/operator-doc-currency.log` files, newest today (Aug 26 11:14). This is also the check that is currently **failing CI** (goal 6).

In the other 8 repos the string `operator-doc-currency` appears in **exactly one place —
its own definition line in `package.json`**. No script, registry or workflow calls it.

**Doc staleness** (`git log -1 --format=%ad --date=short`) — the validator only checks that
paths mentioned in docs still resolve, so a doc can be factually stale and path-correct:

| repo | AGENTS.md | stalest operator doc |
|---|---|---|
| local-guides-generator | **2026-04-29** (~4 mo) | `docs/runbooks/guides_rendering.md` **2026-02-11 (6.5 mo)** |
| p-n-p | 2026-08-07 | `docs/DISTRIBUTION-RUNBOOK.md` **2026-03-22 (5 mo)** |
| sprylabs-hpc-site | 2026-08-08 | `docs/VA_RUNBOOK.md` **2026-04-28 (4 mo)** |
| WPP-llm | 2026-08-08 | `docs/runbooks/fanout_query_coverage_system.md` 2026-05-22 |
| local-guides-citation-velocity | **2026-06-20** | `docs/runbooks/velocity-release-batch-data-trace-2026-05-16.md` 2026-05-16 |
| hicks-consulting-canonical | 2026-08-08 | `docs/runbooks/social-ingestion-runbook.md` 2026-05-15 |
| horse-legal-guide-velocity | 2026-08-08 | `docs/OPERATOR_QUICKSTART.md` + 3 runbooks, all 2026-06-23 |

### 18 · authority-backlink overhaul + more editorials — **PARTIAL**

**Volume is real.** 569 HTML files in `sites/`, of which **543 are dated articles**:
`professional-resources` 387, `founder-operator` 93, `memphis-local` 89.
`git log --since=60.days --oneline | wc -l` → **126**, against `git rev-list --count HEAD`
→ **132** — the repo is ~2 months old, and most commits are the daily bot triplet
(autopilot / seed+self-heal / post-publish distribution), not human work.

**Placement data is genuine, not placeholder.** `data/link-registry.json` (659,932 bytes,
566 records):

```
status:            543 published | 23 approved_target_not_auto_published
lifecycle_stage:   476 live_verified | 67 published_in_repository | 23 approved_destination
evidence flags:    repository_rendered 543 | deployed 476 | live_verified 476
                   discoverable 476 | indexed 0 | ai_cited 0
```

→ **476 live, 67 pending deploy, 23 planned, 0 failed, 0 indexed, 0 AI-cited**, across 65
distinct targets. `scripts/post_publish_distribution.py:277` records real `http_status`,
`target_link_present` and `anchor_present` per row. Live checks confirm:
`approvalprep.com/loan-prep-letter-kit` 308→200, `founderoperatorlibrary.com` 200,
`professionalresourcelibrary.com` 200, and a source page verifiably renders its recorded
link: `<a href="https://www.aplayermode.com/" rel="sponsored nofollow">A Player Mode`.

**Three things undercut the goal.**

1. **Every one of the 476 is a self-link.** All three source domains and all 19 target domains are owned by the same operator (`data/publications.json`, `reports/link-audit.json`). Zero third-party placements, and every link carries `rel="sponsored nofollow"` — **none passes link equity by design.** `data/distribution/observation-feedback.json` reports `indexnow_status`, `gsc_sitemap_status` and `gsc_inspection_status` all `NOT_CONFIGURED` for all three publications.
2. **The 543 articles are templated, not written.** Word counts min 1004 / median 1150 / max 1341. Only **51 distinct H2 sequences across 543 pages** — 276 on one outline, 180 on a second, 32 on a third (88% on three skeletons). Two arbitrary articles measure 0.504 body similarity with visible slot substitution: *"A good founder communications resource should separate facts from opinions…"* vs *"A good meeting operating rhythms resource should separate facts from opinions…"*. **24 pages are future-dated** (2026-08-27 … 2026-09-02).
3. **One field is dishonest.** `data/backlink-lifecycle-contract.json` correctly forbids the conflation (*"rendered is not deployed"*, *"affiliated backlink is not independent earned media"*, `verified_external_citations_initial_state: 0`). But `data/portfolio-campaign-health.json` sets `"external_outcome_proven": true` on campaigns whose own `"indexed": 0`. The generator at `scripts/portfolio_backlink_engine.py:167` is `'external_outcome_proven': live>0 or indexed>0` — **an internal self-link resolving is enough to claim a proven external outcome.** Also, 26 ledger rows credited to "A Player Mode" actually land on `billionairehighperformancecoach.com` after a 301, which the ledger does not reflect.

Testing: 5 test files exist and **none of the 40 npm scripts runs them** — there is no `npm test`.

### 19 · Cadence rework — **PARTIAL**

`npm run cadence:gate` in each repo. `join-west-peek-main` has no cadence script; the other
10 do. Verbatim:

```
sprylabs-hpc-site               [exit=0] CADENCE GATE CLEAR: 2888 urls; 34 past 91d (1.2%); 48 fresh within 30d; ceiling 325
  WARN library_over_ceiling: 2888 pages against a ceiling of 325 ... 2563 pages cannot be kept current at this capacity.
local-guides-citation-velocity  [exit=0] CADENCE GATE CLEAR: 2325 urls; 4 past 91d (0.2%); 179 fresh within 30d; ceiling 325
  WARN library_over_ceiling ... 2000 pages cannot be kept current at this capacity.
WPP-llm                         [exit=1] CADENCE GATE BLOCKED: 3240 urls; 0 past 91d (0%); 3240 fresh within 30d; ceiling 325
  BLOCK weekly_cap: 50 URLs are new since the last run, cap is 2 per week
  WARN library_over_ceiling ... 2915 pages cannot be kept current at this capacity.
  WARN uniform_lastmod: 3240 of 3240 pages share a lastmod inside 7 days ...
authority-backlink-network      [exit=0] CADENCE GATE CLEAR: 565 urls; 0 past 91d (0%); 565 fresh within 30d; ceiling 325
  WARN library_over_ceiling ... 240 pages cannot be kept current at this capacity.
  WARN uniform_lastmod: 565 of 565 pages share a lastmod inside 7 days ...
p-n-p                           [exit=0] CADENCE GATE CLEAR: 104 urls; 0 past 91d (0%); 104 fresh within 30d; ceiling 104
  WARN uniform_lastmod: 104 of 104 pages share a lastmod inside 7 days ...
approvalprep                    [exit=0] CADENCE GATE CLEAR: 108 urls; 0 past 91d (0%); 108 fresh within 30d; ceiling 104
  WARN library_over_ceiling: 108 pages against a ceiling of 104 ... 4 pages cannot be kept current.
dream-wedding-builder           [exit=0] CADENCE GATE CLEAR: 0 urls; 0 past 91d (0%); 0 fresh within 30d; ceiling 78
local-guides-generator          [exit=0] CADENCE GATE CLEAR: 183 urls; 0 past 91d (0%); 183 fresh within 30d; ceiling 195
  WARN uniform_lastmod: 183 of 183 pages share a lastmod inside 7 days ...
hicks-consulting-canonical      [exit=1] CADENCE GATE BLOCKED: 95 urls; 0 past 91d (0%); 0 fresh within 30d; ceiling 130
  BLOCK weekly_cap: 1 URLs are new since the last run, cap is 0 per week
  WARN no_freshness_signal: 95 sitemap URLs have no lastmod ...
horse-legal-guide-velocity      [exit=0] CADENCE GATE CLEAR: 560 urls; 0 past 91d (0%); 0 fresh within 30d; ceiling 130
  WARN no_freshness_signal: 560 sitemap URLs have no lastmod ...
  WARN library_over_ceiling ... 430 pages cannot be kept current at this capacity.
```

The gate is installed in 10 of 11 repos and is doing real work — it blocks two right now.
Three findings undercut the goal:

**The "sitemap `lastmod` was added where missing" claim is false in two repos.**
hicks (`95 sitemap URLs have no lastmod`) and horse-legal (`560 sitemap URLs have no
lastmod`) still have none. Both suppress it to a reported-only warning behind a client
content-freeze note.

**Where `lastmod` was added, the gate itself calls it fake.** Four repos trip
`uniform_lastmod` — WPP-llm 3240/3240, authority-backlink-network 565/565, p-n-p 104/104,
local-guides-generator 183/183 — in the gate's own words: *"that is a date bump pattern,
not a refresh, and it makes the freshness signal meaningless."*

**dream-wedding-builder's gate measures nothing**: `0 urls`. It reports CLEAR because its
sitemap is empty, not because cadence is healthy.

Capacity is the structural problem the gate surfaces: across sprylabs, LGCV, WPP-llm,
authority-backlink, approvalprep and horse-legal, **8,152 pages sit above the refresh
ceiling** and cannot be kept current at the configured rate.

### 20 · Portfolio verification — **DONE (this file is the artifact)**

**A portfolio artifact existed before, but not a goal board.** `docs/portfolio/` contained
`STATUS.md` (2,703 b, written 2026-08-26 by `scripts/portfolio_status.mjs`) and
`publishing-cadence.md`. `find` across all 11 repos for `GOALS*.md` returned **nothing** —
there was no 20-goal board with evidence anywhere. This file is the first.

The prior `STATUS.md` is demonstrably wrong on four counts, all re-measured above:

- it reported `source_exposed: YES` for three domains that are clean (goal 13);
- it reported "No Clarity tag" for six domains that all have one (goal 15);
- its `workflows_green`/`workflows_red` counts bear no relation to reality — it lists approvalprep as 7 green / 0 red where the true figure is 13 green with 3 never-run, and p-n-p as `0 green / 0 red` where three workflows are green;
- it claims horse-legal-guide-velocity has `598` uncommitted files; `git status --porcelain | wc -l` returns **1** today.

Working trees today: `local-guides-citation-velocity` has **124** uncommitted files; every
other repo has 0–3. All 11 are on `main`.

---

## What is actually still broken — ordered by severity

1. **joinwestpeek.com discards every lead.** The contact forms on community, ventures and productions POST to `/api/lead`; there is no `functions/` directory and no Worker in `join-west-peek-main`. `POST /api/lead` → 405 and `GET` → 404, **byte-identical to a path that does not exist** (`/api/zzz-nonexistent-xyz`). This is silent, it is on the fund's own front door, and nothing in CI detects it.

2. **The self-healing loop runs nowhere.** Code is in 9 of 11 repos; **0 of 11 invoke it from a workflow**, no npm script calls it, no git hook references it. Seven of the nine reports came from one manual run on 2026-08-25, seven with `dry_run: true`; sprylabs and horse-legal have **never produced a report at all**. WPP-llm's `release:self-heal` is a validation chain with no repair step — a name that defeats a grep audit.

3. **CI is not green and a quarter of it has never executed.** 96 workflows: 67 green, **8 failing, 2 stuck queued with 0 jobs, 19 never run**. horse-legal has never run 8 of its 16 — including **Build Repo**, **Manual Publish** and **Sitemap And Indexing**. Two runs have been sitting in `queued` with `jobs: 0` for over an hour (LGCV Deploy Distribution, authority-backlink Release Validation). WPP-llm still has a ghost workflow registered for a file deleted on 2026-06-25.

4. **Clarity is installed everywhere and collecting nothing on hicksconsulting.org.** Its CSP omits `clarity.ms` from both `script-src` and `connect-src`. On theindustryguides.com the Bing sync pixel is CSP-blocked, which is why LGCV's own Postdeploy audit reports `PUBLIC CLICK AUDIT FAIL: 36/36`.

5. **The `recommendation_summary` retrofit did not reach two repos.** hicks is at **0% across all 259 pages**; horse-legal at 16.2% (467 missing); LGCV at 53.4% (1,091 missing). The retrofit script is absent from four repos. In p-n-p, hicks and horse-legal the content-pattern spec exists but **no generator reads it**, so new pages will keep missing it.

6. **Caches are not pruned — 381M of `.validation-cache` in sprylabs alone** (97,003 files, still being written), 153M in dream-wedding-builder's `.next/cache`, 14M in authority-backlink. `horse-legal-guide-velocity/.build` is **committed to git** (542 tracked files) because `.build` is missing from that repo's `.gitignore`.

7. **Edge caching is effectively off.** Every homepage checked is `cf-cache-status: DYNAMIC`. One repo of eleven sets asset cache headers. hicksconsulting.org serves CSS and JS with `max-age=60` from a dashboard rule that appears nowhere in the repo.

8. **No portfolio entity has a Wikidata item.** Zero `wikidata.org` references across all 11 repos. Three unsubmitted drafts exist; `entity-validation.yml` validates local JSON-LD shape and never touches Wikidata.

9. **`OPENROUTER_API_KEY` is set in 7 repos and consumed by no workflow.** `llm_citation_probe.mjs` exists in all 7, `npm run citation:probe` in 6 — but grepping `.github/workflows/` for `llm_citation_probe` returns **nothing in any repo**. Only 2 of 7 have ever produced observations, and sprylabs' single run is entirely `provider_error`: *"This model models/gemini-2.0-flash is no longer available."* p-n-p's one real OpenRouter run returned `cited_domains: []` — zero citations.

10. **`aplayermode.com` has no 404 behaviour.** Every path 301s to a page returning 200 — a soft-404 generator across the whole domain.

11. **authority-backlink's 476 "live" backlinks are all self-links**, every one `rel="sponsored nofollow"`, `indexed: 0`, `ai_cited: 0` — yet `portfolio-campaign-health.json` sets `external_outcome_proven: true`, because the generator treats `live>0` as proof. The 543 articles run on three H2 skeletons (88% of pages) and 24 are future-dated.

12. **Operator-currency checks are decorative in 8 of 11 repos** — the script exists but nothing calls it. dream-wedding-builder's passes with `0 path reference(s) checked`. hicks has no such validator at all. `local-guides-generator/docs/runbooks/guides_rendering.md` has been untouched since **2026-02-11** and still passes.

13. **6.7 GB across the 11 repos**, over half of it `node_modules` (2.13 GB) and `.git` (1.34 GB). Nothing has been reduced.

14. **Three repos' query atlases are 100% modelled**, and tiny — p-n-p has 3 queries covering 2 of 36 clusters. sprylabs' atlas claims 69 GSC-measured rows while its own `gsc_truth.json` says `UNAVAILABLE`; its Search Intelligence Cycle fails on a missing `gsc_bhpc.json` that **still does not exist**.

15. **Bing is connected in 1 repo of 11**, and that one returns all-zero metrics.

---

## Explicitly UNVERIFIABLE from this machine

These are stated as unknown rather than inferred:

1. **Whether each Search Console property is still authorised** to the service account. The secrets are not readable here, and `status:"ok"` with all-zero metrics is indistinguishable from an authorised property with no traffic.
2. **Whether the Bing Webmaster property on hicksconsulting.org is authorised** — same reason. Its snapshot returns `status:"ok"` and `{"Clicks":0,"Impressions":0}` throughout.
3. **Which Cloudflare Pages project is bound to which repo and branch**, and the build command and output directory for each. That is account-side state with no source-controlled record in any repo.
4. **Whether `dream-wedding-builder` has ever been deployed.** It is configured as a Worker (`main` + `assets`), which Pages Git integration cannot deploy, and no Actions workflow deploys it.
5. **Whether the Airtable secrets behind `dentistryguides.com/api/request-assistance` are set** in the Pages project. The endpoint returns a correct `400` for a malformed request, but confirming delivery would require submitting a real lead.
6. **Whether the two runs stuck in `queued` with `jobs: 0`** are a GitHub-side runner backlog or a repo-side startup failure. Both are consistent with the observation; `gh` exposes no job to inspect.
