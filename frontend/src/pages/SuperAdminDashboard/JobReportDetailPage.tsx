import { useState, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  Flag,
  Gavel,
  ImageOff,
  MapPin,
  RotateCcw,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  fetchAdminJobReportById,
  assignJobReport,
  updateJobReportStatus,
  type AdminJobReportItem,
} from '../../api/admin/jobReports';
import { AdminConfirmDialog } from '../../components/admin';
import { EmptyState, ErrorState, Section, StatusBadge } from '../../components/developer/kit';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/developer/ui/avatar';
import { Badge } from '../../components/developer/ui/badge';
import { Button } from '../../components/developer/ui/button';
import { Skeleton } from '../../components/developer/ui/skeleton';
import { Textarea } from '../../components/developer/ui/textarea';
import { dateTime } from '@/lib/devFormat';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { ReportStatus, ReportType } from './reportBadges';

const ACCOUNT: Record<string, string> = {
  active: 'Aktiv',
  suspended: 'Suspendert',
  banned: 'Utestengt',
  deleted: 'Slettet',
};

const SERVICE_STATUS: Record<string, string> = {
  open: 'Åpen',
  closed: 'Lukket',
  in_progress: 'Pågår',
  completed: 'Fullført',
  cancelled: 'Kansellert',
};

type Person = AdminJobReportItem['reportedBy'] & { verified?: boolean };

function PersonCard({ title, p, extra }: { title: string; p: Person | null; extra?: ReactNode }) {
  const initials = (p?.name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <Section title={title}>
      {p ? (
        <div className="space-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-10">
              <AvatarImage src={p.avatarUrl} alt="" />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <Link
                to={`/dashboard/users/${p._id}`}
                className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
              >
                {p.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{p.email}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="capitalize">
              {p.role ?? 'user'}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                p.accountStatus && p.accountStatus !== 'active' && 'border-red-200 text-red-700'
              )}
            >
              {ACCOUNT[p.accountStatus ?? 'active'] ?? p.accountStatus}
            </Badge>
            {p.verified && (
              <Badge variant="outline" className="border-emerald-200 text-emerald-700">
                Verifisert
              </Badge>
            )}
            {extra}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Bruker slettet</p>
      )}
    </Section>
  );
}

/** Mottatt → tatt av admin → avgjort. */
function Progress({
  createdAt,
  assignee,
  status,
  resolvedAt,
}: {
  createdAt: string;
  assignee?: string;
  status: string;
  resolvedAt?: string | null;
}) {
  const closed = status === 'resolved' || status === 'dismissed';
  const steps = [
    { label: 'Mottatt', sub: dateTime(createdAt), done: true, icon: <Flag /> },
    {
      label: 'Tatt av admin',
      sub: assignee ?? 'Ikke tildelt',
      done: Boolean(assignee) || status !== 'open',
      icon: <UserCheck />,
    },
    {
      label: status === 'dismissed' ? 'Avvist' : 'Løst',
      sub: closed ? dateTime(resolvedAt) : 'Ikke ennå',
      done: closed,
      icon: status === 'dismissed' ? <XCircle /> : <CheckCircle2 />,
    },
  ];
  return (
    <ol className="grid grid-cols-3 rounded-xl border bg-card p-4">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex flex-col items-center text-center">
          {i > 0 && (
            <span
              className={cn(
                'absolute top-4 right-1/2 h-0.5 w-full -translate-x-4',
                s.done ? 'bg-emerald-500' : 'bg-border'
              )}
            />
          )}
          <span
            className={cn(
              'relative z-10 flex size-8 items-center justify-center rounded-full border-2 [&_svg]:size-4',
              s.done
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-border bg-card text-muted-foreground'
            )}
          >
            {s.icon}
          </span>
          <span className={cn('mt-2 text-xs font-medium', !s.done && 'text-muted-foreground')}>
            {s.label}
          </span>
          <span className="max-w-full truncate px-1 text-[11px] text-muted-foreground">
            {s.sub}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function JobReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState<'resolved' | 'dismissed' | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-job-report-detail', reportId],
    queryFn: () => fetchAdminJobReportById(reportId!),
    enabled: !!reportId,
    staleTime: 30_000,
  });

  const inv = () => {
    qc.invalidateQueries({ queryKey: ['admin-job-report-detail', reportId] });
    qc.invalidateQueries({ queryKey: ['admin-job-reports'] });
  };

  const assignMut = useMutation({
    mutationFn: () => assignJobReport(reportId!),
    onSuccess: () => {
      toast.success('Rapport tildelt.');
      inv();
    },
    onError: (e) => toast.error(getErrorMessage(e, 'Tildeling mislyktes.')),
  });
  const statusMut = useMutation({
    mutationFn: (v: { status: string; note?: string }) =>
      updateJobReportStatus(reportId!, v.status, v.note),
    onSuccess: (_r, v) => {
      toast.success(
        v.status === 'resolved'
          ? 'Rapport markert som løst.'
          : v.status === 'dismissed'
            ? 'Rapport avvist.'
            : 'Rapport gjenåpnet.'
      );
      setDecision(null);
      setNote('');
      inv();
    },
    onError: (e) => toast.error(getErrorMessage(e, 'Kunne ikke oppdatere rapporten.')),
  });

  if (isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 rounded-xl lg:col-span-2" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  if (isError || !data) return <ErrorState error={error} onRetry={refetch} />;

  const { report, related, reportedUserReports } = data;
  const service = report.serviceId;
  const isClosed = ['resolved', 'dismissed'].includes(report.status);
  const otherUserReports = Math.max(0, reportedUserReports - 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard/job-reports">
            <ArrowLeft /> Jobbrapporter
          </Link>
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {service && (
            <>
              <Button variant="outline" size="sm" className="bg-card" asChild>
                <Link to={`/dashboard/services/${service._id}`}>
                  <Briefcase /> Oppdrag
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="bg-card" asChild>
                <Link to={`/job-listing/${service._id}`} target="_blank" rel="noreferrer">
                  <ArrowUpRight /> Se annonsen
                </Link>
              </Button>
            </>
          )}
          {!report.assignedAdminId && !isClosed && (
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              onClick={() => assignMut.mutate()}
              disabled={assignMut.isPending}
            >
              <UserCheck /> Ta saken
            </Button>
          )}
          {isClosed ? (
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              onClick={() => statusMut.mutate({ status: 'under_review' })}
              disabled={statusMut.isPending}
            >
              <RotateCcw /> Gjenåpne
            </Button>
          ) : (
            <>
              <Button variant="destructive" size="sm" onClick={() => setDecision('dismissed')}>
                <XCircle /> Avvis
              </Button>
              <Button size="sm" onClick={() => setDecision('resolved')}>
                <CheckCircle2 /> Løs
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Hero: what was reported and why */}
      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40">
            <Flag className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ReportType type={report.reportType} />
              <ReportStatus s={report.status} />
              {related.length > 0 && (
                <Badge variant="outline" className="border-amber-200 text-amber-700">
                  {related.length} {related.length === 1 ? 'annen rapport' : 'andre rapporter'} på
                  annonsen
                </Badge>
              )}
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
              {service?.title ?? 'Slettet annonse'}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Mottatt {dateTime(report.createdAt)} · #{report._id.slice(-8).toUpperCase()}
            </p>
          </div>
        </div>
        <figure className="mt-4 rounded-xl bg-muted/60 p-4">
          <blockquote className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
            {report.description}
          </blockquote>
          <figcaption className="mt-2 text-xs text-muted-foreground">
            — {report.reportedBy?.name ?? 'Slettet bruker'}
          </figcaption>
        </figure>
      </section>

      <Progress
        createdAt={report.createdAt}
        assignee={report.assignedAdminId?.name}
        status={report.status}
        resolvedAt={report.resolvedAt}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Annonsen">
            {service ? (
              <div className="flex flex-col gap-4 sm:flex-row">
                <span className="flex h-32 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground sm:w-40">
                  {service.images?.[0] ? (
                    <img src={service.images[0]} alt="" className="size-full object-cover" />
                  ) : (
                    <ImageOff className="size-6" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/dashboard/services/${service._id}`}
                      className="text-sm font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {service.title}
                    </Link>
                    {service.status && (
                      <StatusBadge
                        status={service.status}
                        label={SERVICE_STATUS[service.status] ?? service.status}
                        tone={service.status === 'open' ? 'success' : 'neutral'}
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {service.price != null && (
                      <span className="font-medium text-foreground">
                        {service.price.toLocaleString('nb-NO')} kr
                      </span>
                    )}
                    {(service.location?.address || service.location?.city) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" aria-hidden="true" />
                        {[service.location.address, service.location.city]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    )}
                    {service.createdAt && <span>Lagt ut {dateTime(service.createdAt)}</span>}
                  </div>
                  {service.categories?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {service.categories.map((c) => (
                        <Badge key={c} variant="secondary">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {service.description && (
                    <p className="line-clamp-4 text-sm text-muted-foreground">
                      {service.description}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState title="Annonsen er slettet" />
            )}
          </Section>

          <Section
            title="Andre rapporter på denne annonsen"
            description="Flere uavhengige rapporter er et sterkt signal."
          >
            {related.length ? (
              <ul className="divide-y">
                {related.map((r) => (
                  <li key={r._id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <ReportType type={r.reportType} />
                    <span className="min-w-24 flex-1 truncate text-sm">
                      {r.reportedBy?.name ?? 'Slettet bruker'}
                    </span>
                    <span className="text-xs text-muted-foreground">{dateTime(r.createdAt)}</span>
                    <ReportStatus s={r.status} />
                    <Button variant="ghost" size="xs" asChild>
                      <Link to={`/dashboard/job-reports/${r._id}`}>Åpne</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Ingen andre rapporter.</p>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <PersonCard
            title="Rapportert bruker"
            p={report.reportedUser}
            extra={
              otherUserReports > 0 ? (
                <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                  {otherUserReports} {otherUserReports === 1 ? 'annen rapport' : 'andre rapporter'}
                </Badge>
              ) : undefined
            }
          />
          <PersonCard title="Rapportert av" p={report.reportedBy} />
          <Section title="Avgjørelse">
            {isClosed ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Gavel className="size-4 text-muted-foreground" aria-hidden="true" />
                  <ReportStatus s={report.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {report.resolvedBy?.name ?? 'Ukjent'} · {dateTime(report.resolvedAt)}
                </p>
                {report.resolutionNote ? (
                  <p className="rounded-lg bg-muted/60 p-3 whitespace-pre-wrap">
                    {report.resolutionNote}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Ingen notat.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ikke avgjort ennå.{' '}
                {report.assignedAdminId
                  ? `Saksbehandler: ${report.assignedAdminId.name}.`
                  : 'Ingen har tatt saken.'}
              </p>
            )}
          </Section>
        </div>
      </div>

      <AdminConfirmDialog
        title={decision === 'dismissed' ? 'Avvis rapporten?' : 'Løs rapporten?'}
        description={
          decision === 'dismissed'
            ? 'Rapporten var ikke et brudd. Skriv gjerne hvorfor.'
            : 'Saken er håndtert. Skriv gjerne hva som ble gjort.'
        }
        confirmText={decision === 'dismissed' ? 'Ja, avvis' : 'Ja, løs'}
        cancelText="Avbryt"
        variant={decision === 'dismissed' ? 'destructive' : 'default'}
        isOpen={decision !== null}
        onOpenChange={(o) => !o && setDecision(null)}
        onConfirm={() => {
          if (decision) statusMut.mutate({ status: decision, note });
        }}
      >
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Notat (valgfritt)"
          maxLength={1000}
          rows={3}
          className="mt-3"
          aria-label="Notat"
        />
        <p className="mt-1 text-right text-[11px] text-muted-foreground">{note.length}/1000</p>
      </AdminConfirmDialog>
    </div>
  );
}
