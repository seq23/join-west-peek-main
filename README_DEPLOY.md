# West Peek — 3 Sites, 1 Repo (Cloudflare Pages)

This repo deploys three static sites from one GitHub repo using **three separate Cloudflare Pages projects**.

## Sites
- **West Peek Ventures** → `westpeek.ventures`
- **West Peek Productions** → `westpeekproductions.com`
- **West Peek Community** → `joinwestpeek.com`

## Cloudflare Pages settings (per project)

### Ventures
- Build command: `node scripts/build.mjs ventures`
- Output directory: `dist/ventures`

### Productions
- Build command: `node scripts/build.mjs productions`
- Output directory: `dist/productions`

### Community
- Build command: `node scripts/build.mjs community`
- Output directory: `dist/community`

## Shared assets
All sites consume shared assets in `shared/assets/`. During build, assets are copied into `dist/<site>/assets/`.

## Forms
Each site includes a real contact form that POSTs to `/api/lead` (`functions/api/lead.js`).

Every submission does two things: it emails `LEAD_TO`, and it adds the person to the `contacts` tab
of the master network sheet through the West Peek Network OS intake door.

### Environment variables, per Pages project

| Name | Kind | Purpose |
|---|---|---|
| `RESEND_API_KEY` | secret | Resend delivery |
| `EMAIL_FROM` | plain var | notification sender |
| `LEAD_TO` | plain var | notification recipient (defaults to scooter@westpeek.ventures) |
| `COMMUNITY_ASSESSMENT_TO` | plain var | recipient for the community viability assessment |
| `WP_NETWORK_OS_INTAKE_URL` | plain var | the Network OS intake door, `https://<network-os>/api/intake/site-form` |
| `WP_NETWORK_OS_INTAKE_SECRET` | **secret** | shared secret the door requires, sent as `x-wp-network-os-intake-secret` |

`WP_NETWORK_OS_*` are vendor-prefixed so they can never collide with a reserved runtime name. The
same secret value is set on all three site projects, on `west-peek-network-os` and on
`west-peek-pitch-lab`, and is held in the West Peek OS vault under the same name.

**Pages environment changes take effect on the NEXT deployment**, so set them before merging a change
that depends on them.

If the intake door is unreachable or unconfigured, the visitor still gets a success response provided
the email was delivered — a sheet outage must never cost somebody their submission. The outcome is
reported as `sheet` in the JSON response and logged with the form and host.

### Checking readiness without a submission

`GET /api/lead` still answers `405`, but the body's `config` block says whether each half is wired,
with no key or secret in it — one curl per site, no test submission needed:

```
curl -s https://westpeek.ventures/api/lead | jq .config
curl -s https://joinwestpeek.com/api/lead | jq .config
curl -s https://westpeekproductions.com/api/lead | jq .config
# => { "email": true, "sheet": true, "door_host": "<network-os hostname>" }
```

`email` reflects `RESEND_API_KEY` + `EMAIL_FROM`; `sheet` reflects `WP_NETWORK_OS_INTAKE_URL` +
`WP_NETWORK_OS_INTAKE_SECRET`. `false` on either means that half is not configured on that Pages
project — set it, then redeploy (env changes need a fresh deployment to take effect).


## Community hero image
- `shared/assets/img/community-hero.jpg` is used on the community homepage hero.


## Canonical domain map

Use one canonical public domain per West Peek property:

- **Community / Hub** → `joinwestpeek.com`
- **Ventures** → `westpeek.ventures`
- **Productions** → `westpeekproductions.com`
- **West Peek Live** → `westpeek.live`

Redirect-only / alias domains:

- `westpeek.co` → `https://joinwestpeek.com/`
- `westpeekventures.com` → `https://westpeek.ventures/`
- `ventures.joinwestpeek.com` → `https://westpeek.ventures/`
- `westpeek-productions.com` → `https://westpeekproductions.com/`
- `productions.joinwestpeek.com` → `https://westpeekproductions.com/`

Do not use the dot-productions variant; that domain is not owned.
