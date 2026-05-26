# Repo Validation Matrix — West Peek Community

Status: Current for the Founder Dilution Dashboard navigation update.

| Validator / Test | Command | Category | Severity | Production Risk | What It Proves | What It Does Not Prove | Failure Handling |
|---|---|---|---|---|---|---|---|
| Build all sites | `npm run build` | Build | HARD FAIL | Cloudflare Pages may deploy stale or broken static output | Source pages can build to `dist/` for community, ventures, and productions | Does not prove deployed Cloudflare runtime | Fix source/build script and rerun |
| Community nav source link | `grep -q 'https://dilution.joinwestpeek.com/' sites/community/index.html` | Navigation | HARD FAIL | JoinWestPeek visitors cannot discover the dashboard | Source nav/footer include the dashboard URL | Does not prove live DNS or subdomain deploy | Restore link and rerun build |
| Community nav dist link | `grep -q 'https://dilution.joinwestpeek.com/' dist/community/index.html` | Generated output parity | HARD FAIL | Generated deploy output may miss the new nav link | Built community page contains the dashboard URL | Does not prove browser rendering | Rebuild and inspect source/build script |
| Wrong-domain guard | `! grep -R 'founder-dilution-dashboard.pages.dev' sites/community dist/community` | Domain safety | HARD FAIL | Public nav could route users to raw Cloudflare Pages URL instead of West Peek subdomain | App routes through `dilution.joinwestpeek.com` only | Does not prove DNS active | Replace raw Pages URL with subdomain |
| Mobile nav design sanity | Manual/source CSS inspection | UX | STRONG WARNING | Long nav label could wrap poorly on mobile | Existing mobile nav grid handles extra item reasonably | Does not prove human visual approval on device | Adjust CSS if reviewed layout is poor |
| Cloudflare deployment | Cloudflare build logs / live URL | Deployment | NOT PROVEN LOCALLY | GitHub source can still fail on Cloudflare | N/A until deployed | Local build does not prove Cloudflare runtime | Check Cloudflare after push |
