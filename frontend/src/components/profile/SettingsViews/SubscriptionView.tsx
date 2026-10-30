import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap,
  CreditCard,
  History,
  Package,
  Loader2,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ExternalLink,
  RotateCcw,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'react-hot-toast';
import {
  cancelSubscription,
  cancelSubscriptionChange,
  getMySubscription,
  getUserTransactions,
  openSubscriptionPortal,
  resumeSubscription,
} from '../../../api/stripeAPI';
import { ConfirmDialog } from '../../Ui/ConfirmDialog';

const errorMessage = (error: unknown, fallback: string) =>
  isAxiosError<{ message?: string }>(error) ? error.response?.data?.message || fallback : fallback;

interface Transaction {
  _id: string;
  planName: string;
  amount: number;
  currency: string;
  status: string;
  type: 'subscription' | 'extra_contact' | 'urgent';
  createdAt: string;
  /** The job a Hast was for (populated title). */
  serviceId?: { _id: string; title?: string } | string | null;
  refundedAt?: string | null;
  refundReason?: string | null;
}

interface ContactSummary {
  includedLimit: number;
  includedUsed: number;
  includedRemaining: number;
  perContactPrice: number | null;
  contactUnlockMinutes: number | null;
  paidPurchased: number;
  paidUsed: number;
  paidAvailable: number;
  totalPaidForExtraContacts: number;
}

interface CurrentSubscription {
  hasPlan: boolean;
  plan: string | null;
  planType: 'private' | 'business';
  contacts: ContactSummary;
  status: string;
  stripeStatus?: string;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: string;
  renewalDate?: string;
  price?: number | null;
  pendingPlan?: { plan: string; effectiveAt: string } | null;
}

export function SubscriptionView() {
  const [page, setPage] = useState(1);
  // One purchase open at a time, as SafePay-historikk.
  const [openTx, setOpenTx] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['userTransactions', page],
    queryFn: () => getUserTransactions(page),
  });

  const { data: currentSubscription, isLoading: isSubscriptionLoading } =
    useQuery<CurrentSubscription | null>({
      queryKey: ['my-subscription'],
      queryFn: getMySubscription,
    });

  const cancelMutation = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: (result) => {
      toast.success(result?.message || 'Abonnementet avsluttes ved periodens slutt');
      queryClient.invalidateQueries({ queryKey: ['my-subscription'] });
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Kunne ikke si opp abonnementet')),
  });
  const resumeMutation = useMutation({
    mutationFn: resumeSubscription,
    onSuccess: (result) => {
      toast.success(result?.message || 'Abonnementet fortsetter');
      queryClient.invalidateQueries({ queryKey: ['my-subscription'] });
    },
    onError: (error: unknown) =>
      toast.error(errorMessage(error, 'Kunne ikke gjenoppta abonnementet')),
  });
  const cancelPendingPlanMutation = useMutation({
    mutationFn: cancelSubscriptionChange,
    onSuccess: (result) => {
      toast.success(result?.message || 'Den planlagte nedgraderingen er avbrutt');
      queryClient.invalidateQueries({ queryKey: ['my-subscription'] });
    },
    onError: (error: unknown) =>
      toast.error(errorMessage(error, 'Kunne ikke avbryte planendringen')),
  });
  const portalMutation = useMutation({
    mutationFn: openSubscriptionPortal,
    onSuccess: (result) => {
      if (result?.url) window.location.assign(result.url);
      else toast.error('Kunne ikke åpne betalingsadministrasjonen.');
    },
    onError: (error: unknown) =>
      toast.error(errorMessage(error, 'Kunne ikke åpne betalingsadministrasjonen')),
  });

  const transactions = data?.transactions || [];
  const totalPages = data?.totalPages || 1;
  const contacts = currentSubscription?.contacts;
  const includedProgress =
    contacts && contacts.includedLimit > 0
      ? Math.min(contacts.includedUsed / contacts.includedLimit, 1)
      : 0;

  const formatDateTime = (dateString: string) =>
    new Date(dateString).toLocaleString('nb-NO', { dateStyle: 'long', timeStyle: 'short' });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('no-NO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const status = currentSubscription?.status;
  const statusLabel = !currentSubscription?.stripeSubscriptionId
    ? null
    : status === 'past_due' || currentSubscription.stripeStatus === 'unpaid'
      ? 'Betaling forfalt'
      : status === 'expired'
        ? 'Utløpt'
        : status === 'cancelled'
          ? 'Avsluttet'
          : currentSubscription.cancelAtPeriodEnd
            ? 'Avsluttes ved periodens slutt'
            : status === 'inactive'
              ? 'Inaktiv'
              : 'Aktivt';
  const healthy = statusLabel === 'Aktivt';
  const TX_TYPE: Record<Transaction['type'], string> = {
    subscription: 'Abonnement',
    extra_contact: 'Ekstra kontakt',
    urgent: 'Hast',
  };

  // The same building blocks as SafePay-historikk (SafePayHistoryView, FinanceHistoryTabs).
  const CARD = 'rounded-xl border border-[#e6e7e1] bg-white p-4 sm:p-6';
  const PRIMARY =
    'inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#2E6641] px-4 py-2 text-sm font-semibold text-white hover:bg-[#255335] disabled:opacity-60';
  const OUTLINE =
    'inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#dfe3dc] bg-white px-4 py-2 text-sm font-semibold text-[#26332a] hover:bg-[#f6f7f3] disabled:opacity-60';

  return (
    <section className="flex w-full max-w-none flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-[20px] font-bold text-gray-900">Abonnementer</h2>
        <p className="text-[15px] font-normal leading-[1.4] text-[#555]">
          Planen din, kontaktene som følger med og det du har kjøpt.
        </p>
      </div>

      {/* Status, as SafePay's payout banner: one glance, one click to the plans. */}
      <button
        type="button"
        onClick={() => window.location.assign('/membership')}
        className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
          healthy
            ? 'border-green-200 bg-green-50 hover:bg-green-100'
            : statusLabel
              ? 'border-amber-200 bg-amber-50 hover:bg-amber-100'
              : 'border-[#e6e7e1] bg-white hover:bg-[#f6f7f3]'
        }`}
      >
        {healthy ? (
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-green-600" />
        ) : statusLabel ? (
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
        ) : (
          <Package size={20} className="mt-0.5 shrink-0 text-gray-500" />
        )}
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-0.5">
            <span
              className={`text-[14px] font-semibold ${healthy ? 'text-green-900' : statusLabel ? 'text-amber-900' : 'text-gray-900'}`}
            >
              {currentSubscription?.plan
                ? `${currentSubscription.plan}${statusLabel ? ` · ${statusLabel}` : ''}`
                : 'Ingen aktivt abonnement'}
            </span>
            <span
              className={`text-[13px] ${healthy ? 'text-green-800' : statusLabel ? 'text-amber-800' : 'text-gray-500'}`}
            >
              {status === 'past_due'
                ? 'Betalingen er forsinket. Oppdater betalingsmåten for å beholde abonnementet.'
                : currentSubscription?.plan
                  ? `Kontotype: ${currentSubscription.planType === 'business' ? 'bedrift' : 'privat'}`
                  : 'Velg en plan for flere kontakter og raskere tilgang til nye oppdrag.'}
            </span>
          </div>
          <span
            className={`flex w-fit shrink-0 items-center gap-1 text-[12px] font-semibold ${healthy ? 'text-green-700' : statusLabel ? 'text-amber-700' : 'text-[#2E6641]'}`}
          >
            {currentSubscription?.plan ? 'Administrer plan' : 'Se planer'}
            <ArrowRight size={13} />
          </span>
        </div>
      </button>

      {/* Current plan */}
      {currentSubscription?.stripeSubscriptionId && (
        <section className={`space-y-5 ${CARD}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-xl font-semibold tracking-tight text-[#17211a]">
                Gjeldende abonnement
              </h3>
              <p className="mt-1 text-sm leading-5 text-[#63665f]">
                {currentSubscription.price != null &&
                  `${currentSubscription.price.toLocaleString('nb-NO')} kr per måned`}
                {currentSubscription.price != null && currentSubscription.currentPeriodEnd && ' · '}
                {currentSubscription.currentPeriodEnd && (
                  <>
                    {currentSubscription.cancelAtPeriodEnd
                      ? 'Tilgang til'
                      : status === 'expired'
                        ? 'Utløpt'
                        : status === 'past_due'
                          ? 'Betalingsperiode slutt'
                          : 'Neste betaling'}{' '}
                    {formatDate(currentSubscription.currentPeriodEnd)}
                  </>
                )}
              </p>
            </div>
            <span
              className={`w-fit rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${
                healthy
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {currentSubscription.plan} · {statusLabel}
            </span>
          </div>

          {currentSubscription.pendingPlan && (
            <div className="flex items-start gap-2 rounded-xl border border-[#e6e7e1] bg-[#fbfcfa] p-3 text-sm text-[#26332a]">
              <CalendarDays size={16} className="mt-0.5 shrink-0 text-[#63665f]" />
              <span>
                Planlagt endring til {currentSubscription.pendingPlan.plan}{' '}
                {formatDate(currentSubscription.pendingPlan.effectiveAt)}. Du beholder{' '}
                {currentSubscription.plan} frem til da.
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.assign('/membership')}
              className={PRIMARY}
            >
              Endre abonnement
            </button>
            <button
              type="button"
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              className={OUTLINE}
            >
              {portalMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ExternalLink size={14} />
              )}
              Betalingsmåte og faktura
            </button>
            {currentSubscription.cancelAtPeriodEnd ? (
              <button
                type="button"
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
                className={OUTLINE}
              >
                {resumeMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RotateCcw size={14} />
                )}
                {currentSubscription.pendingPlan
                  ? 'Avbryt planlagt endring'
                  : 'Fortsett abonnement'}
              </button>
            ) : ['active', 'past_due'].includes(status || '') ? (
              <>
                {currentSubscription.pendingPlan && (
                  <ConfirmDialog
                    title="Avbryte planlagt nedgradering?"
                    description={`Abonnementet fortsetter på ${currentSubscription.plan}. Planendringen til ${currentSubscription.pendingPlan.plan} ${formatDate(currentSubscription.pendingPlan.effectiveAt)} blir avbrutt.`}
                    confirmText="Avbryt planlagt endring"
                    cancelText="Behold endringen"
                    onConfirm={() => cancelPendingPlanMutation.mutateAsync()}
                    trigger={
                      <button
                        type="button"
                        disabled={cancelPendingPlanMutation.isPending}
                        className={OUTLINE}
                      >
                        {cancelPendingPlanMutation.isPending && (
                          <Loader2 size={14} className="animate-spin" />
                        )}
                        Avbryt planlagt endring
                      </button>
                    }
                  />
                )}
                <ConfirmDialog
                  title="Si opp abonnementet?"
                  description={`Du beholder tilgangen til ${currentSubscription.currentPeriodEnd ? formatDate(currentSubscription.currentPeriodEnd) : 'ut den betalte perioden'}. Abonnementet fornyes ikke etter dette.`}
                  confirmText="Si opp abonnementet"
                  cancelText="Behold abonnementet"
                  variant="destructive"
                  onConfirm={() => cancelMutation.mutateAsync()}
                  trigger={
                    <button
                      type="button"
                      disabled={cancelMutation.isPending}
                      className="inline-flex min-h-10 items-center rounded-xl px-4 py-2 text-sm font-semibold text-[#b0453b] hover:bg-[#fcf4f3] disabled:opacity-60"
                    >
                      Si opp abonnement
                    </button>
                  }
                />
              </>
            ) : null}
          </div>
        </section>
      )}

      {/* Contacts, as SafePay's summary tiles */}
      {/* No plan, no contacts to show: nothing (it used to say "Laster…" for ever). */}
      {!isSubscriptionLoading && !contacts ? null : isSubscriptionLoading || !contacts ? (
        <div className="rounded-xl border border-dashed border-[#e6e7e1] bg-white py-8 text-center text-sm font-medium text-gray-500">
          Laster kontaktinformasjon...
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                [
                  Users,
                  'text-custom-green',
                  'Inkludert',
                  contacts.includedLimit,
                  'Kontakter denne perioden',
                ],
                [
                  UserCheck,
                  'text-[#16a34a]',
                  'Brukt',
                  contacts.includedUsed,
                  `${contacts.includedUsed} / ${contacts.includedLimit} brukt`,
                ],
                [
                  CreditCard,
                  'text-[#6b7280]',
                  'Igjen',
                  contacts.includedRemaining,
                  'Av de inkluderte',
                ],
                [
                  Wallet,
                  'text-[#E08835]',
                  'Ekstra kontakter',
                  contacts.paidAvailable,
                  `${contacts.paidPurchased} kjøpt · ${contacts.totalPaidForExtraContacts} NOK`,
                ],
              ] as const
            ).map(([Icon, color, label, value, hint]) => (
              <div key={label} className="min-w-0 rounded-xl border border-[#e6e7e1] bg-white p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Icon size={18} className={color} />
                  <span className="text-xs font-medium text-gray-500">{label}</span>
                </div>
                <p className="whitespace-nowrap text-lg font-semibold tabular-nums tracking-tight text-gray-900">
                  {value}
                </p>
                <p className="mt-1 text-[11px] text-gray-500">{hint}</p>
              </div>
            ))}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#eef0ea]">
            <div
              className="h-full rounded-full bg-[#2E6641]"
              style={{ width: `${includedProgress * 100}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-[#63665f]">
            <span>
              Ekstra kontakt:{' '}
              <strong className="text-gray-900">
                {contacts.perContactPrice === null
                  ? 'abonnement kreves'
                  : `${contacts.perContactPrice} NOK`}
              </strong>
            </span>
            {contacts.contactUnlockMinutes !== null && (
              <span>
                Tilgang til nye oppdrag:{' '}
                <strong className="text-gray-900">
                  {contacts.contactUnlockMinutes === 0
                    ? 'i sanntid'
                    : `etter ${contacts.contactUnlockMinutes} min`}
                </strong>
              </span>
            )}
            <span>
              Ekstra kontakter brukt: <strong className="text-gray-900">{contacts.paidUsed}</strong>
            </span>
          </div>
        </div>
      )}

      {/* Purchase history: the same cards as SafePay-historikk (SafePayHistoryView). */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="flex items-center gap-2 text-[18px] font-bold text-gray-900">
            <History size={20} className="text-[#63665f]" />
            Kjøpshistorikk
          </h3>
          <p className="text-[14px] text-[#555]">
            Abonnement, ekstra kontakter og Hast du har betalt for.
          </p>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#e6e7e1] bg-white py-12">
            <Loader2 className="mb-2 animate-spin text-[#2E6641]" size={28} />
            <p className="font-medium text-gray-500">Laster transaksjoner...</p>
          </div>
        ) : transactions.length > 0 ? (
          <>
            {transactions.map((tx: Transaction) => {
              const open = openTx === tx._id;
              const job = typeof tx.serviceId === 'object' ? tx.serviceId : null;
              const Icon =
                tx.type === 'urgent' ? Zap : tx.type === 'extra_contact' ? Users : Package;
              return (
                <div
                  key={tx._id}
                  className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => setOpenTx(open ? null : tx._id)}
                    aria-expanded={open}
                    className="w-full p-5 text-left transition-colors hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex flex-1 items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-custom-green-light">
                          <Icon size={24} className="text-custom-green" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-[16px] font-bold text-gray-900">
                            {tx.planName === null ? TX_TYPE[tx.type] : tx.planName}
                          </h4>
                          <p className="text-[14px] text-gray-500">
                            {tx.type === 'urgent'
                              ? job?.title
                                ? `Oppdrag: ${job.title}`
                                : 'Oppdraget ble ikke publisert'
                              : (TX_TYPE[tx.type] ?? tx.type)}
                          </p>
                          <p className="mt-1 text-[12px] text-gray-400">
                            {formatDate(tx.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-right">
                        <div>
                          <p
                            className={`whitespace-nowrap text-[18px] font-bold ${tx.status === 'refunded' ? 'text-gray-400 line-through' : 'text-gray-800'}`}
                          >
                            {tx.amount.toLocaleString('nb-NO')} kr
                          </p>
                          <div
                            className={`flex items-center justify-end gap-1 text-[12px] font-medium ${
                              tx.status === 'succeeded'
                                ? 'text-[#2E6641]'
                                : tx.status === 'refunded'
                                  ? 'text-gray-500'
                                  : 'text-amber-600'
                            }`}
                          >
                            {tx.status === 'succeeded' ? (
                              <CheckCircle2 size={14} />
                            ) : tx.status === 'refunded' ? (
                              <RotateCcw size={14} />
                            ) : (
                              <Clock size={14} />
                            )}
                            <span>
                              {tx.status === 'succeeded'
                                ? 'Fullført'
                                : tx.status === 'refunded'
                                  ? 'Refundert'
                                  : tx.status}
                            </span>
                          </div>
                        </div>
                        <ArrowRight
                          size={18}
                          className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
                        />
                      </div>
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-gray-100 bg-gray-50 p-5">
                      {tx.status === 'refunded' && (
                        <div className="mb-4 rounded-lg border border-[#e6e7e1] bg-white p-3 text-[14px]">
                          <p className="flex items-center gap-1.5 font-semibold text-gray-900">
                            <RotateCcw size={14} /> Refundert
                            {tx.refundedAt && (
                              <span className="font-normal text-gray-500">
                                · {formatDateTime(tx.refundedAt)}
                              </span>
                            )}
                          </p>
                          {tx.refundReason && (
                            <p className="mt-1 text-[13px] text-gray-600">
                              Hvorfor: {tx.refundReason}
                            </p>
                          )}
                          <p className="mt-1 text-[12px] text-gray-500">
                            Pengene går tilbake til kortet du betalte med, vanligvis innen 5–10
                            virkedager.
                          </p>
                        </div>
                      )}
                      <div className="space-y-3">
                        <h5 className="text-xs font-bold uppercase tracking-wide text-gray-600">
                          Betalingsdetaljer
                        </h5>
                        <div className="flex justify-between gap-3 text-[14px]">
                          <span className="text-gray-500">Betalt</span>
                          <span className="text-right font-medium text-gray-900">
                            {formatDateTime(tx.createdAt)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3 text-[14px]">
                          <span className="text-gray-500">Beløp</span>
                          <span className="font-medium tabular-nums text-gray-900">
                            {tx.amount.toLocaleString('nb-NO')} {tx.currency.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3 text-[14px]">
                          <span className="text-gray-500">Type</span>
                          <span className="font-medium text-gray-900">
                            {TX_TYPE[tx.type] ?? tx.type}
                          </span>
                        </div>
                        {tx.type === 'urgent' && (
                          <div className="flex justify-between gap-3 text-[14px]">
                            <span className="text-gray-500">Oppdrag</span>
                            {job ? (
                              <a
                                href={`/jobs/${job._id}`}
                                className="truncate text-right font-medium text-[#2E6641] hover:underline"
                              >
                                {job.title || 'Se oppdraget'}
                              </a>
                            ) : (
                              <span className="text-right font-medium text-gray-900">
                                Ikke publisert
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-1">
                <p className="text-sm font-medium text-gray-500">
                  Side <span className="text-gray-900">{page}</span> av{' '}
                  <span className="text-gray-900">{totalPages}</span>
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    title="Forrige side"
                    aria-label="Forrige side"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded-xl border border-[#dfe3dc] bg-white p-2 hover:bg-[#f6f7f3] disabled:opacity-30"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <button
                    type="button"
                    title="Neste side"
                    aria-label="Neste side"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="rounded-xl border border-[#dfe3dc] bg-white p-2 hover:bg-[#f6f7f3] disabled:opacity-30"
                  >
                    <ArrowRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-100 bg-white py-24">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl bg-gray-50">
              <CreditCard size={32} className="text-gray-200" strokeWidth={1.5} />
            </div>
            <p className="mb-2 text-lg font-bold text-gray-400">Ingen kjøpshistorikk ennå</p>
            <button
              type="button"
              onClick={() => window.location.assign('/membership')}
              className="text-sm font-semibold text-[#2E6641] hover:underline"
            >
              Se planer
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
