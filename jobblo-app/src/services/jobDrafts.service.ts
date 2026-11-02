import apiClient from '../api/client';
import type { CreateJobImage } from './createJob.service';

/** "Dine utkast": the job form saved on the server (backend routes/jobDrafts.js), as on the web. */
export type JobDraftSummary = { _id: string; title: string; updatedAt: string };

export async function listJobDrafts(): Promise<JobDraftSummary[]> {
  return (await apiClient.get<{ drafts: JobDraftSummary[] }>('/job-drafts')).data.drafts;
}

export async function getJobDraft(id: string): Promise<Record<string, unknown>> {
  const { data } = await apiClient.get<{ draft: { data: Record<string, unknown> } }>(
    `/job-drafts/${encodeURIComponent(id)}`
  );
  return data.draft.data ?? {};
}

/** Creates when `id` is null; returns the draft's id. */
export async function saveJobDraft(id: string | null, data: object): Promise<string> {
  const response = id
    ? await apiClient.put<{ draft: { _id: string } }>(`/job-drafts/${encodeURIComponent(id)}`, {
        data,
      })
    : await apiClient.post<{ draft: { _id: string } }>('/job-drafts', { data });
  return response.data.draft._id;
}

/** One photo for the draft, stored on the server; returns its URL. */
export async function uploadJobDraftImage(id: string, photo: CreateJobImage): Promise<string> {
  const form = new FormData();
  form.append('image', photo as unknown as Blob);
  const { data } = await apiClient.post<{ url: string }>(
    `/job-drafts/${encodeURIComponent(id)}/images`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 90_000 }
  );
  return data.url;
}

export async function deleteJobDraft(id: string): Promise<void> {
  await apiClient.delete(`/job-drafts/${encodeURIComponent(id)}`);
}
