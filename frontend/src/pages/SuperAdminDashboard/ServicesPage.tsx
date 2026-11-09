import { useState, useCallback, useRef } from 'react';
import { Briefcase } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdminServices, useUpdateServiceStatus, useDeleteAdminService } from '../../hooks/admin';
import type { AdminServicesQuery, AdminService } from '../../api/admin';
import {
  AdminDataTable,
  AdminSearchInput,
  AdminFilterSelect,
  AdminStatusBadge,
  AdminConfirmDialog,
  AdminPageHeader,
} from '../../components/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { Button } from '../../components/developer/ui/button';

const STATUS_OPTIONS = [
  { label: 'Åpen', value: 'open' },
  { label: 'Lukket', value: 'closed' },
  { label: 'Pågår', value: 'in_progress' },
  { label: 'Fullført', value: 'completed' },
  { label: 'Venter', value: 'pending' },
  { label: 'Avbrutt', value: 'cancelled' },
  { label: 'Utløpt', value: 'expired' },
  { label: 'Utkast', value: 'draft' },
];

export default function ServicesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminService | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    service: AdminService;
    newStatus: string;
  } | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 400);
  }, []);

  const query: AdminServicesQuery = {
    page,
    limit: 15,
    search: debouncedSearch,
    ...(statusFilter && { status: statusFilter }),
    sortBy: 'createdAt',
    sortOrder: 'desc',
  };

  const { data, isLoading, isError, refetch } = useAdminServices(query);
  const statusMutation = useUpdateServiceStatus();
  const deleteMutation = useDeleteAdminService();

  const columns: ColumnDef<AdminService>[] = [
    {
      key: 'image',
      header: 'Bilde',
      render: (s) => {
        const img = s.images?.[0];
        return img ? (
          <img src={img} alt={s.title} className="size-10 rounded-md border object-cover" />
        ) : (
          <div className="flex size-10 items-center justify-center rounded-md border bg-muted/50">
            <Briefcase className="size-4 text-muted-foreground" />
          </div>
        );
      },
      className: 'w-16',
    },
    {
      key: 'title',
      header: 'Tittel',
      render: (s) => (
        <div className="min-w-0">
          <Link
            to={`/dashboard/services/${s._id}`}
            className="block text-sm font-medium text-primary hover:underline truncate max-w-[200px]"
          >
            {s.title}
          </Link>
          <p className="text-xs text-muted-foreground truncate max-w-[200px]">
            {s.categories.slice(0, 2).join(', ')}
          </p>
        </div>
      ),
    },
    {
      key: 'provider',
      header: 'Tilbyder',
      render: (s) => (
        <div>
          <p className="text-sm text-foreground">{s.userId?.name ?? '–'}</p>
          <p className="text-xs text-muted-foreground">{s.userId?.email ?? ''}</p>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Pris',
      render: (s) => (
        <span className="tabular-nums text-foreground">{s.price.toLocaleString('nb-NO')} NOK</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => <AdminStatusBadge status={s.status} />,
    },
    {
      key: 'views',
      header: 'Visninger',
      render: (s) => <span className="text-sm text-muted-foreground">{s.views}</span>,
    },
    {
      key: 'date',
      header: 'Opprettet',
      render: (s) =>
        new Date(s.createdAt).toLocaleDateString('nb-NO', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
    },
    {
      key: 'actions',
      header: 'Handlinger',
      className: 'whitespace-nowrap',
      render: (s) => (
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            onClick={() => navigate(`/dashboard/services/${s._id}`)}
            aria-label={`Detaljer ${s.title}`}
          >
            Detaljer
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => navigate(`/dashboard/services/${s._id}/edit`)}
            aria-label={`Rediger ${s.title}`}
          >
            Rediger
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              setStatusTarget({ service: s, newStatus: s.status === 'open' ? 'closed' : 'open' })
            }
            aria-label={`${s.status === 'open' ? 'Lukk' : 'Åpne'} ${s.title}`}
          >
            {s.status === 'open' ? 'Lukk' : 'Åpne'}
          </Button>
          <Button
            size="xs"
            variant="destructive"
            onClick={() => setDeleteTarget(s)}
            aria-label={`Slett ${s.title}`}
          >
            Slett
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader title="Tjenester" description="Alle tjenester publisert på plattformen" />

      <AdminDataTable
        columns={columns}
        data={data?.services ?? []}
        keyExtractor={(s) => s._id}
        loading={isLoading}
        error={isError}
        onRetry={refetch}
        emptyTitle="Ingen tjenester"
        emptyDescription="Ingen tjenester matcher søket."
        pagination={data?.pagination}
        onPageChange={setPage}
        toolbar={
          <div className="flex flex-wrap gap-3 w-full">
            <AdminSearchInput
              value={search}
              onChange={handleSearchChange}
              placeholder="Søk på tittel eller beskrivelse..."
              className="flex-1 min-w-[200px]"
            />
            <AdminFilterSelect
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
              placeholder="Alle statuser"
            />
          </div>
        }
      />

      {/* Status change confirm */}
      <AdminConfirmDialog
        title="Endre tjenestestatus?"
        description={`Sett "${statusTarget?.service.title}" til "${statusTarget?.newStatus}"?`}
        confirmText="Ja, oppdater"
        cancelText="Avbryt"
        isOpen={!!statusTarget}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        onConfirm={async () => {
          if (!statusTarget) return;
          await statusMutation.mutateAsync({
            id: statusTarget.service._id,
            status: statusTarget.newStatus,
          });
          setStatusTarget(null);
        }}
      />

      {/* Delete confirm */}
      <AdminConfirmDialog
        title="Slett tjeneste?"
        description={`"${deleteTarget?.title}" vil bli permanent slettet. Bilder fjernes fra Azure.`}
        confirmText="Ja, slett"
        cancelText="Avbryt"
        variant="destructive"
        isOpen={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteMutation.mutateAsync(deleteTarget._id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
