import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Clock, ShieldOff } from 'lucide-react';
import type { RangeKey, RiskConfig } from '../../api/developer';
import { devApi } from '../../api/developer';
import {
  useDevMe,
  useSecurityAnalytics,
  useSecurityConfig,
  useUrlFilters,
} from '../../features/developer/hooks';
import { errMessage } from '../../features/developer/stepUp';
import {
  ErrorState,
  PageHeader,
  RangeSelect,
  Section,
  StatCard,
} from '../../components/developer/kit';
import { DataTable } from '../../components/developer/DataTable';
import { TimeSeriesChart } from '../../components/developer/TimeSeriesChart';
import { Button } from '../../components/developer/ui/button';
import { Input } from '../../components/developer/ui/input';
import { RULE_LABEL } from '../../components/developer/security/labels';

const SECTION_LABEL: Record<string, string> = {
  multiIp: 'A · Many networks',
  vpnTransition: 'B · VPN transition',
  multiAccount: 'C · Several accounts',
  loginAbuse: 'D · Failed sign-ins',
  requestAbuse: 'E · Request bursts',
  sensitiveOps: 'F · Sensitive changes',
  bands: 'Score bands',
};

/** The rule thresholds, editable by operations developers (audited). */
function Thresholds({ canAct }: { canAct: boolean }) {
  const { data, error } = useSecurityConfig();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<RiskConfig | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data?.config) setDraft(data.config);
  }, [data?.config]);
  if (error) return <ErrorState error={error} />;
  if (!draft) return null;
  const changed = JSON.stringify(draft) !== JSON.stringify(data?.config);
  const save = async () => {
    setSaving(true);
    try {
      await devApi.updateSecurityConfig(draft);
      toast.success('Thresholds saved');
      qc.invalidateQueries({ queryKey: ['dev', 'security-intel', 'config'] });
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(draft).map(([section, values]) => (
          <div key={section} className="rounded-lg border p-3">
            <div className="mb-2 text-sm font-medium">{SECTION_LABEL[section] || section}</div>
            <div className="space-y-2">
              {Object.entries(values).map(([k, v]) => (
                <label key={k} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {k}
                    {data?.defaults?.[section]?.[k] !== v ? (
                      <span className="ml-1 text-xs">
                        (default {data?.defaults?.[section]?.[k]})
                      </span>
                    ) : null}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    value={v}
                    disabled={!canAct}
                    onChange={(e) =>
                      setDraft(
                        (d) =>
                          d && { ...d, [section]: { ...d[section], [k]: Number(e.target.value) } }
                      )
                    }
                    className="h-8 w-24 text-right"
                    aria-label={`${section} ${k}`}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {canAct ? (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!changed || saving} onClick={save}>
            Save thresholds
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!changed || saving}
            onClick={() => setDraft(data!.config)}
          >
            Discard
          </Button>
          <span className="text-xs text-muted-foreground">
            Applies from the next evaluation. Written to the audit log.
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Read-only access: an operations developer can change thresholds.
        </p>
      )}
    </div>
  );
}

/** Security Analytics — history of findings, signals and how they were handled. */
export default function SecurityAnalyticsPage() {
  const [f, setF] = useUrlFilters({ range: '30d' });
  const { data, error, refetch } = useSecurityAnalytics({ range: f.range as RangeKey });
  const { data: me } = useDevMe();
  const canAct = Boolean(me?.can?.request || me?.can?.execute);
  const r = data?.resolution;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Analytics"
        description="How many findings, which signals, and how they were resolved — from stored data, nothing estimated."
        actions={<RangeSelect value={f.range} onChange={(range) => setF({ range })} />}
      />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Closed findings" icon={<CheckCircle2 />} value={r?.closed ?? '—'} />
        <StatCard
          label="False positives"
          icon={<ShieldOff />}
          tone={r && r.closed && r.falsePositive / r.closed > 0.5 ? 'warning' : 'neutral'}
          value={r?.falsePositive ?? '—'}
          hint={
            r?.closed
              ? `${Math.round((r.falsePositive / r.closed) * 100)} % of closed — high means a threshold is too tight`
              : undefined
          }
        />
        <StatCard
          label="Median time to close"
          icon={<Clock />}
          value={r?.medianHours == null ? '—' : `${r.medianHours} h`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Findings by severity">
          <TimeSeriesChart
            data={data?.alerts}
            bucketMs={data?.range?.bucketMs}
            variant="bar"
            height={220}
            series={[
              { key: 'critical', label: 'Critical', color: 'var(--chart-5)' },
              { key: 'high', label: 'High', color: 'var(--chart-4)' },
              { key: 'medium', label: 'Medium', color: 'var(--chart-3)' },
              { key: 'low', label: 'Low', color: 'var(--chart-2)' },
            ]}
          />
        </Section>
        <Section title="Authentication anomalies and request abuse">
          <TimeSeriesChart
            data={data?.events}
            bucketMs={data?.range?.bucketMs}
            height={220}
            series={[
              { key: 'login_failed', label: 'Failed sign-ins', color: 'var(--chart-4)' },
              { key: 'otp_failed', label: 'Failed codes', color: 'var(--chart-3)' },
              { key: 'rate_limited', label: 'Rate limited', color: 'var(--chart-5)' },
              { key: 'device_new_ip', label: 'New IP', color: 'var(--chart-1)' },
              { key: 'device_new_account', label: 'New account', color: 'var(--chart-2)' },
            ]}
          />
        </Section>
        <Section
          title="VPN / proxy and Tor observations"
          description="New installation-IP pairs on masked networks."
        >
          <TimeSeriesChart
            data={data?.masked}
            bucketMs={data?.range?.bucketMs}
            variant="bar"
            height={220}
            series={[
              { key: 'vpn_proxy', label: 'VPN / proxy', color: 'var(--chart-3)' },
              { key: 'tor', label: 'Tor', color: 'var(--chart-5)' },
            ]}
          />
        </Section>
        <Section
          title="By rule"
          description="Findings first seen in range, and how many were false positives."
        >
          <DataTable
            columns={[
              { key: 'r', header: 'Rule', cell: (x) => RULE_LABEL[x.ruleId] || x.ruleId },
              { key: 'n', header: 'Findings', align: 'right', cell: (x) => x.n },
              { key: 'fp', header: 'False positive', align: 'right', cell: (x) => x.falsePositive },
            ]}
            rows={data?.byRule}
            rowKey={(x) => x.ruleId}
            emptyTitle="No findings in range"
          />
        </Section>
      </div>

      <Section
        title="Rule thresholds"
        description="When each rule fires and where the score bands start."
      >
        <Thresholds canAct={canAct} />
      </Section>
    </div>
  );
}
