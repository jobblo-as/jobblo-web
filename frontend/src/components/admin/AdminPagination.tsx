import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Pagination } from '../../types/admin';
import { cn } from '@/lib/utils';
import { Button } from '../developer/ui/button';

interface AdminPaginationProps {
  pagination: Pagination;
  onPageChange: (page: number) => void;
  className?: string;
}

export function AdminPagination({ pagination, onPageChange, className }: AdminPaginationProps) {
  const { page, totalPages, total, limit, hasNextPage, hasPreviousPage } = pagination;

  if (totalPages <= 1) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-between gap-2 py-2 text-xs text-muted-foreground sm:flex-row',
        className
      )}
      role="navigation"
      aria-label="Paginering"
    >
      <p>
        Viser{' '}
        <span className="font-medium text-foreground">
          {from}–{to}
        </span>{' '}
        av <span className="font-medium text-foreground">{total}</span> resultater
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(page - 1)}
          disabled={!hasPreviousPage}
          aria-label="Forrige side"
        >
          <ChevronLeft />
        </Button>

        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          let pageNum: number;
          if (totalPages <= 5) {
            pageNum = i + 1;
          } else if (page <= 3) {
            pageNum = i + 1;
          } else if (page >= totalPages - 2) {
            pageNum = totalPages - 4 + i;
          } else {
            pageNum = page - 2 + i;
          }
          return (
            <Button
              key={pageNum}
              variant={pageNum === page ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange(pageNum)}
              className="min-w-8 px-2 tabular-nums"
              aria-label={`Side ${pageNum}`}
              aria-current={pageNum === page ? 'page' : undefined}
            >
              {pageNum}
            </Button>
          );
        })}

        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(page + 1)}
          disabled={!hasNextPage}
          aria-label="Neste side"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
