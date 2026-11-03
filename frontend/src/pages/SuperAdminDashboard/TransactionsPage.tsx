import { useState, useCallback, useRef } from 'react';
import { CreditCard, CheckCircle2, XCircle } from 'lucide-react';
import { useAdminTransactions } from '../../hooks/admin';
import type { AdminTransactionsQuery, AdminTransaction } from '../../api/admin';
import {
  AdminDataTable,
  AdminSearchInput,
  AdminFilterSelect,
  AdminStatusBadge,
  AdminPageHeader,
} from '../../components/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { StatCard } from '../../components/developer/kit';
import { Badge } from '../../components/developer/ui/badge';

const STATUS_OPTIONS = [
  { label: 'Venter', value: 'pending' },
  { label: 'Vellykket', value: 'succeeded' },
  { label: 'Feilet', value: 'failed' },
  { label: 'Refundert', value: 'refunded' },
];
const TYPE_OPTIONS = [
  { label: 'Abonnement', value: 'subscription' },
  { label: 'Ekstra kontakter', value: 'extra_contact' },
  { label: 'Hast', value: 'urgent' },
];

export default function TransactionsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 400);
  }, []);

  const query: AdminTransactionsQuery = {
    page,
    limit: 15,
    search: debouncedSearch,
    ...(statusFilter && { status: statusFilter }),
    ...(typeFilter && { type: typeFilter }),
    sortOrder: 'desc',
  };

  const { data, isLoading, isError, refetch } = useAdminTransactions(query);

  const columns: ColumnDef<AdminTransaction>[] = [
    {
      key: 'user',
      header: 'Bruker',
      render: (t) => (
        <div>
          <p className="text-sm font-medium text-foreground">{t.userId?.name ?? '–'}</p>
          <p className="text-xs text-muted-foreground">{t.userId?.email ?? ''}</p>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (t) => (
        <div>
          <p className="text-sm text-foreground">{t.planName}</p>
          <p className="text-xs text-muted-foreground capitalize">{t.planType}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (t) => (
        <Badge variant="outline">
          {t.type === 'subscription'
            ? 'Abonnement'
            : t.type === 'urgent'
              ? 'Hast'
              : 'Ekstra kontakter'}
        </Badge>
      ),
    },
    {
      key: 'amount',
      header: 'Beløp',
      render: (t) => (
        <div>
          <p className="text-sm font-medium tabular-nums text-foreground">
            {t.amount.toLocaleString('nb-NO')} {t.currency.toUpperCase()}
          </p>
          {t.discountAmount > 0 && (
            <p className="text-xs text-emerald-600">
              -{t.discountAmount.toLocaleString('nb-NO')} rabatt
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => <AdminStatusBadge status={t.status} />,
    },
    {
      key: 'refunded',
      header: 'Refundert',
      render: (t) => (
        <span className={`text-xs ${t.refunded ? 'text-foreground' : 'text-muted-foreground'}`}>
          {t.refunded ? 'Ja' : 'Nei'}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Dato',
      render: (t) =>
        new Date(t.createdAt).toLocaleDateString('nb-NO', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
    },
  ];

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Transaksjoner"
        description="Alle betalingstransaksjoner — ingen sensitive betalingsdata vises"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Totalt"
          icon={<CreditCard />}
          loading={isLoading}
          value={data?.pagination.total ?? '–'}
        />
        <StatCard
          label="Denne siden"
          icon={<CreditCard />}
          tone="info"
          loading={isLoading}
          value={data?.transactions.length ?? '–'}
        />
        <StatCard
          label="Vellykket"
          icon={<CheckCircle2 />}
          tone="success"
          loading={isLoading}
          value={data?.transactions.filter((t) => t.status === 'succeeded').length ?? '–'}
        />
        <StatCard
          label="Feilet"
          icon={<XCircle />}
          tone="danger"
          loading={isLoading}
          value={data?.transactions.filter((t) => t.status === 'failed').length ?? '–'}
        />
      </div>

      <AdminDataTable
        columns={columns}
        data={data?.transactions ?? []}
        keyExtractor={(t) => t._id}
        loading={isLoading}
        error={isError}
        onRetry={refetch}
        emptyTitle="Ingen transaksjoner"
        emptyDescription="Ingen transaksjoner matcher søket."
        pagination={data?.pagination}
        onPageChange={setPage}
        toolbar={
          <div className="flex flex-wrap gap-2 w-full">
            <AdminSearchInput
              value={search}
              onChange={handleSearchChange}
              placeholder="Søk på plannavn eller kupong..."
              className="flex-1 min-w-[200px]"
            />
            <AdminFilterSelect
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
              placeholder="Alle statuser"
            />
            <AdminFilterSelect
              value={typeFilter}
              onChange={(v) => {
                setTypeFilter(v);
                setPage(1);
              }}
              options={TYPE_OPTIONS}
              placeholder="Alle typer"
            />
          </div>
        }
      />
    </div>
  );
}
