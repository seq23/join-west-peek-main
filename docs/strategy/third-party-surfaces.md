# Third-party surfaces: Reddit, LinkedIn, Medium, YouTube

**Status:** decision document. Written 2026-08-26.
**Question it answers:** the owned network cannot manufacture third-party
endorsement, because there is no third party in it
(`authority-backlink-network/docs/strategy/where-citations-come-from.md`). So
where does the third party come from, what does it cost, and what gets us
thrown off the platform?

**The decision, up front:** LinkedIn first, YouTube second, Reddit third and
deliberately small, Medium not at all. The ordering is driven less by which
surface AI engines *like* and more by which surface AI crawlers can actually
*read* — a mechanical constraint that turns out to eliminate one of the four
outright and to explain most of the citation-share data below.

---

## 0. Evidence discipline

The previous version of the network strategy doc had to be rewritten because it
quoted precise correlation coefficients with no source and derived an invalid
conclusion from them. To avoid repeating that, every claim in this document is
tagged:

| Tag | Meaning |
|---|---|
| **[MEASURED-HERE]** | Counted from this portfolio's own repos or files. Reproducible locally. |
| **[PRIMARY]** | Fetched by me from the platform itself (robots.txt, official policy page) on the date shown. |
| **[VENDOR]** | Published by an SEO/AI-visibility vendor with a stated methodology. Directionally useful, commercially motivated, and — as shown in §1.4 — vendors disagree with each other by more than 4x. |
| **[UNVERIFIED]** | Circulating claim with no traceable methodology. Recorded so the reasoning is legible. Not a basis for spend. |

If a number below has no tag, that is a defect — flag it.

---

## 1. What we know

### 1.1 What is measured about *this* portfolio [MEASURED-HERE]

| Measure | Value | Source |
|---|---|---|
| Published pages, three largest repos | ~9,700 | portfolio count |
| Impressions / clicks, 90 days | 1,143 / 1 | GSC, window 2026-05-25 → 2026-08-23 |
| Average Google position | 62–73 | GSC, same window |
| External links in the owned backlink network | 562 | `authority-backlink-network/sites/` |
| Of those, `rel="sponsored nofollow"` | 562 of 562 (100%) | ibid. |
| Of those, pointing at a domain we own | 562 of 562 (100%) | ibid. |
| Citation probe observations recorded, 2026-08-26 | 24 | `data/signals/llm_citation_observations.json` in `p-n-p` (9) and `sprylabs-hpc-site` (15) |
| Of those, naming an owned domain | 0 | ibid. |

### 1.2 An important correction to how the probe result is being described

The "zero AI citations" result is real but is being over-read, and the script
itself says so. `scripts/llm_citation_probe.mjs` ran in its default **`knowledge`
mode**, which asks three small models — `ibm-granite/granite-4.0-h-micro`,
`inclusionai/ling-3.0-flash`, `mistralai/mistral-nemo` — a question **with no
retrieval at all** and checks whether the brand name appears in the answer. The
script's own summary field reads:

> `knowledge: counted when the model named us unprompted, with no retrieval. Weaker than a citation and must not be reported as one.`

So what was actually measured is: *three small open-weight models do not have
these domains memorised in their parameters.* That is unsurprising and would
also be true of most profitable small businesses. It is **not** a measurement of
whether an answer engine cites us, because nothing retrieved anything.

Scope is also narrower than "the portfolio": 24 observations, 8 queries, 2 of
the 7 repos that carry a probe config. One of the 24 was a provider error.

**This does not change the strategic conclusion.** More owned pages producing 1
click per 9,700 pages is still not the lever. But it does change the *baseline*:
we do not currently have a citation measurement, we have a memorisation
measurement. Fixing that is week-1 work — see §7.

### 1.3 The mechanical constraint nobody costed: can the crawler read it? [PRIMARY]

Fetched directly from each platform on **2026-08-26**. This is the single most
decision-relevant table in the document.

| Platform | `User-agent: *` | Googlebot | OAI-SearchBot (ChatGPT retrieval) | GPTBot (OpenAI training) | Claude-SearchBot | ClaudeBot | PerplexityBot |
|---|---|---|---|---|---|---|---|
| **YouTube** | **Allowed** (only `/api/`, `/results`, `/comment` etc. disallowed) | allowed | allowed | allowed | allowed | allowed | allowed |
| **LinkedIn** | `Disallow: /` | **allowed**, path-limited | **allowed**, path-limited | `Disallow: /` | **allowed**, path-limited | `Disallow: /` | `Disallow: /` |
| **Medium** | allowed (article paths) | allowed | allowed | **`Disallow: /`** | allowed | **`Disallow: /`** | allowed |
| **Reddit** | **`Disallow: /`** | blocked | blocked | blocked | blocked | blocked | blocked |

Sources, all fetched 2026-08-26:
[youtube.com/robots.txt](https://www.youtube.com/robots.txt) ·
[linkedin.com/robots.txt](https://www.linkedin.com/robots.txt) ·
[medium.com/robots.txt](https://medium.com/robots.txt) ·
[reddit.com/robots.txt](https://www.reddit.com/robots.txt)

Three things follow, and they are the spine of this plan:

**a) LinkedIn is open to ChatGPT and Google and closed to Perplexity — and the
citation data matches exactly.** LinkedIn's robots.txt is default-deny
(`User-agent: * → Disallow: /`) with a named allowlist. `OAI-SearchBot`,
`Claude-SearchBot`, `Googlebot`, `Bingbot` and `Applebot` get path-limited
access. `GPTBot`, `ClaudeBot`, `anthropic-ai`, `ChatGPT-User`, `PerplexityBot`,
`Perplexity-User`, `Google-Extended`, `CCBot`, `cohere-ai`, `DuckAssistBot` and
`Bytespider` all get `Disallow: /`. Independently, Semrush measured LinkedIn
cited in **14.3% of ChatGPT Search responses, 13.5% of Google AI Mode responses,
and 5.3% of Perplexity responses** [VENDOR]
([Semrush, 2026-03-10](https://www.semrush.com/blog/linkedin-ai-visibility-study/),
325k prompts, 89k LinkedIn URLs, Jan–Feb 2026). The engine that is blocked at
the robots layer is the engine that cites LinkedIn least, by roughly 3x. That is
a mechanism, not a coincidence, and it means **crawler access is a leading
indicator you can check for free before spending a quarter on a surface.**

Two caveats that keep this honest. First, "blocked" is not "absent": Perplexity
is blanket-blocked at both agents yet is still measured citing LinkedIn 5.3% of
the time. Cloudflare has documented Perplexity "ignoring — or sometimes failing
to even fetch — robots.txt files" and using undeclared crawlers with generic
Chrome user-agents across rotating IPs, and de-listed it as a verified bot
([Cloudflare, 2025-08-04](https://blog.cloudflare.com/perplexity-is-using-stealth-undeclared-crawlers-to-evade-website-no-crawl-directives/)).
Second, LinkedIn does not appear to enforce by user-agent at the server layer —
the block is policy, not a wall. Neither caveat changes the direction; both mean
robots.txt predicts *relative* citation rate, not a hard zero.

**Three path rules that are directly actionable** (parsed from the file
2026-08-26, verified per user-agent block):

| Path | Who is blocked | So |
|---|---|---|
| `/pulse/` (Articles) | **nobody** | Articles are readable by every allowed bot. Best format. |
| `/posts/…` | **nobody** | The canonical shareable post URL. Readable by all. |
| `/feed/update/urn:li:activity:…` | **Googlebot and Bingbot** (not OAI-SearchBot, not Claude-SearchBot) | **Always share the `/posts/…` form. The `/feed/update/…` form is invisible to Google, and therefore to AI Overviews and AI Mode.** This is the cheapest win in the whole document. |
| `/public-profile/`, `/people/search/` | **OAI-SearchBot and Claude-SearchBot** (not Googlebot) | LinkedIn deliberately withholds bulk people-discovery from AI search bots. Don't build on profile URLs. |

There is no `Sitemap:` directive anywhere in LinkedIn's robots.txt.

**b) Medium blocks the two crawlers that matter most to us for training, and
that is enough to disqualify it.** Medium names eight agents and gives them
`Disallow: /`: `Amazonbot`, `Applebot-Extended`, `Bytespider`, **`ClaudeBot`**,
`FacebookBot`, `GoogleOther`, **`GPTBot`**, `meta-externalagent`. It does not
name `OAI-SearchBot`, `Claude-SearchBot` or `PerplexityBot`, so those fall under
`*` and can read article paths. Net: Medium content can be *retrieved* live but
cannot be *learned*. Combined with §5, Medium is out.

**b2) YouTube is open — but its transcripts are not, and that explains the
strangest number in this document.** YouTube's robots.txt names no AI crawler at
all; everything falls under one `User-agent: *`. But that block contains
`Disallow: /api/`, `Disallow: /timedtext_video` and `Disallow: /results`
[PRIMARY]. A video's transcript is served from `/api/timedtext`. So a
robots-compliant crawler can read a video's **title, description and chapter
timestamps** — and **not its spoken content**. It also cannot walk YouTube
search.

That is the cleanest available explanation for why YouTube is a rounding error
on ChatGPT (0.2% per BrightEdge, 4.4% of YouTube citations per Otterly) while
being the single most-cited domain on Google's own AI surfaces, where Google has
the transcript regardless of robots.txt. It is inference, not a statement from
any engine — no primary source exists on how OpenAI or Anthropic handle YouTube
transcripts. But it is mechanically consistent, and it drives a concrete
instruction: **the description and the chapters are the parts of your video an
AI crawler is actually permitted to read. Write them like they are the content,
because for several engines they are.**

**c) Reddit is `Disallow: /` to everyone.** Reddit's robots.txt blocks all
automated access and points at its
[Public Content Policy](https://support.reddithelp.com/hc/en-us/articles/26410290525844-Public-Content-Policy)
for terms. Reddit content reaches an answer engine **only** through a commercial
licence or a data supplier — not through open crawling. I hit this myself while
researching: my own web-search tool refused `reddit.com` as an allowed domain
("The following domains are not accessible to our user agent: ['reddit.com']"),
which is the same wall from the other side.

That is why Reddit's citation share is so violent: we are not watching an
algorithm, we are watching a supply contract. See §1.4.

### 1.4 Vendor numbers disagree, badly. Use them for direction only.

| Claim | Figure | Source | Note |
|---|---|---|---|
| Reddit share of ChatGPT responses, early Aug 2025 | ~60% | Semrush, 230k prompts, Jul 14–Oct 12 2025, [2025-11-10](https://www.semrush.com/blog/most-cited-domains-ai/) | [VENDOR] |
| Reddit share of ChatGPT responses, mid-Sept 2025 | ~10% | ibid. | [VENDOR] — a ~50-point collapse in six weeks |
| Reddit share of ChatGPT citations, Jul 18–Aug 7 2026 | 3.83% | Promptwatch, via [SEJ 2026-08-19](https://www.searchenginejournal.com/why-reddits-chatgpt-citation-drop-isnt-fully-explained/586479/) | [VENDOR] — note this is *share of citations*, a different metric from *% of responses* |
| Reddit share of ChatGPT citations, Aug 14–17 2026 | 0.52% | ibid. | [VENDOR] — an 86.4% relative drop, **nine days before this document** |
| YouTube share of *all* AI citations | ~1.8% (31.8% of social, social = 5.54% of all) | [Otterly, 2026-03-02](https://otterly.ai/blog/youtube-ai-citation-study-2026/), 100M citation instances, 30 days, 6 engines | [VENDOR] |
| YouTube share of Google AI Overview citations | 23.3% | [5W Research, 2026](https://www.5wpr.com/research/youtube-ai-citation-share-report-2026/) | [VENDOR] — an order of magnitude apart from the line above; methodology not obtained |
| LinkedIn cited in AI responses, avg across 3 engines | 11% | [Semrush 2026-03-10](https://www.semrush.com/blog/linkedin-ai-visibility-study/) | [VENDOR] |

Search Engine Journal's own reporting on the Reddit drop notes the measurement
tools "vary by a factor of four or more for the same platform over the same
period," and that Promptwatch called its own figure "provisional" and could not
rule out a data-collection fault on its own end
([SEJ, 2026-08-19](https://www.searchenginejournal.com/why-reddits-chatgpt-citation-drop-isnt-fully-explained/586479/)).

**Operating rule: never set a target against a vendor citation-share number.**
Use them to rank surfaces; measure your own result with your own probe.

### 1.5 Freshness

The accepted research basis — pages not refreshed within ~13 weeks lose AI
citations sharply, recency correlates strongly with citation, and Google rank
and AI citation are largely decoupled — is carried forward from prior work and
is **not re-derived here**. The specific numbers circulating around it (a "4.5
week median half-life", "76.4% of ChatGPT's most-cited pages updated within 30
days") appear only in SEO-vendor blogs restating a Profound analysis I could not
open the primary of. Treat those specific figures as **[UNVERIFIED]** and do not
quote them externally. The directional point — third-party content also decays,
so a one-off campaign expires — is what the plan below is built on, and that
survives even if the numbers are soft.

### 1.6 Verdict on the four hypotheses left open in `where-citations-come-from.md`

| Hypothesis recorded there | Verdict now |
|---|---|
| Most brand mentions AI surfaces originate on pages the brand doesn't own | Still **[UNVERIFIED]**. No traceable source found. Do not quote it. |
| Reddit, LinkedIn, Wikipedia, Medium and YouTube are disproportionately represented among cited domains | **Partly confirmed, one refuted.** Reddit, LinkedIn and YouTube appear at the top of every vendor ranking found. **Medium does not** — it blocks GPTBot and ClaudeBot outright [PRIMARY] and its only supporting mention was as a post-Sept-2025 "biggest winner" on ChatGPT with no figure attached ([Semrush 2025-11-10](https://www.semrush.com/blog/most-cited-domains-ai/)). Drop Medium from the list. |
| Different engines draw on substantially different domain sets | **Confirmed, with a mechanism, and it is the most useful finding in this document.** LinkedIn is strong on ChatGPT (14.3%) and Google AI Mode (13.5%), weak on Perplexity (5.3%) — and is robots-blocked to Perplexity [PRIMARY]. YouTube is the inverse: #1 on Google's AI surfaces (21–29.5%) and a rounding error on ChatGPT (0.2%) — and its transcripts sit behind a `Disallow: /api/` path [PRIMARY]. **The two surfaces are complements, not alternatives.** Running both is the only way to reach both engine families; running one leaves half the engines untouched. |
| Listicles, comparisons and roundups carry most third-party brand mentions | Still **[UNVERIFIED]** as stated. But a related and better-evidenced shape did turn up: **Q&A format carries >50% of all Reddit citations**, and on LinkedIn 54–64% of cited posts are knowledge-sharing or practical advice rather than promotion [VENDOR]. The transferable finding is *answer shape*, not listicle format. |

---

## 2. LinkedIn — **rated highest. Start here.**

### 2.1 Why it matters for AI citation

Because it is crawlable by the retrieval bot of the engine with the largest
consumer share, and because the bar for being cited is startlingly low.

Semrush's 325k-prompt study ([2026-03-10](https://www.semrush.com/blog/linkedin-ai-visibility-study/)) [VENDOR]:

| Finding | Figure |
|---|---|
| ChatGPT Search responses citing LinkedIn | 14.3% |
| Google AI Mode responses citing LinkedIn | 13.5% |
| Perplexity responses citing LinkedIn | 5.3% |
| Share of cited LinkedIn content that is **Articles** | 50–66% |
| Share that is feed posts | 15–28% |
| **Median reactions on a cited post** | **15–25** |
| Cited authors posting 5+ times in four weeks | ~75% |
| Cited content that is original (not a reshare) | ~95% |
| Optimal article length | 500–2,000 words |
| Cited authors with 2,000+ followers | ~50% (so ~50% have fewer) |

Read the two bolded rows together: **a post with 20 reactions from an account
with under 2,000 followers is inside the observed distribution of cited
content.** LinkedIn's citation mechanic is not virality. It is consistency plus
topical clarity. That is a job a busy owner can actually do.

Semrush's own study adds the finding that matters most to an account starting
from nothing: **creators under 500 followers were cited at essentially the same
rate as large accounts**, and posting frequency beat follower count as a
predictor. Profound separately measured LinkedIn rising to the **5th most-cited
source between November 2025 and February 2026, from outside the top 20** —
reported via
[Social Media Today, 2026-03-10](https://www.socialmediatoday.com/news/linkedin-is-a-leading-source-for-ai-answers/814388/)
[VENDOR].

**The dissenting datapoint, recorded because it is large.** Profound's earlier
analysis (680M citations, Aug 2024 – Jun 2025) put LinkedIn at just **1.3% of
Google AI Overviews citations and 0.8% of Perplexity's**, absent from ChatGPT's
top four
([Profound, 2025-06-05](https://www.tryprofound.com/blog/ai-platform-citation-patterns)).
Semrush's early-2026 figure is roughly 10x that. Some of the gap is real growth
— Profound's own later data shows the climb — and some is that the two vendors
measure different denominators (share of all citations vs. percentage of
responses containing at least one citation). Neither publishes a reproducible
methodology. **Treat "LinkedIn is the #2 AI source" as directional. The
robots.txt evidence in §1.3 is the part that is genuinely verifiable, and it is
what this recommendation actually rests on.**

### 2.2 The rules that get you removed

LinkedIn does not ban people for posting; it bans people for automating.
[LinkedIn User Agreement §8.2](https://www.linkedin.com/legal/user-agreement)
prohibits using bots or automated methods, scraping, and creating false
identities. The
[Professional Community Policies](https://www.linkedin.com/legal/professional-community-policies)
prohibit spam, deceptive behaviour and misrepresenting affiliation.

Concretely, for us:

- **No connection-request or DM automation, ever.** Dux-Soup, Phantombuster,
  Expandi and equivalents are the fastest route to a restricted account. A
  restricted LinkedIn account takes an identity-document appeal to recover.
- **No second persona.** Do not create a separate "Memphis events" personal
  profile. Use Company Pages for brand voice; personal profile stays one person.
- **Disclose the commercial relationship** when writing about a client
  (hicksconsulting.org, horselegalguide.com) — "a client of mine" in the post
  body. This is the same standard as the `rel="sponsored nofollow"` already
  applied on owned properties.
- **The link penalty, resolved as well as it can be.** LinkedIn's official
  position is that links do not intentionally limit reach *provided the post
  stands alone without the link* — Rishi Jobanputra, Sr. Director of Product
  Management, [stated so publicly](https://www.linkedin.com/feed/update/urn:li:activity:7370869955623542785/).
  Two vendor studies disagree with the company: Ordinal (900k+ posts, Feb 2023 –
  Feb 2026) measured a **26.5% reach penalty** on link posts; Richard van der
  Blom's Algorithm Insights 2026 (1.3M posts) measured **18.8% lower median
  reach** [VENDOR]. Both vendors sell tooling that moves links to the first
  comment — direct commercial interest in the penalty being real, and neither
  study page could be fetched directly, so both figures are read from search
  indexes. A third (Saywhat, Q1 2026, ~398k posts) found link posts performing
  *better*. The widely-circulated "60% penalty" figure exceeds every underlying
  study and should not be repeated.

  **Working rule:** somewhere in the 15–30% range, direction consistent,
  magnitude unknowable. Follow LinkedIn's own stated condition — make the post
  complete without the link — which is what you want for citation anyway, since
  **the LinkedIn URL itself is what gets cited, not your link out.**

### 2.3 What to actually publish, mapped to these brands

Personal profile (Sequoia Taylor) is the primary asset. Company Pages are
secondary — but note Perplexity cites Company Pages for 59% of its LinkedIn
citations while ChatGPT and AI Mode cite individual creators 59% of the time
[VENDOR, Semrush], so both have a role.

| Brand | Format | Concrete topic examples |
|---|---|---|
| spryexecutiveos.com / billionairehighperformancecoach.com | **LinkedIn Articles** (1,000–1,500 words), 1 per 2 weeks | "What an AI executive coach can and cannot do for a founder"; "ADHD-adjacent executive routines that survive a bad quarter"; "AI coaching tools compared, honestly" — this last one maps directly onto the T1 GSC query `ai coaching tools` (209 impressions, 0 clicks, avg position 70.3) |
| westpeekproductions.com / virtualagency-os.com | Articles + posts, 2 posts/week | Post-mortems with numbers: "We ran a 400-attendee virtual summit on X budget — here is the run of show"; "Virtual event platform comparison: what actually broke" |
| approvalprep.com | Posts, 1/week | Process explainers: "The five documents that stall a co-op board approval" |
| hicksconsulting.org (**client**) | Articles, **client-approved only** | Workplace mental health — this is genuinely LinkedIn-native subject matter and the single best brand/surface fit in the portfolio. Publish from the client's own profile where possible; ghost-write, do not impersonate. |
| horselegalguide.com (**client**) | Low priority on LinkedIn | Equine legal is not a LinkedIn audience. Send this to YouTube and Reddit instead. |
| porchandparty901.com | Not LinkedIn | Consumer-local. Wrong surface. |

**Client constraint:** neither hicksconsulting.org nor horselegalguide.com
content ships to any third-party surface without written client approval on the
specific text, and both are under existing content and cadence constraints
documented in their repos. Build a two-line approval log per client post. Do not
treat "it's just a LinkedIn post" as outside the approval scope — it is more
public than the site.

### 2.4 Cadence and effort

**Two mechanical steps that cost nothing and are skipped by default:**

1. **Set the SEO title and description on every Article and Newsletter.**
   LinkedIn exposes these explicitly and says they appear "on search engine
   result pages, such as Google search" — SEO title ~60 chars, description
   140–160 ([LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a6244140)).
   Left blank, LinkedIn guesses.
2. **Copy the `/posts/…` link, never the `/feed/update/…` link.** See §1.3.
   Googlebot is blocked from `/feed/update/`, so the second form cannot reach
   AI Overviews or AI Mode at all.

| Activity | Frequency | Hours/week |
|---|---|---|
| 1 Article (500–2,000 words) | every 2 weeks | 1.5 |
| 3 posts (50–299 words) | weekly | 1.0 |
| Comment substantively on 5 others' posts | weekly | 0.5 |
| **Total** | | **~3 hrs/week** |

VA-delegable: scheduling, formatting, sourcing comment targets, the approval log.
**Not** VA-delegable: the actual opinion. Semrush found ~95% of cited LinkedIn
content is original; templated output is exactly what does not get cited.

### 2.5 How to tell if it worked

- **Leading (week 2+):** LinkedIn's own "impressions" and "search appearances"
  are noise here. The real leading indicator is whether the Article URL is
  indexed: `site:linkedin.com/pulse/ "your exact title"` in Google.
- **Real signal (week 6+):** run `llm_citation_probe.mjs` in **`--mode grounded`**
  and add `linkedin.com/in/<handle>` and `linkedin.com/pulse` to a new
  `attributed_surfaces` list alongside `owned_domains`. A grounded run that
  returns a `linkedin.com` URI carrying our name is the first true third-party
  citation observation this portfolio will have.
- **Target for 90 days:** ≥1 grounded observation citing a LinkedIn URL of ours,
  on ≥1 of the 8 priority queries. Not a percentage. One.

### 2.6 What NOT to do

- Do not buy followers or engagement pods. Median cited post has 15–25
  reactions; you are not solving a volume problem.
- Do not reshare owned-domain links as the post body. ~95% of cited LinkedIn
  content is original [VENDOR]; a link-drop is not content.
- Do not post the same text to LinkedIn and the owned site verbatim on the same
  day without deciding which one is canonical.
- Do not run any automation tool against the platform. See §2.2.

---

## 3. YouTube — **rated second. Add at week 4.**

### 3.1 Why it matters for AI citation

Because it is the **only one of the four with an open robots.txt** [PRIMARY], and
because the Otterly data says channel size is irrelevant.

[Otterly, 2026-03-02](https://otterly.ai/blog/youtube-ai-citation-study-2026/) —
100M citation instances, 30 days, six engines [VENDOR]:

| Finding | Figure |
|---|---|
| Correlation of **video views** with citation frequency | r ≈ **-0.03** |
| Correlation of **channel subscribers** with citation | r ≈ **-0.03** |
| Correlation of **likes** with citation | r ≈ -0.02 |
| Correlation of **description length** with citation | r ≈ 0.31 |
| Cited videos with **fewer than 1,000 views** | **40.83%** |
| Cited channels with **under 10,000 subscribers** | **35%** |
| Citations going to **long-form**, not Shorts | 94% |
| Shorts' share | 5.7% |
| Largest length cluster | 10–20 min (32.1%) |
| Cited videos containing timestamps/chapters | 31% |
| Of timestamped videos, cited repeatedly across 2–5 chapters | 78% |

Two of those are the whole argument. **Views, likes and subscribers correlate at
roughly zero with being cited** — near-zero correlations are a claim that a
relationship is *absent*, which is a much safer claim than a claim that one
exists, and it is the finding that makes YouTube viable for a portfolio with no
audience. **Description length is the one metadata signal that moved (r ≈ 0.31,
weak-to-moderate).** Write real descriptions.

### 3.1b Two caveats that should temper the YouTube enthusiasm

**Caveat 1: the vendor spread on YouTube is the worst in this document — a
15x range on the same platform.**

| Source | Surface | YouTube share |
|---|---|---|
| [BrightEdge](https://www.brightedge.com/resources/weekly-ai-search-insights/youtube-presence-ai-search) (May 2024 – Sept 2025) | AI Overviews | **29.5%, #1** |
| [Ahrefs](https://ahrefs.com/blog/most-cited-domains-ai-overviews/) (3M+ US queries, Jul 2026) | AI Overviews | **21.1%, #1** |
| [Profound](https://www.tryprofound.com/blog/ai-platform-citation-patterns) (680M citations, Jun 2025) | AI Overviews | **1.9%** |
| BrightEdge | **ChatGPT** | **0.2%** |
| Otterly (share of YouTube citations by platform) | ChatGPT | 4.4% |

Ahrefs' figure carries a methodology caveat that inflates it and is rarely
quoted alongside it: Ahrefs computes "mention share" as a domain's citations as
a percentage of the **top 50 sources only**, not of all citations.

**Caveat 2: YouTube's headline numbers are Google citing Google.** In the same
Ahrefs table, Google-owned properties take 28.2% of top-50 mention share
(youtube.com 21.1% + google.com 7.1%). The European Commission opened a formal
antitrust probe on 2025-12-09 into Google's use of publisher and
YouTube-uploaded content for AI, explicitly concerned that YouTube content
trains Google's models "whilst rivals are barred from using such content"
([CNBC](https://www.cnbc.com/2025/12/09/google-hit-with-eu-antitrust-probe-over-use-of-online-content-for-ai.html),
[TechCrunch](https://techcrunch.com/2025/12/09/eu-launches-antitrust-probe-into-googles-ai-search-tools/)).
Combined with §1.3(b2), the picture is coherent: **YouTube is a strong surface
for Google's answer engines and a weak one for ChatGPT.** Plan accordingly — and
note this is the mirror image of LinkedIn, which is strong on ChatGPT. The two
together cover more engines than either alone, which is the actual argument for
running both.

Also worth knowing: Google's own Search Central documentation states there are
"no additional requirements to appear in AI Overviews or AI Mode, nor other
special optimizations necessary"
([AI Features and Your Website](https://developers.google.com/search/docs/appearance/ai-features)),
and says nothing about video in AI surfaces at all. Every "optimize YouTube for
AI citations" tactic in circulation is inference, including the ones in this
document. The one documented mechanism is below.

**The one officially documented mechanism.** Google Search Central states that
for YouTube-hosted video "you can specify the exact timestamps and labels in the
video description on YouTube," and that "**we will prioritize key moments set by
you**"
([Video best practices](https://developers.google.com/search/docs/appearance/video)).
That is a first-party statement that chapters in your description change how
Google surfaces the video. It is the only such statement I found across all four
platforms, and it is why chapters are non-negotiable in §3.4.

**What is NOT documented, contrary to widespread claims:** there is **no
source** — from YouTube, Google, or any study — that manually uploaded captions
outperform auto-captions for search, discovery or AI retrieval. YouTube's
caption documentation is framed entirely around accessibility. Correct your
captions because auto-captions garble domain terms and because it is the right
thing to do, not because a blog said it drives citations.

### 3.2 The rules that get you removed

The live risk here is not a ban, it is the **inauthentic content** policy.
YouTube renamed "repetitious content" to "inauthentic content" on
**2025-07-15**, covering "mass-produced or repetitive content, including content
that looks like it's made with a template with little to no variation across
videos, or content that's easily replicable at scale," and explicitly naming
"AI-generated content made with generic templates without the creator's
original, authentic insights"
([YouTube channel monetization policies](https://support.google.com/youtube/answer/1311392),
[YouTube's response to creator questions, July 2025](https://support.google.com/youtube/thread/356734251/response-to-creator-questions-about-ypp-policies-july-2025)).

**This is the single largest platform risk in this plan**, because a portfolio
that generated 9,700 templated pages will be tempted to generate 200 templated
videos. That approach is now named in policy as the thing that gets
demonetised, and — more importantly for us — it is the opposite of what gets
cited.

Two clarifications that reduce the perceived risk, both from YouTube's own
[response to creator questions](https://support.google.com/youtube/thread/356734251/response-to-creator-questions-about-ypp-policies-july-2025):
this content was **always** ineligible for monetisation, so the update is a
clarification and **not an AI ban**; and enforcement is at the **channel level**,
not per video. The separate "reused content" policy is unchanged.

**Monetisation is not the goal and YPP thresholds are irrelevant to citation.**
For the record, the current thresholds are 500 subscribers + 3 valid public
uploads in 90 days + 3,000 qualified watch hours (or 3M Shorts views) for the
lower tier, and 1,000 subscribers + 4,000 watch hours (or 10M Shorts views) for
ad revenue
([YouTube Help](https://support.google.com/youtube/answer/13429240)). Note also
that YPP terms update effective 2027-02-01, requiring acceptance in Studio by
2027-01-31. None of this affects citation. Do not spend a minute on subscriber
counts — 40.83% of cited videos had under 1,000 views [VENDOR].

**AI disclosure, precisely.** Disclosure is required when AI makes a real person
appear to say or do something they did not, alters footage of a real event or
place, or generates a realistic scene that did not occur; it is **not** required
for scripts, titles, descriptions, planning, clearly unrealistic content, beauty
filters, or cloning your own voice for voiceover
([YouTube Help](https://support.google.com/youtube/answer/14328491),
[YouTube blog](https://blog.youtube/news-and-events/disclosing-ai-generated-content/)).
Set it in Studio under Details → Attributes → "AI use". Consistent
non-disclosure can mean a manually applied label, content removal, or YPP
suspension.

### 3.3 What to actually publish, mapped to these brands

Format that fits the evidence: **10–20 minute, single-take, screen-share or
talking-head explainer, with real chapters, and a 150–300 word description.** Not
a produced show. Not Shorts.

| Brand | Channel | Video concepts |
|---|---|---|
| billionairehighperformancecoach.com / spryexecutiveos.com | Existing or new brand channel | "Setting up an AI coaching workflow, start to finish" (screen share, 15 min, chapters per step); "ADHD productivity systems for founders — what I actually run" |
| westpeekproductions.com / virtualagency-os.com | **Highest-fit channel in the portfolio** | Virtual events are a screen-native subject. "Run of show for a 400-person virtual summit"; "Comparing three virtual event platforms live"; "What a producer does in the 30 minutes before a webinar" |
| horselegalguide.com (**client**) | Client channel, **approval required** | Equine legal has almost no good video coverage. "What a horse boarding contract must say"; "Who is liable when a boarded horse is injured" — 12–18 min, chaptered by clause. This is the highest-leverage single video idea in the portfolio: high query specificity, near-zero competition, and no crawler wall. |
| uscisexam.com | Guide-site channel | "The 100 civics questions, explained in ten-question chapters" — chapters map to citation reuse (78% of timestamped videos cited repeatedly across 2–5 chapters) |
| dentistryguides.com / neuroevalguides.com / hormonesivhair.com | **Skip.** YMYL health. Not without a credentialed on-camera presenter. See §6. |
| porchandparty901.com | Low-cost channel | "Balloon garland setup in a real Memphis venue" — 10 min, one take, phone. Also feeds Reddit and the business's own site. |
| approvalprep.com | Optional | Short screen-share walkthroughs of the document kits |

### 3.4 Cadence and effort

Realistic, single-take, no editing beyond top-and-tail:

| Activity | Hours |
|---|---|
| Outline + chapter plan | 0.5 |
| Record 12–18 min single take (allow 2 takes) | 0.75 |
| Trim, upload, **write a real 150–300 word description**, set chapters, upload a corrected caption file | 1.0 |
| **Per video** | **~2.25 hrs** |

**One video per week = ~2.25 hrs/week.** Two per week is achievable once the
format is set. A VA can do trim/upload/chapters/captions (~1.0 hr of that); the
recording cannot be delegated.

**Spend the effort on the description and chapters, not on production value.**
Those are the two things a robots-compliant crawler is actually allowed to read
(§1.3(b2)), and chapters are the one mechanism Google documents first-party
(§3.1b). Correct the auto-captions too — auto-captions garble domain terms like
"equine", "USCIS", "N-400" and "balloon garland", and YouTube itself warns they
"might misrepresent the spoken content"
([YouTube Help](https://support.google.com/youtube/answer/6373554)) — but do it
for accessibility and for on-platform search, **not** because it drives AI
citation. No source supports that claim (§3.1b).

Chapter requirements, officially: first timestamp must be `00:00`, at least
three timestamps in ascending order, each segment at least 10 seconds
([YouTube Help](https://support.google.com/youtube/answer/9884579)).

### 3.5 How to tell if it worked

- **Leading (week 3+):** YouTube Studio → Traffic source → "External" and
  "YouTube search". Also check whether the video appears for its exact title in
  Google video results.
- **Real signal (week 8+):** grounded probe run, watching for `youtube.com` URIs
  in `cited_domains`. Because timestamped citations are Google-only [VENDOR],
  bias the grounded probe toward Gemini-with-search rather than OpenRouter for
  this surface specifically.
- **Target for 90 days:** 12 videos published, ≥1 grounded observation citing a
  youtube.com URL of ours.

### 3.6 What NOT to do

- **Do not mass-produce.** Named in policy since 2025-07-15 as the thing that
  gets you demonetised, and it is not what gets cited.
- Do not make Shorts for citation purposes — 5.7% of citations [VENDOR].
- Do not chase subscribers. r ≈ -0.03 [VENDOR].
- Do not skip chapters or ship a 40-word description. Those are the two
  metadata signals with any observed association at all.
- Do not put a dentist/hormone/neuro claim on camera without a credentialed
  presenter and a reviewed script.

---

## 4. Reddit — **rated third. Do it small, do it as a person, do not build on it.**

### 4.1 Why it matters — and why it is a bad foundation

Reddit is the most-cited domain in nearly every vendor ranking. It is also the
least controllable and, as of nine days before this document, the one in
free-fall.

| Date | Reddit's ChatGPT position | Source |
|---|---|---|
| Early Aug 2025 | cited in ~60% of responses | [Semrush 2025-11-10](https://www.semrush.com/blog/most-cited-domains-ai/) [VENDOR] |
| Mid-Sept 2025 | ~10% of responses | ibid. [VENDOR] |
| Jul 18 – Aug 7 2026 | 3.83% of citations | Promptwatch via [SEJ 2026-08-19](https://www.searchenginejournal.com/why-reddits-chatgpt-citation-drop-isnt-fully-explained/586479/) [VENDOR] |
| Aug 14 – 17 2026 | **0.52% of citations** (−86.4%) | ibid. [VENDOR] |

Nobody can fully explain either collapse. SEJ reports competing explanations
(ChatGPT's Aug 8 shift toward `site:` fanout queries, which jumped from 0.37% to
16.8% of queries; and the earlier removal of Google's `num=100` parameter
breaking third-party data pipelines), a six-day gap the Aug 8 change does not
explain, no comment from OpenAI, and Promptwatch's own admission the figure is
provisional.

The structural reason for the volatility is §1.3(c): **Reddit is
`Disallow: /` to every crawler.** Its presence in an answer engine is a
commercial supply relationship, not an earned position. When the contract or the
pipeline changes, your work evaporates in four days and you get no notice. That
is a categorically different risk from LinkedIn or YouTube, where the content is
openly crawlable and your position degrades gradually.

**But here is the finding that actually settles Reddit's place in the plan, and
it is not the volatility.** Semrush analysed 217,000 prompts producing **248,000
unique cited Reddit URLs** across Google AI Mode, Perplexity and ChatGPT Search
([2025-11-10](https://www.semrush.com/blog/reddit-ai-search-visibility-study/))
[VENDOR]:

| Finding | Figure |
|---|---|
| Cited posts with **fewer than 20 upvotes** | **80%** (median 5–8) |
| Cited posts with fewer than 20 comments | 70% (median 11–19) |
| **Average age of a cited post** | **~900 days (≈2.5 years)** |
| Median cited length | ~80 words |
| Q&A-format threads | **>50% of all citations** |
| Citation rate, ChatGPT Search | 12.6% of responses |
| Citation rate, Google AI Mode | 9% |
| Citation rate, Perplexity | 3.5% |
| Semantic similarity, **response** ↔ post | 0.53–0.54 |
| Semantic similarity, **prompt** ↔ post | **0.04–0.05** |

Read the age row. **The average Reddit post an AI cites is two and a half years
old.** Upvotes are near-irrelevant (80% under 20). What predicts citation is
semantic match to the *answer* (0.53) rather than to the *prompt* (0.05), and
Q&A shape.

That is a genuinely good mechanism — and it is the wrong shape for a 90-day
plan. A comment written today is competing against threads from 2024, and its
own payoff arrives around 2028. Reddit is a **two-year compounding asset with a
four-day downside risk**. Both halves of that sentence argue for the same thing:
start now, keep it small, and do not put it on the critical path.

**Conclusion: participate on Reddit because it is genuinely useful for a local
services business and for niche legal/immigration questions, and because the
asset compounds. Do not build a 90-day citation programme on it.**

### 4.2 The rules that get you removed

This is the surface where the downside is real and asymmetric, and where the
rules changed materially in 2026.

**Correction to a claim commonly made (including in an earlier draft of this
document): the 9:1 rule is NOT deprecated folklore.** It is live, verbatim, on
Reddit's own help centre today. From
[Reddiquette](https://support.reddithelp.com/hc/en-us/articles/205926439-Reddiquette)
(`edited_at` 2025-08-18, retrieved 2026-08-26) [PRIMARY]:

> "Feel free to post links to your own content (within reason). But if that's
> all you ever post, or it always seems to get voted down, take a good hard look
> in the mirror — you just might be a spammer. **A widely used rule of thumb is
> the 9:1 ratio, i.e. only 1 out of every 10 of your submissions should be your
> own content.**"

A stricter mod-facing variant also stands: "Other communities abide by the 10%
rule: only 10% of your posting and comment history in the community can be
self-promotional in nature… It is ultimately up to you and your team to decide
what works best for your community"
([How do I keep spam out of my community](https://support.reddithelp.com/hc/en-us/articles/28012014962580-How-do-I-keep-spam-out-of-my-community),
edited 2026-03-28) [PRIMARY].

The accurate framing is neither "folklore" nor "sitewide rule": **Reddit
publishes the ratio in two live places, both explicitly as informal custom and
per-community discretion.** Reddiquette's own first line calls itself "an
informal expression of the values of many redditors." Treat 9:1 as a floor, not
a ceiling, and expect individual subreddits to be stricter.

*(Note on retrieval: `support.reddithelp.com` returns 403 to automated HTML
fetches, but its Zendesk API — `/api/v2/help_center/en-us/articles/{id}.json` —
serves full article bodies with authoritative `edited_at` timestamps. Every
Reddit help-centre quote in this section was verified through that endpoint on
2026-08-26, not read from a search snippet.)*

**The 2026 changes, all primary-sourced, all tightening:**

- **Reddit's "Content Policy" is now "Reddit Rules"** —
  `redditinc.com/policies/content-policy` 301-redirects to
  [redditinc.com/policies/reddit-rules](https://redditinc.com/policies/reddit-rules)
  [PRIMARY]. Rule 2: "Participate authentically in communities where you have a
  personal interest, and do not spam or engage in disruptive behaviors
  (including content manipulation)." Rule 5 covers impersonation and deception.
- **★ Link-based pre-submission blocking, live in 100% of communities.**
  Reddit's [changelog of 2026-02-04](https://support.reddithelp.com/hc/en-us/articles/45959071783316)
  [PRIMARY] states mods can now write Post and
  Comment Guidance rules that "trigger when a post or comment includes a specific
  domain, URL pattern, or type of link," applying "to the URL field on link posts
  and to links included in the body of text posts **or comments**," and can
  "catch common link-related problems **before a post or comment is submitted**."
  Rolled out to 100% of communities. **This is the single most consequential
  mechanic for anyone planning to link. A mod can silently block your domain
  before you ever hit submit.**
- **Human verification with a seven-day deadline.** If Reddit detects automated
  activity, "you may be asked to verify that there is a real person behind your
  username." Verification is via device passkey (Face ID / fingerprint / PIN).
  ([How to verify you're human](https://support.reddithelp.com/hc/en-us/articles/50051922501268),
  created 2026-06-08) [PRIMARY].
- **Responsible Builder Policy** (created 2025-10-28, edited 2026-06-05)
  [PRIMARY] binds "developer, moderator, researcher, or an app," requires
  approval before API access, and explicitly prohibits "posting identical or
  **substantially similar content across subreddits**."
- **[App] labels.** Automated accounts are labelled publicly; the first set
  appeared 2026-03-31.
- **Gating has moved off karma.** The
  [Contributor Quality Score](https://support.reddithelp.com/hc/en-us/articles/19023371170196)
  (edited 2026-06-23) [PRIMARY] places every account in one of five tiers using
  "past actions taken on a redditor's account, **network and location signals**,
  and steps a redditor has taken to secure their account (e.g. email
  verification)" — and mods filter on it directly. Reddit's reputation filter is
  described in its own docs as "a more nuanced approach than u/AutoModerator
  karma or account age limits."

  **Implication: karma farming is a depreciating asset.** Reddit is deliberately
  migrating gating from signals you can farm (karma, account age) to signals you
  cannot (network, location, account security). Do not spend a single hour
  building karma; spend it on a verified email, a passkey, and real answers.

**Still true, and still the operational rule:**

- **Subreddit rules override everything and are not machine-readable.** Rules
  change, mod teams change, and we have no API access. **Before the first post in
  any subreddit, a human must open the subreddit, read the rules tab, read the
  pinned posts, and log the date read.** Do not skip this because a document
  listed a subreddit name.
- **Never post as a brand.** Post as a person who runs the business, and say so
  the first time it is relevant.

A subreddit ban is permanent, visible to other mods, and — for `r/memphis`
specifically — removes the single best organic surface Porch & Party has. Expect
the first two weeks of a new account to be effectively invisible behind these
filters. Do not react to that by posting more.

### 4.3 What to actually publish, mapped to these brands

**The format the data points at, before the brand map.** Per §4.1, cited Reddit
content is short (~80 words median), Q&A-shaped (>50% of citations), low-scored
(80% under 20 upvotes), and matched to the *answer* not the *prompt*. So:

- **Write the answer, not the pitch.** ~80–150 words, direct, specific, no
  preamble. The thing being measured is whether your comment reads like the
  answer to the question.
- **Answer questions; do not start threads.** Q&A threads carry over half of all
  Reddit citations. A question someone else asked, answered well, is worth more
  than a post you originate.
- **Do not chase upvotes.** 80% of cited posts are under 20. Voting is not the
  mechanism, and Reddit is actively engineering karma out of its own gating.

**Verify every subreddit's current rules before posting — see §4.2.** The
following are candidates, not clearances.

| Brand | Candidate subreddits | What to actually do |
|---|---|---|
| porchandparty901.com | `r/memphis` (plus Memphis city/neighbourhood subs) | **Answer, do not post.** Someone asks for a balloon/backdrop/party rental rec several times a year. Answer it as "I run a decor business here, so discount me accordingly, but here's what I'd tell a friend" and name two competitors alongside yourself. That comment is the asset. |
| Wedding tools / dream-wedding-builder | `r/weddingplanning`, `r/Weddingsunder10k`, `r/weddingvendors` | Budget breakdowns with real numbers. These subs punish vendor self-promotion hard and reward specific cost data. |
| horselegalguide.com (**client**) | `r/Equestrian`, `r/Horses`, `r/HorseBoarding`-type subs | **Highest-value Reddit fit, and highest risk.** Boarding contracts, liability, and sale disputes come up constantly and are answered badly. Requires client approval *and* a standing "this is general information, not legal advice, and I'm not your lawyer" disclaimer in every comment. Many subs ban legal advice outright — check first. |
| uscisexam.com | `r/immigration`, `r/USCIS`, `r/citizenship` | Answer specific N-400 / civics-test questions. Never link on a first contact. |
| Coaching / agency brands | `r/smallbusiness`, `r/eventplanning`, `r/AV` | Operational answers only. `r/Entrepreneur`-style subs are saturated and low-value. |
| hicksconsulting.org (**client**) | `r/managers`, `r/humanresources` | **Client approval required.** Workplace mental health is sensitive on Reddit; a bad comment attributed to a consulting client is a client-relationship problem, not just a marketing one. |
| Health guide sites | **Skip.** | `r/Testosterone`, `r/tressless`, `r/askdentists` etc. have well-earned hostility to commercial accounts and, for some, mod policies against non-clinician advice. Not worth the ban. |

### 4.4 Cadence and effort

| Activity | Frequency | Hours/week |
|---|---|---|
| Read + answer in 2–3 subreddits | daily, 15 min | 1.25 |
| Rule re-read / log for any new subreddit | as needed | 0.25 |
| **Total** | | **~1.5 hrs/week**, capped |

**Cap it at 1.5 hrs/week and do not raise the cap.** Given §4.1, additional
Reddit hours have the worst expected return per hour of the three live surfaces.

**Not VA-delegable.** A VA answering as the owner is a misrepresentation of
identity and is the exact behaviour Reddit's impersonation and spam rules
target. If the owner will not do it personally, do not do it.

### 4.5 How to tell if it worked

- **Leading:** whether the account survives 90 days without a removal, and
  whether comments stay visible rather than being auto-collapsed. Survival is a
  real metric here. **Karma is not** — see §4.2.
- **Real signal:** grounded probe returning a `reddit.com` URI on a priority
  query. Expect this to be rare and unstable — that is the finding, not a failure.
- **Set the expectation honestly:** the average cited Reddit post is ~900 days
  old [VENDOR]. A comment written in week 8 of this plan is not a 90-day asset.
  Judge Reddit at 12 months, not at 12 weeks, and judge it on whether the
  comments still exist and still rank.
- **Target for 90 days:** zero bans, ≥20 substantive answers, ≥1 answer that
  ranks in Google for its thread title.

### 4.6 What NOT to do

- Do not create an account and immediately post a link. Post & Comment Guidance
  can now block a specific domain **before submission**, in 100% of communities
  (§4.2) — you may not even get a removal notice.
- **Do not post the same answer in multiple subreddits.** This is no longer just
  bad manners: the Responsible Builder Policy explicitly prohibits "posting
  identical or substantially similar content across subreddits" [PRIMARY].
- **Do not farm karma.** Reddit has moved gating to Contributor Quality Score,
  which weighs network, location and account-security signals you cannot farm
  (§4.2). Hours spent on karma are hours wasted by design.
- Do not have a VA or an agency post on the owner's behalf. Beyond the honesty
  problem, an account flagged for automated activity now has **seven days** to
  pass passkey human verification or be labelled an app and restricted from
  posting [PRIMARY].
- Do not use any bot, scheduler or generative tool that posts on your behalf.
  Reddit's Spam policy names "tools (e.g., bots, generative AI tools) that may
  break Reddit or facilitate the proliferation of spam" [PRIMARY].
- Do not argue with a moderator. Ever. Accept the removal and move on.
- Do not treat Reddit as a channel with a forecast. §4.1 is why.
- Do not judge it at 90 days. §4.5 is why.

---

## 5. Medium — **do not use. This is the skip.**

### 5.1 Why it does not matter for AI citation

Three independent reasons, any one of which would be sufficient:

**a) It blocks the training crawlers [PRIMARY].** Medium's robots.txt, fetched
2026-08-26, gives `Disallow: /` to `GPTBot` and `ClaudeBot` (among others). Of
the four surfaces, Medium is the only one that has affirmatively closed the door
on the two crawlers most likely to carry a small brand into a model's parameters.
Retrieval bots can still read it — but retrieval favours recency and authority,
which is precisely where a new Medium account has nothing.

**b) Promotional content is structurally excluded from distribution.** Medium's
distribution standards state that stories whose "primary point" is "gathering
signups/traffic, selling something, or soliciting donations" are **not eligible
for distribution**, and that stories tagged to spam a topic's readers are not
eligible for General Distribution
([Medium's Distribution Guidelines](https://help.medium.com/hc/en-us/articles/360006362473-Medium-s-Distribution-Standards-What-Writers-and-Publications-Need-to-Know)).
First-party self-promotion is permitted in principle — "you may promote and link
to your own business, website, mailing list" — but Medium's own guidance adds
that "the more promotion, the less likely it is to reach a wider readership"
([Medium Rules](https://policy.medium.com/medium-rules-30e5502c4eb4);
[Can you self-promote on Medium?](https://medium.com/medium-handbook/can-you-self-promote-on-medium-cd9a91b5c96b)).
A portfolio whose entire purpose on the surface is brand citation is on the
wrong side of that filter by construction.

**c) The canonical import defeats the purpose.** Medium's import tool sets
`rel="canonical"` back to the original URL. That is correct behaviour and avoids
a duplicate-content problem — but it means the *owned domain* remains canonical.
The owned domain is exactly the thing that already isn't being cited. Importing
owned content to Medium produces a page that points authority back at the page
that isn't working. Writing *original* content for Medium avoids that, but then
you are writing original content for a platform that blocks GPTBot and
deprioritises anything commercial.

The one point in Medium's favour found in research: Semrush named Medium a
"biggest winner" on ChatGPT after September 2025, with **no figure attached**
([2025-11-10](https://www.semrush.com/blog/most-cited-domains-ai/)) [VENDOR]. A
directional mention with no number does not outweigh (a), (b) and (c).

### 5.2 If it is used anyway

Only one configuration is defensible: original essays, no imports, no owned-site
links above the fold, published under the owner's real name, in a topic-matched
publication, with the business relationship disclosed. Roughly 2 hrs per piece.
**Expected return per hour: lowest of the four.** The same 2 hours spent on a
LinkedIn Article reaches a surface that ChatGPT's retrieval bot is explicitly
allowed to read and that is cited in ~14% of its responses.

**Recommendation: skip entirely for 90 days.** Revisit only if Medium's
robots.txt changes.

---

## 6. Brand → surface map

| Brand | LinkedIn | YouTube | Reddit | Medium |
|---|---|---|---|---|
| spryexecutiveos.com / billionairehighperformancecoach.com | **Primary** | Secondary | Minor | No |
| westpeekproductions.com / virtualagency-os.com | **Primary** | **Primary** | Minor (`r/eventplanning`, `r/AV`) | No |
| approvalprep.com | Secondary | Optional | No | No |
| porchandparty901.com | No | Secondary (phone video) | **Primary** (`r/memphis`) | No |
| Wedding tools | No | Optional | **Primary** (wedding subs) | No |
| hicksconsulting.org (**client**) | **Primary, approval-gated** | No | Minor, approval-gated | No |
| horselegalguide.com (**client**) | No | **Primary, approval-gated** | Secondary, approval-gated + disclaimer | No |
| uscisexam.com | No | Secondary | Secondary | No |
| dentistryguides.com / hormonesivhair.com / neuroevalguides.com | No | **No — YMYL, no credentialed presenter** | **No** | No |
| theindustryguides.com / theaccidentguides.com | No | Optional | No | No |

**On the health guide sites:** they are excluded from every third-party surface
in this plan. Publishing health claims under a non-clinician identity on Reddit
or YouTube risks removal on both platforms and reputational damage that no
citation gain justifies. If those verticals matter, the correct move is a
credentialed contributor with a named byline — a hiring decision, not a
content-calendar decision.

**On the two client brands:** hicksconsulting.org and horselegalguide.com are
under existing content and cadence constraints in their own repos. Every
third-party post touching either brand requires **written client approval of the
specific text before publication**, logged with a date. This includes posts from
the owner's personal account that merely reference the client. Treat the
approval log as a deliverable, not overhead — it is the thing that makes this
programme safe to run at all.

---

## 7. The 90-day sequence

Ordered by expected return per hour. Total commitment settles at ~7 hrs/week.

### Week 1 — fix the measurement, then start LinkedIn (~4 hrs)

The probe currently measures memorisation, not citation (§1.2). Everything in
this plan is unfalsifiable until that is fixed.

1. **Add a grounded mode run.** Run `llm_citation_probe.mjs --mode grounded`
   against a key with Google Search grounding available. Grounded mode reads
   `groundingMetadata.groundingChunks` — actual retrieved sources — which is a
   citation observation. Knowledge mode is not.
2. **Add `attributed_surfaces` to `citation_probe_config.json`** alongside
   `owned_domains`: `linkedin.com`, `youtube.com`, `reddit.com`. Record when a
   grounded answer cites one of *those* — because from now on a third-party page
   carrying our name is the win, and the current schema has nowhere to put it.
3. **Record a pre-programme baseline run** and commit it. Without a dated
   baseline nothing measured in week 12 means anything.
4. Publish LinkedIn Article #1 (the AI-coaching-tools piece — it maps to a
   measured T1 query).
5. Start the client approval log for hicksconsulting.org.

### Week 2–3 — LinkedIn only (~3 hrs/week)

Three posts/week plus one Article per fortnight. Nothing else. Establish the
cadence before adding a second surface; Semrush's ~75%-of-cited-authors-post-5+
times finding is a consistency finding, and consistency is what breaks first
when you start two things at once.

### Week 4 — add YouTube (~5.5 hrs/week total)

6. Record video #1 for **westpeekproductions.com** (screen-share, run of show,
   15 min, chaptered). This brand first because virtual events are the most
   screen-native subject in the portfolio and the format is the cheapest.
7. Set the template: outline → single take → chapters → 150–300 word
   description → corrected captions. Hand the trim/upload/chapters/captions half
   to the VA from video #3 onward.
8. Get client approval moving for the horselegalguide.com boarding-contract
   video — the highest-leverage single asset identified here.

### Week 6 — first read (~30 min)

9. Grounded probe run #2. Compare against the week-1 baseline. Expect nothing
   yet; the point is to confirm the instrument works and the comparison is
   possible.

### Week 8 — add Reddit, capped (~7 hrs/week total)

10. One account, owner's real identity, disclosed. **Verify the email and set a
    passkey on day one** — those are Contributor Quality Score inputs, and the
    passkey is what clears human verification if the account is ever flagged
    (§4.2). Do not spend any time on karma.
11. Two weeks of answering only — no links at all — while the filters settle.
    Note that link-based blocking now runs pre-submission in 100% of communities,
    so a link may fail silently.
12. Rule-read and log for `r/memphis` and the wedding subs before the first
    comment.
13. Hard cap 1.5 hrs/week. Do not let Reddit crowd out LinkedIn. Judge it at 12
    months, not at week 12 (§4.5).

### Week 12 — decide (~1 hr)

14. Grounded probe run #3 against the week-1 baseline.
15. Decision rule, stated in advance so it cannot be rationalised later.
    **Reddit is explicitly excluded from this decision** — its payoff horizon is
    years, so judging it here would produce the wrong answer:
    - **≥1 grounded observation citing a LinkedIn or YouTube URL of ours** →
      the mechanism works. Double down on whichever produced it.
    - **Zero, but LinkedIn Articles are indexed and videos are getting search
      traffic** → the surfaces are working, the timeline is longer than 90 days.
      Continue at the same cadence, re-read at week 24.
    - **Zero, and the LinkedIn Articles are not even indexed** → the problem is
      upstream of surface choice. Stop and diagnose before spending more hours.

### Explicitly skipped

| Skipped | Why |
|---|---|
| **Medium, entirely** | Blocks GPTBot and ClaudeBot [PRIMARY]; commercial content structurally excluded from distribution; canonical import points back at the pages that already don't work. §5. |
| **A fourth owned publication** | A fourth closed loop. Already settled in `where-citations-come-from.md`. |
| **Reddit before week 8** | Highest-variance surface (lost 86% of its ChatGPT citation share nine days ago) *and* the slowest — the average cited Reddit post is ~900 days old, so nothing started here pays inside 90 days. Learn the cadence habit on a stable, faster surface first. |
| **Karma farming on Reddit** | Reddit has moved its gating to Contributor Quality Score, which weighs network, location and account-security signals rather than karma [PRIMARY]. Farming karma is optimising a signal being deliberately retired. |
| **YouTube Shorts** | 5.7% of YouTube's AI citations [VENDOR]. |
| **Health-vertical third-party posting** | YMYL without a credentialed presenter. §6. |
| **Any paid/automated engagement** | Terms violation on all four platforms, and the data says virality isn't the mechanism anyway (median cited LinkedIn post: 15–25 reactions). |
| **Chasing vendor citation-share targets** | Tools disagree by 4x+ over the same period ([SEJ 2026-08-19](https://www.searchenginejournal.com/why-reddits-chatgpt-citation-drop-isnt-fully-explained/586479/)). Measure with our own probe. |

---

## 8. Non-negotiables

Carried directly from the standard already applied on owned properties, where
562 of 562 external links carry `rel="sponsored nofollow"` [MEASURED-HERE]:

1. **Disclose the commercial relationship** in the body of any post recommending
   an owned or client brand. "I run this" or "this is a client of mine."
2. **One identity per person.** No sockpuppets, no brand accounts pretending to
   be individuals, no VA posting as the owner.
3. **No purchased engagement**, no pods, no reciprocal-upvote arrangements.
4. **No automation against LinkedIn or Reddit.** Both prohibit it; LinkedIn
   enforces it with account restriction.
5. **Client text is approved in writing before it ships**, including posts from
   the owner's account that merely reference a client.
6. **Disclose synthetic media** where a platform requires it (YouTube).
7. **Read the subreddit rules before the first post**, and log the date.

---

## 9. The bottom line

**What this can achieve.** It can put pages carrying these brands' names on
surfaces that AI retrieval crawlers are permitted to read — which, per §1.3, is
something the current 9,700 owned pages and 562 owned-to-owned nofollow links
structurally cannot do. And it can do it across *both* engine families, because
LinkedIn and YouTube fail in opposite directions: LinkedIn is readable by
ChatGPT's and Google's retrieval bots and invisible to Perplexity; YouTube is
dominant on Google's AI surfaces and a rounding error on ChatGPT. That
complementarity is the reason the plan runs two surfaces rather than one, and it
is the reason a third and fourth surface add much less than they appear to. LinkedIn's own data says the bar is a post with 15–25
reactions from an account with under 2,000 followers, posted consistently.
YouTube's says views and subscribers correlate at roughly zero with citation.
Neither of those requires an audience, a budget, or a year. They require about
seven hours a week, indefinitely, from the owner personally.

**What it cannot achieve.** It cannot be forecast. Reddit lost 86% of its
ChatGPT citation share in four days nine days before this was written and nobody
including OpenAI has explained it; Reddit fell ~50 points in six weeks the year
before that. LinkedIn is reachable by ChatGPT and Google and *unreachable* by
Perplexity, by that platform's choice, not ours — and either platform could
change its robots.txt tomorrow and delete the mechanism. Every number in §1.4
comes from vendors who disagree with each other by more than fourfold. **Anyone
who gives you a projected citation rate for this programme is guessing.**

It also will not fix the underlying problem quickly. Ninety days of consistent
work on two surfaces is a realistic shot at *one* observed grounded citation of a
third-party page carrying one of these brands. One. Set against a baseline of
zero across 24 observations, one is a genuine and falsifiable result — but it is
not traffic, it is not revenue, and it will not feel like progress in week six.
Reddit is slower still: the average Reddit post an AI cites is about 900 days
old, so a comment written in week 8 is an asset for 2028, not for this quarter.
That is an argument for starting it, and an argument against measuring it in
December.

**What would actually change the answer.** The largest single asset identified
in this document is not a surface, it is a person: the health verticals, which
are excluded from every third-party surface here, are excluded because nobody in
the portfolio can credibly present them. A credentialed contributor with a named
byline would unlock more citation surface than any amount of posting. That is a
hiring decision, and it sits outside this plan.

**And the honest possibility.** It is possible that ~19 domains is simply more
brands than one person can be a credible third-party voice for. Two surfaces,
two brands, seven hours a week, done consistently for a year, is a plan.
Four surfaces across nineteen brands is not a plan, it is the same
volume-over-depth bet that produced 1,143 impressions and one click — moved to
someone else's platform, where it can also get you banned.

---

## Appendix: sources

**Primary, fetched 2026-08-26**
- [youtube.com/robots.txt](https://www.youtube.com/robots.txt)
- [linkedin.com/robots.txt](https://www.linkedin.com/robots.txt)
- [medium.com/robots.txt](https://medium.com/robots.txt)
- [reddit.com/robots.txt](https://www.reddit.com/robots.txt)
- [Reddit Public Content Policy](https://support.reddithelp.com/hc/en-us/articles/26410290525844-Public-Content-Policy) (linked from Reddit's robots.txt)
- [Reddit Rules](https://redditinc.com/policies/reddit-rules) — the old `/policies/content-policy` URL 301-redirects here
- [Reddiquette](https://support.reddithelp.com/hc/en-us/articles/205926439-Reddiquette) — the live 9:1 text, `edited_at` 2025-08-18
- [How do I keep spam out of my community](https://support.reddithelp.com/hc/en-us/articles/28012014962580-How-do-I-keep-spam-out-of-my-community) — the mod-facing 10% variant, edited 2026-03-28
- [Reddit changelog 2026-02-04](https://support.reddithelp.com/hc/en-us/articles/45959071783316) — link-based Post & Comment Guidance, 100% of communities
- [Reddit Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564) — created 2025-10-28, edited 2026-06-05
- [How to verify you're human when asked by Reddit](https://support.reddithelp.com/hc/en-us/articles/50051922501268) — passkey verification, seven-day deadline, created 2026-06-08
- [What is the Contributor Quality Score?](https://support.reddithelp.com/hc/en-us/articles/19023371170196) — five tiers, edited 2026-06-23

  Reddit's help centre returns HTTP 403 to automated HTML fetches, but its
  Zendesk API is open: `https://support.reddithelp.com/api/v2/help_center/en-us/articles/{id}.json`
  returns the full body and an authoritative `edited_at`. Every Reddit
  help-centre quotation above was verified through that endpoint on 2026-08-26.
  This is a reusable method, not a one-off.
- [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement)
- [LinkedIn Professional Community Policies](https://www.linkedin.com/legal/professional-community-policies)
- [Medium Rules](https://policy.medium.com/medium-rules-30e5502c4eb4)
- [Medium's Distribution Guidelines](https://help.medium.com/hc/en-us/articles/360006362473-Medium-s-Distribution-Standards-What-Writers-and-Publications-Need-to-Know)
- [Can you self-promote on Medium?](https://medium.com/medium-handbook/can-you-self-promote-on-medium-cd9a91b5c96b)

  Note: all three Medium URLs, and the Reddit help-centre URL above, return HTTP
  403 to automated fetches. They were located via search indexes and their
  content is quoted from those indexes, not from a direct fetch. The robots.txt
  files, the LinkedIn legal pages and the YouTube help pages were fetched
  directly and returned 200.
- [YouTube channel monetization policies](https://support.google.com/youtube/answer/1311392)
- [YouTube response to creator questions about YPP policies, July 2025](https://support.google.com/youtube/thread/356734251/response-to-creator-questions-about-ypp-policies-july-2025)
- [YouTube Partner Program eligibility](https://support.google.com/youtube/answer/13429240)
- [YouTube — disclosing AI-generated content](https://support.google.com/youtube/answer/14328491) and the [announcement](https://blog.youtube/news-and-events/disclosing-ai-generated-content/)
- [YouTube — automatic captions](https://support.google.com/youtube/answer/6373554)
- [YouTube — add chapters to your video](https://support.google.com/youtube/answer/9884579)
- [Google Search Central — Video best practices](https://developers.google.com/search/docs/appearance/video) (the "we will prioritize key moments set by you" statement)
- [Google Search Central — AI Features and Your Website](https://developers.google.com/search/docs/appearance/ai-features) ("no additional requirements to appear in AI Overviews or AI Mode")
- [OpenAI — bots and crawlers](https://developers.openai.com/api/docs/bots) (OAI-SearchBot = retrieval, GPTBot = training)
- [Anthropic — does Anthropic crawl the web](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) (Claude-SearchBot = retrieval, ClaudeBot = training)
- [Google — common crawlers](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers) (Google-Extended does not affect Search inclusion)
- [LinkedIn Help — customize SEO title and description on Articles and Newsletters](https://www.linkedin.com/help/linkedin/answer/a6244140)
- [LinkedIn Help — prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387)
- [LinkedIn Help — automated activity](https://www.linkedin.com/help/linkedin/answer/a1340567)
- [Cloudflare — Perplexity is using stealth, undeclared crawlers, 2025-08-04](https://blog.cloudflare.com/perplexity-is-using-stealth-undeclared-crawlers-to-evade-website-no-crawl-directives/)

**Vendor studies (methodology stated, commercially motivated)**
- [Semrush — We Analyzed 89K LinkedIn URLs Cited in AI Search, 2026-03-10](https://www.semrush.com/blog/linkedin-ai-visibility-study/) — 325k prompts, Jan–Feb 2026, ChatGPT Search / Google AI Mode / Perplexity
- [Semrush — The Most-Cited Domains in AI: A 3-Month Study, 2025-11-10](https://www.semrush.com/blog/most-cited-domains-ai/) — 230k prompts, 100M+ citations, Jul 14 – Oct 12 2025
- [Semrush — We Analyzed 248K Reddit Posts, 2025-11-10](https://www.semrush.com/blog/reddit-ai-search-visibility-study/) — 217k prompts, 248k cited Reddit URLs, Google AI Mode / Perplexity / ChatGPT Search. The source for the ~900-day age and sub-20-upvote findings.
- [Otterly — YouTube AI Citation Study 2026, 2026-03-02](https://otterly.ai/blog/youtube-ai-citation-study-2026/) — 100M citation instances, 30 days, 6 engines
- [Search Engine Journal — Why Reddit's ChatGPT Citation Drop Isn't Fully Explained, 2026-08-19](https://www.searchenginejournal.com/why-reddits-chatgpt-citation-drop-isnt-fully-explained/586479/) — reporting Promptwatch data
- [Search Engine Land — AI search engines cite Reddit, YouTube, and LinkedIn most, 2026-03-31](https://searchengineland.com/ai-search-engines-cite-reddit-youtube-and-linkedin-most-study-473138) — reporting Peec AI, 30M sources
- [5W Research — YouTube AI citation share report, 2026](https://www.5wpr.com/research/youtube-ai-citation-share-report-2026/) — methodology not obtained; cited only to show it conflicts with Otterly by an order of magnitude
- [Ahrefs — most-cited domains in AI Overviews, Jul 2026](https://ahrefs.com/blog/most-cited-domains-ai-overviews/) — 3M+ US queries; **mention share is computed over the top 50 sources only, which inflates every figure**
- [BrightEdge — YouTube presence in AI search](https://www.brightedge.com/resources/weekly-ai-search-insights/youtube-presence-ai-search), May 2024 – Sept 2025; trade coverage [Search Engine Land, 2025-10-01](https://searchengineland.com/youtube-ai-search-citations-data-462830)
- [Profound — AI platform citation patterns, 2025-06-05](https://www.tryprofound.com/blog/ai-platform-citation-patterns) — 680M citations, Aug 2024 – Jun 2025. The dissenting low figures for both LinkedIn and YouTube.
- [Social Media Today — LinkedIn is a leading source for AI answers, 2026-03-10](https://www.socialmediatoday.com/news/linkedin-is-a-leading-source-for-ai-answers/814388/) — reporting Profound's Nov 2025 → Feb 2026 climb
- [Ordinal — LinkedIn link penalty study](https://www.tryordinal.com/blog/linkedin-link-penalty-study) — 900k+ posts, Feb 2023 – Feb 2026, Mann-Whitney U, p<0.001; **vendor sells link-moving tooling**. Content read from search indexes; the page returned 404 to my direct fetch.
- [Richard van der Blom — Algorithm Insights](https://richardvanderblom.com/) — 1.3M posts / 50k creators; **vendor sells LinkedIn tooling**. Homepage verified; the specific report page was not obtained, so the 18.8% figure is secondhand.
- [LinkedIn's Rishi Jobanputra on links and reach](https://www.linkedin.com/feed/update/urn:li:activity:7370869955623542785/) — the company's own position

**Context, not evidence**
- [CNBC](https://www.cnbc.com/2025/12/09/google-hit-with-eu-antitrust-probe-over-use-of-online-content-for-ai.html) and [TechCrunch](https://techcrunch.com/2025/12/09/eu-launches-antitrust-probe-into-googles-ai-search-tools/) on the EU antitrust probe into Google's use of YouTube content for AI, opened 2025-12-09

**Internal**
- `authority-backlink-network/docs/strategy/where-citations-come-from.md`
- `scripts/llm_citation_probe.mjs` (present in 7 repos)
- `data/signals/citation_probe_config.json`, `data/signals/llm_citation_observations.json`
