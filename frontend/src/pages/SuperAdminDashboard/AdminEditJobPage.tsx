import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { fetchAdminServiceById, updateAdminServiceForm } from '../../api/admin';
import CreateJobForm from '../../components/CreateJobForm/CreateJobForm';
import { EmptyState, PageHeader } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
import { Skeleton } from '../../components/developer/ui/skeleton';
import { useUserStore } from '../../stores/userStore';

function useAdminJobDetail(id: string) {
  return useQuery({
    queryKey: ['admin', 'service', id],
    queryFn: () => fetchAdminServiceById(id),
    enabled: !!id,
  });
}

export default function AdminEditJobPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useUserStore((s) => s.user);

  const { data: job, isLoading } = useAdminJobDetail(id ?? '');
  const saveMutation = useMutation({
    mutationFn: (formData: FormData) => updateAdminServiceForm(id!, formData),
  });

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!job) {
    return <EmptyState title="Oppdrag ikke funnet." />;
  }

  const handleFormSubmit = async (formData: FormData) => {
    await saveMutation.mutateAsync(formData);
    navigate('/dashboard/services');
  };

  const coords = job.location?.coordinates; // GeoJSON [lng, lat]

  const initialData = {
    title: job.title,
    description: job.description,
    price: job.price,
    address: job.location?.address,
    city: job.location?.city,
    countyCode: job.countyCode,
    municipalityCode: job.municipalityCode,
    areaCode: job.areaCode,
    latitude: coords?.[1],
    longitude: coords?.[0],
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
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rediger oppdraget"
        description="Endringene lagres direkte. Eier av oppdraget vil se dem umiddelbart."
        actions={
          <Button variant="outline" size="sm" className="bg-card" asChild>
            <Link to="/dashboard/services">
              <ArrowLeft /> Tjenester
            </Link>
          </Button>
        }
      />

      <CreateJobForm
        onSubmit={handleFormSubmit}
        userId={user?._id ?? ''}
        initialData={initialData}
        isEditMode
      />
    </div>
  );
}
