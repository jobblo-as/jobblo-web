type SimilarJob = { _id: string; userId?: unknown };

const idOf = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'object') {
    const v = value as { _id?: unknown; id?: unknown };
    return String(v._id ?? v.id ?? '');
  }
  return String(value);
};

/**
 * The server's list is the same for everyone (cached), so the viewer's own jobs and the jobs
 * they already applied to are dropped here; the server order (near first, newest first) stays.
 * Pages are fetched at different times, so a job that moved between them is shown once.
 */
export function visibleSimilarJobs<T extends SimilarJob>(
  jobs: T[] | undefined,
  { viewerId, appliedJobIds }: { viewerId?: string | null; appliedJobIds?: ReadonlySet<string> }
): T[] {
  const seen = new Set<string>();
  return (jobs ?? []).filter((job) => {
    const id = String(job._id);
    if (seen.has(id)) return false;
    seen.add(id);
    if (viewerId && idOf(job.userId) === viewerId) return false;
    return !appliedJobIds?.has(id);
  });
}

/**
 * Jobs the viewer has an open (pending) or accepted application on. The requests list also
 * holds ones sent to the viewer's own jobs, so only rows where the viewer is the applicant count.
 */
export function appliedJobIdsOf(
  requests: { serviceId?: unknown; customerId?: unknown; status?: string }[] | undefined,
  viewerId?: string | null
): Set<string> {
  return new Set(
    (requests ?? [])
      .filter((r) => r.status === 'pending' || r.status === 'accepted')
      .filter((r) => !viewerId || !r.customerId || idOf(r.customerId) === viewerId)
      .map((r) => idOf(r.serviceId))
      .filter(Boolean)
  );
}
