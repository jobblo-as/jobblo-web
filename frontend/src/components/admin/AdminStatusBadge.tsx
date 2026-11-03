import { cn } from '@/lib/utils';
import { StatusBadge } from '../developer/kit';

type StatusVariant =
  | 'active'
  | 'inactive'
  | 'verified'
  | 'pending'
  | 'completed'
  | 'cancelled'
  | 'paid'
  | 'unpaid'
  | 'refunded'
  | 'succeeded'
  | 'failed'
  | 'open'
  | 'closed'
  | 'in_progress'
  | 'ready_for_review'
  | 'waiting_for_approval'
  | 'disputed'
  | 'superAdmin'
  | 'developer'
  | 'provider'
  | 'company'
  | 'user'
  | string;

/** Tones of the Developer Console's StatusBadge (components/developer/kit.tsx). */
const toneMap: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  active: 'success',
  verified: 'success',
  completed: 'info',
  ready_for_review: 'info',
  waiting_for_approval: 'info',
  paid: 'success',
  succeeded: 'success',
  open: 'info',
  in_progress: 'warning',
  under_review: 'warning',
  disputed: 'danger',
  resolved: 'success',
  dismissed: 'danger',
  pending: 'warning',
  processing: 'warning',
  awaiting_payment: 'warning',
  inactive: 'neutral',
  cancelled: 'danger',
  closed: 'neutral',
  failed: 'danger',
  partially_refunded: 'info',
  unpaid: 'warning',
  refunded: 'info',
  reconciliation_required: 'danger',
  manual_review: 'danger',
  verification_retry: 'warning',
  ready: 'success',
  provider_ready: 'success',
  deadline_expired: 'danger',
  declined: 'danger',
  accepted: 'success',
  awaiting_provider_connect: 'warning',
  superAdmin: 'danger',
  developer: 'info',
  provider: 'info',
  company: 'info',
  user: 'neutral',
};

const labelMap: Record<string, string> = {
  in_progress: 'Pågår',
  ready_for_review: 'Klar for godkjenning',
  waiting_for_approval: 'Venter godkjenning',
  awaiting_payment: 'Venter betaling',
  superAdmin: 'Super Admin',
  developer: 'Utvikler',
  provider: 'Tilbyder',
  company: 'Bedrift',
  user: 'Bruker',
  active: 'Aktiv',
  inactive: 'Inaktiv',
  verified: 'Verifisert',
  completed: 'Fullført',
  cancelled: 'Avbrutt',
  pending: 'Venter',
  processing: 'Behandles',
  paid: 'Betalt',
  unpaid: 'Ubetalt',
  refunded: 'Refundert',
  partially_refunded: 'Delvis refundert',
  none: 'Ingen refusjon',
  reconciliation_required: 'Krever avstemming',
  manual_review: 'Manuell kontroll',
  verification_retry: 'Ny verifisering',
  ready: 'Klar',
  provider_ready: 'Tilbyder klar',
  deadline_expired: 'Frist utløpt',
  succeeded: 'Vellykket',
  failed: 'Feilet',
  open: 'Åpen',
  closed: 'Lukket',
  under_review: 'Under behandling',
  resolved: 'Løst',
  dismissed: 'Avvist',
  disputed: 'Tvist',
  declined: 'Avslått',
  accepted: 'Akseptert',
  awaiting_provider_connect: 'Venter på tilbyder',
};

interface AdminStatusBadgeProps {
  status: StatusVariant;
  className?: string;
}

export function AdminStatusBadge({ status, className }: AdminStatusBadgeProps) {
  return (
    <span className={cn('inline-flex', className)}>
      <StatusBadge
        status={status}
        label={labelMap[status] ?? status}
        tone={toneMap[status] ?? 'neutral'}
      />
    </span>
  );
}
