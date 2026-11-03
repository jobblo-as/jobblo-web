import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { AdminStatusBadge } from '../AdminStatusBadge';
import { KeyValue, Mono, Section } from '../../developer/kit';
import { Button } from '../../developer/ui/button';
import type { AdminChatRelatedRecords } from '../../../api/admin/chats';

interface ChatRelatedRecordsCardProps {
  records: AdminChatRelatedRecords;
}

const linkTo = (to: string | null | undefined, text: string) =>
  to ? (
    <Link to={to} className="font-mono text-xs text-primary hover:underline">
      {text}
    </Link>
  ) : (
    <span className="font-mono text-xs">{text}</span>
  );

export function ChatRelatedRecordsCard({ records }: ChatRelatedRecordsCardProps) {
  const rows: [string, ReactNode][] = [];
  if (records.serviceTitle) rows.push(['Tjeneste', records.serviceTitle]);
  if (records.serviceId) rows.push(['Tjeneste-ID', <Mono key="s">{records.serviceId}</Mono>]);
  if (records.orderId)
    rows.push([
      'Ordre-ID',
      linkTo(
        `/dashboard/orders/${records.orderId}`,
        String(records.orderId).slice(-8).toUpperCase()
      ),
    ]);
  if (records.safePayOrderId)
    rows.push([
      'SafePay-ordre',
      linkTo(records.safePayDetailLink, String(records.safePayOrderId).slice(-8).toUpperCase()),
    ]);
  if (records.orderStatus)
    rows.push(['Ordrestatus', <AdminStatusBadge key="o" status={records.orderStatus} />]);
  if (records.paymentStatus)
    rows.push(['Betalingsstatus', <AdminStatusBadge key="p" status={records.paymentStatus} />]);
  if (records.disputeStatus)
    rows.push(['Tviststatus', <AdminStatusBadge key="d" status={records.disputeStatus} />]);
  if (records.agreedPrice != null)
    rows.push(['Avtalt pris', `${Number(records.agreedPrice).toLocaleString('nb-NO')} NOK`]);
  if (records.disputeId)
    rows.push([
      'Tvist',
      <Link
        key="t"
        to={`/dashboard/disputes/${records.disputeId}`}
        className="text-primary hover:underline"
      >
        Se tvist
      </Link>,
    ]);

  return (
    <Section title="Tilknyttede data">
      {rows.length ? (
        <KeyValue items={rows} />
      ) : (
        <p className="text-sm text-muted-foreground">Ingen data.</p>
      )}

      {(records.safePayDetailLink || records.reportDetailLink) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
          {records.safePayDetailLink && (
            <Button variant="outline" size="sm" className="bg-card" asChild>
              <Link to={records.safePayDetailLink}>
                SafePay-detaljer <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          )}
          {records.reportDetailLink && (
            <Button variant="outline" size="sm" className="bg-card" asChild>
              <Link to={records.reportDetailLink}>
                Se rapporter <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}
