import React, { useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMyJobs } from '../../src/hooks/useMyJobs';
import { ErrorState } from '../../src/components/ui/ErrorState';
import { CreateJobSkeleton } from '../../src/components/skeletons/ScreenSkeletons';
import { PostJobFlow } from '../../src/features/post-job/PostJobFlow';
import { usePostJobStore } from '../../src/features/post-job/store';
import type { CreateJobFormValues } from '../../src/services/createJob.service';
import type { MyJob } from '../../src/types/Jobs';

/** A published job as the post-job flow's answers. */
function jobToValues(job: MyJob): CreateJobFormValues {
  return {
    title: job.title || '', description: job.description || '', categories: job.categories || [], tags: job.tags || [],
    equipment: job.equipment || 'utstyrfri', customerType: job.customerType || 'private', maxApplicants: String(job.maxApplicants ?? 0), urgent: Boolean(job.urgent),
    address: job.location?.address || '', postalCode: job.location?.postalCode || '', city: job.location?.city || '', countyCode: job.countyCode || '', municipalityCode: job.municipalityCode || '', areaCode: job.areaCode || '',
    coordinates: job.location?.coordinates?.length === 2 ? [job.location.coordinates[1], job.location.coordinates[0]] : [0, 0],
    fromDate: job.fromDate?.slice(0, 10) || '', toDate: job.toDate?.slice(0, 10) || '', durationValue: String(job.duration?.value ?? ''), durationUnit: job.duration?.unit || 'hours',
    paymentType: (job.paymentType as CreateJobFormValues['paymentType']) || 'Fastpris', price: job.price != null ? String(job.price) : '', hourlyRate: job.hourlyRate != null ? String(job.hourlyRate) : '',
    contactPhone: job.contactPhone || '', contactEmail: job.contactEmail || '', checklist: (job.checklist || []).map((item) => ({ id: item.id, text: item.text })),
  };
}

/**
 * "Legg ut" tab: the FINN-style post-job flow. `?editId=` ("Rediger" on the job page and in
 * Mine annonser) opens the same flow on its summary, filled with the published job.
 */
export default function CreateJobScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ editId?: string | string[] }>();
  const editId = (Array.isArray(params.editId) ? params.editId[0] : params.editId) || '';
  const loadedId = usePostJobStore((s) => s.editId);
  const startEdit = usePostJobStore((s) => s.startEdit);
  const ownerJobs = useMyJobs();
  const job = editId ? ownerJobs.data?.find((item) => item._id === editId) : undefined;
  const editable = job && job.capabilities?.canEdit !== false;

  useEffect(() => {
    if (job && editable && loadedId !== job._id) startEdit(job._id, jobToValues(job), job.images || []);
  }, [job, editable, loadedId, startEdit]);

  if (!editId || loadedId === editId) return <PostJobFlow />;

  const leave = () => {
    router.setParams({ editId: '' });
    router.back();
  };
  const screen = (child: React.ReactNode) => <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">{child}</SafeAreaView>;
  if (ownerJobs.isLoading) return screen(<CreateJobSkeleton />);
  if (ownerJobs.isError) {
    return screen(<ErrorState title="Kunne ikke laste oppdraget" message="Sjekk internettforbindelsen din og prøv igjen." actionLabel="Prøv igjen" onAction={() => void ownerJobs.refetch()} />);
  }
  if (!job) return screen(<ErrorState title="Oppdraget ble ikke funnet" message="Annonsen er ikke tilgjengelig for redigering." actionLabel="Tilbake" onAction={leave} />);
  if (!editable) {
    return screen(<ErrorState title="Oppdraget kan ikke redigeres" message={job.capabilities?.blockedReason ?? 'Serveren tillater ikke redigering av dette oppdraget.'} actionLabel="Tilbake" onAction={leave} />);
  }
  return screen(<CreateJobSkeleton />);
}
