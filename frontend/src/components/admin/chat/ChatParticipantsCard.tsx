import { Link } from 'react-router-dom';
import { ArrowUpRight, ShieldCheck, Star } from 'lucide-react';
import { AdminStatusBadge } from '../AdminStatusBadge';
import { Section } from '../../developer/kit';
import { Avatar, AvatarFallback, AvatarImage } from '../../developer/ui/avatar';
import { Button } from '../../developer/ui/button';
import type { AdminChatParticipants } from '../../../api/admin/chats';

interface ChatParticipantsCardProps {
  participants: AdminChatParticipants;
}

function ParticipantRow({
  participant,
}: {
  participant: NonNullable<AdminChatParticipants['customer']>;
}) {
  return (
    <div className="flex items-start gap-3">
      <Avatar>
        <AvatarImage src={participant.avatarUrl} alt={participant.name} />
        <AvatarFallback>{(participant.name || '?').slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-foreground">{participant.name}</span>
          {participant.verified && (
            <ShieldCheck className="size-3.5 text-emerald-600" aria-label="Verifisert" />
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{participant.email}</p>
        {participant.accountStatus && <AdminStatusBadge status={participant.accountStatus} />}
        {participant.averageRating !== undefined && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Star className="size-3 fill-current text-amber-500" aria-hidden="true" />
            {participant.averageRating.toFixed(1)} · {participant.completedJobs ?? 0} jobber
          </p>
        )}
        {participant.profileLink && (
          <Button variant="ghost" size="xs" className="-ml-2" asChild>
            <Link to={participant.profileLink}>
              Se profil <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export function ChatParticipantsCard({ participants }: ChatParticipantsCardProps) {
  return (
    <Section title="Deltakere">
      <div className="divide-y">
        {(
          [
            ['Kunde', participants.customer],
            ['Tilbyder', participants.provider],
          ] as const
        ).map(([role, p]) => (
          <div key={role} className="space-y-2 py-3 first:pt-0 last:pb-0">
            <p className="text-xs text-muted-foreground">{role}</p>
            {p ? (
              <ParticipantRow participant={p} />
            ) : (
              <p className="text-sm text-muted-foreground">Ikke tilgjengelig</p>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
