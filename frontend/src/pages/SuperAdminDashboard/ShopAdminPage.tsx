import { useState } from 'react';
import {
  Plus,
  Save,
  Edit3,
  Trash2,
  ShoppingBag,
  Coins,
  ToggleLeft,
  ToggleRight,
  Loader2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  createShopItem,
  deleteShopItem,
  fetchShopItems,
  toggleShopItem,
  updateShopItem,
  type ShopForm,
  type ShopItem,
} from '../../api/admin';
import {
  AdminDataTable,
  AdminPageHeader,
  AdminConfirmDialog,
  AdminStatusBadge,
} from '../../components/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { Badge } from '../../components/developer/ui/badge';
import { Button } from '../../components/developer/ui/button';
import { Input } from '../../components/developer/ui/input';
import { Label } from '../../components/developer/ui/label';
import { Textarea } from '../../components/developer/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/developer/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/developer/ui/dialog';

const emptyForm: ShopForm = { title: '', description: '', coins: '0', category: 'coins' };

export default function ShopAdminPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<ShopItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ShopItem | null>(null);
  const [form, setForm] = useState<ShopForm>(emptyForm);
  const [formError, setFormError] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-shop', page],
    queryFn: () => fetchShopItems(page),
    staleTime: 30_000,
  });

  const toggleMutation = useMutation({
    mutationFn: toggleShopItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-shop'] });
      toast.success('Status oppdatert.');
    },
    onError: () => toast.error('Kunne ikke oppdatere status.'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteShopItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-shop'] });
      toast.success('Vare slettet.');
    },
    onError: () => toast.error('Kunne ikke slette varen.'),
  });

  const saveMutation = useMutation({
    mutationFn: async (values: ShopForm) => {
      if (editTarget) {
        await updateShopItem(editTarget._id, values);
      } else {
        await createShopItem(values);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-shop'] });
      toast.success(editTarget ? 'Vare oppdatert.' : 'Vare opprettet.');
      setCreateOpen(false);
      setEditTarget(null);
    },
    onError: (err: { response?: { data?: { error?: string } } }) =>
      toast.error(err?.response?.data?.error || 'Operasjon feilet.'),
  });

  const openCreate = () => {
    setForm(emptyForm);
    setEditTarget(null);
    setFormError('');
    setCreateOpen(true);
  };

  const openEdit = (item: ShopItem) => {
    setEditTarget(item);
    setForm({
      title: item.title,
      description: item.description || '',
      coins: String(item.coins),
      category: item.category,
    });
    setFormError('');
    setCreateOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      setFormError('Tittel er påkrevd.');
      return;
    }
    await saveMutation.mutateAsync(form);
    setForm(emptyForm);
  };

  const items = data?.items ?? [];
  const pagination = data?.pagination;

  const columns: ColumnDef<ShopItem>[] = [
    {
      key: 'title',
      header: 'Tittel',
      render: (item) => (
        <div className="flex items-center gap-2">
          <ShoppingBag className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-foreground">{item.title}</span>
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Beskrivelse',
      render: (item) => (
        <span className="block max-w-55 truncate text-muted-foreground">
          {item.description || '–'}
        </span>
      ),
    },
    {
      key: 'coins',
      header: 'Mynter',
      render: (item) => (
        <Badge
          variant="outline"
          className="border-amber-200/70 bg-amber-50 text-amber-700 tabular-nums"
        >
          <Coins /> {item.coins}
        </Badge>
      ),
    },
    {
      key: 'category',
      header: 'Kategori',
      render: (item) => (
        <Badge variant="outline" className="text-muted-foreground">
          {item.category === 'coins'
            ? 'Mynter'
            : item.category === 'premium'
              ? 'Premium'
              : 'Funksjon'}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => <AdminStatusBadge status={item.isActive ? 'active' : 'inactive'} />,
    },
    {
      key: 'created',
      header: 'Opprettet',
      render: (item) =>
        new Date(item.createdAt).toLocaleDateString('nb-NO', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
    },
    {
      key: 'actions',
      header: 'Handlinger',
      className: 'whitespace-nowrap',
      render: (item) => (
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => openEdit(item)}>
            <Edit3 /> Rediger
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleMutation.mutate(item._id)}
            disabled={toggleMutation.isPending}
          >
            {item.isActive ? <ToggleLeft /> : <ToggleRight />}
            {item.isActive ? 'Deaktiver' : 'Aktiver'}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(item)}>
            <Trash2 /> Slett
          </Button>
        </div>
      ),
    },
  ];

  const isFormOpen = createOpen || !!editTarget;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Shop - Mynthandel"
        description="Administrer Jobblo Shop-varer og myntpakker"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus /> Ny vare
          </Button>
        }
      />

      <AdminDataTable
        columns={columns}
        data={items}
        keyExtractor={(item) => item._id}
        loading={isLoading}
        error={isError}
        onRetry={refetch}
        emptyTitle="Ingen shop-varer"
        emptyDescription="Opprett den første varen i shoppen."
        pagination={pagination}
        onPageChange={setPage}
      />

      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? `Rediger: ${editTarget.title}` : 'Ny vare'}</DialogTitle>
          </DialogHeader>

          {formError && (
            <p className="rounded-md border border-red-200/70 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="shop-title">Tittel *</Label>
            <Input
              id="shop-title"
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shop-desc">Beskrivelse</Label>
            <Textarea
              id="shop-desc"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="shop-coins">Mynter *</Label>
              <Input
                id="shop-coins"
                type="number"
                min="0"
                value={form.coins}
                onChange={(e) => setForm((f) => ({ ...f, coins: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shop-category">Kategori *</Label>
              <Select
                value={form.category}
                onValueChange={(value) =>
                  setForm((f) => ({ ...f, category: value as 'coins' | 'premium' | 'feature' }))
                }
              >
                <SelectTrigger id="shop-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="coins">Mynter</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                  <SelectItem value="feature">Funksjon</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {editTarget ? 'Oppdater' : 'Opprett'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminConfirmDialog
        title="Slett vare?"
        description={`"${deleteTarget?.title}" vil bli permanent slettet.`}
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
