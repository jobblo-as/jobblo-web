import CreateJobForm from '../../components/CreateJobForm/CreateJobForm';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { saveServiceForm } from '../../features/services/api';
import { useUserStore } from '../../stores/userStore';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { FileText, Trash2 } from 'lucide-react';
import { deleteJobDraft, listJobDrafts } from '../../api/jobDraftsAPI';
import toast from 'react-hot-toast';
import { useJobDetailQuery } from '../../features/jobDetail/hook.ts';
import { Spinner } from '../../components/Ui/Spinner';
import { BackLink } from '../../components/Ui/BackLink';
import { MICRO_LABEL } from '../../theme/brand';

export default function LeggUtOppdrag() {
  const { id } = useParams();
  const isEditMode = !!id;
  const navigate = useNavigate();
  const { search } = useLocation();
  const user = useUserStore((state) => state.user);

  const { data: job, isLoading } = useJobDetailQuery(id || '');
  const queryClient = useQueryClient();
  const saveMutation = useMutation({
    mutationFn: (formData: FormData) => saveServiceForm(formData, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-services'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      if (id) queryClient.invalidateQueries({ queryKey: ['jobDetail', id] });
    },
  });

  if (!user) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h2>Du må være logget inn for å legge ut oppdrag</h2>
        <p>Vennligst logg inn for å fortsette.</p>
      </div>
    );
  }

  if (isEditMode && isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Spinner />
      </div>
    );
  }

  const userId = user._id;

  const handleFormSubmit = async (formData: FormData) => {
    console.log('Sending job data (FormData)');

    try {
      const response = await saveMutation.mutateAsync(formData);

      if (!response.data) {
        // Treat "no body" as a failure like any other, so the caller keeps the
        // draft instead of clearing it on a response we can't confirm.
        throw new Error(`Uventet svar fra serveren (status ${response.status})`);
      }

      toast.success(isEditMode ? 'Oppdrag oppdatert!' : 'Oppdrag publisert!');
      navigate('/');
    } catch (error) {
      // Re-thrown on purpose: useCreateJobForm only preserves the IndexedDB
      // draft if this promise rejects. Swallowing the error here made every
      // failed publish look like a success to the caller, which then wiped
      // everything the user had typed. It also owns the error toast, so we
      // deliberately don't show one too.
      console.error('Error saving job:', error);
      throw error;
    }
  };

  const coordinates = job?.location?.coordinates; // GeoJSON order: [lng, lat]

  const initialData = job
    ? {
        title: job.title,
        description: job.description,
        price: job.price,
        address: job.location?.address,
        city: job.location?.city,
        countyCode: job.countyCode,
        municipalityCode: job.municipalityCode,
        areaCode: job.areaCode,
        postalCode: job.location?.postalCode,
        latitude: coordinates?.[1],
        longitude: coordinates?.[0],
        categories: job.categories,
        urgent: job.urgent,
        equipment: job.equipment,
        fromDate: job.fromDate,
        toDate: job.toDate,
        durationValue: job.duration?.value,
        durationUnit: job.duration?.unit,
        paymentType: job.paymentType,
        hourlyRate: job.hourlyRate,
        maxApplicants: job.maxApplicants,
        images: job.images,
      }
    : undefined;

  return (
    <div className="min-h-screen bg-[#EFF0EA]">
      <div className="mx-auto w-full max-w-3xl px-4 pt-8 sm:px-6">
        <BackLink fallback="/home" />

        <header className="mt-6 mb-8">
          <p className={MICRO_LABEL}>{isEditMode ? 'Rediger' : 'Nytt oppdrag'}</p>
          <h1 className="mt-2 text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-tight tracking-[-0.04em] text-[#0B0B0B]">
            {isEditMode ? 'Rediger oppdraget' : 'Legg ut et oppdrag'}
          </h1>
          <p className="mt-2 max-w-lg text-[0.9375rem] leading-relaxed text-[#63665F]">
            {isEditMode
              ? 'Endringene blir synlige for alle som ser oppdraget.'
              : 'To korte steg. Du kan forhåndsvise underveis, og utkastet lagres automatisk.'}
          </p>
        </header>

        {!isEditMode && <DraftsList />}
      </div>

      {/* A new `?utkast=` remounts the form, so the hook loads that draft. */}
      <CreateJobForm
        key={search}
        onSubmit={handleFormSubmit}
        userId={userId}
        initialData={initialData}
        isEditMode={isEditMode}
      />
    </div>
  );
}

/** "Dine utkast": server drafts, newest first. Opening one reloads the form with it. */
function DraftsList() {
  const queryClient = useQueryClient();
  const { data: drafts = [] } = useQuery({ queryKey: ['job-drafts'], queryFn: listJobDrafts });
  const remove = useMutation({
    mutationFn: deleteJobDraft,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['job-drafts'] }),
    onError: () => toast.error('Kunne ikke slette utkastet.'),
  });
  if (drafts.length === 0) return null;

  return (
    <section aria-labelledby="drafts-heading" className="mb-8 rounded-3xl border border-[#E6E7E1] bg-white p-5">
      <h2 id="drafts-heading" className="text-[0.9375rem] font-bold tracking-[-0.02em] text-[#0B0B0B]">Dine utkast</h2>
      <ul className="mt-3 divide-y divide-[#E6E7E1]">
        {drafts.map((d) => (
          <li key={d._id} className="flex items-center gap-3 py-2.5">
            <FileText size={16} className="shrink-0 text-[#2E6641]" />
            <Link to={`/Publish-job?utkast=${d._id}`} className="min-w-0 flex-1 hover:underline">
              <span className="block truncate text-[0.875rem] font-semibold text-[#0B0B0B]">{d.title || 'Uten tittel'}</span>
              <span className="block text-[0.75rem] text-[#63665F]">
                Sist endret {new Date(d.updatedAt).toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => remove.mutate(d._id)}
              disabled={remove.isPending}
              aria-label={`Slett utkastet ${d.title || 'uten tittel'}`}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-[#63665F] hover:bg-[#FCF4F3] hover:text-[#B0453B] disabled:opacity-50"
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
