import mainLink from './mainURLs';

/** "Dine utkast": the job form saved on the server, so it follows the user across devices. */
export type JobDraftSummary = { _id: string; title: string; updatedAt: string };

export const listJobDrafts = async (): Promise<JobDraftSummary[]> =>
  (await mainLink.get('/api/job-drafts')).data.drafts;

export const getJobDraft = async <T>(id: string): Promise<T> =>
  (await mainLink.get(`/api/job-drafts/${encodeURIComponent(id)}`)).data.draft.data;

/** Creates when `id` is null; returns the draft's id. */
export const saveJobDraft = async (id: string | null, data: object): Promise<string> =>
  id
    ? (await mainLink.put(`/api/job-drafts/${encodeURIComponent(id)}`, { data })).data.draft._id
    : (await mainLink.post('/api/job-drafts', { data })).data.draft._id;

/** One photo for the draft, stored on the server; returns its URL. */
export const uploadJobDraftImage = async (id: string, file: File): Promise<string> => {
  const form = new FormData();
  form.append('image', file);
  return (await mainLink.post(`/api/job-drafts/${encodeURIComponent(id)}/images`, form)).data.url;
};

export const deleteJobDraft = async (id: string): Promise<void> => {
  await mainLink.delete(`/api/job-drafts/${encodeURIComponent(id)}`);
};
