# Portfolio status

Collected 2026-08-26 by `scripts/portfolio_status.mjs`. Every row here was measured
when this file was written. Nothing in it is carried over from a previous report.

Regenerate with `npm run portfolio:status`. If a claim is not in this file, it
has not been verified.

## Live domains

| domain | home | real_404 | source_exposed | clarity |
|---|---|---|---|---|
| billionairehighperformancecoach.com | 200 | yes | no | yes |
| spryexecutiveos.com | 200 | yes | no | yes |
| aplayermode.com | 301 | redirect | no | no |
| virtualagency-os.com | 200 | yes | YES | yes |
| porchandparty901.com | 200 | yes | YES | yes |
| partyandporch.com | 200 | yes | YES | yes |
| approvalprep.com | 200 | yes | no | yes |
| horselegalguide.com | 200 | yes | no | yes |
| hicksconsulting.org | 200 | yes | no | yes |
| founderoperatorlibrary.com | 200 | yes | no | yes |
| memphisvendorlibrary.com | 200 | yes | no | yes |
| professionalresourcelibrary.com | 200 | yes | no | yes |
| westpeekproductions.com | 200 | yes | no | yes |
| theindustryguides.com | 200 | yes | no | yes |
| hormonesivhair.com | 200 | yes | no | no |
| uscisexam.com | 200 | yes | no | no |
| theaccidentguides.com | 200 | yes | no | no |
| neuroevalguides.com | 200 | yes | no | no |
| dentistryguides.com | 200 | yes | no | no |

## Repositories

| repo | in_sync | uncommitted | workflows_green | workflows_red |
|---|---|---|---|---|
| sprylabs-hpc-site | yes | 0 | 2 | 0 |
| local-guides-citation-velocity | yes | 0 | 3 | 0 |
| WPP-llm | yes | 0 | 3 | 0 |
| authority-backlink-network | yes | 3 | 1 | 0 |
| p-n-p | yes | 0 | 0 | 1 |
| approvalprep | yes | 0 | 2 | 0 |
| dream-wedding-builder | yes | 0 | 3 | 0 |
| join-west-peek-main | yes | 1 | 1 | 0 |
| local-guides-generator | yes | 1 | 6 | 0 |
| hicks-consulting-canonical | yes | 0 | 5 | 0 |
| horse-legal-guide-velocity | yes | 603 | 2 | 0 |

## Open findings

- **Source exposed**: `/package.json` returns 200 on virtualagency-os.com, porchandparty901.com, partyandporch.com.
- Every domain returns a real 404 for unknown paths.
- **No Clarity tag**: aplayermode.com, hormonesivhair.com, uscisexam.com, theaccidentguides.com, neuroevalguides.com, dentistryguides.com.
- **Red workflows**: p-n-p (1).

## Not verifiable from here

- Whether a Cloudflare Pages or Workers deployment succeeded. This checks what
  the domain serves, which is a different claim.
- Whether a Search Console or Bing property is still authorised, and whether the
  GitHub secrets backing ingestion are set.
- Whether an edge-cached response matches what the current deployment contains.
  A stale cached object can keep serving a file the build no longer produces.
