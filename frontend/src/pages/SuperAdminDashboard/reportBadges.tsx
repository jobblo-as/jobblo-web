import { StatusBadge } from '../../components/developer/kit';
import { Badge } from '../../components/developer/ui/badge';
import { REPORT_TYPE_LABELS } from '../../api/admin/jobReports';
import { CHAT_REPORT_PRIORITY_LABELS, CHAT_REPORT_TYPE_LABELS } from '../../api/admin/chats';
import { cn } from '@/lib/utils';

/** Shared badges for Jobbrapporter and Chatrapporter. */
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const STATUS: Record<string, [string, Tone]> = {
  open: ['Åpen', 'warning'],
  under_review: ['Under behandling', 'info'],
  waiting_for_reporter: ['Venter på rapportør', 'info'],
  waiting_for_reported_user: ['Venter på rapportert', 'info'],
  action_required: ['Handling kreves', 'danger'],
  resolved: ['Løst', 'success'],
  dismissed: ['Avvist', 'neutral'],
  closed: ['Lukket', 'neutral'],
};

export const ReportStatus = ({ s }: { s?: string | null }) => {
  const [label, tone] = (s && STATUS[s]) || [s || '—', 'neutral' as Tone];
  return <StatusBadge status={s} label={label} tone={tone} />;
};

/** Fraud/safety reasons stand out in red; the rest are informational. */
const SERIOUS = new Set([
  'scam_or_fraud',
  'fake_job',
  'payment_issue',
  'inappropriate_content',
  'threats',
  'harassment',
  'off_platform_payment_request',
  'privacy_violation',
  'suspicious_link',
]);

export const ReportType = ({ type, chat }: { type: string; chat?: boolean }) => (
  <Badge
    variant="outline"
    className={cn(
      'font-medium',
      SERIOUS.has(type)
        ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
        : 'bg-muted/60 text-foreground'
    )}
  >
    {(chat ? CHAT_REPORT_TYPE_LABELS : REPORT_TYPE_LABELS)[type] ?? type.replace(/_/g, ' ')}
  </Badge>
);

const PRIORITY_TONE: Record<string, Tone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  urgent: 'danger',
};

export const Priority = ({ p }: { p?: string | null }) => (
  <StatusBadge
    status={p}
    label={(p && CHAT_REPORT_PRIORITY_LABELS[p]) || p || '—'}
    tone={(p && PRIORITY_TONE[p]) || 'neutral'}
  />
);
