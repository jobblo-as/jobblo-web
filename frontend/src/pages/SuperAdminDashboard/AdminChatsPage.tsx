import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Copy, CheckCircle2, Eye, MessageSquare } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { fetchAdminChats } from '../../api/admin/chats';
import type { AdminChatSummary } from '../../api/admin/chats';
import {
  AdminDataTable,
  AdminFilterSelect,
  AdminStatusBadge,
  AdminPageHeader,
  AdminSearchInput,
} from '../../components/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { StatusBadge } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';

const STATUS_OPTIONS = [
  { label: 'Forespurt', value: 'requested' },
  { label: 'Avtalt', value: 'agreed' },
  { label: 'Betalt', value: 'paid' },
  { label: 'Kontraktert', value: 'contracted' },
  { label: 'Pågår', value: 'in_progress' },
  { label: 'Fullført', value: 'completed' },
  { label: 'Tvist', value: 'disputed' },
  { label: 'Avbrutt', value: 'cancelled' },
];

const REPORTED_OPTIONS = [
  { label: 'Rapportert', value: 'true' },
  { label: 'Ikke rapportert', value: 'false' },
];

const SAFEPAY_OPTIONS = [
  { label: 'SafePay tilknyttet', value: 'true' },
  { label: 'Ikke tilknyttet', value: 'false' },
];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          toast.success('Chat ID kopiert');
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label="Kopier Chat ID"
      title="Kopier Chat ID"
    >
      {copied ? <CheckCircle2 className="text-emerald-600" /> : <Copy />}
    </Button>
  );
}

export default function AdminChatsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [reportedFilter, setReportedFilter] = useState('');
  const [safePayFilter, setSafePayFilter] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-chats', page, search, statusFilter, reportedFilter, safePayFilter],
    queryFn: () =>
      fetchAdminChats({
        page,
        limit: 20,
        ...(/^[a-f\d]{24}$/i.test(search.trim())
          ? { chatId: search.trim() }
          : search.trim() && { search: search.trim() }),
        ...(statusFilter && { status: statusFilter }),
        ...(reportedFilter && { reported: reportedFilter as 'true' | 'false' }),
        ...(safePayFilter && { safePayLinked: safePayFilter as 'true' | 'false' }),
      }),
    staleTime: 30_000,
  });

  const columns: ColumnDef<AdminChatSummary>[] = [
    {
      key: 'chatId',
      header: 'Chat ID',
      render: (c) => (
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs text-muted-foreground">
            {c._id.slice(0, 8)}…{c._id.slice(-4)}
          </span>
          <CopyButton value={c._id} />
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Kunde',
      render: (c) => {
        const u = c.clientId;
        return u ? (
          <div>
            <p className="text-sm text-foreground">{u.name}</p>
            <p className="text-xs text-muted-foreground">{u.email}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">–</span>
        );
      },
    },
    {
      key: 'provider',
      header: 'Tilbyder',
      render: (c) => {
        const u = c.providerId;
        return u ? (
          <div>
            <p className="text-sm text-foreground">{u.name}</p>
            <p className="text-xs text-muted-foreground">{u.email}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">–</span>
        );
      },
    },
    {
      key: 'service',
      header: 'Tjeneste',
      render: (c) =>
        c.serviceId ? (
          <span className="text-sm truncate max-w-[120px] block">{c.serviceId.title}</span>
        ) : (
          <span className="text-muted-foreground">–</span>
        ),
    },
    {
      key: 'orderId',
      header: 'Ordre-ID',
      render: (c) => {
        const orderId = typeof c.orderId === 'object' ? c.orderId?._id : c.orderId;
        return orderId ? (
          <Link
            to={`/dashboard/orders/${orderId}`}
            className="font-mono text-xs text-primary hover:underline"
          >
            {orderId.slice(-8).toUpperCase()}
          </Link>
        ) : (
          <span className="text-muted-foreground">–</span>
        );
      },
    },
    {
      key: 'status',
      header: 'Chat-status',
      render: (c) => <AdminStatusBadge status={c.status} />,
    },
    {
      key: 'reportCount',
      header: 'Rapporter',
      render: (c) =>
        c.reportCount > 0 ? (
          <StatusBadge status="reported" tone="danger" label={String(c.reportCount)} />
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'Opprettet',
      render: (c) =>
        new Date(c.createdAt).toLocaleDateString('nb-NO', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
    },
    {
      key: 'actions',
      header: 'Handlinger',
      className: 'whitespace-nowrap',
      render: (c) => (
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="xs"
            onClick={() => navigate(`/dashboard/chats/${c._id}`)}
            aria-label="Se chat"
          >
            <Eye aria-hidden="true" /> Se chat
          </Button>
          <Button variant="outline" size="xs" asChild>
            <Link to={`/dashboard/chat-review?chatId=${c._id}`}>
              <MessageSquare aria-hidden="true" /> Gjennomgå
            </Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Chatter"
        description="Søk og administrer samtaler mellom kunder og tilbydere"
      />

      <AdminDataTable
        columns={columns}
        data={data?.chats ?? []}
        keyExtractor={(c) => c._id}
        loading={isLoading}
        error={isError}
        onRetry={refetch}
        emptyTitle="Ingen chatter"
        emptyDescription="Ingen chatter samsvarer med valgte filtre."
        pagination={data?.pagination}
        onPageChange={(p) => setPage(p)}
        toolbar={
          <div className="flex w-full flex-wrap gap-2">
            <AdminSearchInput
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Søk på Chat ID, oppdrag, navn eller e-post…"
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
              value={reportedFilter}
              onChange={(v) => {
                setReportedFilter(v);
                setPage(1);
              }}
              options={REPORTED_OPTIONS}
              placeholder="Rapporteringsstatus"
            />
            <AdminFilterSelect
              value={safePayFilter}
              onChange={(v) => {
                setSafePayFilter(v);
                setPage(1);
              }}
              options={SAFEPAY_OPTIONS}
              placeholder="SafePay-tilknytning"
            />
          </div>
        }
      />
    </div>
  );
}
