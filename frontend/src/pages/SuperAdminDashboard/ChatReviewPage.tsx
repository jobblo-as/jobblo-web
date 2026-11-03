import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { fetchAdminChatById, fetchAdminChatReportById } from '../../api/admin/chats';
import type { AdminChatDetailResponse, AdminChatReportDetail } from '../../api/admin/chats';
import { ChatIdSearchForm } from '../../components/admin/chat/ChatIdSearchForm';
import { ChatAccessReasonDialog } from '../../components/admin/chat/ChatAccessReasonDialog';
import { ChatReviewEmptyState } from '../../components/admin/chat/ChatReviewEmptyState';
import { AdminChatViewer } from '../../components/admin/chat/AdminChatViewer';
import { AdminPageHeader, AdminStatusBadge } from '../../components/admin';
import { KeyValue, Section } from '../../components/developer/kit';
import { Card } from '../../components/developer/ui/card';
import { Skeleton } from '../../components/developer/ui/skeleton';

// ── Source → default access reason mapping ─────────────────────────────────
const SOURCE_REASON: Record<string, string> = {
  safepay: 'SafePay review',
  report: 'Chat report investigation',
};

// ── Report summary panel ──────────────────────────────────────────────────
function ReportSummaryPanel({ report }: { report: AdminChatReportDetail }) {
  return (
    <div className="space-y-3">
      <KeyValue
        items={[
          ['Type', report.reportType.replace(/_/g, ' ')],
          ['Tittel', report.title],
          ['Status', <AdminStatusBadge key="s" status={report.status} />],
          ['Rapportert av', report.reportedBy?.name ?? '–'],
          ['Rapportert bruker', report.reportedUser?.name ?? '–'],
        ]}
      />
      {report.description && (
        <p className="text-sm leading-relaxed text-muted-foreground">{report.description}</p>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function ChatReviewPage() {
  const [searchParams] = useSearchParams();

  // URL params — pre-fill only; never auto-trigger query
  const urlChatId = searchParams.get('chatId') ?? '';
  const urlSource = searchParams.get('source') ?? '';
  const urlReportId = searchParams.get('reportId') ?? '';

  // Local state — controls when query fires
  const [submittedChatId, setSubmittedChatId] = useState<string>('');
  const [confirmedReason, setConfirmedReason] = useState<string>('');
  const [showDialog, setShowDialog] = useState(false);
  const [pendingChatId, setPendingChatId] = useState<string>('');
  const [chatData, setChatData] = useState<AdminChatDetailResponse | null>(null);

  // React Query — NEVER auto-executes (enabled: false)
  const chatQuery = useQuery({
    queryKey: ['admin-chat', submittedChatId, confirmedReason],
    queryFn: () => fetchAdminChatById(submittedChatId, confirmedReason),
    enabled: false, // manual refetch only
    retry: false,
  });

  // Report detail — only when reportId is present and chat is loaded
  const reportQuery = useQuery({
    queryKey: ['admin-chat-report', urlReportId],
    queryFn: () => fetchAdminChatReportById(urlReportId),
    enabled: false,
    retry: false,
  });

  // When query succeeds — store data
  useEffect(() => {
    if (chatQuery.data) {
      setChatData(chatQuery.data);
      if (urlReportId) {
        reportQuery.refetch();
      }
    }
  }, [chatQuery.data]);

  // ── Step 1: Admin submits a Chat ID ──────────────────────────────────────
  const handleSearch = useCallback((chatId: string) => {
    setPendingChatId(chatId);
    setShowDialog(true);
  }, []);

  // ── Step 2: Admin confirms access reason ──────────────────────────────────
  const handleConfirmReason = useCallback(
    async (reason: string) => {
      setShowDialog(false);
      setConfirmedReason(reason);
      setSubmittedChatId(pendingChatId);

      // Trigger the query after state settles
      setTimeout(() => {
        chatQuery.refetch().catch(() => {
          // errors handled via chatQuery.isError below
        });
      }, 0);
    },
    [pendingChatId]
  );

  // Refetch whenever submittedChatId + confirmedReason are both set
  useEffect(() => {
    if (submittedChatId && confirmedReason) {
      chatQuery.refetch();
    }
  }, [submittedChatId, confirmedReason]);

  // Show error toast
  useEffect(() => {
    if (chatQuery.isError) {
      const err = chatQuery.error as { response?: { data?: { message?: string } } };
      const msg = err?.response?.data?.message ?? 'Chat ikke funnet eller tilgang nektet.';
      toast.error(msg);
    }
  }, [chatQuery.isError]);

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    setChatData(null);
    setSubmittedChatId('');
    setConfirmedReason('');
    setPendingChatId('');
  }, []);

  const handleSearchAnother = useCallback(() => {
    setChatData(null);
    setSubmittedChatId('');
    setConfirmedReason('');
    setPendingChatId('');
  }, []);

  // ── Dialog cancel ────────────────────────────────────────────────────────
  const handleCancelDialog = useCallback(() => {
    setShowDialog(false);
    setPendingChatId('');
    // Do NOT load chat — Req 3.5
  }, []);

  const defaultReason = SOURCE_REASON[urlSource] ?? '';
  const highlightMessageId = reportQuery.data?.messageId ?? null;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Chat-gjennomgang"
        description="Søk på Chat ID for å gjennomgå en samtale på en sikker måte."
      />

      <Section
        title="Søk på Chat ID"
        description="Chatter vises ikke automatisk. Skriv inn et eksakt Chat ID og oppgi en tilgangsgrunn. Alle tilganger logges automatisk."
      >
        <ChatIdSearchForm
          onSearch={handleSearch}
          defaultValue={urlChatId}
          loading={chatQuery.isFetching}
        />
        {chatQuery.isError && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {(chatQuery.error as { response?: { data?: { message?: string } } })?.response?.data
              ?.message ?? 'Feil ved henting av chat. Sjekk Chat ID og prøv igjen.'}
          </p>
        )}
      </Section>

      {/* Access reason dialog */}
      <ChatAccessReasonDialog
        open={showDialog}
        defaultReason={defaultReason}
        onConfirm={handleConfirmReason}
        onCancel={handleCancelDialog}
      />

      {/* Main content */}
      {chatQuery.isFetching ? (
        <div className="space-y-4" role="status" aria-label="Laster chat…">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : chatData ? (
        <AdminChatViewer
          data={chatData}
          highlightMessageId={highlightMessageId}
          onClear={handleClear}
          onSearchAnother={handleSearchAnother}
          reportSummary={
            reportQuery.data ? <ReportSummaryPanel report={reportQuery.data} /> : undefined
          }
        />
      ) : (
        <Card>
          <ChatReviewEmptyState />
        </Card>
      )}
    </div>
  );
}
