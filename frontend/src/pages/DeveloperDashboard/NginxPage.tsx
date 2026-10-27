import { Activity, Archive, Gauge, Globe, Plug, Zap } from 'lucide-react';
import { bytes, ms, num, pct } from '@/lib/devFormat';
import { useDevNginx } from '../../features/developer/hooks';
import {
  CountBars,
  ErrorState,
  KeyValue,
  Mono,
  NotConfigured,
  PageHeader,
  RefreshButton,
  Section,
  StatCard,
} from '../../components/developer/kit';
import { DataTable } from '../../components/developer/DataTable';
import type { NginxPath } from '../../api/developer';

/**
 * nginx in front of the API: live connections (stub_status), what the micro-cache answered
 * (access log), slowest paths, processes and the cache folder. Each part shows why it is
 * missing instead of failing the page.
 */
export default function NginxPage() {
  const { data, isLoading, isFetching, error, refetch } = useDevNginx();
  const st = data?.status.available ? data.status : null;
  const log = data?.accessLog.available ? data.accessLog : null;
  const dir = data?.cacheDir.available ? data.cacheDir : null;
  const five = log?.statuses['5xx'] ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Nginx"
        description={`Reverse proxy and micro-cache in front of the API${data?.version ? ` · nginx ${data.version}` : ''}. Anonymous GETs of public lists are answered from a 3 s cache; logged-in requests always go to the API.`}
        actions={<RefreshButton onClick={() => refetch()} spinning={isFetching} />}
      />
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Active connections"
          icon={<Plug />}
          loading={isLoading}
          value={st ? num(st.active) : 'n/a'}
          hint={
            st
              ? `${st.reading} reading · ${st.writing} writing · ${st.waiting} idle`
              : 'stub_status not reachable'
          }
        />
        <StatCard
          label="Requests (since start)"
          icon={<Activity />}
          loading={isLoading}
          value={st ? num(st.requests) : 'n/a'}
          hint={st ? `${num(st.accepts)} connections · ${num(st.dropped)} dropped` : ''}
          tone={st && st.dropped > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Requests / s (1 min)"
          icon={<Gauge />}
          loading={isLoading}
          value={log ? num(log.rpsLastMin) : 'n/a'}
          hint="from the access log"
        />
        <StatCard
          label="Micro-cache hit rate"
          icon={<Zap />}
          loading={isLoading}
          value={log ? pct(log.cacheHitRate) : 'n/a'}
          hint="HIT + STALE of cacheable API GETs"
          tone={log && log.cacheHitRate !== null && log.cacheHitRate < 50 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="p95 total / API"
          icon={<Globe />}
          loading={isLoading}
          value={log ? ms(log.requestP95Ms) : 'n/a'}
          hint={log ? `upstream p95 ${ms(log.upstreamP95Ms)}` : ''}
        />
        <StatCard
          label="Cache folder"
          icon={<Archive />}
          loading={isLoading}
          value={dir ? bytes(dir.bytes) : 'n/a'}
          hint={dir ? `${num(dir.files)} entries${dir.truncated ? '+' : ''}` : ''}
        />
      </div>

      {data && !st && (
        <NotConfigured
          title="Live counters unavailable"
          description={(data.status as { reason: string }).reason}
        />
      )}
      {data && !log && (
        <NotConfigured
          title="Access log unavailable"
          description={(data.accessLog as { reason: string }).reason}
        />
      )}

      {log && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="Cache status (API requests)"
            description="HIT/STALE/UPDATING = answered by nginx · MISS/EXPIRED = fetched from the API and stored · BYPASS = logged-in or not cacheable · none = route is never cached."
          >
            <CountBars counts={log.cache} />
          </Section>
          <Section
            title="Status codes"
            description={`${num(log.lines)} requests in the log tail${log.unparsed ? ` (${log.unparsed} unreadable lines)` : ''}${log.from ? ` · ${new Date(log.from).toLocaleString()} → ${new Date(log.to!).toLocaleString()}` : ''}`}
          >
            <CountBars counts={log.statuses} />
            {five > 0 && (
              <p className="mt-2 text-sm text-red-600">
                {five} server errors in this window — see Errors and Logs.
              </p>
            )}
          </Section>
        </div>
      )}

      {log && (
        <Section
          title="Busiest API paths"
          description="Ids are folded into :id. A low hit rate on a public list usually means many different query strings (pages, searches)."
        >
          <DataTable<NginxPath>
            rows={log.topPaths}
            rowKey={(p) => p.path}
            columns={[
              { key: 'path', header: 'Path', cell: (p) => <Mono>{p.path}</Mono> },
              { key: 'n', header: 'Requests', align: 'right', cell: (p) => num(p.requests) },
              { key: 'hit', header: 'Cache hit rate', align: 'right', cell: (p) => pct(p.hitRate) },
              { key: 'p95', header: 'p95', align: 'right', cell: (p) => ms(p.p95Ms) },
            ]}
          />
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Processes" description="nginx master and workers on this host.">
          {data?.processes.available ? (
            <DataTable
              rows={data.processes.list}
              rowKey={(p) => String(p.pid)}
              emptyTitle="No nginx process found on this host"
              columns={[
                { key: 'pid', header: 'PID', cell: (p) => <Mono>{p.pid}</Mono> },
                { key: 'role', header: 'Role', cell: (p) => p.role },
                { key: 'rss', header: 'Memory', align: 'right', cell: (p) => bytes(p.rssBytes) },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{data?.processes.reason ?? '—'}</p>
          )}
        </Section>
        <Section
          title="Where this page reads from"
          description="Override with the env vars on the API."
        >
          <KeyValue
            items={[
              ['Live counters (NGINX_STATUS_URL)', <Mono>{data?.config.statusUrl ?? '—'}</Mono>],
              ['Access log (NGINX_ACCESS_LOG)', <Mono>{data?.config.accessLog ?? '—'}</Mono>],
              ['Cache folder (NGINX_CACHE_DIR)', <Mono>{data?.config.cacheDir ?? '—'}</Mono>],
              [
                'Config files',
                <Mono>deploy/nginx/*.conf · check: deploy/nginx/check-cache.sh</Mono>,
              ],
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
