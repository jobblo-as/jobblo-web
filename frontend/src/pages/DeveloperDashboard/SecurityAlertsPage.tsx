import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ago, dateTime } from '@/lib/devFormat';
import { devApi, type AlertStatus, type SecurityAlertRow } from '../../api/developer';
import {
  useDevMe,
  useSecurityAlert,
  useSecurityAlerts,
  useUrlFilters,
} from '../../features/developer/hooks';
import { errMessage } from '../../features/developer/stepUp';
import { ErrorState, KeyValue, PageHeader, Section } from '../../components/developer/kit';
import { DataTable, type Column } from '../../components/developer/DataTable';
import { Button } from '../../components/developer/ui/button';
import { Label } from '../../components/developer/ui/label';
import { Skeleton } from '../../components/developer/ui/skeleton';
import { Textarea } from '../../components/developer/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/developer/ui/sheet';
import {
  AlertStatusBadge,
  ConfidenceText,
  FilterSelect,
  SeverityBadge,
  DeviceLink,
  IpLink,
} from '../../components/developer/security/SecurityUi';
import { RULE_LABEL, STATUS_LABEL } from '../../components/developer/security/labels';

/** The investigation workspace for one finding: evidence, related accounts, notes, decision. */
function AlertSheet({
  id,
  onClose,
  canAct,
}: {
  id: string | null;
  onClose: () => void;
  canAct: boolean;
}) {
  const { data, isLoading, error } = useSecurityAlert(id);
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setNote(''), [id]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['dev', 'security-intel'] });

  const decide = async (status: AlertStatus) => {
    setBusy(status);
    try {
      await devApi.updateSecurityAlert(id!, status, note.trim());
      toast.success(`Marked ${STATUS_LABEL[status].toLowerCase()}`);
      setNote('');
      refresh();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const escalate = async () => {
    setBusy('escalate');
    try {
      await devApi.escalateSecurityAlert(id!, note.trim());
      toast.success('Escalated: a fraud case is open for each account');
      setNote('');
      refresh();
      qc.invalidateQueries({ queryKey: ['dev', 'fraud'] });
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const a = data?.alert;
  const users = data?.users || {};
  return (
    <Sheet open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{a?.title || 'Finding'}</SheetTitle>
          <SheetDescription>
            {a ? `${RULE_LABEL[a.ruleId] || a.ruleId} · ${a.summary || ''}` : ''}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          {isLoading ? <Skeleton className="h-40 w-full" /> : null}
          {error ? <ErrorState error={error} /> : null}
          {a ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge value={a.severity} />
                <AlertStatusBadge value={a.status} />
                <ConfidenceText value={a.confidence} />
                <span className="text-xs text-muted-foreground">· seen {a.count}×</span>
              </div>
              <KeyValue
                items={[
                  ['Installation', <DeviceLink deviceKey={a.deviceKey} label={a.device} />],
                  [
                    'Risk',
                    data?.device
                      ? `${data.device.riskScore ?? '—'} · ${data.device.riskBand || '—'}`
                      : '—',
                  ],
                  ['First seen', dateTime(a.firstSeen)],
                  ['Last seen', dateTime(a.lastSeen)],
                  ['Suggested', data?.recommendation || '—'],
                ]}
              />
              <div>
                <div className="mb-2 text-sm font-medium">Evidence</div>
                <ul className="space-y-1.5 text-sm">
                  {a.evidence.map((e, i) => (
                    <li
                      key={i}
                      className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      <span className="min-w-0">
                        {e.ref?.type === 'ip' && e.ref.id ? (
                          <>
                            {<IpLink ip={e.ref.id} />}
                            <span className="ml-1 text-muted-foreground">
                              {e.label.replace(e.ref.id, '')}
                            </span>
                          </>
                        ) : e.ref?.type === 'user' && e.ref.id ? (
                          <Link
                            to={`/developer/users?id=${e.ref.id}`}
                            className="text-primary hover:underline"
                          >
                            {users[e.ref.id]?.name || e.label}
                          </Link>
                        ) : (
                          e.label
                        )}
                      </span>
                      {e.at ? (
                        <span className="shrink-0 text-xs text-muted-foreground">{ago(e.at)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
              {a.userIds.length ? (
                <div>
                  <div className="mb-2 text-sm font-medium">Accounts</div>
                  <ul className="space-y-1 text-sm">
                    {a.userIds.map((u) => {
                      const fc = data?.fraudCases.find((c) => c.userId === u);
                      return (
                        <li key={u} className="flex items-center justify-between gap-2">
                          <Link
                            to={`/developer/users?id=${u}`}
                            className="text-primary hover:underline"
                          >
                            {users[u]?.name || u.slice(-6)}{' '}
                            <span className="text-xs text-muted-foreground">{users[u]?.email}</span>
                          </Link>
                          {fc ? (
                            <Link
                              to="/developer/fraud"
                              className="text-xs text-muted-foreground hover:underline"
                            >
                              fraud case: {fc.status}
                            </Link>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {data?.siblings.length ? (
                <div>
                  <div className="mb-2 text-sm font-medium">
                    Other findings on this installation
                  </div>
                  <ul className="space-y-1 text-sm">
                    {data.siblings.map((s) => (
                      <li key={s._id} className="flex items-center justify-between gap-2">
                        <span>{RULE_LABEL[s.ruleId] || s.ruleId}</span>
                        <AlertStatusBadge value={s.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <div className="mb-2 text-sm font-medium">Notes</div>
                {a.notes.length ? (
                  <ul className="space-y-2 text-sm">
                    {a.notes.map((n, i) => (
                      <li key={i} className="rounded-md bg-muted/50 px-3 py-2">
                        <div className="text-xs text-muted-foreground">
                          {dateTime(n.at)} · {n.by ? users[n.by]?.name || 'developer' : 'system'}
                          {n.status ? ` · ${n.status}` : ''}
                        </div>
                        <div>{n.text}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                )}
              </div>

              {canAct ? (
                <div className="space-y-2 border-t pt-4">
                  <Label htmlFor="alert-note">Note (needed to close or escalate)</Label>
                  <Textarea
                    id="alert-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="What you checked and what you decided."
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Boolean(busy)}
                      onClick={() => decide('investigating')}
                    >
                      Investigating
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Boolean(busy) || note.trim().length < 5}
                      onClick={() => decide('false_positive')}
                    >
                      False positive
                    </Button>
                    <Button
                      size="sm"
                      disabled={Boolean(busy) || note.trim().length < 5}
                      onClick={() => decide('resolved')}
                    >
                      Resolve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={Boolean(busy) || note.trim().length < 5 || !a.userIds.length}
                      onClick={escalate}
                    >
                      Escalate to fraud case
                    </Button>
                    {a.status !== 'open' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={Boolean(busy)}
                        onClick={() => decide('open')}
                      >
                        Reopen
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Every decision is written to the audit log. Nothing here blocks or bans an
                    account.
                  </p>
                </div>
              ) : (
                <p className="border-t pt-4 text-xs text-muted-foreground">
                  Read-only access: an operations developer can change this finding.
                </p>
              )}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Investigations — every risk finding, filterable, with its workspace. */
export default function SecurityAlertsPage() {
  const [f, setF] = useUrlFilters({
    status: 'live',
    severity: '',
    rule: '',
    device: '',
    ip: '',
    page: '1',
    open: '',
  });
  const { data, isLoading, error, refetch } = useSecurityAlerts({
    ...f,
    open: undefined,
    limit: 25,
  });
  const { data: me } = useDevMe();
  const canAct = Boolean(me?.can?.request || me?.can?.execute);

  const columns: Column<SecurityAlertRow>[] = [
    { key: 'sev', header: 'Severity', cell: (a) => <SeverityBadge value={a.severity} /> },
    {
      key: 'title',
      header: 'Finding',
      cell: (a) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{a.title}</div>
          <div className="truncate text-xs text-muted-foreground">{a.summary}</div>
        </div>
      ),
    },
    {
      key: 'rule',
      header: 'Rule',
      cell: (a) => <span className="text-xs">{RULE_LABEL[a.ruleId] || a.ruleId}</span>,
    },
    {
      key: 'dev',
      header: 'Installation',
      cell: (a) => <DeviceLink deviceKey={a.deviceKey} label={a.device} />,
    },
    { key: 'acc', header: 'Accounts', align: 'right', cell: (a) => a.userIds.length },
    { key: 'status', header: 'Status', cell: (a) => <AlertStatusBadge value={a.status} /> },
    { key: 'last', header: 'Last seen', align: 'right', cell: (a) => ago(a.lastSeen) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investigations"
        description="Risk findings to review. Mark false positives (they stay closed), resolve, or escalate the accounts to a fraud case."
      />
      <Section
        title="Findings"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Status"
              value={f.status === 'live' ? '' : f.status}
              onChange={(status) => setF({ status: status || 'live', page: '1' })}
              options={(
                [
                  'open',
                  'investigating',
                  'escalated',
                  'resolved',
                  'false_positive',
                ] as AlertStatus[]
              ).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              width="w-44"
            />
            <FilterSelect
              label="Severity"
              value={f.severity}
              onChange={(severity) => setF({ severity, page: '1' })}
              options={['critical', 'high', 'medium', 'low'].map((v) => ({ value: v, label: v }))}
              width="w-36"
            />
            <FilterSelect
              label="Rule"
              value={f.rule}
              onChange={(rule) => setF({ rule, page: '1' })}
              options={Object.entries(RULE_LABEL).map(([value, label]) => ({ value, label }))}
              width="w-48"
            />
          </div>
        }
      >
        {f.status === 'live' ? (
          <p className="-mt-2 mb-3 text-xs text-muted-foreground">
            Showing open, investigating and escalated findings.
          </p>
        ) : null}
        {f.device || f.ip ? (
          <p className="-mt-2 mb-3 text-xs text-muted-foreground">
            Filtered by {f.device ? `installation ${f.device}` : ''} {f.ip ? `IP ${f.ip}` : ''} ·{' '}
            <button
              className="text-primary hover:underline"
              onClick={() => setF({ device: '', ip: '', page: '1' })}
            >
              clear
            </button>
          </p>
        ) : null}
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
        <DataTable
          columns={columns}
          rows={data?.rows}
          rowKey={(a) => a._id}
          loading={isLoading}
          onRowClick={(a) => setF({ open: a._id })}
          pagination={data?.pagination}
          onPageChange={(page) => setF({ page: String(page) })}
          emptyTitle="No findings"
          emptyDescription="Nothing matches these filters."
        />
      </Section>
      <AlertSheet id={f.open || null} onClose={() => setF({ open: '' })} canAct={canAct} />
    </div>
  );
}
