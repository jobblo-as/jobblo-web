import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdminEmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** Centred icon box, title and description — the Developer Console's EmptyState. */
export function AdminEmptyState({
  title = 'Ingen resultater',
  description = 'Det er ingen data å vise her ennå.',
  icon,
  action,
  className,
}: AdminEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-4 py-10 text-center',
        className
      )}
      role="status"
      aria-label={title}
    >
      <div className="flex size-9 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground [&_svg]:size-4">
        {icon ?? <Inbox />}
      </div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
