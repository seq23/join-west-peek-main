# Wikidata entity draft — West Peek

Draft only. **A human submits this**, and the flagged items must be confirmed
first: a Wikidata item with wrong facts is worse than no item, because it
becomes the grounding source that language models repeat.

## Why Wikidata and not Wikipedia

These are different bars, and conflating them wastes effort.

**Wikidata** accepts an item when the subject is *identifiable and referenced* —
it does not require significant press coverage. A company with a live site, a
LinkedIn company page and an existing directory listing generally clears it.
That is the achievable target here.

**Wikipedia** requires significant coverage in independent, reliable, secondary
sources — journalism about the company, not by it. Nothing in this portfolio
currently meets that bar, and attempting an article without it produces a
speedy deletion and a promotional-editing flag against the account. Recommended
position: **do not attempt a Wikipedia article yet.**

Wikidata is worth doing on its own merits: it is a primary grounding source for
entity resolution in most LLM pipelines, so it is read by exactly the systems
this portfolio is optimised for.

## Entity structure

Three related organizations are already modelled in the site entity graph, and
Wikidata should mirror that structure rather than flatten it:

| Entity | Site | Role |
|---|---|---|
| West Peek | joinwestpeek.com | Umbrella community for founders and builders |
| West Peek Ventures | westpeek.ventures | Investment arm |
| West Peek Productions | westpeekproductions.com | Community-as-a-Service and creative agency |

Create **West Peek** first as the parent item, then the two subsidiaries with
`parent organization (P749) → West Peek`. Creating a subsidiary first leaves an
orphan that is harder to merge later.

## Item 1 — West Peek

| Property | Value | Source |
|---|---|---|
| Label (en) | West Peek | Site entity graph |
| Description (en) | Community for founders and builders | Site entity graph |
| instance of (P31) | organization (Q43229) | — |
| official website (P856) | https://joinwestpeek.com/ | Site entity graph |
| described at URL (P973) | https://www.linkedin.com/company/west-peek-group/about/ | Declared `sameAs` |
| **inception (P571)** | **CONFIRM** | Not declared anywhere in the repos |
| **headquarters location (P159)** | **CONFIRM** | Not declared anywhere in the repos |

## Item 2 — West Peek Ventures

| Property | Value | Source |
|---|---|---|
| Label (en) | West Peek Ventures | Site entity graph |
| instance of (P31) | organization (Q43229) | — |
| parent organization (P749) | West Peek | Community site describes it as the umbrella |
| official website (P856) | https://westpeek.ventures/ | Site entity graph |
| has part / officer | Scooter Taylor — General Partner | Site entity graph |
| has part / officer | Sequoia Taylor — General Partner | Site entity graph |

## Item 3 — West Peek Productions

| Property | Value | Source |
|---|---|---|
| Label (en) | West Peek Productions | Site entity graph |
| Description (en) | Community-as-a-Service and creative agency | Site entity graph |
| instance of (P31) | organization (Q43229) | — |
| parent organization (P749) | West Peek | Community site describes it as the umbrella |
| official website (P856) | https://westpeekproductions.com/ | Site entity graph |

## Must be confirmed before submission

Everything above marked CONFIRM is **not stated anywhere in these repositories**.
Do not submit a guess for any of them:

1. **Inception date.** No `foundingDate` appears in any entity graph. Wikidata
   records a source for each statement, and an unsourced founding year that
   later turns out wrong propagates into every model that reads the item.
2. **Headquarters and offices.** No address is declared in any entity graph.
3. **Additional `sameAs` identifiers.** Only LinkedIn, Instagram and X are
   declared today. Crunchbase, The Vendry or any other directory listing should
   be added only if the listing actually exists — each becomes a referenced
   identifier.

## After submission

Add the resulting Q-numbers back into the site entity graphs as `sameAs`. That
closes the loop: the sites point at Wikidata and Wikidata points at the sites,
which is what makes the entity resolvable rather than merely present. Until the
Q-numbers exist there is nothing to add, so this step is genuinely blocked on
submission rather than deferred.
