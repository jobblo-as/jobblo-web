import { useState, useRef } from 'react';
import { Plus, Loader2, Tag, type LucideIcon } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import {
  useAdminCategories,
  useCreateAdminCategory,
  useUpdateAdminCategory,
  useToggleAdminCategory,
  useDeleteAdminCategory,
} from '../../hooks/admin';
import type { AdminCategory } from '../../api/admin';
import {
  AdminDataTable,
  AdminSearchInput,
  AdminFilterSelect,
  AdminConfirmDialog,
  AdminPageHeader,
  AdminStatusBadge,
} from '../../components/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { Mono } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
import { Input } from '../../components/developer/ui/input';
import { Label } from '../../components/developer/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/developer/ui/dialog';

// The namespace also exports helpers (createLucideIcon, ...); only icon names are looked up.
const lucideIcon = (name: string) =>
  (LucideIcons as unknown as Record<string, LucideIcon | undefined>)[name];

const ACTIVE_OPTIONS = [
  { label: 'Aktive', value: 'true' },
  { label: 'Inaktive', value: 'false' },
];

interface CategoryForm {
  name: string;
  icon: string;
  sortOrder: string;
}

const emptyForm: CategoryForm = { name: '', icon: '', sortOrder: '0' };

export default function CategoriesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null);
  const [editTarget, setEditTarget] = useState<AdminCategory | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [formError, setFormError] = useState('');

  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleSearchChange = (val: string) => {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 400);
  };

  const { data, isLoading, isError, refetch } = useAdminCategories({
    page,
    limit: 20,
    search: debouncedSearch,
    ...(activeFilter && { isActive: activeFilter }),
  });

  const createMutation = useCreateAdminCategory();
  const updateMutation = useUpdateAdminCategory();
  const toggleMutation = useToggleAdminCategory();
  const deleteMutation = useDeleteAdminCategory();

  const openCreate = () => {
    setForm(emptyForm);
    setFormError('');
    setCreateOpen(true);
  };
  const openEdit = (cat: AdminCategory) => {
    setEditTarget(cat);
    setForm({ name: cat.name, icon: cat.icon ?? '', sortOrder: String(cat.sortOrder) });
    setFormError('');
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('Kategorinavn er påkrevd.');
      return;
    }
    if (createOpen) {
      await createMutation.mutateAsync({
        name: form.name.trim(),
        icon: form.icon.trim() || undefined,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
      });
      setCreateOpen(false);
    } else if (editTarget) {
      await updateMutation.mutateAsync({
        id: editTarget._id,
        payload: {
          name: form.name.trim(),
          icon: form.icon.trim() || undefined,
          sortOrder: parseInt(form.sortOrder, 10) || 0,
        },
      });
      setEditTarget(null);
    }
    setForm(emptyForm);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const columns: ColumnDef<AdminCategory>[] = [
    {
      key: 'name',
      header: 'Navn',
      render: (c) => (
        <div className="flex items-center gap-2">
          <div
            className="flex size-7 items-center justify-center rounded-md border bg-muted/50"
            aria-hidden="true"
          >
            <Tag className="size-3.5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{c.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{c.slug}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'icon',
      header: 'Ikon',
      render: (c) => {
        const IconComp = lucideIcon(c.icon ?? '');
        return IconComp ? (
          <span className="flex items-center gap-2">
            <IconComp className="size-4 text-muted-foreground" />
            <Mono>{c.icon}</Mono>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">–</span>
        );
      },
    },
    {
      key: 'sortOrder',
      header: 'Sortering',
      render: (c) => <span className="text-sm tabular-nums text-muted-foreground">{c.sortOrder}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <AdminStatusBadge status={c.isActive ? 'active' : 'inactive'} />,
    },
    {
      key: 'date',
      header: 'Opprettet',
      render: (c) =>
        new Date(c.createdAt).toLocaleDateString('nb-NO', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
    },
    {
      key: 'actions',
      header: 'Handlinger',
      className: 'whitespace-nowrap',
      render: (c) => (
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            onClick={() => openEdit(c)}
            aria-label={`Rediger ${c.name}`}
          >
            Rediger
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => toggleMutation.mutate(c._id)}
            disabled={toggleMutation.isPending}
            aria-label={`${c.isActive ? 'Deaktiver' : 'Aktiver'} ${c.name}`}
          >
            {c.isActive ? 'Deaktiver' : 'Aktiver'}
          </Button>
          <Button
            size="xs"
            variant="destructive"
            onClick={() => setDeleteTarget(c)}
            aria-label={`Slett ${c.name}`}
          >
            Slett
          </Button>
        </div>
      ),
    },
  ];

  const isFormOpen = createOpen || !!editTarget;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Kategorier"
        description="Administrer tjenestekategorier"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus />
            Ny kategori
          </Button>
        }
      />

      <AdminDataTable
        columns={columns}
        data={data?.categories ?? []}
        keyExtractor={(c) => c._id}
        loading={isLoading}
        error={isError}
        onRetry={refetch}
        emptyTitle="Ingen kategorier"
        emptyDescription="Opprett den første kategorien."
        pagination={data?.pagination}
        onPageChange={setPage}
        toolbar={
          <div className="flex flex-wrap gap-3 w-full">
            <AdminSearchInput
              value={search}
              onChange={handleSearchChange}
              placeholder="Søk på kategorinavn..."
              className="flex-1 min-w-[180px]"
            />
            <AdminFilterSelect
              value={activeFilter}
              onChange={(v) => {
                setActiveFilter(v);
                setPage(1);
              }}
              options={ACTIVE_OPTIONS}
              placeholder="Alle statuser"
            />
          </div>
        }
      />

      {/* Create / Edit dialog */}
      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createOpen ? 'Ny kategori' : `Rediger: ${editTarget?.name}`}</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Navn *</Label>
            <Input
              id="cat-name"
              type="text"
              value={form.name}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
                setFormError('');
              }}
              aria-invalid={!!formError}
              aria-describedby={formError ? 'cat-name-err' : undefined}
            />
            {formError && (
              <p id="cat-name-err" className="text-xs text-red-600">
                {formError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-icon">Ikon (lucide-navn)</Label>
            <div className="flex items-center gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50">
                {(() => {
                  const PreviewIcon = lucideIcon(form.icon);
                  return PreviewIcon ? (
                    <PreviewIcon className="size-4 text-foreground" />
                  ) : (
                    <Tag className="size-4 text-muted-foreground" />
                  );
                })()}
              </div>
              <Input
                id="cat-icon"
                type="text"
                value={form.icon}
                onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                placeholder="f.eks. Wrench, Truck, Hammer"
                className="font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Navnet på et lucide-react-ikon, f.eks. <Mono>Wrench</Mono>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-sort">Sorteringsrekkefølge</Label>
            <Input
              id="cat-sort"
              type="number"
              min="0"
              value={form.sortOrder}
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                setEditTarget(null);
              }}
            >
              Avbryt
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              {createOpen ? 'Opprett' : 'Lagre'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminConfirmDialog
        title="Slett kategori?"
        description={`"${deleteTarget?.name}" slettes permanent. Kun mulig om ingen tjenester bruker denne kategorien.`}
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
