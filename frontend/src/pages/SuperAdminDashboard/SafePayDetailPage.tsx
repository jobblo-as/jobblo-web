import React, { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/developer/ui/avatar';
import { Button } from '../../components/developer/ui/button';
import { Card, CardContent } from '../../components/developer/ui/card';
import { Checkbox } from '../../components/developer/ui/checkbox';
import { Progress } from '../../components/developer/ui/progress';
import { Textarea } from '../../components/developer/ui/textarea';
import { Section, StatusBadge, Timeline } from '../../components/developer/kit';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Copy,
  ExternalLink,
  FileText,
  MessageSquare,
  Lock,
  Loader2,
  Star,
} from 'lucide-react';
import { useSafePayDetail, useSafePayTimeline, useSafePayChat } from '../../hooks/admin/safepay';
import type { AdminChatMessage } from '../../api/admin/safepay';
import {
  AdminStatusBadge,
  AdminLoadingSkeleton,
  AdminErrorState,
  AdminEmptyState,
  AdminPageHeader,
} from '../../components/admin';

// ── Helpers ────────────────────────────────────────────────────────────────────
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => {
        copyToClipboard(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-muted-foreground"
      aria-label="Kopier"
    >
      {copied ? <CheckCircle2 className="text-emerald-600" /> : <Copy />}
    </Button>
  );
}

function Row({
  label,
  value,
  badge,
  copy,
}: {
  label: string;
  value?: React.ReactNode;
  badge?: string;
  copy?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="w-36 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1 text-right text-sm text-foreground">
        {badge ? (
          <AdminStatusBadge status={badge} />
        ) : (
          (value ?? <span className="text-muted-foreground">–</span>)
        )}
        {copy && <CopyButton value={copy} />}
      </span>
    </div>
  );
}

function UserCard({
  user,
  role,
}: {
  user?: {
    _id?: string;
    name?: string;
    email?: string;
    avatarUrl?: string;
    verified?: boolean;
    accountStatus?: string;
    averageRating?: number;
    completedJobs?: number;
  } | null;
  role: string;
}) {
  if (!user) return <p className="text-sm text-muted-foreground">Ikke tilgjengelig</p>;
  return (
    <div className="flex items-start gap-3">
      <Avatar size="lg">
        {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
        <AvatarFallback>{(user.name ?? 'U')[0]?.toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{user.name}</p>
        <p className="text-xs text-muted-foreground">{user.email}</p>
        <p className="text-xs text-muted-foreground capitalize">{role}</p>
        <div className="flex items-center gap-2 mt-1">
          {user.verified && <StatusBadge status="verified" tone="success" label="Verifisert" />}
          {user.accountStatus && <AdminStatusBadge status={user.accountStatus} />}
        </div>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Star className="size-3" /> {user.averageRating?.toFixed(1) ?? '–'} ·{' '}
          {user.completedJobs ?? 0} jobber
        </p>
      </div>
    </div>
  );
}

const SOURCE_TONE = { order: 'info', dispute: 'danger', admin: 'warning' } as const;

// ── Chat access panel ──────────────────────────────────────────────────────────
function ChatAccessPanel({
  orderId,
  hasActiveDispute,
}: {
  orderId: string;
  hasActiveDispute: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [auditMode] = useState(!hasActiveDispute);

  const chatQuery = useSafePayChat(orderId, reason, submitted, auditMode);

  const handleSubmit = () => {
    if (reason.trim().length < 5) return;
    setSubmitted(true);
  };

  const resetAccess = () => {
    setSubmitted(false);
    setReason('');
    setShowForm(false);
  };

  if (!showForm && !submitted) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start bg-card"
        onClick={() => setShowForm(true)}
      >
        <Lock />
        {hasActiveDispute ? 'Se full chat (tvist åpen)' : 'Be om tilgang til full chat'}
      </Button>
    );
  }

  if (showForm && !submitted) {
    return (
      <div className="space-y-2 pt-2">
        <p className="rounded-md border border-amber-200/70 bg-amber-50 p-2 text-xs text-amber-700">
          Tilgang logges som admin-aktivitet. Oppgi en gyldig grunn.
        </p>
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Grunn for tilgang (min. 5 tegn)…"
          className="resize-none text-xs"
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 bg-card" onClick={resetAccess}>
            Avbryt
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={handleSubmit}
            disabled={reason.trim().length < 5}
          >
            Hent chat
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-2 space-y-2">
      {chatQuery.isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="size-3.5 animate-spin" /> Laster chatthistorikk…
        </div>
      )}
      {chatQuery.isError && (
        <div className="space-y-2">
          <p className="rounded-md border border-red-200/70 bg-red-50 p-2 text-xs text-red-700">
            {(chatQuery.error as { response?: { data?: { message?: string } } })?.response?.data
              ?.message ?? 'Tilgang nektet. Krever aktiv tvist eller revisjonstillatelse.'}
          </p>
          <Button variant="outline" size="sm" onClick={resetAccess}>
            Prøv igjen
          </Button>
        </div>
      )}
      {chatQuery.data && (
        <ChatMessagesView messages={chatQuery.data.chat.messages} onClose={resetAccess} />
      )}
    </div>
  );
}

// ── Chat messages read-only view ──────────────────────────────────────────────
function ChatMessagesView({
  messages,
  onClose,
}: {
  messages: AdminChatMessage[];
  onClose: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">
            Chatthistorikk (skrivebeskyttet)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status="read_only" tone="warning" label="Kun lesing" />
          <Button variant="ghost" size="xs" onClick={onClose}>
            Lukk
          </Button>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto p-3 space-y-2 bg-card">
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Ingen meldinger</p>
        ) : (
          messages.map((msg) => {
            const isSystem = msg.type?.startsWith('system_');
            if (isSystem) {
              return (
                <div key={msg._id} className="text-center">
                  <span className="inline-block rounded-md border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                    {msg.text ?? msg.type}
                  </span>
                </div>
              );
            }
            const senderName = msg.sender?.name ?? 'Ukjent';
            const senderRole = msg.sender?.role ?? '';
            return (
              <div key={msg._id} className="flex gap-2.5">
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                  {senderName[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-medium text-foreground">{senderName}</span>
                    {senderRole && (
                      <span className="text-[10px] text-muted-foreground capitalize">
                        {senderRole}
                      </span>
                    )}
                    <time className="ml-auto text-[10px] text-muted-foreground">
                      {new Date(msg.createdAt).toLocaleString('nb-NO')}
                    </time>
                  </div>
                  {msg.text && (
                    <p className="text-xs text-foreground leading-relaxed">{msg.text}</p>
                  )}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {msg.attachments.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                        >
                          <FileText className="size-2.5" /> Vedlegg {i + 1}
                          <ExternalLink className="size-2.5" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
type OrderData = {
  _id: string;
  status: string;
  paymentStatus: string;
  cancellationReason?: string;
  checkoutAmountMinor?: number;
  paymentConfirmedAt?: string;
  providerConnectDeadlineDays?: number;
  providerConnectDeadlineAt?: string;
  providerConnectTimeout?: {
    status?: string;
    operationKey?: string;
    stripeRefundId?: string;
    originalPaymentAmountMinor?: number;
    refundAmountMinor?: number;
    refundedAmountMinor?: number;
    reason?: string;
    lastErrorCode?: string;
    manualReviewReason?: string;
    lastAttemptAt?: string;
    lockUntil?: string;
    providerVerificationAt?: string;
    refundCompletedAt?: string;
    refundFailedAt?: string;
  };
  agreedPrice?: number;
  initialPrice?: number;
  fee?: number;
  customerTotal?: number;
  providerNet?: number;
  scheduledDate?: string;
  createdAt: string;
  checklist?: Array<{
    id: string;
    text: string;
    checked: boolean;
    checkedBy?: { name: string };
    checkedAt?: string;
  }>;
  beforeImages?: string[];
  afterImages?: string[];
  attachments?: string[];
  customerId?: {
    _id: string;
    name: string;
    email: string;
    avatarUrl?: string;
    verified?: boolean;
    accountStatus?: string;
    averageRating?: number;
    completedJobs?: number;
  };
  providerId?: {
    _id: string;
    name: string;
    email: string;
    avatarUrl?: string;
    verified?: boolean;
    accountStatus?: string;
    averageRating?: number;
    completedJobs?: number;
  };
  serviceId?: { _id: string; title: string; price: number; status: string; categories?: string[] };
};

export default function SafePayDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { data, isLoading, isError, refetch } = useSafePayDetail(orderId ?? '');
  const { data: timeline, isLoading: timelineLoading } = useSafePayTimeline(orderId ?? '');

  if (isLoading)
    return (
      <div className="space-y-4">
        <AdminLoadingSkeleton rows={3} />
        <AdminLoadingSkeleton rows={5} />
      </div>
    );
  if (isError || !data)
    return (
      <AdminErrorState
        onRetry={refetch}
        title="Kontrakt ikke funnet"
        description="Kontrakten finnes ikke eller tilgang er nektet."
      />
    );

  const d = data as {
    order: OrderData;
    payment?: {
      _id: string;
      status: string;
      amount: number;
      capturedAmountMinor?: number;
      refundAmountMinor?: number;
      refundedAmountMinor?: number;
      refundStatus?: string;
      stripeRefundId?: string;
      stripePaymentIntentId?: string;
      createdAt: string;
    } | null;
    safePayHistory?: {
      status: string;
      amounts: { agreedPrice: number; fee: number; totalCustomer: number; netProvider: number };
      paymentDate?: string;
      originalPaymentAmountMinor?: number;
      refundAmountMinor?: number;
      refundedAmountMinor?: number;
      refundStatus?: string;
      refundReason?: string;
      cancellationReason?: string;
      providerConnectStatus?: string;
      stripePaymentIntentId?: string;
      stripeRefundId?: string;
    } | null;
    dispute?: {
      _id: string;
      status: string;
      priority: string;
      title: string;
      reasonCategory: string;
    } | null;
    chatMeta?: {
      _id: string;
      status: string;
      messageCount: number;
      systemMessageCount: number;
      lastMessageAt?: string;
    } | null;
  };
  const { order, payment, safePayHistory, dispute, chatMeta } = d;
  const fee = order.agreedPrice ? Math.round(order.agreedPrice * 0.03) : 0;
  const checklist = order.checklist ?? [];
  const checkedCount = checklist.filter((i) => i.checked).length;
  const checklistPct =
    checklist.length > 0 ? Math.round((checkedCount / checklist.length) * 100) : 0;
  const hasActiveDispute =
    !!dispute &&
    [
      'open',
      'under_review',
      'waiting_for_customer',
      'waiting_for_provider',
      'evidence_submitted',
    ].includes(dispute.status);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={`Kontrakt ${order._id.slice(-8).toUpperCase()}`}
        description={order.serviceId?.title ?? 'Ukjent tjeneste'}
        actions={
          <>
            <Button variant="outline" size="sm" className="bg-card" asChild>
              <Link to="/dashboard/safepay">
                <ArrowLeft /> Tilbake til SafePay
              </Link>
            </Button>
            {dispute && (
              <Button variant="outline" size="sm" className="bg-card text-red-700" asChild>
                <Link to={`/dashboard/disputes/${dispute._id}`}>
                  <AlertTriangle /> Vis tvist
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/* Status bar */}
      <Card size="sm">
        <CardContent className="flex flex-wrap gap-x-6 gap-y-3">
          {(
            [
              { label: 'Ordre', value: order.status },
              { label: 'Betaling', value: order.paymentStatus },
              { label: 'Chat', value: chatMeta?.status },
              { label: 'Tvist', value: dispute?.status },
            ] as { label: string; value?: string }[]
          ).map(({ label, value }) =>
            value ? (
              <div key={label} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{label}:</span>
                <AdminStatusBadge status={value} />
              </div>
            ) : null
          )}
        </CardContent>
      </Card>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Contract overview */}
          <Section title="Kontraktoversikt">
            <Row
              label="Ordre-ID"
              value={<span className="font-mono text-xs">{order._id}</span>}
              copy={order._id}
            />
            <Row label="Tjeneste" value={order.serviceId?.title} />
            <Row label="Ordrestatus" badge={order.status} />
            <Row label="Betalingsstatus" badge={order.paymentStatus} />
            <Row
              label="Opprinnelig pris"
              value={
                order.initialPrice != null
                  ? `${order.initialPrice.toLocaleString('nb-NO')} NOK`
                  : undefined
              }
            />
            <Row
              label="Avtalt pris"
              value={
                order.agreedPrice != null
                  ? `${order.agreedPrice.toLocaleString('nb-NO')} NOK`
                  : undefined
              }
            />
            <Row label="Jobblo-gebyr (3%)" value={`${fee.toLocaleString('nb-NO')} NOK`} />
            <Row
              label="Kunden betaler"
              value={
                order.agreedPrice != null
                  ? `${(order.agreedPrice + fee).toLocaleString('nb-NO')} NOK`
                  : undefined
              }
            />
            <Row
              label="Tilbyder får (intern)"
              value={
                order.agreedPrice != null
                  ? `${(order.agreedPrice - fee).toLocaleString('nb-NO')} NOK`
                  : undefined
              }
            />
            <Row label="Opprettet" value={new Date(order.createdAt).toLocaleString('nb-NO')} />
            {order.scheduledDate && (
              <Row
                label="Planlagt dato"
                value={new Date(order.scheduledDate).toLocaleDateString('nb-NO')}
              />
            )}
          </Section>

          {/* Payment */}
          <Section title="Betalingsinformasjon">
            {payment ? (
              <>
                <Row label="Status" badge={payment.status} />
                <Row label="Beløp" value={`${payment.amount.toLocaleString('nb-NO')} NOK`} />
                {payment.stripePaymentIntentId && (
                  <Row
                    label="Stripe PI (trunkert)"
                    value={
                      <span className="font-mono text-xs">{payment.stripePaymentIntentId}</span>
                    }
                    copy={payment.stripePaymentIntentId}
                  />
                )}
                <Row
                  label="Betalingsdato"
                  value={new Date(payment.createdAt).toLocaleString('nb-NO')}
                />
                {payment.capturedAmountMinor != null && (
                  <Row
                    label="Faktisk innbetalt"
                    value={`${(payment.capturedAmountMinor / 100).toLocaleString('nb-NO')} NOK`}
                  />
                )}
                {payment.refundedAmountMinor != null && payment.refundedAmountMinor > 0 && (
                  <Row
                    label="Refundert beløp"
                    value={`${(payment.refundedAmountMinor / 100).toLocaleString('nb-NO')} NOK`}
                  />
                )}
                {payment.refundAmountMinor != null && payment.refundAmountMinor > 0 && (
                  <Row
                    label="Beløp for refusjon"
                    value={`${(payment.refundAmountMinor / 100).toLocaleString('nb-NO')} NOK`}
                  />
                )}
                {payment.refundStatus && (
                  <Row label="Refusjonsstatus" badge={payment.refundStatus} />
                )}
                {payment.stripeRefundId && (
                  <Row
                    label="Stripe-refusjon"
                    value={<span className="font-mono text-xs">{payment.stripeRefundId}</span>}
                    copy={payment.stripeRefundId}
                  />
                )}
              </>
            ) : (
              <AdminEmptyState
                title="Ingen betaling"
                description="Betaling er ikke behandlet ennå."
                className="py-4"
              />
            )}
          </Section>

          {order.providerConnectDeadlineAt && (
            <Section title="Startfrist og automatisk refusjon">
              <Row
                label="Betaling bekreftet"
                value={
                  order.paymentConfirmedAt
                    ? new Date(order.paymentConfirmedAt).toLocaleString('nb-NO')
                    : undefined
                }
              />
              <Row
                label="Frist (24-timers dager)"
                value={`${order.providerConnectDeadlineDays ?? '–'} dager`}
              />
              <Row
                label="Frist utløper"
                value={new Date(order.providerConnectDeadlineAt).toLocaleString('nb-NO')}
              />
              <Row label="Oppfølging" badge={order.providerConnectTimeout?.status ?? 'venter'} />
              {order.providerConnectTimeout?.originalPaymentAmountMinor != null && (
                <Row
                  label="Opprinnelig innbetaling"
                  value={`${(order.providerConnectTimeout.originalPaymentAmountMinor / 100).toLocaleString('nb-NO')} NOK`}
                />
              )}
              {order.providerConnectTimeout?.refundedAmountMinor != null && (
                <Row
                  label="Bekreftet refusjon"
                  value={`${(order.providerConnectTimeout.refundedAmountMinor / 100).toLocaleString('nb-NO')} NOK`}
                />
              )}
              {order.providerConnectTimeout?.refundAmountMinor != null && (
                <Row
                  label="Refusjonsbeløp"
                  value={`${(order.providerConnectTimeout.refundAmountMinor / 100).toLocaleString('nb-NO')} NOK`}
                />
              )}
              {order.providerConnectTimeout?.stripeRefundId && (
                <Row
                  label="Stripe-refusjon"
                  value={
                    <span className="font-mono text-xs">
                      {order.providerConnectTimeout.stripeRefundId}
                    </span>
                  }
                  copy={order.providerConnectTimeout.stripeRefundId}
                />
              )}
              {order.cancellationReason && (
                <Row label="Kanselleringsårsak" value={order.cancellationReason} />
              )}
              {order.providerConnectTimeout?.lastErrorCode && (
                <Row label="Siste feilkode" value={order.providerConnectTimeout.lastErrorCode} />
              )}
              {order.providerConnectTimeout?.manualReviewReason && (
                <Row
                  label="Manuell behandling"
                  value={order.providerConnectTimeout.manualReviewReason}
                />
              )}
              {order.providerConnectTimeout?.operationKey && (
                <Row
                  label="Operasjonsnøkkel"
                  value={
                    <span className="font-mono text-xs">
                      {order.providerConnectTimeout.operationKey}
                    </span>
                  }
                />
              )}
            </Section>
          )}

          {/* SafePayHistory */}
          {safePayHistory && (
            <Section title="SafePay-historikk">
              <Row label="Status" badge={safePayHistory.status} />
              {safePayHistory.providerConnectStatus && (
                <Row label="Connect-kontostatus" badge={safePayHistory.providerConnectStatus} />
              )}
              {safePayHistory.refundStatus && (
                <Row label="Refusjonsstatus" badge={safePayHistory.refundStatus} />
              )}
              <Row
                label="Avtalt pris"
                value={`${safePayHistory.amounts.agreedPrice.toLocaleString('nb-NO')} NOK`}
              />
              <Row
                label="Gebyr"
                value={`${safePayHistory.amounts.fee.toLocaleString('nb-NO')} NOK`}
              />
              <Row
                label="Kunden betalte"
                value={`${safePayHistory.amounts.totalCustomer.toLocaleString('nb-NO')} NOK`}
              />
              <Row
                label="Tilbyderens interne saldo"
                value={`${safePayHistory.amounts.netProvider.toLocaleString('nb-NO')} NOK`}
              />
              {safePayHistory.refundAmountMinor != null && safePayHistory.refundAmountMinor > 0 && (
                <Row
                  label="Refusjonsbeløp"
                  value={`${(safePayHistory.refundAmountMinor / 100).toLocaleString('nb-NO')} NOK`}
                />
              )}
              {safePayHistory.refundedAmountMinor != null &&
                safePayHistory.refundedAmountMinor > 0 && (
                  <Row
                    label="Bekreftet refundert"
                    value={`${(safePayHistory.refundedAmountMinor / 100).toLocaleString('nb-NO')} NOK`}
                  />
                )}
              {safePayHistory.paymentDate && (
                <Row
                  label="Betalingsdato"
                  value={new Date(safePayHistory.paymentDate).toLocaleString('nb-NO')}
                />
              )}
              <p className="mt-2 rounded-md border border-amber-200/70 bg-amber-50 p-3 text-xs leading-5 text-amber-700">
                Connect-status viser kontotilkobling. Tilbyderens interne saldo er ikke en bekreftet
                bankutbetaling; overføringsstatus er ikke tilgjengelig her.
              </p>
            </Section>
          )}

          {/* Checklist */}
          <Section
            title={`Sjekkliste (${checkedCount}/${checklist.length}${checklist.length > 0 ? ` · ${checklistPct}%` : ''})`}
          >
            {checklist.length === 0 ? (
              <AdminEmptyState
                title="Ingen sjekkliste"
                description="Ingen sjekklistepunkter."
                className="py-4"
              />
            ) : (
              <div className="space-y-2">
                <Progress value={checklistPct} className="mb-3 h-1.5" />
                {checklist.map((item) => (
                  <div key={item.id} className="flex items-start gap-2.5 py-1.5">
                    <Checkbox
                      checked={item.checked}
                      disabled
                      aria-label={item.text}
                      className="mt-0.5 disabled:opacity-100"
                    />
                    <div className="min-w-0">
                      <p
                        className={`text-sm ${item.checked ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                      >
                        {item.text}
                      </p>
                      {item.checked && item.checkedBy && (
                        <p className="text-xs text-muted-foreground">
                          {item.checkedBy.name}
                          {item.checkedAt
                            ? ` · ${new Date(item.checkedAt).toLocaleDateString('nb-NO')}`
                            : ''}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Files */}
          {((order.beforeImages?.length ?? 0) > 0 ||
            (order.afterImages?.length ?? 0) > 0 ||
            (order.attachments?.length ?? 0) > 0) && (
            <Section title="Filer og bilder">
              {order.beforeImages && order.beforeImages.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Før</p>
                  <div className="flex flex-wrap gap-2">
                    {order.beforeImages.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={url}
                          alt={`Før ${i + 1}`}
                          className="size-16 rounded-md border object-cover"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {order.afterImages && order.afterImages.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Etter</p>
                  <div className="flex flex-wrap gap-2">
                    {order.afterImages.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={url}
                          alt={`Etter ${i + 1}`}
                          className="size-16 rounded-md border object-cover"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {order.attachments && order.attachments.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Vedlegg</p>
                  {order.attachments.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs text-primary hover:underline mb-1"
                    >
                      <FileText className="size-3.5" /> Vedlegg {i + 1}{' '}
                      <ExternalLink className="size-3" />
                    </a>
                  ))}
                </div>
              )}
            </Section>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <Section title="Kunde">
            <UserCard user={order.customerId} role="Kunde" />
          </Section>
          <Section title="Tilbyder">
            <UserCard user={order.providerId} role="Tilbyder" />
          </Section>

          {/* Chat — fully functional with access reason dialog */}
          <Section title="Chat">
            {chatMeta ? (
              <div className="space-y-2">
                <Row
                  label="Chat-ID"
                  value={
                    <span className="font-mono text-xs">{String(chatMeta._id).slice(-8)}</span>
                  }
                  copy={String(chatMeta._id)}
                />
                <Row label="Status" badge={chatMeta.status} />
                <Row label="Meldinger" value={String(chatMeta.messageCount)} />
                <Row label="Systemmeldinger" value={String(chatMeta.systemMessageCount)} />
                {chatMeta.lastMessageAt && (
                  <Row
                    label="Siste melding"
                    value={new Date(chatMeta.lastMessageAt).toLocaleDateString('nb-NO')}
                  />
                )}
                {/* Functional chat access panel */}
                <ChatAccessPanel orderId={order._id} hasActiveDispute={hasActiveDispute} />
              </div>
            ) : (
              <AdminEmptyState
                title="Ingen chat"
                description="Ingen chat er knyttet til denne kontrakten."
                className="py-4"
              />
            )}
          </Section>

          {/* Dispute summary */}
          {dispute && (
            <Section title="Aktiv tvist">
              <Row
                label="Tvist-ID"
                value={<span className="font-mono text-xs">{dispute._id.slice(-8)}</span>}
              />
              <Row label="Tittel" value={dispute.title} />
              <Row label="Årsak" value={dispute.reasonCategory.replace(/_/g, ' ')} />
              <Row label="Status" badge={dispute.status} />
              <Row label="Prioritet" value={dispute.priority} />
              <div className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start bg-card text-red-700"
                  asChild
                >
                  <Link to={`/dashboard/disputes/${dispute._id}`}>
                    <AlertTriangle /> Administrer tvist
                  </Link>
                </Button>
              </div>
            </Section>
          )}

          {/* Timeline */}
          <Section title="Tidslinje">
            {timelineLoading ? (
              <AdminLoadingSkeleton rows={4} />
            ) : !timeline || timeline.length === 0 ? (
              <AdminEmptyState
                title="Ingen hendelser"
                description="Ingen loggede hendelser ennå."
                className="py-4"
              />
            ) : (
              <Timeline
                events={timeline.map((event) => ({
                  at: event.timestamp,
                  source: event.source,
                  title: event.action.replace(/_/g, ' '),
                  detail: event.description,
                  tone: SOURCE_TONE[event.source as keyof typeof SOURCE_TONE] ?? 'neutral',
                }))}
              />
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
