import { Link } from 'react-router-dom';
import { Database, Globe, Layers } from 'lucide-react';
import { duration, num, pct } from '@/lib/devFormat';
import { useDevCaching } from '../../features/developer/hooks';
import {
  CountBars,
  ErrorState,
  Mono,
  NotConfigured,
  PageHeader,
  RefreshButton,
  Section,
  StatCard,
} from '../../components/developer/kit';
import { DataTable } from '../../components/developer/DataTable';
import type { CachingInfo } from '../../api/developer';

type Ns = CachingInfo['api']['namespaces'][number];

/**
 * Every cache layer a public read passes, outermost first:
 *   nginx micro-cache (3 s) → in-process L1 (1 s) → Redis response cache (TTL per namespace) → MongoDB.
 */
export default function CachingPage() {
  const { data, isLoading, isFetching, error, refetch } = useDevCaching();
  const ng = data?.nginx.available ? data.nginx : null;
  const api = data?.api;
  const hits = api?.namespaces.reduce((a, n) => a + n.hits, 0) ?? 0;
  const misses = api?.namespaces.reduce((a, n) => a + n.misses, 0) ?? 0;
  const apiRate = hits + misses ? Math.round((hits / (hits + misses)) * 1000) / 10 : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Caching"
        description="A public request is answered by the first layer that has it: nginx micro-cache (3 s, anonymous only) → in-process L1 (1 s) → Redis response cache → MongoDB. Any job write clears the API caches at once."
        actions={<RefreshButton onClick={() => refetch()} spinning={isFetching} />}
      />
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard
          label="1 · nginx micro-cache"
          icon={<Globe />}
          loading={isLoading}
          value={ng ? pct(ng.hitRate) : 'n/a'}
          hint={
            ng
              ? `hit rate over ${num(ng.window.lines)} logged requests`
              : 'access log not available — see Nginx'
          }
        />
        <StatCard
          label="2 · API cache (L1 + Redis)"
          icon={<Layers />}
          loading={isLoading}
          value={pct(apiRate)}
          hint={
            api
              ? `${num(hits + misses)} lookups on ${api.workers} worker${api.workers === 1 ? '' : 's'} · store: ${api.store}`
              : ''
          }
        />
        <StatCard
          label="3 · Redis keys"
          icon={<Database />}
          loading={isLoading}
          value={num(api?.namespaces.reduce((a, n) => a + (n.redisKeys ?? 0), 0))}
          hint={
            data?.redisKeys.available
              ? 'cached responses (upper bound; exact on Cache Manager)'
              : (data?.redisKeys as { reason?: string })?.reason
          }
        />
      </div>

      <p className="text-sm text-muted-foreground">
        The API layer only sees what nginx did not answer, so its hit rate is naturally lower than
        nginx's — requests nginx serves never reach it. Invalidate a namespace on the{' '}
        <Link className="underline" to="../redis/cache">
          Cache Manager
        </Link>
        .
      </p>

      {data && !ng && (
        <NotConfigured
          title="nginx layer not visible"
          description={(data.nginx as { reason: string }).reason}
        />
      )}
      {ng && (
        <Section
          title="nginx micro-cache"
          description="HIT/STALE/UPDATING served by nginx · MISS/EXPIRED fetched from the API · BYPASS logged-in or not cacheable."
        >
          <CountBars counts={ng.statuses} />
        </Section>
      )}

      <Section
        title="API response cache by namespace"
        description="Hits and misses summed over all workers since they started; TTL as configured on the route; keys currently in Redis."
      >
        <DataTable<Ns>
          loading={isLoading}
          rows={api?.namespaces ?? []}
          rowKey={(n) => n.name}
          emptyTitle="No cached route has been used yet"
          columns={[
            { key: 'name', header: 'Namespace', cell: (n) => <Mono>{n.name}</Mono> },
            {
              key: 'ttl',
              header: 'TTL',
              align: 'right',
              cell: (n) => (n.ttlSec ? duration(n.ttlSec) : '—'),
            },
            { key: 'hits', header: 'Hits', align: 'right', cell: (n) => num(n.hits) },
            { key: 'misses', header: 'Misses', align: 'right', cell: (n) => num(n.misses) },
            { key: 'rate', header: 'Hit rate', align: 'right', cell: (n) => pct(n.hitRate) },
            { key: 'keys', header: 'Keys in Redis', align: 'right', cell: (n) => num(n.redisKeys) },
          ]}
        />
      </Section>
    </div>
  );
}
