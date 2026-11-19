import { queryClient } from '../../providers/queryClient';
import {
  deleteJobDraft,
  saveJobDraft,
  uploadJobDraftImage,
} from '../../services/jobDrafts.service';
import { draftWorthSaving, toDraftData } from './draft';
import { isLocalPhoto } from './flow';
import { usePostJobStore } from './store';

export const DRAFTS_KEY = ['job-drafts'] as const;

// One request at a time, so two quick edits never create two drafts (as on the web).
let chain: Promise<void> = Promise.resolve();
const enqueue = (job: () => Promise<void>) => {
  chain = chain.then(job).catch(() => undefined);
  return chain;
};
// Bumped when the listing is published or thrown away: a save still in flight for it must not
// leave a draft behind.
let session = 0;

/** Saves the new listing as a server draft, then uploads photos it does not have yet. */
export function saveDraft() {
  return enqueue(async () => {
    const mine = session;
    const s = usePostJobStore.getState();
    if (s.editId || s.publishedId || !draftWorthSaving(s.values, s.summary)) return;
    try {
      const id = await saveJobDraft(
        s.draftId,
        toDraftData({
          values: s.values,
          summary: s.summary,
          photos: s.photos,
          photoUrls: s.draftPhotoUrls,
        })
      );
      if (mine !== session) {
        if (!s.draftId) await deleteJobDraft(id);
        return;
      }
      if (!s.draftId) {
        usePostJobStore.getState().setDraftId(id);
        void queryClient.invalidateQueries({ queryKey: DRAFTS_KEY });
      }
      for (const photo of usePostJobStore.getState().photos.filter(isLocalPhoto)) {
        if (mine !== session || usePostJobStore.getState().draftPhotoUrls[photo.uri]) continue;
        const url = await uploadJobDraftImage(id, photo);
        if (mine === session) usePostJobStore.getState().setDraftPhotoUrl(photo.uri, url);
      }
    } catch (error) {
      // Deleted elsewhere (the web): the next edit starts a new one. Anything else: next edit.
      if (
        mine === session &&
        (error as { response?: { status?: number } })?.response?.status === 404
      )
        usePostJobStore.getState().setDraftId(null);
    }
  });
}

/**
 * Sign-out / account switch: forget the listing being written. A save already in flight
 * finishes for the old account but no longer touches the store (it then holds the new
 * user's state); nothing is deleted, the draft stays in the old account's "Dine utkast".
 */
export function forgetDraftsForSignOut() {
  session += 1;
  usePostJobStore.getState().clearForSignOut();
}

/** Published or thrown away: its server draft goes too (best effort, after any save). */
export function discardDraft() {
  session += 1;
  const id = usePostJobStore.getState().draftId;
  return enqueue(async () => {
    if (id) await deleteJobDraft(id);
    void queryClient.invalidateQueries({ queryKey: DRAFTS_KEY });
  });
}
