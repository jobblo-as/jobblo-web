import { useState } from 'react';
import { Copy, CheckCircle2 } from 'lucide-react';
import { AdminStatusBadge } from '../AdminStatusBadge';
import { Mono, Section } from '../../developer/kit';
import { Button } from '../../developer/ui/button';
import type { AdminChatDetail } from '../../../api/admin/chats';

interface ChatReviewHeaderProps {
  chat: AdminChatDetail;
  onClear?: () => void;
  onSearchAnother?: () => void;
}

export function ChatReviewHeader({ chat, onClear, onSearchAnother }: ChatReviewHeaderProps) {
  const [copied, setCopied] = useState(false);

  const copyId = () => {
    navigator.clipboard.writeText(chat._id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const fmt = (d?: string | null) =>
    d
      ? new Date(d).toLocaleString('nb-NO', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '–';

  return (
    <Section
      title={
        <span className="flex flex-wrap items-center gap-2">
          Chat ID
          <Mono className="select-all">{chat._id}</Mono>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={copyId}
            aria-label="Kopier Chat ID"
            title="Kopier Chat ID"
          >
            {copied ? (
              <CheckCircle2 className="text-emerald-600" aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </Button>
          <AdminStatusBadge status={chat.status} />
        </span>
      }
      description="Skrivebeskyttet visning — admin kan ikke redigere, slette eller sende meldinger."
      action={
        (onSearchAnother || onClear) && (
          <div className="flex items-center gap-2">
            {onSearchAnother && (
              <Button variant="outline" size="sm" className="bg-card" onClick={onSearchAnother}>
                Søk annen chat
              </Button>
            )}
            {onClear && (
              <Button variant="destructive" size="sm" onClick={onClear}>
                Fjern chat
              </Button>
            )}
          </div>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Meldinger', value: chat.messageCount },
          { label: 'Vedlegg', value: chat.attachmentCount },
          { label: 'Rapporter', value: chat.reportCount },
          { label: 'Opprettet', value: fmt(chat.createdAt) },
          { label: 'Oppdatert', value: fmt(chat.updatedAt) },
          { label: 'Siste melding', value: fmt(chat.lastMessageAt) },
        ].map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate text-sm font-medium text-foreground tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
