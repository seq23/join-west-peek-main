# Artifact Manifest — West Peek Community Nav Update

Artifact scope: full baseline snapshot for `west-peek-community`.

## Change

- Added `Founder Dilution Dashboard` to the `joinwestpeek.com` main navigation.
- Added the same cross-property link to the West Peek network footer.
- Destination: `https://dilution.joinwestpeek.com/`.

## Validation

- `npm run build` passed.
- Source community page contains the dashboard subdomain link.
- Generated community output contains the dashboard subdomain link.
- Raw Cloudflare Pages URL is not used in community source or generated output.
- Hostile review documented in `docs/HOSTILE_NAV_REVIEW.md` and repeated after user-requested hostile double-check.

## Known Unproven Layers

- Cloudflare deployment not proven in this artifact pass.
- Live DNS/subdomain activation not proven in this artifact pass.
- Live mobile human review not proven in this artifact pass.

## User-Requested Hostile Double-Check

- Reopened the prior baseline ZIP.
- Re-ran `npm run build`.
- Rechecked source nav link, generated community output link, and wrong-domain guard against shipped page output.
- Strengthened hostile review documentation.
- No source nav fix was required after the second hostile pass.
