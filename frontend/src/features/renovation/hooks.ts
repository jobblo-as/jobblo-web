import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteRenovationPlan,
  getRenovationCatalogue,
  getSharedRenovationPlan,
  listRenovationPlans,
  postRenovationEstimate,
  postRenovationFacts,
  saveRenovationPlan,
  shareRenovationPlan,
  unshareRenovationPlan,
  type SavedPlanBody,
} from './renovationAPI';

export const renovationKeys = {
  catalogue: ['renovation-catalogue'] as const,
  plans: ['renovation-plans'] as const,
  shared: (shareId: string) => ['renovation-shared', shareId] as const,
};

export const useRenovationCatalogue = () =>
  useQuery({
    queryKey: renovationKeys.catalogue,
    queryFn: getRenovationCatalogue,
    staleTime: 1000 * 60 * 60,
  });

export const useRenovationEstimate = () => useMutation({ mutationFn: postRenovationEstimate });

export const useRenovationFacts = () => useMutation({ mutationFn: postRenovationFacts });

export const useRenovationPlans = (enabled: boolean) =>
  useQuery({ queryKey: renovationKeys.plans, queryFn: listRenovationPlans, enabled });

export const useSharedRenovationPlan = (shareId: string) =>
  useQuery({
    queryKey: renovationKeys.shared(shareId),
    queryFn: () => getSharedRenovationPlan(shareId),
    retry: false,
  });

/** Save, delete and share all change the "Mine planer" list. */
export const useRenovationPlanActions = () => {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: renovationKeys.plans });
  return {
    save: useMutation({
      mutationFn: ({ id, body }: { id: string | null; body: SavedPlanBody }) =>
        saveRenovationPlan(id, body),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: deleteRenovationPlan, onSuccess }),
    share: useMutation({ mutationFn: shareRenovationPlan, onSuccess }),
    unshare: useMutation({ mutationFn: unshareRenovationPlan, onSuccess }),
  };
};
