# Publishing cadence

Rewritten 2026-08-26. The previous policy gated publishing on Google Search
Console surfacing. That was the wrong instrument for an AEO goal, and the gate it
produced could not block anything.

## What changed and why

**Google rank and AI citation are largely decoupled.** Reported figures put
around 90% of AI-cited pages outside Google's top 20, and roughly two thirds of
cited sources outside the top 10 for the same query. Answer engines run their own
retrieval rather than reading Google's ranking, and they cite passages rather
than pages.

That matters directly here. Across the two largest libraries this portfolio has
**5,300 published pages producing 1,143 impressions in 90 days, one click, at an
average position of 62 to 73.** Under the old policy that reads as failure and
as a reason to publish more. Under the decoupling it reads as: Search position is
not the scoreboard, and it was never going to be moved by volume at this scale.

**Freshness is the lever that is actually tied to citation.** The consistent
finding across current sources is that pages not updated within roughly 13 weeks
become markedly more likely to lose AI citations, that recently updated content
is cited substantially more often, and that citation visibility decays toward
nothing over about a year without a refresh.

## The arithmetic that sets the ceiling

If a page must be touched every 13 weeks to stay citable, then a library can only
be as large as `substantive refreshes per week x 13`. Current sources put a
well-run content operation at roughly 50 to 100 quality articles a month, which
is about 12 to 25 substantive pieces of work per week.

At 25 per week the maintainable ceiling is **325 pages**. Measured today:

| Repo | Pages | Ceiling | Over by | Past 13 weeks |
|---|---:|---:|---:|---:|
| WPP-llm | 3,190 | 325 | 2,865 | 0% |
| sprylabs-hpc-site | 2,888 | 325 | 2,563 | 1.2% |
| local-guides-citation-velocity | 2,325 | 325 | 2,000 | 0.2% |
| authority-backlink-network | 556 | 325 | 231 | **100%** |
| local-guides-generator | 183 | 195 | — | 0% |
| approvalprep | 108 | 104 | 4 | 0% |
| p-n-p | 104 | 104 | — | 0% |

This is the uncomfortable finding and it is worth stating plainly: **the
libraries are already several times larger than any realistic refresh capacity
can keep citable.** Publishing more pages does not add citation surface, it adds
decay. The tail is not neutral - it ages out and dilutes.

`authority-backlink-network` is the sharpest case. Every one of its 556 pages is
past the 13-week threshold, and it is the surface whose entire purpose is
citation. It is the first thing to fix.

## Cadence

New pages per week, and the refresh capacity each repo's ceiling assumes:

| Repo | New / week | Refresh / week | Note |
|---|---:|---:|---|
| authority-backlink-network | 3 | 25 | One per publication. Clear the refresh backlog before adding. |
| sprylabs-hpc-site | 2 | 25 | Largest library. Maintenance over growth. |
| local-guides-citation-velocity | 2 | 25 | Same. |
| WPP-llm | 2 | 25 | Same. |
| approvalprep | 2 | 8 | Product surface; conversion pages matter more than volume. |
| local-guides-generator | 5 | 15 | Five verticals, one each. |
| p-n-p | 1 | 8 | Local service business; small addressable set. |
| dream-wedding-builder | 1 | 6 | Small catalogue. |
| horse-legal-guide-velocity | 0 | 10 | Client repo, publishing is client-approved only. |
| hicks-consulting-canonical | 0 | 10 | Client repo, frozen until 2026-12-31. |

Roughly 18 new pages a week across the portfolio, against generation that was
previously uncapped.

## The gate

`npm run cadence:gate` in each repo. Blocks on:

1. **weekly cap** - URLs new since the last run above the repo's cap. New means
   absent from the previous run's URL ledger, not merely carrying a recent date;
   a page that changed is not a page that was published.
2. **refresh debt** - more than 20% of pages past the refresh window.
3. **no freshness signal** - sitemap URLs with no lastmod. A crawler cannot tell
   what changed. Reported rather than enforced in the two client repos, whose
   sitemaps build from `dist/` and which are under a freeze.

Reports without blocking on:

- **library over ceiling** - a strategic problem no publish step can fix. It has
  to come down by pruning or by genuinely raising refresh capacity, and a
  permanently red gate teaches people to ignore it.
- **uniform lastmod** - nearly every page sharing one recent date. That is a date
  bump, not a refresh, and it would otherwise be rewarded by rule 2.

Exit code is non-zero when blocked, which the previous gate never was.

## What is still not measured

Nothing here measures AI citation directly. Freshness and volume are proxies
chosen because they are supported by evidence and observable from the repo. The
real scoreboard - whether these pages are cited by ChatGPT, Perplexity, Google AI
Overviews or Claude - has no instrument in this portfolio. Until it does, every
statement about AEO progress is inference.
