import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, CheckCircle2, MessageSquare } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '../../developer/ui/button';

interface ChatIdCellProps {
  chatId?: string | null;
  /** URL source param — used to pre-select access reason */
  reviewSource?: 'safepay' | 'report';
  reportId?: string;
}

export function ChatIdCell({ chatId, reviewSource = 'safepay', reportId }: ChatIdCellProps) {
  const [copied, setCopied] = useState(false);

  if (!chatId) {
    return <span className="text-xs text-muted-foreground">Ingen tilknyttet chat</span>;
  }

  const truncated = `${chatId.slice(0, 8)}…${chatId.slice(-4)}`;

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText(chatId).then(() => {
      setCopied(true);
      toast.success('Chat ID kopiert');
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const reviewUrl = reportId
    ? `/dashboard/chat-review?chatId=${chatId}&reportId=${reportId}&source=${reviewSource}`
    : `/dashboard/chat-review?chatId=${chatId}&source=${reviewSource}`;

  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-xs text-muted-foreground select-all" title={chatId}>
        {truncated}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleCopy}
        aria-label="Kopier Chat ID"
        title="Kopier Chat ID"
      >
        {copied ? (
          <CheckCircle2 className="text-emerald-600" aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
      </Button>
      <Button variant="outline" size="xs" asChild>
        <Link to={reviewUrl} title="Gjennomgå chat">
          <MessageSquare aria-hidden="true" />
          Gjennomgå
        </Link>
      </Button>
    </div>
  );
}
