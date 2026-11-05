import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Fingerprint, Globe, ShieldAlert, Users, Waypoints } from 'lucide-react';
import { ago } from '@/lib/devFormat';
import type { SecurityAlertRow } from '../../api/developer';
import { useSecurityOverview, useUrlFilters } from '../../features/developer/hooks';
import {
  ErrorState,
  PageHeader,
  RangeSelect,
  Section,
  StatCard,
} from '../../components/developer/kit';
import { DataTable, type Column } from '../../components/developer/DataTable';
import { TimeSeriesChart } from '../../components/developer/TimeSeriesChart';
import {
  AlertStatusBadge,
  SeverityBadge,
  DeviceLink,
} from '../../components/developer/security/SecurityUi';
import { RULE_LABEL } from '../../components/developer/security/labels';

/** Security Intelligence — what needs a look now, and how it is trending. */
export default function SecurityIntelOverviewPage() {
  const [f, setF] = useUrlFilters({ range: '24h' });
  const { data, isLoading, error, refetch } = useSecurityOverview({ range: f.range as '24h' });
  const navigate = useNavigate();
  const t = data?.totals;
  const sev = t?.bySeverity ?? {};

  const alertCols: Column<SecurityAlertRow>[] = [
    { key: 'sev', header: 'Severity', cell: (a) => <SeverityBadge value={a.severity} /> },
    {
      key: 'title',
      header: 'Finding',
      cell: (a) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{a.title}</div>
          <div className="text-xs text-muted-foreground">{RULE_LABEL[a.ruleId] || a.ruleId}</div>
        </div>
      ),
    },
    {
      key: 'dev',
      header: 'Installation',
      cell: (a) => <DeviceLink deviceKey={a.deviceKey} label={a.device} />,
    },
    { key: 'status', header: 'Status', cell: (a) => <AlertStatusBadge value={a.status} /> },
    { key: 'last', header: 'Last seen', align: 'right', cell: (a) => ago(a.lastSeen) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Overview"
        description="Installations, networks and risk findings. A finding is a reason to look — never proof, and a VPN alone is not fraud."
        actions={<RangeSelect value={f.range} onChange={(range) => setF({ range })} />}
      />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Open findings"
          icon={<ShieldAlert />}
          tone={
            (sev.high || 0) + (sev.critical || 0) ? 'danger' : t?.openAlerts ? 'warning' : 'success'
          }
          value={t?.openAlerts ?? '—'}
          hint={`${sev.critical || 0} critical · ${sev.high || 0} high · ${sev.medium || 0} medium`}
        />
        <StatCard
          label="High-risk installations"
          icon={<AlertTriangle />}
          tone={t?.riskyDevices ? 'danger' : 'neutral'}
          value={t?.riskyDevices ?? '—'}
          hint="high or critical score"
        />
        <StatCard
          label="Active installations"
          icon={<Fingerprint />}
          value={t?.activeDevices ?? '—'}
          hint="seen in range"
        />
        <StatCard
          label="Many networks"
          icon={<Waypoints />}
          tone={t?.multiIpDevices ? 'warning' : 'neutral'}
          value={t?.multiIpDevices ?? '—'}
          hint={`${t?.newIpEvents ?? 0} new IP sightings`}
        />
        <StatCard
          label="VPN / proxy / Tor"
          icon={<Globe />}
          value={t?.maskedObservations ?? '—'}
          hint="installation-IP pairs"
        />
        <StatCard
          label="Several accounts"
          icon={<Users />}
          tone={t?.multiAccountDevices ? 'warning' : 'neutral'}
          value={t?.multiAccountDevices ?? '—'}
          hint="on one installation"
        />
      </div>

      <Section title="New findings" description="By severity, when first seen.">
        <TimeSeriesChart
          data={data?.trend}
          bucketMs={data?.range?.bucketMs}
          variant="bar"
          height={200}
          series={[
            { key: 'critical', label: 'Critical', color: 'var(--chart-5)' },
            { key: 'high', label: 'High', color: 'var(--chart-4)' },
            { key: 'medium', label: 'Medium', color: 'var(--chart-3)' },
            { key: 'low', label: 'Low', color: 'var(--chart-2)' },
          ]}
        />
      </Section>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Section
          title="Latest open findings"
          action={
            <Link
              to="/developer/security-intel/alerts"
              className="text-sm text-primary hover:underline"
            >
              All investigations →
            </Link>
          }
        >
          <DataTable
            columns={alertCols}
            rows={data?.recentAlerts}
            rowKey={(a) => a._id}
            loading={isLoading}
            onRowClick={(a) => navigate(`/developer/security-intel/alerts?open=${a._id}`)}
            emptyTitle="No open findings"
            emptyDescription="The risk rules found nothing to look at."
          />
        </Section>
        <Section title="Highest risk installations">
          <DataTable
            columns={[
              {
                key: 'd',
                header: 'Installation',
                cell: (d) => <DeviceLink deviceKey={d.deviceKey} label={d.device} />,
              },
              { key: 'b', header: 'Band', cell: (d) => <SeverityBadge value={d.riskBand} /> },
              { key: 's', header: 'Score', align: 'right', cell: (d) => d.riskScore ?? '—' },
              { key: 'a', header: 'Accounts', align: 'right', cell: (d) => d.accounts },
            ]}
            rows={data?.riskyDevices}
            rowKey={(d) => d.deviceKey}
            loading={isLoading}
            onRowClick={(d) => navigate(`/developer/security-intel/devices/${d.deviceKey}`)}
            emptyTitle="None"
            emptyDescription="No installation is at high or critical risk."
          />
        </Section>
      </div>
    </div>
  );
}
