import { Flag } from 'lucide-react';
import { Badge } from '../../developer/ui/badge';

interface ReportedMessageBadgeProps {
  reportCount?: number;
}

export function ReportedMessageBadge({ reportCount = 1 }: ReportedMessageBadgeProps) {
  return (
    <Badge
      variant="outline"
      className="border-red-200/70 bg-red-50 text-red-700"
      aria-label={`Rapportert ${reportCount} gang${reportCount !== 1 ? 'er' : ''}`}
      title={`Denne meldingen er rapportert ${reportCount} gang${reportCount !== 1 ? 'er' : ''}`}
    >
      <Flag aria-hidden="true" />
      {reportCount > 1 ? `${reportCount}x rapportert` : 'Rapportert'}
    </Badge>
  );
}
