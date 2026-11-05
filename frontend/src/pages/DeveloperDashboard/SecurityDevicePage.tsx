import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Fingerprint, Globe, ShieldAlert, Users } from 'lucide-react';
import { ago, dateTime } from '@/lib/devFormat';
import type {
  DeviceObservationRow,
  SecIntelEventRow,
  SecurityAlertRow,
  SecurityDeviceDetail,
} from '../../api/developer';
import { useSecurityDevice } from '../../features/developer/hooks';
import {
  ErrorState,
  KeyValue,
  PageHeader,
  Section,
  StatCard,
} from '../../components/developer/kit';
import { DataTable, type Column } from '../../components/developer/DataTable';
import { useLocalPaging } from '../../components/developer/useLocalPaging';
import {
  AlertStatusBadge,
  ConfidenceText,
  NetworkBadge,
  SeverityBadge,
  IpLink,
} from '../../components/developer/security/SecurityUi';
import { RULE_LABEL } from '../../components/developer/security/labels';

type Session = SecurityDeviceDetail['sessions'][number];

const userLink = (users: SecurityDeviceDetail['users'], id: string | null | undefined) => {
  if (!id) return <span className="text-muted-foreground">—</span>;
  const u = users[id];
  return (
    <Link
      to={`/developer/users?id=${id}`}
      className="text-primary hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {u?.name || id.slice(-6)}
      {u?.email ? <span className="ml-1 text-xs text-muted-foreground">{u.email}</span> : null}
    </Link>
  );
};

/** One installation: who used it, from where, what the rules found, and why the score is what it is. */
export default function SecurityDevicePage() {
  const { key } = useParams();
  const { data, isLoading, error, refetch } = useSecurityDevice(key);
  const navigate = useNavigate();
  const obs = useLocalPaging(data?.observations);
  const events = useLocalPaging(data?.events);
  const sessions = useLocalPaging(data?.sessions);
  const users = data?.users || {};
  const masked = (data?.observations || []).filter((o) =>
    ['vpn_proxy', 'tor'].includes(o.network?.class || '')
  ).length;
  const countries = [
    ...new Set((data?.observations || []).map((o) => o.network?.countryCode).filter(Boolean)),
  ];

  const obsCols: Column<DeviceObservationRow>[] = [
    { key: 'ip', header: 'IP', cell: (o) => <IpLink ip={o.ip} /> },
    { key: 'net', header: 'Network', cell: (o) => <NetworkBadge network={o.network} /> },
    {
      key: 'where',
      header: 'Where',
      cell: (o) =>
        [o.network?.countryCode, o.network?.asn, o.network?.isp].filter(Boolean).join(' · ') || '—',
    },
    { key: 'user', header: 'Account', cell: (o) => userLink(users, o.userId) },
    {
      key: 'events',
      header: 'Events',
      cell: (o) =>
        Object.entries(o.events || {})
          .map(([k, n]) => `${k} ×${n}`)
          .join(', ') || '—',
    },
    { key: 'hits', header: 'Sightings', align: 'right', cell: (o) => o.hits },
    { key: 'first', header: 'First seen', align: 'right', cell: (o) => dateTime(o.firstSeen) },
    { key: 'last', header: 'Last seen', align: 'right', cell: (o) => ago(o.lastSeen) },
  ];
  const alertCols: Column<SecurityAlertRow>[] = [
    { key: 'sev', header: 'Severity', cell: (a) => <SeverityBadge value={a.severity} /> },
    { key: 'rule', header: 'Rule', cell: (a) => RULE_LABEL[a.ruleId] || a.ruleId },
    { key: 'sum', header: 'Why', cell: (a) => <span className="text-sm">{a.summary}</span> },
    { key: 'conf', header: 'Confidence', cell: (a) => <ConfidenceText value={a.confidence} /> },
    { key: 'status', header: 'Status', cell: (a) => <AlertStatusBadge value={a.status} /> },
    { key: 'last', header: 'Last seen', align: 'right', cell: (a) => ago(a.lastSeen) },
  ];
  const eventCols: Column<SecIntelEventRow>[] = [
    { key: 'at', header: 'When', cell: (e) => dateTime(e.at) },
    {
      key: 'type',
      header: 'Event',
      cell: (e) => <span className="font-mono text-xs">{e.type}</span>,
    },
    { key: 'ip', header: 'IP', cell: (e) => (e.ip ? <IpLink ip={e.ip} /> : '—') },
    {
      key: 'route',
      header: 'Route',
      cell: (e) => <span className="font-mono text-xs">{e.route || '—'}</span>,
    },
    { key: 'user', header: 'Account', cell: (e) => userLink(users, e.userId) },
  ];
  const sessionCols: Column<Session>[] = [
    { key: 'user', header: 'Account', cell: (s) => userLink(users, s.userId) },
    { key: 'ip', header: 'IP', cell: (s) => <IpLink ip={s.ip} /> },
    {
      key: 'dev',
      header: 'Device',
      cell: (s) => s.deviceName || [s.browser, s.os].filter(Boolean).join(' · ') || '—',
    },
    { key: 'loc', header: 'Location', cell: (s) => s.location || '—' },
    { key: 'created', header: 'Signed in', align: 'right', cell: (s) => dateTime(s.createdAt) },
    {
      key: 'used',
      header: 'Last used',
      align: 'right',
      cell: (s) => ago(s.lastUsed || s.createdAt),
    },
  ];

  return (
    <div className="space-y-6">
      <Link
        to="/developer/security-intel/devices"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Device Explorer
      </Link>
      <PageHeader
        title={data?.device?.device || 'Installation'}
        description={
          data?.device
            ? `${data.device.platform === 'app' ? 'App' : 'Browser'} · ${data.device.uaFamily || 'unknown'} · first seen ${dateTime(data.device.firstSeen)}`
            : undefined
        }
      />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Risk score"
          icon={<ShieldAlert />}
          tone={
            data?.score?.band === 'critical' || data?.score?.band === 'high'
              ? 'danger'
              : data?.score?.band === 'medium'
                ? 'warning'
                : 'neutral'
          }
          value={data?.score ? `${data.score.score} · ${data.score.band}` : '—'}
          hint={`${data?.score?.rules ?? 0} rule(s)`}
        />
        <StatCard
          label="Accounts"
          icon={<Users />}
          value={data?.accounts?.length ?? '—'}
          hint="signed in on it"
        />
        <StatCard
          label="IPs"
          icon={<Globe />}
          value={data?.observations?.length ?? '—'}
          hint={`${masked} VPN/proxy/Tor · ${countries.length} countries`}
        />
        <StatCard
          label="Last seen"
          icon={<Fingerprint />}
          value={data?.device ? ago(data.device.lastSeen) : '—'}
        />
      </div>

      {data?.device && data?.score ? (
        <Section title="Why this score" description={data.score.recommendation}>
          <KeyValue
            items={[
              ['What it is', data.device.identity],
              [
                'Contributions',
                data.score.reasons.length ? data.score.reasons.join(' · ') : 'Nothing found.',
              ],
              [
                'Key',
                <span key="k" className="font-mono text-xs">
                  {data.device.deviceKey}
                </span>,
              ],
            ]}
          />
        </Section>
      ) : null}

      <Section
        title="IP history"
        description="Each installation-IP pair once, with its classification and source (hover a badge)."
      >
        <DataTable
          columns={obsCols}
          rows={obs.rows}
          rowKey={(o) => o.ip}
          loading={isLoading}
          pagination={obs.pagination}
          onPageChange={obs.onPageChange}
          emptyTitle="No IPs yet"
        />
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Accounts">
          <DataTable
            columns={[
              { key: 'n', header: 'Account', cell: (u) => userLink(users, u._id) },
              { key: 'r', header: 'Role', cell: (u) => u.role || '—' },
              { key: 'd', header: '', cell: (u) => (u.deleted ? 'deleted' : '') },
            ]}
            rows={data?.accounts}
            rowKey={(u) => u._id}
            loading={isLoading}
            emptyTitle="No account signed in"
          />
        </Section>
        <Section title="Findings">
          <DataTable
            columns={alertCols}
            rows={data?.alerts}
            rowKey={(a) => a._id}
            loading={isLoading}
            onRowClick={(a) => navigate(`/developer/security-intel/alerts?open=${a._id}`)}
            emptyTitle="No findings"
          />
        </Section>
      </div>

      <Section title="Activity" description="Security events from this installation, last 30 days.">
        <DataTable
          columns={eventCols}
          rows={events.rows}
          rowKey={(e) => e._id}
          loading={isLoading}
          pagination={events.pagination}
          onPageChange={events.onPageChange}
          emptyTitle="No security events"
        />
      </Section>

      <Section title="Sessions" description="Sign-ins created on this installation.">
        <DataTable
          columns={sessionCols}
          rows={sessions.rows}
          rowKey={(s) => s._id}
          loading={isLoading}
          pagination={sessions.pagination}
          onPageChange={sessions.onPageChange}
          emptyTitle="No sessions"
        />
      </Section>
    </div>
  );
}
