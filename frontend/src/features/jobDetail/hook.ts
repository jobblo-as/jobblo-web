import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getJobDetail, createChat, createStripeSession, getSimilarJobs } from './jobApi';
import { createJobRequest, getMyJobRequests } from '../../api/orderAPI';
import type { Jobs } from '../../types/Jobs';
import { useUserStore } from '../../stores/userStore';

export const useJobDetailQuery = (id: string) => {
  return useQuery({
    queryKey: ['jobDetail', id],
    queryFn: () => getJobDetail(id),
    enabled: !!id,
  });
};

export const useMyJobRequestsQuery = (isAuthenticated: boolean) => {
  return useQuery({
    queryKey: ['jobRequests'],
    queryFn: getMyJobRequests,
    enabled: isAuthenticated,
  });
};

export const useCreateJobRequestMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createJobRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobRequests'] });
      queryClient.invalidateQueries({ queryKey: ['my-subscription'] });
      useUserStore
        .getState()
        .fetchProfile()
        .catch(() => {});
    },
  });
};

// useCreateOrderMutation removed alongside POST /api/orders. No component used it, and
// the endpoint created orders with the payer and payee reversed. Orders are created by
// the award flow (useCreateSafePayContractMutation).

// useUpdateOrderStatusMutation removed alongside PATCH /api/orders/:id. No component
// used it, and the endpoint it called let either party drive an order into a terminal
// state without settling the money. Order status changes go through the SafePay flow.

/**
 * "Lignende oppdrag", page by page: the server picks the same category, the most alike title
 * first, and leaves out full and closed jobs. The list is the same for everyone, so the
 * viewer's own jobs and the ones they applied to are dropped here (and a job that moved between
 * two pages is shown once).
 */
export const useRecommendedJobsQuery = (
  currentJobId: string,
  viewerId?: string | null,
  appliedJobIds?: ReadonlySet<string>
) => {
  return useInfiniteQuery({
    queryKey: ['recommendedJobs', currentJobId],
    queryFn: ({ pageParam }) => getSimilarJobs(currentJobId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined,
    enabled: Boolean(currentJobId),
    staleTime: 60_000,
    select: (data) => {
      const seen = new Set<string>();
      return data.pages
        .flatMap((page) => page.data)
        .filter((job: Jobs) => {
          if (seen.has(job._id)) return false;
          seen.add(job._id);
          // Typed as an id, but the list populates the seller.
          const seller = job.userId as unknown as string | { _id?: string } | null;
          const owner = seller && typeof seller === 'object' ? seller._id : seller;
          if (viewerId && String(owner) === viewerId) return false;
          return !appliedJobIds?.has(job._id);
        });
    },
  });
};

export const useSendMessageMutation = () => {
  return useMutation({
    mutationFn: createChat,
  });
};

// Mutation for Stripe
export const useStripeMutation = () => {
  return useMutation({
    mutationFn: createStripeSession,
  });
};
