import React from 'react';
import { Text, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { JobCard, JOB_PHOTO_RATIO } from '../JobCard';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { SaveToListSheet } from './SaveToListSheet';
import { jobsService } from '../../services/jobs.service';
import { queryKeys } from '../../queryKeys';
import { visibleSimilarJobs } from '../../utils/similarJobs';

const PAGE_SIZE = 12;

/**
 * "Lignende oppdrag" at the bottom of a job page: the same category, the most alike title first
 * (the server decides; see GET /api/services/:id/similar). Laid out like Hjem: two columns of
 * the same job cards, heart included. It sits inside the page's scroll view, so the next page
 * comes from "Vis flere oppdrag" rather than an endless list. Hidden entirely when nothing is
 * left after dropping the viewer's own and applied-to jobs, and on an error (it is extra).
 */
export function SimilarJobs({
  jobId,
  viewerId,
  appliedJobIds,
}: {
  jobId: string;
  viewerId?: string | null;
  appliedJobIds?: ReadonlySet<string>;
}) {
  const [saveId, setSaveId] = React.useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: queryKeys.jobs.similar(jobId),
    queryFn: ({ pageParam }) => jobsService.getSimilarJobs(jobId, pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined,
    enabled: Boolean(jobId),
    staleTime: 60_000,
  });
  const jobs = visibleSimilarJobs(
    query.data?.pages.flatMap((page) => page.data),
    { viewerId, appliedJobIds }
  );
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  // A page made only of the viewer's own or applied-to jobs shows nothing: fetch on until
  // something shows or the pages run out.
  const nothingYet = !query.isPending && !jobs.length;
  React.useEffect(() => {
    if (nothingYet && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [nothingYet, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (nothingYet && !hasNextPage) return null;

  return (
    <View className="border-t border-line-soft px-4 py-6" testID="similar-jobs">
      <Text className="mb-3 text-[1.25rem] font-bold tracking-[-0.01em] text-ink">
        Lignende oppdrag
      </Text>

      {query.isPending ? (
        // Hjem's loading grid.
        <View
          className="flex-row flex-wrap justify-between gap-y-5"
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Laster lignende oppdrag"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={{ width: '48%' }} className="gap-2">
              <Skeleton className="w-full rounded-2xl" style={{ aspectRatio: JOB_PHOTO_RATIO }} />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </View>
          ))}
        </View>
      ) : (
        // Hjem's job grid, card for card.
        <View className="-mx-1.5 flex-row flex-wrap">
          {jobs.map((job) => (
            <View key={job._id} className="w-1/2 px-1.5 pb-5">
              <JobCard job={job} compact onSavePress={(id) => setSaveId(id)} />
            </View>
          ))}
        </View>
      )}

      {hasNextPage && !query.isPending ? (
        <View testID="similar-jobs-more">
          <Button
            label={isFetchingNextPage ? 'Laster…' : 'Vis flere oppdrag'}
            variant="secondary"
            loading={isFetchingNextPage}
            onPress={() => void fetchNextPage()}
            fullWidth
          />
        </View>
      ) : null}

      <SaveToListSheet
        visible={!!saveId}
        onClose={() => setSaveId(null)}
        serviceId={saveId ?? ''}
        serviceTitle={jobs.find((j) => j._id === saveId)?.title}
      />
    </View>
  );
}
