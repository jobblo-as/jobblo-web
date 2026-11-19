import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createJob,
  updateJob,
  type CreateJobFormValues,
  type CreateJobImage,
} from '../services/createJob.service';
import { queryKeys } from '../queryKeys';
import { prepareUploadPhotos } from '../utils/uploadPhotos';

export function useCreateJobMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      values,
      images,
      draftId,
    }: {
      values: CreateJobFormValues;
      images: CreateJobImage[];
      draftId?: string | null;
    }) => prepareUploadPhotos(images).then((ready) => createJob(values, ready, draftId)),
    onSuccess: async () => {
      await Promise.all([
        // "Rediger" right after publishing looks the job up in this list.
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.mine }),
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.list() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.infinite() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.applicants.overview }),
      ]);
    },
  });
}

export function useUpdateJobMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      serviceId,
      values,
      images,
      imagesToDelete,
    }: {
      serviceId: string;
      values: CreateJobFormValues;
      images: CreateJobImage[];
      imagesToDelete: string[];
    }) =>
      prepareUploadPhotos(images).then((ready) =>
        updateJob(serviceId, values, ready, imagesToDelete)
      ),
    // Not awaited: the save is done once the server answered. Awaiting every refetch kept
    // the button on "Lagrer…" for as long as the slowest list took to reload.
    onSuccess: (_result, variables) => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.mine }),
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.detail(variables.serviceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.list() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.infinite() }),
      ]);
    },
  });
}
