import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { ago } from '@/lib/devFormat';
import type { SecurityDeviceRow } from '../../api/developer';
import { useSecurityDevices, useUrlFilters } from '../../features/developer/hooks';
import { ErrorState, PageHeader, Section } from '../../components/developer/kit';
import { DataTable, type Column } from '../../components/developer/DataTable';
import { Input } from '../../components/developer/ui/input';
import {
  FilterSelect,
  SeverityBadge,
  DeviceLink,
} from '../../components/developer/security/SecurityUi';

/** Device Explorer — every installation, searchable by label, account id or IP. */
export default function SecurityDevicesPage() {
  const [f, setF] = useUrlFilters({ q: '', band: '', platform: '', multiAccount: '', page: '1' });
  const [q, setQ] = useState(f.q);
  useEffect(() => setQ(f.q), [f.q]);
  const { data, isLoading, error, refetch } = useSecurityDevices({ ...f, limit: 25 });
  const navigate = useNavigate();

  const columns: Column<SecurityDeviceRow>[] = [
    {
      key: 'device',
      header: 'Installation',
      cell: (d) => (
        <div>
          {<DeviceLink deviceKey={d.deviceKey} label={d.device} />}
          <div className="text-xs text-muted-foreground">
            {d.platform === 'app' ? 'App' : 'Browser'} · {d.uaFamily || 'unknown'}
          </div>
        </div>
      ),
    },
    { key: 'band', header: 'Risk', cell: (d) => <SeverityBadge value={d.riskBand} /> },
    { key: 'score', header: 'Score', align: 'right', cell: (d) => d.riskScore ?? '—' },
    { key: 'acc', header: 'Accounts', align: 'right', cell: (d) => d.accounts },
    {
      key: 'ips',
      header: 'IPs',
      align: 'right',
      cell: (d) => (
        <span>
          {d.ips}
          {d.maskedIps ? (
            <span className="ml-1 text-xs text-amber-600">({d.maskedIps} masked)</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'cc',
      header: 'Countries',
      cell: (d) => (d.countries.length ? d.countries.join(', ') : '—'),
    },
    { key: 'last', header: 'Last seen', align: 'right', cell: (d) => ago(d.lastSeen) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Device Explorer"
        description="Browser and app installations (pseudonymous ids). One installation is not one physical device: another browser, or cleared cookies, is another installation."
      />
      <Section
        title="Installations"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setF({ q: q.trim(), page: '1' });
              }}
              className="relative"
            >
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="DEV-7842, account id or IP"
                className="h-8 w-60 pl-8"
                aria-label="Search installations"
              />
            </form>
            <FilterSelect
              label="Risk"
              value={f.band}
              onChange={(band) => setF({ band, page: '1' })}
              options={['critical', 'high', 'medium', 'low'].map((v) => ({ value: v, label: v }))}
              width="w-32"
            />
            <FilterSelect
              label="Platform"
              value={f.platform}
              onChange={(platform) => setF({ platform, page: '1' })}
              options={[
                { value: 'web', label: 'Browser' },
                { value: 'app', label: 'App' },
              ]}
              width="w-36"
            />
            <FilterSelect
              label="Accounts"
              value={f.multiAccount}
              onChange={(multiAccount) => setF({ multiAccount, page: '1' })}
              options={[{ value: 'true', label: 'More than one' }]}
              width="w-44"
            />
          </div>
        }
      >
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
        <DataTable
          columns={columns}
          rows={data?.rows}
          rowKey={(d) => d.deviceKey}
          loading={isLoading}
          onRowClick={(d) => navigate(`/developer/security-intel/devices/${d.deviceKey}`)}
          pagination={data?.pagination}
          onPageChange={(page) => setF({ page: String(page) })}
          emptyTitle="No installations"
          emptyDescription="Installations appear once a browser or the app signs in."
        />
      </Section>
    </div>
  );
}
