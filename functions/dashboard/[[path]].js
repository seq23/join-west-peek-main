/**
 * /dashboard on westpeekproductions.com — password-gated, server-rendered, figures from the
 * private store. Everything lives in functions/_lib/productions-dashboard.mjs; this file only
 * routes /dashboard and /dashboard/* to it. Other hosts sharing these Functions get 404.
 */
import { handleDashboard } from '../_lib/productions-dashboard.mjs';

export function onRequest({ request, env }) {
  return handleDashboard({ request, env });
}
