import { useState, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserCheck, Briefcase, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  fetchAdminJobReportById,
  assignJobReport,
  updateJobReportStatus,
} from '../../api/admin/jobReports';
import {
  AdminStatusBadge,
  AdminLoadingSkeleton,
  AdminErrorState,
  AdminPageHeader,
  AdminConfirmDialog,
} from '../../components/admin';
import { KeyValue, Mono, Section } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
import { Textarea } from '../../components/developer/ui/textarea';

export default function JobReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const qc = useQueryClient();
  const [resolveNote, setResolveNote] = useState('');
  const [dismissNote, setDismissNote] = useState('');
  const [showResolve, setShowResolve] = useState(false);
  const [showDismiss, setShowDismiss] = useState(false);

  const {
    data: report,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin-job-report-detail', reportId],
    queryFn: () => fetchAdminJobReportById(reportId!),
    enabled: !!reportId,
    staleTime: 30_000,
  });

  const inv = () => qc.invalidateQueries({ queryKey: ['admin-job-report-detail', reportId] });

  const assignMut = useMutation({
    mutationFn: () => assignJobReport(reportId!),
    onSuccess: () => {
      toast.success('Rapport tildelt.');
      inv();
    },
    onError: () => toast.error('Tildeling mislyktes.'),
  });
  const resolveMut = useMutation({
    mutationFn: () => updateJobReportStatus(reportId!, 'resolved', resolveNote),
    onSuccess: () => {
      toast.success('Rapport markert som løst.');
      setShowResolve(false);
      setResolveNote('');
      inv();
    },
    onError: () => toast.error('Kunne ikke løse rapporten.'),
  });
  const dismissMut = useMutation({
    mutationFn: () => updateJobReportStatus(reportId!, 'dismissed', dismissNote),
    onSuccess: () => {
      toast.success('Rapport avvist.');
      setShowDismiss(false);
      setDismissNote('');
      inv();
    },
    onError: () => toast.error('Kunne ikke avvise rapporten.'),
  });
  const reopenMut = useMutation({
    mutationFn: () => updateJobReportStatus(reportId!, 'under_review'),
    onSuccess: () => {
      toast.success('Rapport gjenåpnet.');
      inv();
    },
    onError: () => toast.error('Kunne ikke gjenåpne rapporten.'),
  });

  if (isLoading)
    return (
      <div className="space-y-4">
        <AdminLoadingSkeleton rows={4} />
        <AdminLoadingSkeleton rows={6} />
      </div>
    );
  if (isError || !report) return <AdminErrorState onRetry={refetch} title="Rapport ikke funnet" />;

  const service = report.serviceId;
  const isClosed = ['resolved', 'dismissed'].includes(report.status);

  const details: [string, ReactNode][] = [
    ['Rapport-ID', <Mono key="id">{report._id}</Mono>],
    ['Status', <AdminStatusBadge key="st" status={report.status} />],
    ['Tildelt', report.assignedAdminId?.name ?? '–'],
    ['Type', report.reportType.replace(/_/g, ' ')],
    ['Beskrivelse', report.description],
    ['Opprettet', new Date(report.createdAt).toLocaleString('nb-NO')],
    ['Sist oppdatert', new Date(report.updatedAt).toLocaleString('nb-NO')],
  ];
  if (report.resolvedAt)
    details.push(['Løst dato', new Date(report.resolvedAt).toLocaleString('nb-NO')]);
  if (report.resolutionNote) details.push(['Løsningsnotat', report.resolutionNote]);
  if (report.resolvedBy) details.push(['Løst av', report.resolvedBy.name]);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={`Rapport: ${service?.title ?? 'Slettet annonse'}`}
        description={report.reportType.replace(/_/g, ' ')}
        actions={
          <>
            <Button variant="outline" size="sm" className="bg-card" asChild>
              <Link to="/dashboard/job-reports">
                <ArrowLeft /> Tilbake til rapporter
              </Link>
            </Button>
            {service && (
              <Button variant="outline" size="sm" className="bg-card" asChild>
                <Link to={`/job-listing/${service._id}`} target="_blank">
                  <Briefcase /> Se annonse
                </Link>
              </Button>
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
            {!isClosed ? (
              <>
                <Button variant="destructive" size="sm" onClick={() => setShowDismiss(true)}>
                  <XCircle /> Avvis
                </Button>
                <Button size="sm" onClick={() => setShowResolve(true)}>
                  <CheckCircle2 /> Løs
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="bg-card"
                onClick={() => reopenMut.mutate()}
                disabled={reopenMut.isPending}
              >
                <RotateCcw /> Gjenåpne
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Rapportdetaljer">
            <KeyValue items={details} />
          </Section>

          <Section title="Annonseinformasjon">
            {service ? (
              <KeyValue
                items={[
                  ['Tittel', service.title],
                  ...(service.price != null
                    ? [['Pris', `${service.price.toLocaleString('nb-NO')} kr`] as [string, string]]
                    : []),
                  [
                    'Status',
                    service.status ? <AdminStatusBadge key="s" status={service.status} /> : '–',
                  ],
                  [
                    'Opprettet',
                    new Date(service.createdAt ?? report.createdAt).toLocaleDateString('nb-NO'),
                  ],
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Annonsen er slettet.</p>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Rapportert av">
            {report.reportedBy ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">{report.reportedBy.name}</p>
                <p className="text-xs text-muted-foreground">{report.reportedBy.email}</p>
                <div className="flex items-center gap-2">
                  <AdminStatusBadge status={report.reportedBy.role ?? 'user'} />
                  <AdminStatusBadge status={report.reportedBy.accountStatus ?? 'active'} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Bruker slettet</p>
            )}
          </Section>

          <Section title="Rapportert bruker">
            {report.reportedUser ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">{report.reportedUser.name}</p>
                <p className="text-xs text-muted-foreground">{report.reportedUser.email}</p>
                <div className="flex items-center gap-2">
                  <AdminStatusBadge status={report.reportedUser.role ?? 'user'} />
                  <AdminStatusBadge status={report.reportedUser.accountStatus ?? 'active'} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Bruker slettet</p>
            )}
          </Section>
        </div>
      </div>

      <AdminConfirmDialog
        title="Løs rapporten?"
        description="Marker denne rapporten som løst. Du kan legge til et notat for journalføring."
        confirmText="Ja, løs"
        cancelText="Avbryt"
        variant="default"
        isOpen={showResolve}
        onOpenChange={setShowResolve}
        onConfirm={() => resolveMut.mutate()}
      >
        <Textarea
          value={resolveNote}
          onChange={(e) => setResolveNote(e.target.value)}
          placeholder="Notat (valgfritt)"
          rows={3}
          className="mt-3"
        />
      </AdminConfirmDialog>

      <AdminConfirmDialog
        title="Avvis rapporten?"
        description="Marker denne rapporten som avvist. Du kan legge til et notat for journalføring."
        confirmText="Ja, avvis"
        cancelText="Avbryt"
        variant="destructive"
        isOpen={showDismiss}
        onOpenChange={setShowDismiss}
        onConfirm={() => dismissMut.mutate()}
      >
        <Textarea
          value={dismissNote}
          onChange={(e) => setDismissNote(e.target.value)}
          placeholder="Notat (valgfritt)"
          rows={3}
          className="mt-3"
        />
      </AdminConfirmDialog>
    </div>
  );
}
