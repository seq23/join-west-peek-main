/**
 * /portal/<link> on westpeekproductions.com (and its Pages previews): one client's own project page.
 * It shows that client only the tasks and files Scooter marked for them; never another client, a
 * note, a quote, a rate, a price or a money row. Other hosts sharing these Functions get 404.
 */
import { handlePortal } from '../_lib/productions-dashboard.mjs';

export function onRequest({ request, env }) {
  return handlePortal({ request, env });
}
