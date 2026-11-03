import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Banknote,
  Clock3,
  DollarSign,
  RefreshCw,
} from 'lucide-react';
import { nb } from 'date-fns/locale';
import { useSafePayFinanceSummary, useSafePayList } from '../../hooks/admin/safepay';
import type { SafePayContract, SafePayFinanceSummary } from '../../types/admin/safepay';
import {
  AdminErrorState,
  AdminFilterSelect,
  AdminLoadingSkeleton,
  AdminPageHeader,
  AdminSearchInput,
  AdminStatusBadge,
} from '../../components/admin';
import { AdminPagination } from '../../components/admin/AdminPagination';
import { ChatIdCell } from '../../components/admin/chat/ChatIdCell';
import { Section, StatCard, StatusBadge } from '../../components/developer/kit';
import { DataTable, type Column } from '../../components/developer/DataTable';
import { Badge } from '../../components/developer/ui/badge';
import { Button } from '../../components/developer/ui/button';
import { Calendar } from '../../components/developer/ui/calendar';
import { Card, CardContent } from '../../components/developer/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/developer/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/developer/ui/select';
const STATUS_OPTIONS = [
  { label: 'Venter betaling', value: 'awaiting_payment' },
  { label: 'Betalt', value: 'paid' },
  { label: 'Pågår', value: 'in_progress' },
  { label: 'Fullført', value: 'completed' },
  { label: 'Avbrutt', value: 'cancelled' },
  { label: 'Tvist', value: 'disputed' },
];

const PAYMENT_OPTIONS = [
  { label: 'Ubetalt', value: 'unpaid' },
  { label: 'Venter', value: 'pending' },
  { label: 'Betalt', value: 'paid' },
  { label: 'Refundert', value: 'refunded' },
];

type FinanceMetric = {
  key: string;
  currency: string;
  liveMode?: boolean;
  transferredAmount: number;
  transferredCount: number;
  pendingAmount: number;
  pendingCount: number;
  feeAmount: number;
};

function financeMetrics(summary?: SafePayFinanceSummary): FinanceMetric[] {
  if (!summary) return [];
  const scopes = new Map<string, FinanceMetric>();
  const getScope = (currency: string, liveMode?: boolean) => {
    const key = `${currency}:${liveMode ?? 'unknown'}`;
    if (!scopes.has(key)) {
      scopes.set(key, {
        key,
        currency,
        liveMode,
        transferredAmount: 0,
        transferredCount: 0,
        pendingAmount: 0,
        pendingCount: 0,
        feeAmount: 0,
      });
    }
    return scopes.get(key)!;
  };
  const settledStatuses = new Set(['transferred', 'partially_reversed', 'fully_reversed']);

  summary.transfers.forEach((group) => {
    const metric = getScope(group._id.currency, group._id.mode);
    if (settledStatuses.has(group._id.status ?? '')) {
      metric.transferredAmount += group.amount;
      metric.transferredCount += group.count;
      metric.feeAmount += group.jobbloFee ?? 0;
    }
  });
  summary.pendingTransfers.forEach((group) => {
    const metric = getScope(group._id.currency, group._id.mode);
    metric.pendingAmount += group.amount;
    metric.pendingCount += group.count;
  });
  return Array.from(scopes.values()).sort(
    (a, b) => a.currency.localeCompare(b.currency) || Number(a.liveMode) - Number(b.liveMode)
  );
}

function formatMinor(amount: number, currency: string) {
  const code = currency.toUpperCase();
  const formatter = new Intl.NumberFormat('nb-NO', { style: 'currency', currency: code });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amount / 10 ** fractionDigits);
}

function formatNok(amount: number) {
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency: 'NOK',
    maximumFractionDigits: 2,
  }).format(amount);
}

function FinanceMetricCard({
  title,
  icon,
  metrics,
  amount,
  count,
  countLabel,
  mode,
}: {
  title: string;
  icon: ReactNode;
  metrics: FinanceMetric[];
  amount: (metric: FinanceMetric) => number;
  count: (metric: FinanceMetric) => number;
  countLabel: string;
  mode: SafePayFinanceSummary['mode'];
}) {
  return (
    <StatCard
      label={`${title}${mode === 'all' ? '' : ` · ${mode === 'live' ? 'Live' : 'Test'}`}`}
      icon={icon}
      value={
        metrics.length ? (
          <div className="space-y-0.5">
            {metrics.map((metric) => (
              <div
                key={metric.key}
                className="flex flex-wrap items-baseline justify-between gap-x-3"
              >
                <span>{formatMinor(amount(metric), metric.currency)}</span>
                <span className="text-xs font-normal tracking-normal text-muted-foreground">
                  {mode === 'all'
                    ? `${metric.liveMode === undefined ? 'Ukjent modus' : metric.liveMode ? 'Live' : 'Test'} · `
                    : ''}
                  {metric.currency.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          '–'
        )
      }
      hint={
        metrics.length
          ? `${metrics.reduce((total, metric) => total + count(metric), 0).toLocaleString('nb-NO')} ${countLabel}`
          : 'Ingen finansposter registrert ennå.'
      }
    />
  );
}

function parseLocalDate(value: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dateInputValue(value?: Date) {
  if (!value) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateLabel(value: string, placeholder: string) {
  const selected = parseLocalDate(value);
  return selected
    ? selected.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })
    : placeholder;
}

function isPastConnectDeadline(contract: SafePayContract) {
  return (
    contract.paymentStatus === 'paid' &&
    !contract.startedAt &&
    !!contract.providerConnectDeadlineAt &&
    new Date(contract.providerConnectDeadlineAt).getTime() <= Date.now()
  );
}

function FollowUpStatus({ contract }: { contract: SafePayContract }) {
  const status = contract.providerConnectTimeout?.status;
  if (status) return <AdminStatusBadge status={status} />;
  if (isPastConnectDeadline(contract)) {
    return <AdminStatusBadge status="deadline_expired" />;
  }
  return <span className="text-sm text-muted-foreground">–</span>;
}

function FollowUpPanel({
  contracts,
  total,
  loading,
  error,
  onRetry,
}: {
  contracts: SafePayContract[];
  total: number;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (!loading && !error && total === 0) return null;

  return (
    <section aria-labelledby="safepay-followup-title">
      <Section
        title={
          <span id="safepay-followup-title" className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600" />
            Krever oppfølging
          </span>
        }
        description="Kun aktive Connect-frister og refusjonssaker fra SafePay-dataene."
        action={
          !loading &&
          !error &&
          total > 0 && <StatusBadge status="open" tone="warning" label={`${total} saker`} />
        }
      >
        {loading ? (
          <AdminLoadingSkeleton rows={2} />
        ) : error ? (
          <div className="flex items-center gap-3 rounded-md border border-red-200/70 bg-red-50/40 px-3 py-2 text-sm text-red-700">
            <span className="flex-1">Oppfølgingssaker kunne ikke lastes.</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Prøv igjen
            </Button>
          </div>
        ) : (
          <>
            <ul className="divide-y rounded-md border">
              {contracts.map((contract) => (
                <li
                  key={contract._id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/dashboard/safepay/${contract._id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      #{contract._id.slice(-8).toUpperCase()}
                    </Link>
                    <p className="truncate text-sm text-foreground">
                      {contract.serviceId?.title ?? 'Tjeneste ikke tilgjengelig'}
                      {contract.providerId?.name ? ` · ${contract.providerId.name}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <FollowUpStatus contract={contract} />
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/dashboard/safepay/${contract._id}`}>Se sak</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {total > contracts.length && (
              <Button variant="ghost" size="sm" className="mt-2" asChild>
                <Link to="/dashboard/safepay?timeoutReview=true">
                  Vis alle {total} oppfølgingssaker
                </Link>
              </Button>
            )}
          </>
        )}
      </Section>
    </section>
  );
}

export default function SafePayPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [timeoutReview, setTimeoutReview] = useState(() =>
    searchParams.get('timeoutReview') === 'true' ? 'true' : ''
  );
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [fromDateOpen, setFromDateOpen] = useState(false);
  const [toDateOpen, setToDateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [financeMode, setFinanceMode] = useState<SafePayFinanceSummary['mode']>('all');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isFetching, isError, refetch } = useSafePayList({
    page,
    limit: 15,
    sortOrder,
    ...(statusFilter && { status: statusFilter }),
    ...(paymentFilter && { paymentStatus: paymentFilter }),
    ...(timeoutReview && { timeoutReview }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
    ...(debouncedSearch && { orderId: debouncedSearch }),
  });
  const attention = useSafePayList({ page: 1, limit: 4, timeoutReview: 'true' });
  const {
    data: financeSummary,
    isLoading: financeSummaryLoading,
    isError: financeSummaryError,
    refetch: refetchFinanceSummary,
  } = useSafePayFinanceSummary(financeMode);
  const financeData = financeMetrics(financeSummary);

  const clearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setStatusFilter('');
    setPaymentFilter('');
    setTimeoutReview('');
    setSearchParams({});
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const activeFilterCount = [
    statusFilter,
    paymentFilter,
    timeoutReview,
    dateFrom,
    dateTo,
    debouncedSearch,
  ].filter(Boolean).length;

  const columns: Column<SafePayContract>[] = [
    {
      key: 'contract',
      header: (
        <button
          type="button"
          onClick={() => setSortOrder((order) => (order === 'desc' ? 'asc' : 'desc'))}
          className="inline-flex items-center gap-1.5 hover:text-foreground"
          aria-label={`Sorter etter opprettet dato (${sortOrder === 'desc' ? 'nyeste først' : 'eldste først'})`}
        >
          Kontrakt
          {sortOrder === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}
        </button>
      ),
      cell: (contract) => (
        <div className="min-w-[108px]">
          <Link
            to={`/dashboard/safepay/${contract._id}`}
            className="font-mono text-xs text-primary hover:underline"
          >
            #{contract._id.slice(-8).toUpperCase()}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {new Date(contract.createdAt).toLocaleDateString('nb-NO')}
          </p>
        </div>
      ),
    },
    {
      key: 'service',
      header: 'Tjeneste',
      cell: (contract) => (
        <div className="min-w-0">
          <p className="max-w-[220px] truncate text-sm font-medium text-foreground">
            {contract.serviceId?.title ?? '–'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Chat <ChatIdCell chatId={contract.chatId} reviewSource="safepay" />
          </p>
        </div>
      ),
    },
    {
      key: 'participants',
      header: 'Kunde / tilbyder',
      cell: (contract) => (
        <div className="min-w-[160px] space-y-1">
          <p className="truncate text-sm text-foreground">
            {contract.customerId?.name ?? 'Kunde –'}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {contract.providerId?.name ?? 'Tilbyder –'}
          </p>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Avtalt pris',
      cell: (contract) => (
        <div className="whitespace-nowrap">
          <p className="text-sm tabular-nums text-foreground">
            {contract.agreedPrice != null ? formatNok(contract.agreedPrice) : '–'}
          </p>
          {contract.fee != null && (
            <p className="mt-0.5 text-xs text-muted-foreground">Gebyr {formatNok(contract.fee)}</p>
          )}
        </div>
      ),
    },
    {
      key: 'orderStatus',
      header: 'Ordre',
      cell: (contract) => <AdminStatusBadge status={contract.status} />,
    },
    {
      key: 'paymentStatus',
      header: 'Betaling',
      cell: (contract) => <AdminStatusBadge status={contract.paymentStatus} />,
    },
    {
      key: 'connect',
      header: 'Connect-konto',
      cell: (contract) =>
        contract.safePayStatus?.providerConnectStatus ? (
          <AdminStatusBadge status={contract.safePayStatus.providerConnectStatus} />
        ) : (
          <span className="text-sm text-muted-foreground">–</span>
        ),
    },
    {
      key: 'refund',
      header: 'Refusjon',
      cell: (contract) =>
        contract.safePayStatus?.refundStatus && contract.safePayStatus.refundStatus !== 'none' ? (
          <AdminStatusBadge status={contract.safePayStatus.refundStatus} />
        ) : (
          <span className="text-sm text-muted-foreground">–</span>
        ),
    },
    {
      key: 'followUp',
      header: 'Frist / oppfølging',
      cell: (contract) => <FollowUpStatus contract={contract} />,
    },
    {
      key: 'dispute',
      header: 'Tvist',
      cell: (contract) =>
        contract.dispute ? (
          <Link
            to={`/dashboard/disputes/${contract.dispute._id}`}
            className="inline-flex items-center gap-1.5 hover:opacity-80"
          >
            <AlertTriangle className="size-3.5 text-red-600" />
            <AdminStatusBadge status={contract.dispute.status} />
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">–</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (contract) => (
        <Button variant="outline" size="sm" className="bg-card" asChild>
          <Link to={`/dashboard/safepay/${contract._id}`}>Detaljer</Link>
        </Button>
      ),
    },
  ];

  const reload = () => {
    void refetch();
    void refetchFinanceSummary();
    void attention.refetch();
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="SafePay"
        description="Oversikt over kontrakter, innbetalinger og oppfølging."
        actions={
          <>
            <Select
              value={financeMode}
              onValueChange={(value) => setFinanceMode(value as SafePayFinanceSummary['mode'])}
            >
              <SelectTrigger size="sm" className="w-36 bg-card" aria-label="Stripe-modus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">Test + live</SelectItem>
                <SelectItem value="test">Test</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={reload}
              disabled={isFetching || financeSummaryLoading}
              className="bg-card"
            >
              <RefreshCw className={isFetching ? 'animate-spin' : ''} />
              Oppdater
            </Button>
          </>
        }
      />

      <section aria-label="SafePay nøkkeltall" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {financeSummaryLoading ? (
          Array.from({ length: 3 }, (_, index) => (
            <StatCard key={index} label="Laster…" value="" loading />
          ))
        ) : financeSummaryError ? (
          <Card className="border-red-200/70 bg-red-50/40 sm:col-span-2 lg:col-span-3" role="alert">
            <CardContent className="flex items-center gap-3 text-sm text-red-700">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="flex-1">Finansoversikten kunne ikke lastes.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void refetchFinanceSummary();
                }}
              >
                Prøv igjen
              </Button>
            </CardContent>
          </Card>
        ) : (
          financeSummary && (
            <>
              <FinanceMetricCard
                title="Overført til Stripe Connect"
                icon={<Banknote />}
                metrics={financeData}
                amount={(metric) => metric.transferredAmount}
                count={(metric) => metric.transferredCount}
                countLabel="bekreftede overføringer"
                mode={financeMode}
              />
              <FinanceMetricCard
                title="Avventer overføring"
                icon={<Clock3 />}
                metrics={financeData}
                amount={(metric) => metric.pendingAmount}
                count={(metric) => metric.pendingCount}
                countLabel="oppdrag"
                mode={financeMode}
              />
              <FinanceMetricCard
                title="Jobblo-gebyrer"
                icon={<DollarSign />}
                metrics={financeData}
                amount={(metric) => metric.feeAmount}
                count={(metric) => metric.transferredCount}
                countLabel="bekreftede overføringer"
                mode={financeMode}
              />
            </>
          )
        )}
      </section>

      <FollowUpPanel
        contracts={attention.data?.contracts ?? []}
        total={attention.data?.pagination?.total ?? 0}
        loading={attention.isLoading}
        error={attention.isError}
        onRetry={() => {
          void attention.refetch();
        }}
      />

      <section aria-label="SafePay-kontrakter">
        <Section
          title="Kontrakter"
          description="Filtrer og undersøk betalings- og oppfølgingsstatus."
          action={
            data?.pagination && (
              <span className="text-xs text-muted-foreground">{data.pagination.total} treff</span>
            )
          }
          contentClassName="space-y-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <AdminSearchInput
              value={search}
              onChange={setSearch}
              placeholder="Søk etter ordre-ID"
              className="min-w-[200px] flex-1"
            />
            <AdminFilterSelect
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
              placeholder="Alle statuser"
            />
            <AdminFilterSelect
              value={paymentFilter}
              onChange={(value) => {
                setPaymentFilter(value);
                setPage(1);
              }}
              options={PAYMENT_OPTIONS}
              placeholder="Alle betalinger"
            />
            <AdminFilterSelect
              value={timeoutReview}
              onChange={(value) => {
                setTimeoutReview(value);
                setSearchParams(value ? { timeoutReview: value } : {});
                setPage(1);
              }}
              options={[{ label: 'Krever oppfølging', value: 'true' }]}
              placeholder="Connect / refusjon"
            />
            <Popover open={fromDateOpen} onOpenChange={setFromDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  aria-label="Fra dato"
                  className="w-36 justify-between bg-card font-normal"
                >
                  <span className={dateFrom ? '' : 'text-muted-foreground'}>
                    {dateLabel(dateFrom, 'Fra dato')}
                  </span>
                  <CalendarDays className="text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" collisionPadding={12} className="w-auto p-0">
                <Calendar
                  mode="single"
                  locale={nb}
                  selected={parseLocalDate(dateFrom)}
                  disabled={dateTo ? { after: parseLocalDate(dateTo)! } : undefined}
                  onSelect={(value) => {
                    setDateFrom(dateInputValue(value));
                    setPage(1);
                    setFromDateOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
            <Popover open={toDateOpen} onOpenChange={setToDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  aria-label="Til dato"
                  className="w-36 justify-between bg-card font-normal"
                >
                  <span className={dateTo ? '' : 'text-muted-foreground'}>
                    {dateLabel(dateTo, 'Til dato')}
                  </span>
                  <CalendarDays className="text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" collisionPadding={12} className="w-auto p-0">
                <Calendar
                  mode="single"
                  locale={nb}
                  selected={parseLocalDate(dateTo)}
                  disabled={dateFrom ? { before: parseLocalDate(dateFrom)! } : undefined}
                  onSelect={(value) => {
                    setDateTo(dateInputValue(value));
                    setPage(1);
                    setToDateOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              disabled={activeFilterCount === 0}
            >
              Nullstill filtre
            </Button>
          </div>
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-2" aria-label="Aktive filtre">
              {debouncedSearch && <Badge variant="secondary">Søk: {debouncedSearch}</Badge>}
              {statusFilter && <Badge variant="secondary">Ordre:{' '}{STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label ?? statusFilter}</Badge>}
              {paymentFilter && <Badge variant="secondary">Betaling:{' '}{PAYMENT_OPTIONS.find((option) => option.value === paymentFilter)?.label ?? paymentFilter}</Badge>}
              {timeoutReview && <Badge variant="secondary">Connect / refusjon: Krever oppfølging</Badge>}
              {dateFrom && <Badge variant="secondary">Fra: {dateLabel(dateFrom, 'Fra dato')}</Badge>}
              {dateTo && <Badge variant="secondary">Til: {dateLabel(dateTo, 'Til dato')}</Badge>}
            </div>
          )}

          {isError ? (
            <AdminErrorState onRetry={refetch} />
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={data?.contracts}
                loading={isLoading}
                rowKey={(contract) => contract._id}
                emptyTitle={activeFilterCount ? 'Ingen treff' : 'Ingen SafePay-kontrakter'}
                emptyDescription={
                  activeFilterCount
                    ? 'Prøv å endre eller nullstille filtrene.'
                    : 'SafePay-kontrakter vises her når de opprettes.'
                }
              />
              {!isLoading && !data?.contracts.length && activeFilterCount > 0 && (
                <div className="text-center">
                  <Button variant="outline" size="sm" className="bg-card" onClick={clearFilters}>
                    Nullstill filtre
                  </Button>
                </div>
              )}
              {!isLoading && !!data?.contracts.length && data.pagination && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Connect viser kontotilkobling, ikke en bankutbetaling. Status for overføring
                    til bank er ikke tilgjengelig i SafePay-dataene.
                  </p>
                  <AdminPagination pagination={data.pagination} onPageChange={setPage} />
                </>
              )}
            </>
          )}
        </Section>
      </section>
    </div>
  );
}
