import { Lock } from 'lucide-react';
import { EmptyState } from '../../developer/kit';

export function ChatReviewEmptyState() {
  return (
    <div role="status" aria-live="polite">
      <EmptyState
        icon={<Lock />}
        title="Ingen chat lastet"
        description="Skriv inn et Chat ID for å gjennomgå en samtale på en sikker måte. Chatter vises ikke automatisk av hensyn til personvern og sikkerhet. Alle chattilganger krever en tilgangsgrunn og logges automatisk."
      />
    </div>
  );
}
