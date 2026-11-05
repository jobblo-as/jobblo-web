import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { dateTime } from '@/lib/devFormat';
import type { RangeKey, SecIntelEventRow } from '../../api/developer';
import { useSecurityEvents, useUrlFilters } from '../../features/developer/hooks';
import { ErrorState, PageHeader, RangeSelect, Section } from '../../components/developer/kit';
import { DataTable, type Column } from '../../components/developer/DataTable';
import { Input } from '../../components/developer/ui/input';
import { FilterSelect, DeviceLink, IpLink } from '../../components/developer/security/SecurityUi';

/** Security Events — every security signal, filterable by type, installation, IP and route. */
export default function SecurityEventsIntelPage() {
  const [f, setF] = useUrlFilters({
    range: '24h',
    type: '',
    device: '',
    ip: '',
    route: '',
    page: '1',
  });
  const [search, setSearch] = useState({ device: f.device, ip: f.ip });
  useEffect(() => setSearch({ device: f.device, ip: f.ip }), [f.device, f.ip]);
  const { data, isLoading, error, refetch } = useSecurityEvents({
    ...f,
    range: f.range as RangeKey,
    limit: 50,
  });

  const columns: Column<SecIntelEventRow>[] = [
    { key: 'at', header: 'When', cell: (e) => dateTime(e.at) },
    {
      key: 'type',
      header: 'Event',
      cell: (e) => <span className="font-mono text-xs">{e.type}</span>,
    },
    {
      key: 'dev',
      header: 'Installation',
      cell: (e) => <DeviceLink deviceKey={e.deviceKey} label={e.device} />,
    },
    { key: 'ip', header: 'IP', cell: (e) => (e.ip ? <IpLink ip={e.ip} /> : '—') },
    {
      key: 'route',
      header: 'Request',
      cell: (e) => (
        <span className="font-mono text-xs">
          {[e.method, e.route].filter(Boolean).join(' ') || '—'}
          {e.status ? ` · ${e.status}` : ''}
          {e.code ? ` · ${e.code}` : ''}
        </span>
      ),
    },
    {
      key: 'who',
      header: 'Account',
      cell: (e) => e.email || (e.userId ? e.userId.slice(-6) : '—'),
    },
  ];

  const typeOptions = (data?.types || []).map((t) => ({
    value: t,
    label: `${t}${data?.byType?.[t] ? ` (${data.byType[t]})` : ''}`,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Events"
        description="Failed sign-ins, rate limits, token problems, blocked IPs, and installation signals (new IP, new account). Kept 30 days."
        actions={<RangeSelect value={f.range} onChange={(range) => setF({ range, page: '1' })} />}
      />
      <Section
        title="Events"
        action={
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setF({ device: search.device.trim(), ip: search.ip.trim(), page: '1' });
            }}
          >
            <FilterSelect
              label="Type"
              value={f.type}
              onChange={(type) => setF({ type, page: '1' })}
              options={typeOptions}
              width="w-52"
            />
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search.device}
                onChange={(e) => setSearch((s) => ({ ...s, device: e.target.value }))}
                placeholder="DEV-7842"
                className="h-8 w-32 pl-8"
                aria-label="Installation"
              />
            </div>
            <Input
              value={search.ip}
              onChange={(e) => setSearch((s) => ({ ...s, ip: e.target.value }))}
              placeholder="IP"
              className="h-8 w-36"
              aria-label="IP"
            />
            <button type="submit" className="sr-only">
              Search
            </button>
          </form>
        }
      >
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
        <DataTable
          columns={columns}
          rows={data?.rows}
          rowKey={(e) => e._id}
          loading={isLoading}
          pagination={data?.pagination}
          onPageChange={(page) => setF({ page: String(page) })}
          emptyTitle="No events"
          emptyDescription="Nothing in this range matches."
        />
      </Section>
    </div>
  );
}
