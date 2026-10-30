/**
 * "Kontakter denne perioden: 1 brukt av 5 · 4 igjen", worked out exactly as the web's job page
 * (JobListingDetailPage): the v2 entitlements when the server has them; when v2 is switched off
 * (SUBSCRIPTION_V2_ENTITLEMENTS_DISABLED) the plan's freeContact and the user's monthly usage.
 * Null when neither source can say, so nothing is shown.
 */
export type ContactEntitlements = {
  includedContacts: number;
  consumedIncludedContacts: number;
  remainingIncludedContacts: number;
};

export function contactUsage({
  entitlements,
  errorCode,
  planFreeContacts,
  monthlyUsage,
}: {
  entitlements?: ContactEntitlements | null;
  errorCode?: string;
  planFreeContacts?: number;
  monthlyUsage?: number;
}): { used: number; limit: number; remaining: number } | null {
  const legacy = errorCode === 'SUBSCRIPTION_V2_ENTITLEMENTS_DISABLED';
  const limit = entitlements?.includedContacts ?? (legacy ? planFreeContacts : undefined);
  const used = entitlements?.consumedIncludedContacts ?? (legacy ? monthlyUsage || 0 : undefined);
  if (limit === undefined || used === undefined) return null;
  const remaining = entitlements?.remainingIncludedContacts ?? Math.max(0, limit - used);
  return { used, limit, remaining };
}
