/**
 * API URL → route template for the monitoring reporter: no host, no query string, no ids,
 * so reports never carry user data and the same endpoint groups together.
 * "/api/services/6ad90a9e94221dfd9681ff17/apply?x=1" → "/services/:id/apply"
 * Also used for screen paths (expo-router pathnames), which carry the same ids.
 */
export function templatePath(url?: string) {
  if (!url) return '';
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/^\/api(?=\/)/, '');
  // Mongo ids, numbers, UUIDs and Stripe-style ids (cs_live_…, pi_…, acct_…). The Stripe
  // pattern needs a digit so plain words like "push_tokens" stay readable.
  return path
    .replace(/\/(?:[0-9a-f]{24}|\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[^/]*\d)[a-z]{2,6}_[A-Za-z0-9_]{8,})(?=\/|$)/gi, '/:id')
    .slice(0, 200);
}
