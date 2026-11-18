/**
 * Why a job takes no new application from this user, as the job page's disabled button text;
 * null when it does. Mirrors the backend's refusals in createJobRequest
 * (backend/controllers/orderController.js) and the web's isClosedService
 * (frontend/src/constants/statuses.ts). The app knew only four closed statuses, so a job with a
 * chosen provider or a full applicant list kept an enabled "Søk på oppdraget" that ended in an
 * error after the user had written the message.
 */
const FINISHED: Record<string, string> = {
  completed: 'Oppdraget er fullført',
  closed: 'Oppdraget er lukket',
  cancelled: 'Oppdraget er kansellert',
  expired: 'Oppdraget har utløpt',
  draft: 'Oppdraget er ikke publisert',
};

/** A provider is chosen: the backend refuses (service status or an active order). */
const TAKEN = ['awaiting_payment', 'paid', 'in_progress', 'waiting_for_approval'];

/** `myRequestStatus`: this user's latest request on the job, if any (pending / accepted / ...). */
export function applyBlockReason(
  job?: { status?: string | null; isLimitReached?: boolean } | null,
  myRequestStatus?: string | null
): string | null {
  const status = job?.status ?? '';
  if (FINISHED[status]) return FINISHED[status];
  // Before "Utfører er valgt": the chosen provider sees their own state, not someone else's.
  if (myRequestStatus === 'accepted') return 'Forespørsel godkjent';
  if (myRequestStatus === 'pending') return 'Forespørsel sendt';
  if (TAKEN.includes(status)) return 'Utfører er valgt';
  if (job?.isLimitReached) return 'Fulltegnet';
  return null;
}
