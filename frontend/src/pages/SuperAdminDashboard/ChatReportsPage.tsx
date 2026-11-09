import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Flag,
  MessageSquare,
  Shield,
  Siren,
  UserCheck,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  assignChatReport,
  CHAT_REPORT_PRIORITY_LABELS,
  CHAT_REPORT_TYPE_LABELS,
  fetchAdminChatReports,
  fetchAdminChatReportsSummary,
  type AdminChatReportItem,
} from '../../api/admin/chats';
import { AdminDataTable, AdminFilterSelect, AdminPageHeader } from '../../components/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { StatCard } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
import { dateTime } from '@/lib/devFormat';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { cn } from '@/lib/utils';
import { Priority, ReportStatus, ReportType } from './reportBadges';

const STATUS_TABS = [
  { label: 'Alle', value: '', count: 'total' },
  { label: 'Åpne', value: 'open', count: 'open' },
  { label: 'Under behandling', value: 'under_review', count: 'under_review' },
  { label: 'Handling kreves', value: 'action_required', count: 'action_required' },
  { label: 'Venter på rapportør', value: 'waiting_for_reporter', count: 'waiting_for_reporter' },
  {
    label: 'Venter på rapportert',
    value: 'waiting_for_reported_user',
    count: 'waiting_for_reported_user',
  },
  { label: 'Løst', value: 'resolved', count: 'resolved' },
  { label: 'Avvist', value: 'dismissed', count: 'dismissed' },
] as const;

const options = (m: Record<string, string>) =>
  Object.entries(m).map(([value, label]) => ({ value, label }));
const TYPE_OPTIONS = options(CHAT_REPORT_TYPE_LABELS);
const PRIORITY_OPTIONS = options(CHAT_REPORT_PRIORITY_LABELS);

function PersonCell({ p }: { p: AdminChatReportItem['reportedBy'] }) {
  if (!p) return <span className="text-xs text-muted-foreground">Slettet bruker</span>;
  return (
    <div className="min-w-0">
      <Link
        to={`/dashboard/users/${p._id}`}
        className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
      >
        {p.name}
      </Link>
      <p className="truncate text-xs text-muted-foreground">{p.email}</p>
    </div>
  );
}

export default function ChatReportsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-chat-reports', page, statusFilter, priorityFilter, typeFilter],
    queryFn: () =>
      fetchAdminChatReports({
        page,
        limit: 20,
        ...(statusFilter && { status: statusFilter }),
        ...(priorityFilter && { priority: priorityFilter }),
        ...(typeFilter && { reportType: typeFilter }),
      }),
    staleTime: 30_000,
  });
  const summaryQuery = useQuery({
    queryKey: ['admin-chat-reports', 'summary'],
    queryFn: fetchAdminChatReportsSummary,
    staleTime: 30_000,
  });
  const summary = summaryQuery.data;

  const assignMutation = useMutation({
    mutationFn: (id: string) => assignChatReport(id),
    onSuccess: () => {
      toast.success('Rapport tildelt til deg.');
      qc.invalidateQueries({ queryKey: ['admin-chat-reports'] });
    },
    onError: (e) => toast.error(getErrorMessage(e, 'Tildeling mislyktes.')),
  });

  const columns: ColumnDef<AdminChatReportItem>[] = [
    {
      key: 'title',
      header: 'Rapport',
      render: (r) => (
        <div className="flex min-w-[240px] items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4',
              r.scope === 'message' ? 'bg-sky-50 text-sky-600' : 'bg-violet-50 text-violet-600'
            )}
            title={r.scope === 'message' ? 'Én melding' : 'Hele chatten'}
          >
            {r.scope === 'message' ? <MessageSquare /> : <Flag />}
          </span>
          <div className="min-w-0">
            <Link
              to={`/dashboard/chat-reports/${r._id}`}
              className="line-clamp-1 text-sm font-medium text-foreground hover:text-primary hover:underline"
            >
              {r.title}
            </Link>
            <p className="line-clamp-1 max-w-[280px] text-xs text-muted-foreground">
              {r.scope === 'message' ? 'Én melding · ' : 'Hele chatten · '}
              {r.description}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'reportType',
      header: 'Årsak',
      render: (r) => <ReportType type={r.reportType} chat />,
    },
    { key: 'priority', header: 'Prioritet', render: (r) => <Priority p={r.priority} /> },
    { key: 'reportedBy', header: 'Rapportert av', render: (r) => <PersonCell p={r.reportedBy} /> },
    {
      key: 'reportedUser',
      header: 'Rapportert bruker',
      render: (r) => <PersonCell p={r.reportedUser} />,
    },
    { key: 'status', header: 'Status', render: (r) => <ReportStatus s={r.status} /> },
    {
      key: 'assigned',
      header: 'Saksbehandler',
      render: (r) =>
        r.assignedAdminId ? (
          <span className="text-xs text-foreground">{r.assignedAdminId.name}</span>
        ) : (
          <span className="text-xs font-medium text-amber-600">Ikke tildelt</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'Mottatt',
      className: 'whitespace-nowrap text-xs text-muted-foreground',
      render: (r) => dateTime(r.createdAt),
    },
    {
      key: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      render: (r) => {
        const isActive = !['resolved', 'dismissed', 'closed'].includes(r.status);
        return (
          <div className="flex items-center justify-end gap-1.5">
            {isActive && !r.assignedAdminId && (
              <Button
                size="xs"
                onClick={() => assignMutation.mutate(r._id)}
                disabled={assignMutation.isPending}
              >
                <UserCheck aria-hidden="true" /> Ta sak
              </Button>
            )}
            <Button variant="outline" size="xs" asChild>
              <Link to={`/dashboard/chat-reports/${r._id}`} aria-label={`Åpne rapport ${r.title}`}>
                <Eye aria-hidden="true" /> Åpne
              </Link>
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Chatrapporter"
        description="Brukere som har rapportert en melding eller en hel chat. Ta saken, les chatten og avgjør."
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Åpne"
          value={summary?.open ?? 0}
          icon={<AlertTriangle />}
          tone="warning"
          loading={summaryQuery.isLoading}
          hint={summary ? `${summary.unassigned} ikke tildelt` : undefined}
        />
        <StatCard
          label="Haster"
          value={summary?.urgent ?? 0}
          icon={<Siren />}
          tone="danger"
          loading={summaryQuery.isLoading}
          hint={summary ? `${summary.high} med høy prioritet` : undefined}
        />
        <StatCard
          label="Under behandling"
          value={summary?.under_review ?? 0}
          icon={<Shield />}
          tone="info"
          loading={summaryQuery.isLoading}
          hint={summary ? `${summary.action_required} krever handling` : undefined}
        />
        <StatCard
          label="Avgjort denne mnd"
          value={summary?.resolvedThisMonth ?? 0}
          icon={<CheckCircle2 />}
          tone="success"
          loading={summaryQuery.isLoading}
          hint={
            summary ? `${summary.resolved} løst · ${summary.dismissed} avvist totalt` : undefined
          }
        />
      </section>

      <AdminDataTable
        columns={columns}
        data={data?.reports ?? []}
        keyExtractor={(r) => r._id}
        loading={isLoading}
        error={isError}
        onRetry={refetch}
        emptyTitle="Ingen rapporter"
        emptyDescription="Det er ingen chatrapporter som samsvarer med valgte filtre."
        pagination={data?.pagination}
        onPageChange={(p) => setPage(p)}
        toolbar={
          <div className="flex w-full flex-col gap-2">
            <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1.5">
              {STATUS_TABS.map((t) => {
                const active = statusFilter === t.value;
                const n = summary?.[t.count];
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setStatusFilter(t.value);
                      setPage(1);
                    }}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-card text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t.label}
                    {n != null && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 tabular-nums',
                          active ? 'bg-white/20' : 'bg-muted'
                        )}
                      >
                        {n}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <AdminFilterSelect
                value={priorityFilter}
                onChange={(v) => {
                  setPriorityFilter(v);
                  setPage(1);
                }}
                options={PRIORITY_OPTIONS}
                placeholder="Alle prioriteter"
              />
              <AdminFilterSelect
                value={typeFilter}
                onChange={(v) => {
                  setTypeFilter(v);
                  setPage(1);
                }}
                options={TYPE_OPTIONS}
                placeholder="Alle årsaker"
              />
            </div>
          </div>
        }
      />
    </div>
  );
}
