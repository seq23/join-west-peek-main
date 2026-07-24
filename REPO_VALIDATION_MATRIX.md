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
| Responsive structure | Browser/device spot check | UX | STRONG WARNING | Desktop/mobile hierarchy renders as intended | Automated source inspection alone |
| Cloudflare deployment | Cloudflare build logs / live URLs | Deployment | NOT PROVEN LOCALLY | Production runtime is healthy | N/A until deployed |

## Local validation expectation

The local updater should perform the repository's normal build/validation/commit/push flow. Any failure should be fixed precisely against that failing layer and redelivered as a full baseline snapshot.
