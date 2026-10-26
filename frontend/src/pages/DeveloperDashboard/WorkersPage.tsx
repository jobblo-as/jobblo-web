import { Activity, Cpu, Gauge, KeyRound, MemoryStick, Network, RotateCcw } from 'lucide-react';
import { bytes, duration, ms, num, pct } from '@/lib/devFormat';
import { useDevWorkers } from '../../features/developer/hooks';
import { ErrorState, Mono, PageHeader, RefreshButton, Section, StatCard, StatusBadge } from '../../components/developer/kit';
import { DataTable } from '../../components/developer/DataTable';
import type { WorkerInfo } from '../../api/developer';

const WARN = { loopP99: 100, cpu: 85, hitRate: 50 };
const secondsSince = (iso: string, now: number) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));

/**
 * Every API process at once. With WEB_CONCURRENCY>1 the Server and Performance pages show
 * whichever worker answered; this page reads all workers' heartbeats from Redis.
 */
export default function WorkersPage() {
  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useDevWorkers();
  const t = data?.totals;
  const now = dataUpdatedAt || Date.now();
  const configured = data?.configured ?? '1';
  const expected = /^\d+$/.test(configured) ? Number(configured) : null; // "auto" = one per CPU

  const warnings = data
    ? [
        !data.redis && configured !== '1' && `WEB_CONCURRENCY=${configured} but Redis is not connected — the API runs as ONE process (cluster mode needs REDIS_URL).`,
        expected && t && t.workers < expected && `${t.workers} of ${expected} workers are reporting — check pm2 logs for crashing workers.`,
        t && t.schedulerWorkers === 0 && 'No worker runs the scheduler — scheduled jobs (auto-release, reminders) are not running.',
        t && t.schedulerWorkers > 1 && `${t.schedulerWorkers} workers run the scheduler — jobs may run more than once. Only worker 1 should.`,
        t && t.passwordBusy > 0 && `${t.passwordBusy} logins were refused as busy (503) since start — login traffic exceeds the password-check queue.`,
        t && t.worstLoopP99Ms >= WARN.loopP99 && `Event loop p99 is ${t.worstLoopP99Ms} ms on the slowest worker — requests are queueing.`,
      ].filter(Boolean)
    : [];

  const cacheRows = Object.entries(t?.cache ?? {}).map(([name, c]) => ({ name, ...c }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cluster (API workers)"
        description={`Every API process (WEB_CONCURRENCY=${configured}). ${data?.primaries.length ? data.primaries.map((p) => `Primary pid ${p.pid} on ${p.host}: ${p.workers} workers, ${p.schedPolicy === 'rr' ? 'round-robin' : 'OS'} load balancing.`).join(' ') : 'Single process (no cluster primary).'} Each worker reports every ${data?.heartbeatSec ?? 5} s; one that stops reporting drops off after 20 s.`}
        actions={<RefreshButton onClick={() => refetch()} spinning={isFetching} />}
      />
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {warnings.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-200/70 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {warnings.map((w) => (
            <div key={String(w)}>{w}</div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Workers" icon={<Network />} loading={isLoading} value={num(t?.workers)} hint={data ? `configured ${configured} · Redis ${data.redis ? 'on' : 'off'}` : ''} tone={expected && t && t.workers < expected ? 'warning' : 'neutral'} />
        <StatCard label="Requests / s" icon={<Activity />} loading={isLoading} value={num(t?.rps)} hint={`${num(t?.activeRequests)} in flight · ${num(t?.errorsLastMin)} 5xx last min`} />
        <StatCard label="CPU (sum)" icon={<Cpu />} loading={isLoading} value={pct(t?.cpuPercent)} hint="100% = one full core" />
        <StatCard label="Memory (RSS)" icon={<MemoryStick />} loading={isLoading} value={bytes(t?.rss)} hint="all workers" />
        <StatCard label="Event loop p99" icon={<Gauge />} loading={isLoading} value={ms(t?.worstLoopP99Ms)} hint="slowest worker" tone={t && t.worstLoopP99Ms >= WARN.loopP99 ? 'danger' : 'neutral'} />
        <StatCard label="Login queue" icon={<KeyRound />} loading={isLoading} value={num(t?.passwordWaiting)} hint={`${num(t?.passwordBusy)} refused (busy) since start`} tone={t && t.passwordBusy > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Restarts" icon={<RotateCcw />} loading={isLoading} value={num(t?.restarts)} hint="crashes since the primary started" tone={t && t.restarts > 0 ? 'warning' : 'neutral'} />
      </div>

      <Section title="Workers" description="Live per process. Worker 1 runs the singletons (scheduler, alerts, probes).">
        <DataTable<WorkerInfo>
          loading={isLoading}
          rows={data?.workers ?? []}
          rowKey={(w) => w.id}
          emptyTitle="No worker has reported yet"
          columns={[
            { key: 'slot', header: 'Worker', cell: (w) => <span className="font-medium">{w.slot ? `#${w.slot}` : 'single'}</span> },
            { key: 'pid', header: 'PID / host', cell: (w) => <Mono>{`${w.pid} @ ${w.host}${w.slot ? ` (primary ${w.ppid})` : ''}`}</Mono> },
            { key: 'up', header: 'Uptime', align: 'right', cell: (w) => duration(secondsSince(w.startedAt, now)) },
            { key: 'rps', header: 'Req/s', align: 'right', cell: (w) => num(w.rps) },
            { key: 'p95', header: 'p95 (1 min)', align: 'right', cell: (w) => ms(w.p95LastMinMs) },
            { key: 'cpu', header: 'CPU', align: 'right', cell: (w) => <span className={w.cpuPercent >= WARN.cpu ? 'text-red-600' : undefined}>{pct(w.cpuPercent)}</span> },
            { key: 'rss', header: 'RSS / heap', align: 'right', cell: (w) => `${bytes(w.rss)} / ${bytes(w.heapUsed)}` },
            { key: 'loop', header: 'Loop p50 / p99', align: 'right', cell: (w) => <span className={(w.loopP99Ms ?? 0) >= WARN.loopP99 ? 'text-red-600' : undefined}>{`${ms(w.loopP50Ms)} / ${ms(w.loopP99Ms)}`}</span> },
            { key: 'pw', header: 'Login queue', align: 'right', cell: (w) => `${w.passwordQueue.active}/${w.passwordQueue.maxActive} · ${w.passwordQueue.waiting} waiting${w.passwordQueue.busy ? ` · ${w.passwordQueue.busy} busy` : ''}` },
            { key: 'sched', header: 'Scheduler', cell: (w) => (w.scheduler ? <StatusBadge status="running" label="yes" tone="success" /> : <span className="text-muted-foreground">—</span>) },
            { key: 'restarts', header: 'Restarts', align: 'right', cell: (w) => <span title={w.lastExit ?? undefined}>{w.restarts}</span> },
            { key: 'beat', header: 'Last report', align: 'right', cell: (w) => <span className={secondsSince(w.at, now) > 12 ? 'text-amber-600' : 'text-muted-foreground'}>{`${secondsSince(w.at, now)} s ago`}</span> },
          ]}
        />
      </Section>

      <Section
        title="Response cache (all workers)"
        description="Redis cache hits and misses since each worker started, summed. nginx micro-cache hits never reach the API, so they are not counted here — check them with deploy/nginx/check-cache.sh or the X-Cache-Status header."
      >
        <DataTable<(typeof cacheRows)[number]>
          loading={isLoading}
          rows={cacheRows}
          rowKey={(c) => c.name}
          emptyTitle="No cached route has been hit yet"
          columns={[
            { key: 'name', header: 'Namespace', cell: (c) => <Mono>{c.name}</Mono> },
            { key: 'hits', header: 'Hits', align: 'right', cell: (c) => num(c.hits) },
            { key: 'misses', header: 'Misses', align: 'right', cell: (c) => num(c.misses) },
            {
              key: 'rate',
              header: 'Hit rate',
              align: 'right',
              cell: (c) => <span className={c.hitRate !== null && c.hitRate < WARN.hitRate ? 'text-amber-600' : undefined}>{pct(c.hitRate)}</span>,
            },
          ]}
        />
      </Section>
    </div>
  );
}
