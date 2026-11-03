import { useState } from 'react';
import { CreditCard, ShieldAlert } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchSubscriptionBillingSummary } from '../../api/admin';
import { AdminPageHeader } from '../../components/admin';
import { ErrorState, Section, StatCard, StatusBadge } from '../../components/developer/kit';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/developer/ui/select';

type BillingSummary = {
  mode: string;
  subscribers: number;
  statuses: Array<{ _id: string; count: number }>;
  failedInvoices: Array<{
    stripeSessionId: string;
    userId: string;
    planName: string;
    amount: number;
    currency: string;
    livemode: boolean | null;
    createdAt: string;
  }>;
  webhookReadiness: { ready: boolean; status: string; mode: string | null };
};

// SubscriptionV2 statuses.
const statusLabels: Record<string, string> = {
  active: 'Aktive',
  past_due: 'Forfalt',
  canceling: 'Avsluttes',
  canceled: 'Avsluttet',
  expired: 'Utløpt',
};

export default function SubscriptionBillingAdminPage() {
  const [mode, setMode] = useState<'all' | 'test' | 'live'>('all');
  const { data, isLoading, isError } = useQuery<BillingSummary>({
    queryKey: ['admin-subscription-billing', mode],
    queryFn: () => fetchSubscriptionBillingSummary(mode),
  });
  const counts = Object.fromEntries((data?.statuses || []).map(({ _id, count }) => [_id, count]));

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Abonnementsfakturering"
        description="Abonnentstatus og mislykkede abonnementsbetalinger."
        actions={
          <Select value={mode} onValueChange={(value) => setMode(value as 'all' | 'test' | 'live')}>
            <SelectTrigger size="sm" className="w-36 bg-card" aria-label="Stripe-modus">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">Test + Live</SelectItem>
              <SelectItem value="test">Test</SelectItem>
              <SelectItem value="live">Live</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {isError ? (
        <div role="alert">
          <ErrorState error={{ message: 'Kunne ikke hente abonnementsoversikten.' }} />
        </div>
      ) : (
        <>
          <section aria-label="Abonnentstatus" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Abonnenter', data?.subscribers ?? 0],
              ...Object.entries(statusLabels).map(([key, label]) => [label, counts[key] || 0]),
            ].map(([label, count]) => (
              <StatCard
                key={String(label)}
                label={String(label)}
                loading={isLoading}
                value={Number(count).toLocaleString('nb-NO')}
              />
            ))}
          </section>

          <Section
            title={
              <span className="flex items-center gap-2">
                {data?.webhookReadiness.ready ? (
                  <CreditCard className="size-4 text-emerald-600" />
                ) : (
                  <ShieldAlert className="size-4 text-amber-600" />
                )}
                Webhook-status
              </span>
            }
          >
            <p className="text-sm text-muted-foreground">
              {data?.webhookReadiness.ready
                ? `Stripe-webhook er verifisert for ${data.webhookReadiness.mode?.toUpperCase()}-modus.`
                : `Webhook krever oppfølging (${data?.webhookReadiness.status || 'ukjent status'}).`}
            </p>
          </Section>

          <Section title="Mislykkede abonnementsbetalinger">
            {!data?.failedInvoices.length ? (
              <p className="text-sm text-muted-foreground">
                Ingen mislykkede betalinger registrert.
              </p>
            ) : (
              <ul className="divide-y">
                {data.failedInvoices.map((invoice) => (
                  <li
                    key={invoice.stripeSessionId}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {invoice.planName || 'Abonnement'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {invoice.userId} · {new Date(invoice.createdAt).toLocaleDateString('nb-NO')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        status="livemode"
                        tone="warning"
                        label={
                          invoice.livemode === false
                            ? 'TEST'
                            : invoice.livemode === true
                              ? 'LIVE'
                              : 'UKJENT'
                        }
                      />
                      <span className="tabular-nums font-medium text-foreground">
                        {new Intl.NumberFormat('nb-NO', {
                          style: 'currency',
                          currency: (invoice.currency || 'nok').toUpperCase(),
                        }).format(invoice.amount)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
