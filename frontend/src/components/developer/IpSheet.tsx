import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Globe, KeyRound, ShieldAlert } from 'lucide-react';
import { ago, num } from '@/lib/devFormat';
import { useDevBlocks, useDevIpActivity, useDevMe } from '../../features/developer/hooks';
import type { AuthEventType, RangeKey } from '../../api/developer';
import { BlockIpDialog } from './BlockIpDialog';
import { EmptyState, MethodBadge, StatusBadge } from './kit';
import { TimeSeriesChart } from './TimeSeriesChart';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';

const AUTH_LABEL: Record<AuthEventType, { text: string; tone: 'success' | 'danger' | 'warning' }> =
  {
    login: { text: 'Logged in', tone: 'success' },
    login_failed: { text: 'Login failed', tone: 'danger' },
    password_reset_requested: { text: 'Forgot password: code sent', tone: 'warning' },
    password_reset: { text: 'Password changed', tone: 'success' },
    password_reset_failed: { text: 'Password reset failed', tone: 'danger' },
  };

/** "Chrome · Windows" from a user agent; the raw string is in the tooltip. */
const deviceOf = (ua: string | null) => {
  if (!ua) return '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /okhttp|Expo|Dalvik|CFNetwork/i.test(ua)
            ? 'Jobblo app'
            : 'Other';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iOS|CFNetwork/.test(ua)
        ? 'iOS'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return [browser, os].filter(Boolean).join(' · ');
};

/** Everything one IP did in a range, with a block action. Shared by API Monitoring, Security and IP Management. */
export function IpSheet({
  ip,
  range,
  onClose,
}: {
  ip: string | null;
  range: RangeKey;
  onClose: () => void;
}) {
  const { data, isLoading } = useDevIpActivity({ ip: ip || undefined, range });
  const { data: me } = useDevMe();
  const { data: blockData } = useDevBlocks();
  const [blocking, setBlocking] = useState(false);
  const isBlocked = (blockData?.blocks || []).some((x) => x.target === ip);
  const isMe = ip === blockData?.yourIp;
  const total = data?.endpoints.reduce((a, e) => a + e.requests, 0) || 0;
  const failed = data?.endpoints.reduce((a, e) => a + e.failed, 0) || 0;
  const security = Object.entries(data?.security || {});
  return (
    <Sheet open={Boolean(ip)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 font-mono text-sm">
            <Globe className="size-4 text-muted-foreground" />
            {ip}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            {num(total)} requests · {num(failed)} failed · {data?.endpoints.length ?? 0} endpoints
            in range
            {isBlocked && <StatusBadge status="blocked" tone="danger" />}
            {isMe && <StatusBadge status="you" tone="info" label="your IP" />}
          </SheetDescription>
          {(me?.can.execute || me?.can.request) && !isBlocked && !isMe && (
            <Button
              variant="destructive"
              size="sm"
              className="w-fit"
              onClick={() => setBlocking(true)}
            >
              <Ban /> Block this IP
            </Button>
          )}
        </SheetHeader>
        <div className="space-y-5 overflow-y-auto p-4">
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
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
              <KeyRound className="size-3.5" /> Login &amp; password
            </h4>
            {data?.auth?.length ? (
              <ul className="divide-y rounded-md border text-sm">
                {data.auth.map((a, i) => (
                  <li key={`${a.at}-${i}`} className="flex items-start gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <StatusBadge
                        status={a.type}
                        tone={AUTH_LABEL[a.type]?.tone ?? 'neutral'}
                        label={AUTH_LABEL[a.type]?.text ?? a.type}
                      />
                      <div className="mt-1 truncate text-xs" title={a.userAgent || ''}>
                        <span className="font-mono">{a.email || 'no email'}</span>
                        {a.userAgent && (
                          <span className="text-muted-foreground"> · {deviceOf(a.userAgent)}</span>
                        )}
                      </div>
                    </div>
                    <span
                      className="shrink-0 text-right text-xs text-muted-foreground"
                      title={new Date(a.at).toLocaleString('nb-NO')}
                    >
                      {ago(a.at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No sign-ins or password resets from this IP in range" />
            )}
          </div>
          <div>
            <h4 className="mb-2 text-xs font-medium text-muted-foreground uppercase">
              Requests over time
            </h4>
            <TimeSeriesChart
              data={data?.series}
              bucketMs={data?.range.bucketMs}
              height={150}
              variant="bar"
              series={[
                { key: 'requests', label: 'Requests', color: 'var(--chart-1)' },
                { key: 'failed', label: 'Failed', color: 'var(--chart-5)' },
              ]}
            />
          </div>
          <div>
            <h4 className="mb-2 text-xs font-medium text-muted-foreground uppercase">
              Endpoints called
            </h4>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : data?.endpoints.length ? (
              <ul className="divide-y rounded-md border text-sm">
                {data.endpoints.map((e) => (
                  <li key={`${e.method} ${e.route}`} className="flex items-center gap-2 px-3 py-2">
                    <MethodBadge method={e.method} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{e.route}</span>
                    <span className="text-xs tabular-nums">
                      {num(e.requests)}
                      {e.failed > 0 && (
                        <span className="ml-1 text-amber-600">({num(e.failed)} failed)</span>
                      )}
                    </span>
                    <span className="w-24 text-right text-xs text-muted-foreground">
                      {ago(e.lastSeen)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No requests from this IP in range" />
            )}
          </div>
          <Link
            to={`/developer/logs?q=${encodeURIComponent(ip || '')}`}
            className="inline-block text-xs text-primary hover:underline"
          >
            Search logs for this IP →
          </Link>
        </div>
        <BlockIpDialog ip={ip || ''} open={blocking} onOpenChange={setBlocking} />
      </SheetContent>
    </Sheet>
  );
}
