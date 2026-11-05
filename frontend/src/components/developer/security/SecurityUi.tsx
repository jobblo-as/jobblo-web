import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  AlertConfidence,
  AlertStatus,
  IpNetworkIntel,
  RiskBand,
} from '../../../api/developer';
import { StatusBadge } from '../kit';
import { ALL, STATUS_LABEL } from './labels';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

/** Shared bits of the Security Intelligence pages. */

const BAND_TONE = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
} as const;

export function SeverityBadge({ value }: { value: RiskBand | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <StatusBadge status={value} label={value} tone={BAND_TONE[value]} />;
}

const STATUS_TONE: Record<AlertStatus, 'info' | 'warning' | 'success' | 'neutral' | 'danger'> = {
  open: 'info',
  investigating: 'warning',
  resolved: 'success',
  false_positive: 'neutral',
  escalated: 'danger',
};
export function AlertStatusBadge({ value }: { value: AlertStatus }) {
  return <StatusBadge status={value} label={STATUS_LABEL[value]} tone={STATUS_TONE[value]} />;
}

const CONFIDENCE_HINT: Record<AlertConfidence, string> = {
  confirmed: 'Confirmed by the data itself',
  likely: 'Likely: a signed browser cookie',
  possible: 'Possible: an app-made id or shared signal',
};
export function ConfidenceText({ value }: { value: AlertConfidence }) {
  return (
    <span className="text-xs text-muted-foreground" title={CONFIDENCE_HINT[value]}>
      {value}
    </span>
  );
}

const NETWORK_LABEL: Record<string, string> = {
  tor: 'Tor',
  vpn_proxy: 'VPN / proxy',
  hosting: 'Hosting / datacenter',
  mobile: 'Mobile network',
  residential: 'Residential',
  private: 'Private network',
  unknown: 'Unknown',
};
const NETWORK_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral' | 'success'> = {
  tor: 'danger',
  vpn_proxy: 'warning',
  hosting: 'warning',
  mobile: 'info',
  residential: 'success',
  private: 'neutral',
  unknown: 'neutral',
};
/** The class, and — on hover — where it came from and how sure it is. Never a verdict. */
export function NetworkBadge({ network }: { network: IpNetworkIntel | null | undefined }) {
  const cls = network?.class || 'unknown';
  const title = network
    ? `${NETWORK_LABEL[cls]} · confidence ${network.confidence}${network.sources?.length ? ` · ${network.sources.join(', ')}` : ''}${network.checkedAt ? ` · checked ${new Date(network.checkedAt).toLocaleString('nb-NO')}` : ''}`
    : 'Not classified yet';
  return (
    <span title={title}>
      <StatusBadge status={cls} label={NETWORK_LABEL[cls]} tone={NETWORK_TONE[cls]} />
    </span>
  );
}

export function DeviceLink({
  deviceKey,
  label,
}: {
  deviceKey: string | null | undefined;
  label: ReactNode;
}) {
  if (!deviceKey) return <span className="text-muted-foreground">—</span>;
  return (
    <Link
      to={`/developer/security-intel/devices/${deviceKey}`}
      className="font-mono text-sm font-medium text-primary hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </Link>
  );
}

export function IpLink({ ip }: { ip: string }) {
  return (
    <Link
      to={`/developer/ips/${encodeURIComponent(ip)}`}
      className="font-mono text-sm text-primary hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {ip}
    </Link>
  );
}

/** A compact filter dropdown; ALL = no filter. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  width = 'w-40',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  width?: string;
}) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <SelectTrigger size="sm" className={`${width} bg-card`} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: all</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
