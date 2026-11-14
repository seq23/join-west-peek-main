/**
 * /dashboard on westpeekproductions.com (and its Pages previews): Scooter's dashboard v1.0.
 * Everything lives in functions/_lib/productions-dashboard.mjs and functions/_lib/pd/; this file
 * only routes /dashboard and /dashboard/* to it. Other hosts sharing these Functions get 404.
 */
import { handleDashboard } from '../_lib/productions-dashboard.mjs';

export function onRequest({ request, env, waitUntil }) {
  return handleDashboard({ request, env, waitUntil });
}
