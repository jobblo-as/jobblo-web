import { useState } from 'react';
import { AlertTriangle, Cpu, MemoryStick, RotateCcw, Workflow } from 'lucide-react';
import { bytes, duration, num, pct } from '@/lib/devFormat';
import { useDevPm2 } from '../../features/developer/hooks';
import { ErrorState, Mono, NotConfigured, PageHeader, RefreshButton, Section, StatCard, StatusBadge } from '../../components/developer/kit';
import { DataTable } from '../../components/developer/DataTable';
import type { Pm2Process } from '../../api/developer';

const tone = (s: string) => (s === 'online' ? 'success' : s === 'stopped' ? 'neutral' : s === 'launching' ? 'info' : 'danger');

/** What pm2 manages on the API host (`pm2 jlist`). Only safe fields; error logs are redacted. */
export default function Pm2Page() {
  const { data, isLoading, isFetching, error, refetch } = useDevPm2();
  const list = data?.available ? data.processes : [];
  const [open, setOpen] = useState<number | null>(null);
  const shown = list.find((p) => p.id === open) ?? list.find((p) => p.errLogTail.length) ?? null;
  const notOnline = list.filter((p) => p.status !== 'online');

  const warnings = list.flatMap((p) => [
    p.mode === 'cluster' && p.webConcurrency && p.webConcurrency !== '1' && `${p.name}: pm2 cluster mode AND WEB_CONCURRENCY=${p.webConcurrency} — use one or the other (ecosystem.config.js keeps pm2 in fork mode).`,
    p.killTimeoutMs !== null && p.killTimeoutMs < 12_000 && `${p.name}: kill_timeout ${p.killTimeoutMs} ms is shorter than the 10 s graceful shutdown — requests are cut off on restart.`,
    p.unstableRestarts > 0 && `${p.name}: ${p.unstableRestarts} unstable restarts (crashed right after start) — check the error log below.`,
    p.nodeEnv && p.nodeEnv !== 'production' && `${p.name}: NODE_ENV=${p.nodeEnv}.`,
  ]).filter(Boolean);

  return (
    <div className="space-y-5">
      <PageHeader title="PM2" description="Processes pm2 runs on the API host: status, restarts, uptime and resources. Restart/stop stay on the server (pm2 CLI)." actions={<RefreshButton onClick={() => refetch()} spinning={isFetching} />} />
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && !data.available && <NotConfigured title="pm2 not available" description={data.reason} />}
      {warnings.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-200/70 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {warnings.map((w) => (
            <div key={String(w)}>{w}</div>
          ))}
        </div>
      )}

      {data?.available && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Processes" icon={<Workflow />} loading={isLoading} value={`${list.length - notOnline.length} / ${list.length}`} hint="online / total" tone={notOnline.length ? 'danger' : 'success'} />
            <StatCard label="Restarts" icon={<RotateCcw />} loading={isLoading} value={num(list.reduce((a, p) => a + p.restarts, 0))} hint="since pm2 started them" />
            <StatCard label="CPU" icon={<Cpu />} loading={isLoading} value={pct(list.reduce((a, p) => a + (p.cpuPercent ?? 0), 0))} hint="pm2 sees the primary only; workers: Cluster page" />
            <StatCard label="Memory" icon={<MemoryStick />} loading={isLoading} value={bytes(list.reduce((a, p) => a + (p.memoryBytes ?? 0), 0))} />
          </div>

          <Section title="Processes" description={data.self ? `This API runs as "${data.self}".` : undefined}>
            <DataTable<Pm2Process>
              rows={list}
              rowKey={(p) => String(p.id)}
              onRowClick={(p) => setOpen(p.id)}
              columns={[
                { key: 'name', header: 'Name', cell: (p) => <span className="font-medium">{p.name}</span> },
                { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} tone={tone(p.status)} /> },
                { key: 'pid', header: 'PID', cell: (p) => <Mono>{p.pid ?? '—'}</Mono> },
                { key: 'mode', header: 'Mode', cell: (p) => `${p.mode}${p.mode === 'cluster' ? ` ×${p.instances}` : ''}${p.webConcurrency ? ` · WEB_CONCURRENCY=${p.webConcurrency}` : ''}` },
                { key: 'up', header: 'Uptime', align: 'right', cell: (p) => (p.status === 'online' ? duration(p.uptimeSec) : '—') },
                { key: 'restarts', header: 'Restarts', align: 'right', cell: (p) => `${p.restarts}${p.unstableRestarts ? ` (${p.unstableRestarts} unstable)` : ''}` },
                { key: 'cpu', header: 'CPU', align: 'right', cell: (p) => pct(p.cpuPercent) },
                { key: 'mem', header: 'Memory', align: 'right', cell: (p) => bytes(p.memoryBytes) },
                { key: 'node', header: 'Node', cell: (p) => <Mono>{p.node ?? '—'}</Mono> },
              ]}
            />
          </Section>

          <Section
            title={shown ? `Recent errors — ${shown.name}` : 'Recent errors'}
            description="Last 40 lines of the pm2 error log (click a process above). Emails, numbers, tokens, keys and passwords are redacted."
            action={shown?.errLogTail.length ? <AlertTriangle className="size-4 text-amber-600" /> : undefined}
          >
            {shown?.errLogTail.length ? (
              <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{shown.errLogTail.join('\n')}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">No recent errors.</p>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
