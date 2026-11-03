import React, { useEffect, useRef } from 'react';
import { ChatReviewHeader } from './ChatReviewHeader';
import { ChatParticipantsCard } from './ChatParticipantsCard';
import { ChatRelatedRecordsCard } from './ChatRelatedRecordsCard';
import { AdminMessageBubble } from './AdminMessageBubble';
import { EmptyState, Section, StatusBadge } from '../../developer/kit';
import type { AdminChatDetailResponse } from '../../../api/admin/chats';

interface AdminChatViewerProps {
  data: AdminChatDetailResponse;
  highlightMessageId?: string | null;
  onClear?: () => void;
  onSearchAnother?: () => void;
  reportSummary?: React.ReactNode;
}

export function AdminChatViewer({
  data,
  highlightMessageId,
  onClear,
  onSearchAnother,
  reportSummary,
}: AdminChatViewerProps) {
  const { chat, participants, relatedRecords, messages } = data;
  const highlightRef = useRef<HTMLDivElement>(null);

  // Guard — participants/relatedRecords may be missing if the API shape differs
  const safeParticipants = participants ?? { customer: null, provider: null };
  const safeRecords = relatedRecords ?? {};
  const safeMessages = messages ?? [];
  const customerId = safeParticipants.customer?._id;

  // Scroll to highlighted message after render
  useEffect(() => {
    if (highlightMessageId) {
      const el = document.getElementById(`msg-${highlightMessageId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlightMessageId, messages]);

  return (
    <div className="space-y-4">
      {/* Header — with Clear / Search Another buttons */}
      <ChatReviewHeader chat={chat} onClear={onClear} onSearchAnother={onSearchAnother} />

      {/* Two-column layout on large screens */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Messages — left 2/3 */}
        <div className="lg:col-span-2 space-y-4">
          {/* Report summary panel (when opened from a report link) */}
          {reportSummary && <Section title="Rapport-sammendrag">{reportSummary}</Section>}

          {/* Messages */}
          <Section
            title={`Meldinger (${safeMessages.length})`}
            action={<StatusBadge status="read_only" tone="warning" label="Kun lesing" />}
          >
            <div
              ref={highlightRef}
              className="max-h-[600px] space-y-3 overflow-y-auto"
              aria-label="Chatmeldinger (skrivebeskyttet)"
              aria-live="off"
            >
              {safeMessages.length === 0 ? (
                <EmptyState title="Ingen meldinger i denne chatten." />
              ) : (
                safeMessages.map((msg) => (
                  <AdminMessageBubble
                    key={msg._id}
                    message={msg}
                    customerId={customerId}
                    isHighlighted={!!highlightMessageId && msg._id === highlightMessageId}
                  />
                ))
              )}
            </div>
          </Section>
        </div>

        {/* Sidebar — right 1/3 */}
        <div className="space-y-4">
          <ChatParticipantsCard participants={safeParticipants} />
          <ChatRelatedRecordsCard records={safeRecords as typeof relatedRecords} />
        </div>
      </div>
    </div>
  );
}
