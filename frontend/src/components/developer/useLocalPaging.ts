import { useState } from 'react';

/** Client-side paging for a list already in memory: spread the result into DataTable. */
export function useLocalPaging<T>(rows: T[] | undefined, size = 10) {
  const [page, setPage] = useState(1);
  const total = rows?.length || 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(page, totalPages);
  return {
    rows: rows?.slice((p - 1) * size, p * size),
    pagination: {
      page: p,
      limit: size,
      total,
      totalPages,
      hasNextPage: p < totalPages,
      hasPreviousPage: p > 1,
    },
    onPageChange: setPage,
  };
}
