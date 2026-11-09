import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Flag,
  ImageOff,
  Shield,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  assignJobReport,
  fetchAdminJobReports,
  fetchAdminJobReportsSummary,
  REPORT_TYPE_LABELS,
  type AdminJobReportItem,
} from '../../api/admin/jobReports';
import { AdminDataTable, AdminFilterSelect, AdminPageHeader } from '../../components/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { StatCard } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
import { dateTime } from '@/lib/devFormat';
import { cn } from '@/lib/utils';
import { ReportStatus, ReportType } from './reportBadges';

const STATUS_TABS = [
  { label: 'Alle', value: '' },
  { label: 'Åpne', value: 'open' },
  { label: 'Under behandling', value: 'under_review' },
  { label: 'Løst', value: 'resolved' },
  { label: 'Avvist', value: 'dismissed' },
] as const;

const TYPE_OPTIONS = Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function PersonCell({ p }: { p: AdminJobReportItem['reportedBy'] }) {
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

export default function JobReportsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-job-reports', page, statusFilter, typeFilter],
    queryFn: () =>
      fetchAdminJobReports({
        page,
        limit: 20,
        ...(statusFilter && { status: statusFilter }),
        ...(typeFilter && { reportType: typeFilter }),
      }),
    staleTime: 30_000,
  });
  const summaryQuery = useQuery({
    queryKey: ['admin-job-reports', 'summary'],
    queryFn: fetchAdminJobReportsSummary,
    staleTime: 30_000,
  });
  const summary = summaryQuery.data;

  const assignMutation = useMutation({
    mutationFn: (id: string) => assignJobReport(id),
    onSuccess: () => {
      toast.success('Rapport tildelt til deg.');
      qc.invalidateQueries({ queryKey: ['admin-job-reports'] });
    },
    onError: () => toast.error('Tildeling mislyktes.'),
  });

  const columns: ColumnDef<AdminJobReportItem>[] = [
    {
      key: 'serviceId',
      header: 'Annonse',
      render: (r) => (
        <div className="flex min-w-[220px] items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
            {r.serviceId?.images?.[0] ? (
              <img src={r.serviceId.images[0]} alt="" className="size-full object-cover" />
            ) : (
              <ImageOff className="size-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            {r.serviceId ? (
              <Link
                to={`/dashboard/job-reports/${r._id}`}
                className="line-clamp-1 text-sm font-medium text-foreground hover:text-primary hover:underline"
              >
                {r.serviceId.title}
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">Slettet annonse</span>
            )}
            <p className="line-clamp-1 max-w-[260px] text-xs text-muted-foreground">
              “{r.description}”
            </p>
          </div>
        </div>
      ),
    },
    { key: 'reportType', header: 'Årsak', render: (r) => <ReportType type={r.reportType} /> },
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
        const isActive = !['resolved', 'dismissed'].includes(r.status);
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
              <Link
                to={`/dashboard/job-reports/${r._id}`}
                aria-label={`Åpne rapport ${r.serviceId?.title ?? ''}`}
              >
                <Eye aria-hidden="true" /> Åpne
              </Link>
            </Button>
          </div>
        );
      },
    },
  ];

  const count = (v: string) =>
    !summary ? null : v === '' ? summary.total : summary[v as keyof typeof summary];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Jobbrapporter"
        description="Brukere som har rapportert en annonse. Ta saken, se annonsen og løs eller avvis."
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
          label="Under behandling"
          value={summary?.under_review ?? 0}
          icon={<Shield />}
          tone="info"
          loading={summaryQuery.isLoading}
        />
        <StatCard
          label="Løst denne mnd"
          value={summary?.resolvedThisMonth ?? 0}
          icon={<CheckCircle2 />}
          tone="success"
          loading={summaryQuery.isLoading}
          hint={summary ? `${summary.resolved} løst totalt` : undefined}
        />
        <StatCard
          label="Avvist"
          value={summary?.dismissed ?? 0}
          icon={<XCircle />}
          loading={summaryQuery.isLoading}
          hint={summary ? `${summary.total} rapporter totalt` : undefined}
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
        emptyDescription="Det er ingen jobbrapporter som samsvarer med valgte filtre."
        pagination={data?.pagination}
        onPageChange={(p) => setPage(p)}
        toolbar={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1.5">
              {STATUS_TABS.map((t) => {
                const active = statusFilter === t.value;
                const n = count(t.value);
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
                    {t.value === 'open' && <Flag className="size-3" aria-hidden="true" />}
                    {t.value === 'under_review' && <Clock className="size-3" aria-hidden="true" />}
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
        }
      />
    </div>
  );
}
