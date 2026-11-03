import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart } from 'recharts';
import {
  Users,
  Briefcase,
  ShoppingCart,
  DollarSign,
  Star,
  CreditCard,
  RefreshCw,
} from 'lucide-react';
import { useDashboardOverview } from '../../hooks/admin';
import {
  AdminStatCard,
  AdminStatCardSkeleton,
  AdminActivityItem,
  AdminStatusBadge,
  AdminErrorState,
  AdminEmptyState,
} from '../../components/admin';
import { CountBars, PageHeader, Section } from '../../components/developer/kit';
import { TimeSeriesChart } from '../../components/developer/TimeSeriesChart';
import { Button } from '../../components/developer/ui/button';
import { Skeleton } from '../../components/developer/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/developer/ui/avatar';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../../components/developer/ui/chart';
import type {
  AdminActivity,
  TrendPoint,
  RecentUser,
  RecentService,
  RecentOrder,
  RoleDistribution,
  OrderStatusDistribution,
} from '../../types/admin';
import { format, formatDistanceToNow } from 'date-fns';
import { nb } from 'date-fns/locale';

// ─── Registrations per day (dev TimeSeriesChart) ─────────────────────────────
function BarChart({ data }: { data: TrendPoint[] }) {
  if (!data.length)
    return <AdminEmptyState description="Ingen registreringer siste 30 dager." className="py-6" />;
  return (
    <div role="img" aria-label="Brukerregistreringer siste 30 dager">
      <TimeSeriesChart
        variant="bar"
        height={180}
        bucketMs={86_400_000}
        data={data.map((d) => ({ t: d._id, count: d.count }))}
        series={[{ key: 'count', label: 'Brukere', color: 'var(--chart-1)' }]}
      />
    </div>
  );
}

// ─── Donut chart for role distribution ───────────────────────────────────────
const ROLE_CHART: ChartConfig = {
  user: { label: 'Bruker', color: 'var(--chart-1)' },
  provider: { label: 'Tilbyder', color: 'var(--chart-2)' },
  company: { label: 'Bedrift', color: 'var(--chart-3)' },
  superAdmin: { label: 'Super Admin', color: 'var(--chart-4)' },
};

function DonutChart({ data }: { data: RoleDistribution }) {
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  if (total === 0) return <AdminEmptyState description="Ingen brukerdata." className="py-6" />;

  const rows = entries.map(([role, count]) => ({ role, count }));
  const color = (role: string) => ROLE_CHART[role]?.color ?? 'var(--chart-5)';

  return (
    <div
      className="flex flex-col items-center justify-center gap-6 sm:flex-row"
      role="img"
      aria-label="Rollefordeling"
    >
      <div className="relative size-36 shrink-0">
        <ChartContainer config={ROLE_CHART} className="aspect-square size-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="role" hideLabel />} />
            <Pie
              data={rows}
              dataKey="count"
              nameKey="role"
              innerRadius={48}
              outerRadius={66}
              strokeWidth={2}
            >
              {rows.map((r) => (
                <Cell key={r.role} fill={color(r.role)} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {total.toLocaleString('nb-NO')}
          </span>
          <span className="text-[10px] text-muted-foreground">brukere</span>
        </div>
      </div>
      <ul className="w-full max-w-[190px] space-y-2 text-sm">
        {entries.map(([role, count]) => (
          <li key={role} className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: color(role) }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{ROLE_CHART[role]?.label ?? role}</span>
            <span className="ml-auto tabular-nums text-foreground">
              {count.toLocaleString('nb-NO')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Order status bars (dev CountBars) ───────────────────────────────────────
const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Venter',
  accepted: 'Akseptert',
  in_progress: 'Pågår',
  completed: 'Fullført',
  cancelled: 'Avbrutt',
  paid: 'Betalt',
  awaiting_payment: 'Venter betaling',
  declined: 'Avslått',
};

function OrderStatusChart({ data }: { data: OrderStatusDistribution }) {
  const entries = Object.entries(data).filter(([, v]) => (v ?? 0) > 0);
  if (!entries.length) return <AdminEmptyState description="Ingen ordredata." className="py-6" />;
  return (
    <div aria-label="Ordrestatus-fordeling">
      <CountBars
        counts={Object.fromEntries(
          entries.map(([status, count]) => [ORDER_STATUS_LABELS[status] ?? status, count ?? 0])
        )}
      />
    </div>
  );
}

// ─── Recent rows ──────────────────────────────────────────────────────────────
const LIST = 'divide-y text-sm';
const ROW = 'flex items-center gap-3 py-2 first:pt-0 last:pb-0';

function RecentUsersTable({ users }: { users: RecentUser[] }) {
  if (!users.length) return <AdminEmptyState description="Ingen nye brukere." className="py-6" />;
  return (
    <ul className={LIST} role="list">
      {users.map((u) => (
        <li key={u._id} className={ROW} role="listitem">
          <Avatar>
            <AvatarImage src={u.avatarUrl} alt={u.name} />
            <AvatarFallback>{u.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-foreground">{u.name}</p>
            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
          </div>
          <AdminStatusBadge status={u.role} />
        </li>
      ))}
    </ul>
  );
}

function RecentServicesTable({ services }: { services: RecentService[] }) {
  if (!services.length)
    return <AdminEmptyState description="Ingen nye tjenester." className="py-6" />;
  return (
    <ul className={LIST} role="list">
      {services.map((s) => (
        <li key={s._id} className={ROW} role="listitem">
          <div className="min-w-0 flex-1">
            <p className="truncate text-foreground">{s.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {s.userId?.name ?? 'Ukjent'} ·{' '}
              {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true, locale: nb })}
            </p>
          </div>
          <AdminStatusBadge status={s.status} />
        </li>
      ))}
    </ul>
  );
}

function RecentOrdersTable({ orders }: { orders: RecentOrder[] }) {
  if (!orders.length) return <AdminEmptyState description="Ingen nye ordrer." className="py-6" />;
  return (
    <ul className={LIST} role="list">
      {orders.map((o) => (
        <li key={o._id} className={ROW} role="listitem">
          <div className="min-w-0 flex-1">
            <p className="truncate text-foreground">{o.serviceId?.title ?? 'Ukjent tjeneste'}</p>
            <p className="truncate text-xs text-muted-foreground">
              {o.customerId?.name ?? 'Ukjent kunde'} ·{' '}
              {o.agreedPrice != null
                ? `${o.agreedPrice.toLocaleString('nb-NO')} NOK`
                : 'Pris ikke satt'}
            </p>
          </div>
          <AdminStatusBadge status={o.status} />
        </li>
      ))}
    </ul>
  );
}

// Section header action, like the dev pages' "Details" / "All" links.
const seeAll = (to: string, label = 'Se alle') => (
  <Button variant="ghost" size="sm" asChild>
    <Link to={to}>{label}</Link>
  </Button>
);

const listSkeleton = (n: number, h = 'h-10') => (
  <div className="space-y-2">
    {Array.from({ length: n }).map((_, i) => (
      <Skeleton key={i} className={`${h} w-full`} />
    ))}
  </div>
);

function groupRecentActivity(items: AdminActivity[]) {
  const groups = new Map<string, { item: AdminActivity; occurrences: number }>();

  for (const item of items) {
    const actorId = typeof item.adminId === 'object' && item.adminId ? item.adminId._id : null;
    const key = JSON.stringify([
      actorId,
      item.action,
      item.targetModel,
      actorId ? item.targetId : null,
      item.description,
    ]);
    const existing = groups.get(key);
    if (existing) existing.occurrences += 1;
    else groups.set(key, { item, occurrences: 1 });
  }

  return [...groups.values()];
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function DashboardOverviewPage() {
  const { data, dataUpdatedAt, isLoading, isFetching, isError, refetch } = useDashboardOverview();
  const activityGroups = useMemo(
    () => groupRecentActivity(data?.recentActivity ?? []),
    [data?.recentActivity]
  );

  // KPI cards config
  const cards = useMemo(() => {
    if (!data) return [];
    return [
      {
        title: 'Totale brukere',
        value: data.stats.totalUsers.value,
        icon: <Users />,
        change: data.stats.totalUsers.change,
        to: '/dashboard/users',
      },
      {
        title: 'Tjenester',
        value: data.stats.totalServices.value,
        icon: <Briefcase />,
        subtitle: `${data.stats.totalServices.thisMonth ?? 0} denne måneden`,
        to: '/dashboard/services',
      },
      {
        title: 'Ordrer',
        value: data.stats.totalOrders.value,
        icon: <ShoppingCart />,
        subtitle: `${data.stats.totalOrders.thisMonth ?? 0} denne måneden`,
        to: '/dashboard/orders',
      },
      {
        title: 'Inntekt (NOK)',
        value: data.stats.revenueThisMonth.value.toLocaleString('nb-NO'),
        icon: <DollarSign />,
        change: data.stats.revenueThisMonth.change,
        subtitle: 'Inntekt denne måneden',
      },
      {
        title: 'Aktive abonnementer',
        value: data.stats.activeSubscriptions.value,
        icon: <CreditCard />,
        to: '/dashboard/plans',
      },
      {
        title: 'Vurderinger',
        value: data.stats.totalReviews.value,
        icon: <Star />,
        to: '/dashboard/reviews',
      },
    ];
  }, [data]);

  if (isError) {
    return (
      <AdminErrorState
        title="Kunne ikke laste dashbord"
        description="Noe gikk galt ved henting av oversiktsdata."
        onRetry={refetch}
        className="min-h-[60vh]"
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashbord"
        description={`Oversikt over plattformaktivitet${
          dataUpdatedAt > 0
            ? ` · Oppdatert ${format(new Date(dataUpdatedAt), 'HH:mm', { locale: nb })}`
            : ''
        }`}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="bg-card"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={isFetching ? 'animate-spin' : undefined} />
            Oppdater
          </Button>
        }
      />

      {/* KPI stat cards */}
      <section
        aria-label="Nøkkeltall"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      >
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <AdminStatCardSkeleton key={i} />)
          : cards.map((c) => (
              <AdminStatCard
                key={c.title}
                title={c.title}
                value={c.value}
                icon={c.icon}
                change={c.change}
                subtitle={c.subtitle}
                to={c.to}
              />
            ))}
      </section>

      {/* Charts row */}
      <section aria-label="Diagrammer" className="grid gap-4 lg:grid-cols-3">
        <Section
          title="Brukerregistreringer"
          description="Siste 30 dager"
          className="lg:col-span-2"
        >
          {isLoading ? (
            <Skeleton className="h-44 w-full" />
          ) : (
            data && <BarChart data={data.userRegistrationTrend} />
          )}
        </Section>

        <Section title="Rollefordeling" description="Alle brukere">
          {isLoading ? (
            <Skeleton className="h-44 w-full" />
          ) : (
            data && <DonutChart data={data.roleDistribution} />
          )}
        </Section>
      </section>

      <section aria-label="Ordrestatus og aktivitet" className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Ordrestatus"
          description={`${data?.stats.totalOrders.value.toLocaleString('nb-NO') ?? '–'} ordrer totalt`}
        >
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            data && <OrderStatusChart data={data.orderStatusDistribution} />
          )}
        </Section>

        <Section
          title="Siste adminaktivitet"
          description={`${data?.recentActivity?.length ?? 0} siste hendelser · like systemmeldinger samles`}
          action={seeAll('/developer/audit', 'Aktivitetslogg')}
        >
          {isLoading ? (
            listSkeleton(4, 'h-12')
          ) : !data?.recentActivity?.length ? (
            <AdminEmptyState description="Ingen aktivitet registrert ennå." className="py-6" />
          ) : (
            <div className="-mx-3 max-h-[360px] space-y-1 overflow-y-auto">
              {activityGroups.map(({ item, occurrences }) => (
                <AdminActivityItem key={item._id} item={item} occurrences={occurrences} />
              ))}
            </div>
          )}
        </Section>
      </section>

      {/* Recent rows */}
      <section aria-label="Siste oppføringer" className="grid gap-4 lg:grid-cols-3">
        <Section title="Siste brukere" action={seeAll('/dashboard/users')}>
          {isLoading ? listSkeleton(4) : <RecentUsersTable users={data?.recentUsers ?? []} />}
        </Section>

        <Section title="Siste tjenester" action={seeAll('/dashboard/services')}>
          {isLoading ? (
            listSkeleton(4)
          ) : (
            <RecentServicesTable services={data?.recentServices ?? []} />
          )}
        </Section>

        <Section title="Siste ordrer" action={seeAll('/dashboard/orders')}>
          {isLoading ? listSkeleton(4) : <RecentOrdersTable orders={data?.recentOrders ?? []} />}
        </Section>
      </section>
    </div>
  );
}
