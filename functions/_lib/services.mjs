/**
 * West Peek Productions' six services: ONE list, read by the site (the build writes it into the
 * homepage, Capabilities and the Get in touch dropdown), the dashboard's Discovery picker and Quote,
 * and the form handler. Scooter, 15 Nov 2026: "Use these same categories, in this order, on the site
 * and dashboard" — Content production; Podcast production; Virtual / hybrid event production;
 * Community-As-A-Service; Brand strategy; Web development. Change a name or the order here only.
 *
 * `line` is the short reveal on the site (Scooter: "Much less copy per box; each with a hover or
 * click reveal"); generic on purpose, no client named. `events: true` marks the service whose form
 * choice asks for event start and end dates.
 */
const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;

export const SERVICES = [
  { id: 'content-production', name: 'Content production', line: 'Video, photo, design and social content that carries your story.', icon: svg('<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3z"/>') },
  { id: 'podcast-production', name: 'Podcast production', line: 'A series planned, recorded, edited and published for you.', icon: svg('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>') },
  { id: 'virtual-hybrid-events', name: 'Virtual / hybrid event production', line: 'Summits, conferences and webinars, produced end to end.', icon: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M10.5 8l4 2-4 2z"/>'), events: true },
  { id: 'community-as-a-service', name: 'Community-As-A-Service', line: 'Your community planned, grown and kept engaged all year.', icon: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.8.4 5 2.7 5 5.8"/>') },
  { id: 'brand-strategy', name: 'Brand strategy', line: 'Who needs to care, what to say, and how you look saying it.', icon: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>') },
  { id: 'web-development', name: 'Web development', line: 'Websites that tell your story and are easy to keep current.', icon: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M10 13l-2 2 2 2M14 13l2 2-2 2"/>') }
];

export const SERVICE_BY_ID = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
export const SERVICE_BY_NAME = Object.fromEntries(SERVICES.map((s) => [s.name, s]));
export const EVENT_SERVICE = SERVICES.find((s) => s.events);

/** A service id from a name, an id, or loose words in a tracker cell ("Events", "website", "podcast"). */
export function serviceFrom(text) {
  const t = String(text || '').trim();
  if (SERVICE_BY_ID[t]) return t;
  if (SERVICE_BY_NAME[t]) return SERVICE_BY_NAME[t].id;
  const low = t.toLowerCase();
  if (!low) return '';
  const rules = [['podcast-production', /podcast|audio series/], ['virtual-hybrid-events', /event|summit|conference|webinar|virtual|hybrid|gathering/], ['community-as-a-service', /community/], ['web-development', /web|site|digital/], ['brand-strategy', /brand|story|identity|strategy/], ['content-production', /content|video|film|media|photo|social/]];
  return (rules.find(([, re]) => re.test(low)) || [''])[0];
}
