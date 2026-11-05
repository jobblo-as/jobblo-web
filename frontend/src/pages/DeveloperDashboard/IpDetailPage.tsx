import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  Monitor,
  ShieldAlert,
  Smartphone,
  Tablet,
  type LucideIcon,
} from 'lucide-react';
import { ago, num } from '@/lib/devFormat';
import {
  useDevBlocks,
  useDevIpActivity,
  useDevMe,
  useUrlFilters,
} from '../../features/developer/hooks';
import type {
  AuthEventRow,
  AuthEventType,
  IpAccount,
  IpActivity,
  IpDevice,
  IpDeviceInfo,
  IpNetwork,
  IpSession,
  RangeKey,
} from '../../api/developer';
import {
  ErrorState,
  MethodBadge,
  PageHeader,
  RangeSelect,
  RefreshButton,
  Section,
  StatusBadge,
} from '../../components/developer/kit';
import { DataTable, type Column } from '../../components/developer/DataTable';
import { BlockIpDialog } from '../../components/developer/BlockIpDialog';
import { TimeSeriesChart } from '../../components/developer/TimeSeriesChart';
import { Button } from '../../components/developer/ui/button';

const PAGE_SIZE = 10;

const AUTH_LABEL: Record<AuthEventType, { text: string; tone: 'success' | 'danger' | 'warning' }> =
  {
    login: { text: 'Logged in', tone: 'success' },
    login_failed: { text: 'Login failed', tone: 'danger' },
    password_reset_requested: { text: 'Forgot password: code sent', tone: 'warning' },
    password_reset: { text: 'Password changed', tone: 'success' },
    password_reset_failed: { text: 'Password reset failed', tone: 'danger' },
  };

const KIND_ICON: Record<IpDeviceInfo['kind'], LucideIcon> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

/** "Chrome · Windows 10 · iPhone 15 Pro" for a parsed device. */
const deviceLabel = (d: IpDeviceInfo) =>
  [d.browser, d.os, d.model].filter(Boolean).join(' · ') || 'Unknown device';

function DeviceCell({ device }: { device: IpDeviceInfo }) {
  const Icon = KIND_ICON[device.kind] || Monitor;
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="whitespace-normal">{deviceLabel(device)}</span>
    </span>
  );
}

const when = (iso: string) => (
  <span title={new Date(iso).toLocaleString('nb-NO')} className="text-muted-foreground">
    {ago(iso)}
  </span>
);

/** One page of a list the server sent whole, in DataTable's pagination shape. */
function usePaged<T>(rows: T[] | undefined) {
  const [page, setPage] = useState(1);
  const total = rows?.length || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(page, totalPages);
  return {
    rows: rows?.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE),
    pagination: {
      page: p,
      limit: PAGE_SIZE,
      total,
      totalPages,
      hasNextPage: p < totalPages,
      hasPreviousPage: p > 1,
    },
    onPageChange: setPage,
  };
}

/** Where the IP is and what kind of network: a phone on 4G reads differently from a datacenter. */
function NetworkCard({ net }: { net?: IpNetwork }) {
  type Tone = 'info' | 'warning' | 'danger' | 'success';
  const flags: { label: string; tone: Tone }[] = [];
  if (net?.mobile) flags.push({ label: 'Mobile network', tone: 'info' });
  if (net?.proxy) flags.push({ label: 'VPN / proxy', tone: 'warning' });
  if (net?.hosting) flags.push({ label: 'Datacenter / hosting', tone: 'danger' });
  if (net?.mobile === false && net.proxy === false && net.hosting === false)
    flags.push({ label: 'Residential / business', tone: 'success' });
  const rows: [string, string | null | undefined][] = [
    ['Location', [net?.city, net?.country].filter(Boolean).join(', ') || null],
    ['ISP', net?.isp],
    ['Organisation', net?.org && net.org !== net.isp ? net.org : null],
    ['AS', net?.as],
  ];
  const known = rows.filter(([, v]) => v);
  return (
    <Section title="Network" description="ip-api lookup, cached 24 h">
      {flags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <StatusBadge key={f.label} status={f.label} tone={f.tone} label={f.label} />
          ))}
        </div>
      )}
      {known.length ? (
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          {known.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-mono text-xs break-all">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">Lookup unavailable for this IP.</p>
      )}
    </Section>
  );
}

const deviceColumns: Column<IpDevice>[] = [
  { key: 'device', header: 'Device', cell: (d) => <DeviceCell device={d} /> },
  { key: 'kind', header: 'Type', cell: (d) => <span className="capitalize">{d.kind}</span> },
  { key: 'seen', header: 'Seen', align: 'right', cell: (d) => `${num(d.seen)}×` },
  { key: 'sources', header: 'From', cell: (d) => d.sources.join(' + ') },
  {
    key: 'accounts',
    header: 'Accounts',
    cell: (d) => (
      <span className="font-mono text-xs whitespace-normal">{d.accounts.join(', ') || '—'}</span>
    ),
  },
  { key: 'last', header: 'Last seen', cell: (d) => when(d.lastSeen) },
];

const accountColumns: Column<IpAccount>[] = [
  {
    key: 'name',
    header: 'Account',
    cell: (a) => (
      <Link
        to={`/developer/users?id=${a._id}`}
        className="font-medium text-primary hover:underline"
      >
        {a.name || 'Unnamed'}
      </Link>
    ),
  },
  { key: 'email', header: 'E-mail', cell: (a) => <span className="font-mono">{a.email}</span> },
  { key: 'role', header: 'Role', cell: (a) => a.role || '—' },
  { key: 'sessions', header: 'Open sessions', align: 'right', cell: (a) => num(a.sessions) },
  { key: 'last', header: 'Last seen', cell: (a) => when(a.lastSeen) },
];

const sessionColumns: Column<IpSession>[] = [
  {
    key: 'device',
    header: 'Device',
    cell: (x) => (
      <span className="flex items-center gap-2">
        <DeviceCell device={x.device} />
        {x.mfaVerified && <StatusBadge status="mfa" tone="success" label="MFA" />}
      </span>
    ),
  },
  {
    key: 'user',
    header: 'User',
    cell: (x) =>
      x.user ? (
        <Link to={`/developer/users?id=${x.user._id}`} className="text-primary hover:underline">
          {x.user.name || x.user.email}
        </Link>
      ) : (
        '—'
      ),
  },
  { key: 'location', header: 'Location', cell: (x) => x.location || '—' },
  { key: 'signed', header: 'Signed in', cell: (x) => when(x.createdAt) },
  { key: 'used', header: 'Last used', cell: (x) => when(x.lastUsed) },
];

const authColumns: Column<AuthEventRow>[] = [
  {
    key: 'type',
    header: 'Event',
    cell: (a) => (
      <StatusBadge
        status={a.type}
        tone={AUTH_LABEL[a.type]?.tone ?? 'neutral'}
        label={AUTH_LABEL[a.type]?.text ?? a.type}
      />
    ),
  },
  {
    key: 'email',
    header: 'E-mail',
    cell: (a) => <span className="font-mono">{a.email || '—'}</span>,
  },
  {
    key: 'device',
    header: 'Device',
    cell: (a) =>
      a.device ? (
        <span title={a.userAgent || ''}>
          <DeviceCell device={a.device} />
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  { key: 'at', header: 'When', cell: (a) => when(a.at) },
];

type Endpoint = IpActivity['endpoints'][number];
const endpointColumns: Column<Endpoint>[] = [
  { key: 'method', header: 'Method', cell: (e) => <MethodBadge method={e.method} /> },
  {
    key: 'route',
    header: 'Route',
    cell: (e) => <span className="font-mono text-xs break-all">{e.route}</span>,
  },
  { key: 'requests', header: 'Requests', align: 'right', cell: (e) => num(e.requests) },
  {
    key: 'failed',
    header: 'Failed',
    align: 'right',
    cell: (e) => (e.failed ? <span className="text-amber-600">{num(e.failed)}</span> : '0'),
  },
  { key: 'last', header: 'Last seen', cell: (e) => when(e.lastSeen) },
];

/**
 * Everything one IP did in a range, as a page (it was a side panel that cut lists short):
 * network, devices, accounts, open sessions, sign-ins, traffic and endpoints, each list paged.
 */
export default function IpDetailPage() {
  const ip = decodeURIComponent(useParams().ip || '');
  const [f, setF] = useUrlFilters({ range: '24h' });
  const { data, isLoading, isFetching, error, refetch } = useDevIpActivity({
    ip,
    range: f.range as RangeKey,
  });
  const { data: me } = useDevMe();
  const { data: blockData } = useDevBlocks();
  const [blocking, setBlocking] = useState(false);
  const isBlocked = (blockData?.blocks || []).some((x) => x.target === ip);
  const isMe = ip === blockData?.yourIp;
  const total = data?.endpoints?.reduce((a, e) => a + e.requests, 0) || 0;
  const failed = data?.endpoints?.reduce((a, e) => a + e.failed, 0) || 0;
  const security = Object.entries(data?.security || {});

  const devices = usePaged(data?.devices);
  const accounts = usePaged(data?.accounts);
  const sessions = usePaged(data?.sessions);
  const auth = usePaged(data?.auth);
  const endpoints = usePaged(data?.endpoints);

  return (
    <div className="space-y-4">
      <Link
        to={`/developer/ips?range=${f.range}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> IP Management
      </Link>
      <PageHeader
        title={ip}
        description={`${num(total)} requests · ${num(failed)} failed · ${data?.endpoints?.length ?? 0} endpoints in range`}
        actions={
          <>
            {isBlocked && <StatusBadge status="blocked" tone="danger" />}
            {isMe && <StatusBadge status="you" tone="info" label="your IP" />}
            <RangeSelect value={f.range} onChange={(range) => setF({ range })} />
            {(me?.can?.execute || me?.can?.request) && !isBlocked && !isMe && (
              <Button variant="destructive" size="sm" onClick={() => setBlocking(true)}>
                <Ban /> Block this IP
              </Button>
            )}
            <RefreshButton onClick={() => refetch()} spinning={isFetching} />
          </>
        }
      />
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {security.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200/70 bg-amber-50 p-3 text-sm text-amber-800">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            Security events from this IP:{' '}
            {security.map(([k, n]) => `${k.replace(/_/g, ' ')} ×${n}`).join(', ')}.{' '}
            <Link to="/developer/security" className="underline">
              Security Center
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <NetworkCard net={data?.network} />
        <Section title="Requests over time" className="lg:col-span-2">
          <TimeSeriesChart
            data={data?.series}
            bucketMs={data?.range?.bucketMs}
            height={190}
            variant="bar"
            series={[
              { key: 'requests', label: 'Requests', color: 'var(--chart-1)' },
              { key: 'failed', label: 'Failed', color: 'var(--chart-5)' },
            ]}
          />
        </Section>
      </div>

      <Section
        title={`Devices (${data?.devices?.length ?? 0})`}
        description="From open sessions and sign-in events"
      >
        <DataTable
          columns={deviceColumns}
          loading={isLoading}
          rowKey={(d, i) => `${deviceLabel(d)}-${i}`}
          emptyTitle="No known device on this IP in range"
          {...devices}
        />
      </Section>

      <div className="space-y-4">
        <Section title={`Accounts with a session from this IP (${data?.accounts?.length ?? 0})`}>
          <DataTable
            columns={accountColumns}
            loading={isLoading}
            rowKey={(a) => a._id}
            emptyTitle="No open session from this IP"
            {...accounts}
          />
        </Section>
        <Section title={`Open sessions (${data?.sessions?.length ?? 0})`}>
          <DataTable
            columns={sessionColumns}
            loading={isLoading}
            rowKey={(x) => x._id}
            emptyTitle="No open session from this IP"
            {...sessions}
          />
        </Section>
      </div>

      <Section title={`Login & password (${data?.auth?.length ?? 0})`}>
        <DataTable
          columns={authColumns}
          loading={isLoading}
          rowKey={(a, i) => `${a.at}-${i}`}
          emptyTitle="No sign-ins or password resets from this IP in range"
          {...auth}
        />
      </Section>

      <Section
        title={`Endpoints called (${data?.endpoints?.length ?? 0})`}
        action={
          <Link
            to={`/developer/logs?q=${encodeURIComponent(ip)}`}
            className="text-xs text-primary hover:underline"
          >
            Search logs for this IP →
          </Link>
        }
      >
        <DataTable
          columns={endpointColumns}
          loading={isLoading}
          rowKey={(e) => `${e.method} ${e.route}`}
          emptyTitle="No requests from this IP in range"
          {...endpoints}
        />
      </Section>

      <BlockIpDialog ip={ip} open={blocking} onOpenChange={setBlocking} />
    </div>
  );
}
