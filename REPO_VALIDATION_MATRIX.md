# Repo Validation Matrix — West Peek Community

Status: Current for the Agency repositioning + public navigation hierarchy update.

| Validator / Test | Command / Check | Category | Severity | What It Proves | What It Does Not Prove |
|---|---|---|---|---|---|
| Build all sites | `npm run build` | Build | HARD FAIL | Source can generate deployable `dist/` outputs | Live Cloudflare deployment |
| Agency label guard | Search public source/output for obsolete `Event Production` nav labels | Navigation | HARD FAIL | Public cross-property naming is aligned to `Agency` | Browser visual hierarchy |
| Community nav hierarchy | Inspect `sites/community/index.html` and built output | Navigation/UX | HARD FAIL | Primary, secondary, and tertiary nav groups exist in source/output | Human device rendering |
| Operator de-emphasis | Inspect `.nav-utility` styling in built CSS | UX | HARD FAIL | Operator Login is intentionally lower-weight in global public nav | Human visual judgment on every viewport |
| Productions positioning | Inspect `sites/productions/index.html` and built output for Community-as-a-Service/service architecture | Content | HARD FAIL | Approved agency positioning is present | Marketing performance |
| Approved hero asset | Verify `shared/assets/img/productions-community-hero.jpg` ships and resolves in built output | Asset | HARD FAIL | Locked hero visual is packaged | CDN/browser delivery after deploy |
| Entity graph | `.github/workflows/entity-validation.yml` (structured data step) | Schema | HARD FAIL | The three index pages carry distinct, cross-linked Organization nodes | That the other eleven pages carry any schema |
| Built-page Organization coverage | `.github/workflows/entity-validation.yml` (built-pages step) | Schema | HARD FAIL | Every page in `dist/` carries an Organization node | That a search engine has recrawled them |
| Sitemap freshness | Same step: every `<url>` carries a `<lastmod>`, and `robots.txt` names the sitemap | Indexing | HARD FAIL | Crawlers get a freshness signal derived from real git history | That the dates match a human's idea of "substantive change" |
| Lastmod ledger currency | `npm run lastmod:check` | Indexing | HARD FAIL | `shared/lastmod.json` matches git history for every source page | Anything about pages with no commit yet |
| Form transmission | `npm run validate:forms` (`scripts/validate_forms.mjs`), also a step in `.github/workflows/entity-validation.yml` and part of `npm run validate` | Conversion | HARD FAIL | Every form in `sites/` and `dist/` has a transmitting path or a written reason it has none; every data-bearing control has a `name`; no `onsubmit="return false"`; no `<input type="file">` without a declared transport; honeypot names match `functions/api/lead.js` and are genuinely hidden, labelless and unfocusable; no inline script announces success without a network call | That `/api/lead` delivers. Delivery needs live Resend credentials and a POST, and a POST to production creates a real record |
| Confirmed-response success guard | Same run — rule FORM-7 loads `shared/assets/js/forms.js` and drives a real submit against six stubbed responses | Conversion | HARD FAIL | Success copy is reachable only from an HTTP-ok response carrying `{"ok":true}`; a 200-with-error, 502, 503, unparseable body or network error each produce a failure message with a fallback address, leave the visitor's input intact, and restore the button | Anything about the real network, or about a page that hand-rolls its own handler instead of using the shared one — FORM-6 is what covers that |
| URL field normalisation | Same run — rule FORM-8, 7 inputs × 2 triggers | Conversion | HARD FAIL | A `type="url"` field accepts a bare domain: the handler prefixes `https://` on blur and on Enter, so native validation cannot refuse a whole submission over a missing scheme | That any particular link resolves |
| Securities disclosure + outbound link rel | `npm run validate:disclosure` (`scripts/validate_disclosure.mjs`), also a step in `.github/workflows/entity-validation.yml` and part of `npm run validate` | Content/Compliance | HARD FAIL | Every `sites/ventures/` and `dist/ventures/` page carries the no-offer securities statement in its own body with the footer stripped out, so a footer link to `/disclosures` cannot pass for a disclosure; every third-party outbound `<a>` in `sites/` and `dist/` carries `rel` containing `noopener` and is not marked `sponsored`, `nofollow` or `ugc` | That the wording is legally sufficient for any given jurisdiction, or that a lawyer has reviewed it. It asserts presence and derivation discipline, not legal adequacy |
| Responsive structure | Browser/device spot check | UX | STRONG WARNING | Desktop/mobile hierarchy renders as intended | Automated source inspection alone |
| Cloudflare deployment | Cloudflare build logs / live URLs | Deployment | NOT PROVEN LOCALLY | Production runtime is healthy | N/A until deployed |

## Local validation expectation

The local updater should perform the repository's normal build/validation/commit/push flow. Any failure should be fixed precisely against that failing layer and redelivered as a full baseline snapshot.

`npm run validate` is the local gate and now runs `npm run build && npm run validate:forms && npm run validate:disclosure`. The forms check has to run after the build, because it reads `dist/` as well as `sites/`.

## Registration rule

A validator that is written but not wired into a gate never runs, and a gate that never runs is indistinguishable from no validator at all. Every entry in this matrix names the command **and** the place that invokes it. Adding a new validator means three edits, not one: the script, the `npm run` entry that the gate calls, and a row here.
