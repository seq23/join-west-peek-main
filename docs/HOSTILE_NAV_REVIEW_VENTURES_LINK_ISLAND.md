# Hostile Nav Review — West Peek Ventures Link Island

Follows the structure established by `docs/HOSTILE_NAV_REVIEW.md`.

## Scope

Make every page of `westpeek.ventures` reachable from every other page of
`westpeek.ventures`, and in particular give `companies.html` and
`disclosures/index.html` inbound links, which they did not have anywhere in the
repository.

## Loop 1 Findings

- `sites/ventures/index.html` linked to **none** of its own subpages. Its nav
  pointed only at same-page anchors (`#believe`, `#team`, `#community`,
  `#apply`) and at other domains. Zero relative hrefs, zero `.html` links. The
  most-linked page on the site was a dead end for the other six.
- `sites/ventures/companies.html` had **zero inbound links** anywhere in the
  repo. It was present in the generated sitemap and nowhere else. A sitemap
  entry is not a link: no reader could reach the page, and it carries the only
  named portfolio proof the site publishes.
- `sites/ventures/disclosures/index.html` was **also fully orphaned**, with no
  inbound link from any page. It is a compliance surface, which makes an
  unreachable copy of it worse than a merely unhelpful one.
- The site runs **two incompatible nav systems**: `sites/ventures/index.html` is
  a self-contained one-pager with its own inline `<style>` block and
  `.nav-links` / `.nav-cta` classes, while the five subpages share a
  byte-identical `.navlinks` header sourced from `shared/assets/base.css`.
  `sites/ventures/disclosures/index.html` is a third variant again.
- Nav is **hand-duplicated per file**. `scripts/build.mjs` is a straight
  `copyRecursive` tree copy that post-processes only the 404 page, a Clarity
  tag, the JSON-LD Organization graph and the sitemap. It never touches nav, so
  a nav change is an edit to every affected file.

## Fixes Applied

- Added `Companies` to the shared subpage nav in `sites/ventures/thesis.html`,
  `sites/ventures/team.html`, `sites/ventures/companies.html`,
  `sites/ventures/what-we-look-for.html` and `sites/ventures/pitch.html`. The
  five nav blocks were byte-identical before the change and remain so after it.
- Added a second footer row to all six pages listing every page on the site —
  Ventures Home, Thesis, What we look for, Companies, Team, Pitch, Disclosures —
  so orphan status cannot recur silently for any of them.
- Rewrote the nav in `sites/ventures/index.html` to carry real page links
  (`thesis.html`, `what-we-look-for.html`, `companies.html`, `team.html`)
  alongside the retained `#believe` and `#community` anchors, and gave it the
  same all-pages footer row.
- Corrected `sites/ventures/team.html`, which declared
  `https://westpeek.ventures/` as its canonical and carried the homepage
  `<title>`. Because `injectOrganization()` in `scripts/build.mjs` derives the
  `WebPage` `@id` from the canonical, the built page was asserting to answer
  engines that it *was* the homepage, while the sitemap listed it at `/team`.
- Rebuilt all three sites so `dist/` matches source.

## Loop 2 Findings

- Link forms match what Cloudflare Pages actually serves. `publicUrl()` in
  `scripts/build.mjs` emits flat pages extensionless (`/thesis`) and a nested
  index with a trailing slash (`/disclosures/`). The subpage navs use relative
  `.html` hrefs, which Pages serves directly; the disclosures link uses the
  trailing-slash directory form. Neither ships a 308.
- The Operator Login nav entry was **not** reintroduced. `origin/work/fix-founder-capture`
  still contains `operator.html` and its nav link, but that branch is an
  ancestor of `main` and `main` deleted both in the operator-password-gate
  removal. Source of truth was taken from `main`, not from the stale branch.
- No new form was introduced on any ventures page, so the FORM-1..8 rules in
  `scripts/validate_forms.mjs` are unaffected by this change.

## User-Requested Double-Check / Hostile Loop 3

### Attack Questions

Reusing the attack questions from `docs/HOSTILE_NAV_REVIEW.md`, plus the ones
specific to an orphan-page fix:

- Did the links land on the actual `westpeek.ventures` source surface, and not
  on the community or productions site?
- Did the generated deployment output contain the same links after rebuilding?
- Did any link accidentally point at a raw Cloudflare Pages URL?
- Did the extra nav items break mobile behaviour enough to require a new
  component or menu pattern?
- Did the change depend on a source-only edit without generated output parity?
- Did editing the shared subpage nav leave the five copies divergent?
- Did the body-prose links to `team.html` get rewritten by mistake when the nav
  link was edited?
- Is `companies.html` now genuinely reachable by a reader, not merely present in
  the sitemap?

### Findings

- Source grep confirms all six ventures pages carry links to `companies.html`
  and to `disclosures/`.
- Generated grep against `dist/ventures/` confirms parity after `npm run build`.
- No raw `*.pages.dev` URL appears in any ventures source or output file.
- The nav edit was scoped to the text between `<nav class="navlinks">` and its
  closing tag, so the in-body `team.html` and `pitch.html` CTAs in
  `sites/ventures/team.html` and `sites/ventures/thesis.html` were left intact.
- The five subpage nav blocks remain byte-identical to each other.
- `.navlinks` in `shared/assets/base.css` already wraps and collapses to a
  pill grid under 860px and a single column under 420px, so one added item
  needs no new pattern.

### Fixes Applied

None required beyond Loop 1; the Loop 3 checks passed as run.

## User-Requested Double-Check / Hostile Loop 4

### Re-run Checks

- `npm run validate` passes (`npm run build && npm run validate:forms`).
- `npm run lastmod:check` passes against a regenerated `shared/lastmod.json`.
  The ledger had two stale entries, one per site, for the operator login pages
  that were deleted along with the hardcoded password gate. Their paths are
  deliberately not written out here: this doc is scanned by
  `scripts/validate_operator_doc_currency.mjs`, which fails on any repo path a
  doc names that no longer exists — which is exactly the check working.
- Source grep passes for all six files under `sites/ventures/`.
- Generated grep passes for the matching files under `dist/ventures/`.
- Wrong-domain grep passes: no raw Pages URL found.

### Remaining Known Risks

- The two nav systems on this site are still two nav systems. This change makes
  both of them complete; it does not unify them. Unifying `sites/ventures/index.html`
  onto `shared/assets/base.css` would also require fixing its footer, which uses
  `class="nav-live"` where every other page uses `class="live-link"` with a
  nested `.live-mark`.
- There is still **no wired orphan/internal-link validator** in this repo.
  Nothing would have caught this defect, and nothing would catch it recurring.
  Adding one is a three-edit change under the Registration rule in
  `REPO_VALIDATION_MATRIX.md`: the script, the `npm run` entry, and a matrix row.
- Cloudflare deployment and live DNS remain external proof layers and are not
  proven inside this local pass.
- Live human visual review on `westpeek.ventures` remains postdeploy.

### Exit Condition

No known fixable local/source/build/nav issues remain for this change. Every
page on `westpeek.ventures` is now reachable from every other page on it.

## Remaining Known Risks

Recorded above under Loop 4.

## Exit Condition

Hostile loop completed. The link island is closed.
