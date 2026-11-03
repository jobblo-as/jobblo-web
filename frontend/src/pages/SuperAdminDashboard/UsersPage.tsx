import { useState, useCallback, useRef } from 'react';
import { Users, UserPlus, Calendar, Plus, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/developer/ui/avatar';
import { Button } from '../../components/developer/ui/button';
import { Input } from '../../components/developer/ui/input';
import { Label } from '../../components/developer/ui/label';
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
import {
  useAdminUsers,
  useCreateAdminUser,
  useChangeUserRole,
  useVerifyUser,
  useUpdateUserStatus,
} from '../../hooks/admin';
import {
  AdminDataTable,
  AdminSearchInput,
  AdminFilterSelect,
  AdminStatusBadge,
  AdminConfirmDialog,
  AdminPageHeader,
  AdminStatCard,
} from '../../components/admin';
import type { AdminUser } from '../../types/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { useUserStore } from '../../stores/userStore';

// Role options — create form. The API refuses superAdmin (no step-up in the panel).
const ROLE_OPTIONS = [
  { label: 'Bruker', value: 'user' },
  { label: 'Tilbyder', value: 'provider' },
  { label: 'Bedrift', value: 'company' },
  { label: 'Utvikler', value: 'developer' },
];
const ROLE_FILTER_OPTIONS = [
  { label: 'Bruker', value: 'user' },
  { label: 'Tilbyder', value: 'provider' },
  { label: 'Bedrift', value: 'company' },
  { label: 'Super Admin', value: 'superAdmin' },
  { label: 'Utvikler', value: 'developer' },
];
// Role change: superAdmin is listed (so an existing one displays) but cannot be picked.
const CHANGE_ROLE_OPTIONS = ROLE_FILTER_OPTIONS;
const STATUS_OPTIONS = [
  { label: 'Aktiv', value: 'active' },
  { label: 'Inaktiv', value: 'inactive' },
  { label: 'Verifisert', value: 'verified' },
];

export default function UsersPage() {
  const currentUser = useUserStore((s) => s.user);

  // Query state
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 400);
  }, []);

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<AdminUser | null>(null);
  const [roleTarget, setRoleTarget] = useState<{ user: AdminUser; newRole: string } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', role: 'user' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Data
  const { data, isLoading, isError, refetch } = useAdminUsers({
    page,
    limit: 15,
    search: debouncedSearch,
    role: roleFilter,
    accountStatus: statusFilter,
  });

  // Mutations
  const createMutation = useCreateAdminUser();
  const roleMutation = useChangeUserRole();
  const verifyMutation = useVerifyUser();
  const statusMutation = useUpdateUserStatus();

  // Table columns
  const columns: ColumnDef<AdminUser>[] = [
    {
      key: 'user',
      header: 'Bruker',
      render: (u) => (
        <Link to={`/dashboard/users/${u._id}`} className="group flex min-w-0 items-center gap-2.5">
          <Avatar>
            <AvatarImage src={u.avatarUrl} alt={u.name} />
            <AvatarFallback>{u.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground group-hover:underline">
              {u.name}
            </p>
            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
          </div>
        </Link>
      ),
    },
    {
      key: 'role',
      header: 'Rolle',
      render: (u) => <AdminStatusBadge status={u.role} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => <AdminStatusBadge status={u.accountStatus} />,
    },
    {
      key: 'verified',
      header: 'Verifisert',
      render: (u) => (
        <span
          className={`text-xs font-medium ${u.verified ? 'text-emerald-700' : 'text-muted-foreground'}`}
        >
          {u.verified ? 'Ja' : 'Nei'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Registrert',
      render: (u) =>
        new Date(u.createdAt).toLocaleDateString('nb-NO', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
    },
    {
      key: 'actions',
      header: 'Handlinger',
      className: 'whitespace-nowrap',
      render: (u) => {
        const isSelf = u._id === currentUser?._id;
        return (
          <div className="flex items-center gap-1">
            {/* Verify */}
            {!u.verified && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => verifyMutation.mutate(u._id)}
                disabled={verifyMutation.isPending}
                aria-label={`Verifiser ${u.name}`}
              >
                Verifiser
              </Button>
            )}
            {/* Toggle status */}
            {!isSelf && (
              <Button
                size="xs"
                variant={u.accountStatus === 'active' ? 'destructive' : 'outline'}
                onClick={() => {
                  if (u.accountStatus === 'active') setStatusTarget(u);
                  else statusMutation.mutate({ id: u._id, accountStatus: 'active' });
                }}
                disabled={statusMutation.isPending}
                aria-label={`${u.accountStatus === 'active' ? 'Deaktiver' : 'Aktiver'} ${u.name}`}
              >
                {u.accountStatus === 'active' ? 'Deaktiver' : 'Aktiver'}
              </Button>
            )}
            {/* Change role — not allowed for self */}
            {!isSelf && (
              <Select
                value={u.role}
                onValueChange={(newRole) => {
                  if (newRole !== u.role) {
                    setRoleTarget({ user: u, newRole });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-32 text-xs"
                  aria-label={`Endre rolle for ${u.name}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {CHANGE_ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value} disabled={r.value === 'superAdmin'}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      },
    },
  ];

  // Form validation
  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Navn er påkrevd.';
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email))
      errors.email = 'Gyldig e-post er påkrevd.';
    if (!form.password || form.password.length < 6) errors.password = 'Passord må ha minst 6 tegn.';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreate = async () => {
    if (!validateForm()) return;
    await createMutation.mutateAsync({
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      password: form.password,
      role: form.role,
    });
    setCreateOpen(false);
    setForm({ name: '', email: '', phone: '', password: '', role: 'user' });
    setFormErrors({});
  };

  const stats = data?.pagination
    ? {
        total: data.pagination.total,
        thisPage: data.users.length,
      }
    : null;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Brukere"
        description="Administrer alle plattformbrukere"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            Ny bruker
          </Button>
        }
      />

      {/* Stats row */}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-3">
          <AdminStatCard title="Totale brukere" value={stats.total} icon={<Users />} />
          <AdminStatCard title="Søkeresultater" value={stats.thisPage} icon={<UserPlus />} />
          <AdminStatCard
            title="Sider"
            value={data?.pagination.totalPages ?? 0}
            icon={<Calendar />}
          />
        </div>
      )}

      {/* Table with toolbar */}
      <AdminDataTable
        columns={columns}
        data={data?.users ?? []}
        keyExtractor={(u) => u._id}
        loading={isLoading}
        error={isError}
        onRetry={refetch}
        emptyTitle="Ingen brukere"
        emptyDescription="Ingen brukere matcher søket ditt."
        pagination={data?.pagination}
        onPageChange={setPage}
        toolbar={
          <div className="flex flex-wrap gap-3 w-full">
            <AdminSearchInput
              value={search}
              onChange={handleSearchChange}
              placeholder="Søk på navn, e-post, telefon..."
              className="flex-1 min-w-[200px]"
            />
            <AdminFilterSelect
              value={roleFilter}
              onChange={(v) => {
                setRoleFilter(v);
                setPage(1);
              }}
              options={ROLE_FILTER_OPTIONS}
              placeholder="Alle roller"
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

      {/* Create user dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setFormErrors({});
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Opprett ny bruker</DialogTitle>
          </DialogHeader>

          {(['name', 'email', 'phone', 'password'] as const).map((field) => (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={`create-${field}`}>
                {field === 'name'
                  ? 'Navn *'
                  : field === 'email'
                    ? 'E-post *'
                    : field === 'phone'
                      ? 'Telefon'
                      : 'Passord *'}
              </Label>
              <Input
                id={`create-${field}`}
                type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
                value={form[field]}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                aria-describedby={formErrors[field] ? `err-${field}` : undefined}
                aria-invalid={!!formErrors[field]}
              />
              {formErrors[field] && (
                <p id={`err-${field}`} className="text-xs text-red-600">
                  {formErrors[field]}
                </p>
              )}
            </div>
          ))}

          <div className="space-y-1.5">
            <Label htmlFor="create-role">Rolle *</Label>
            <Select value={form.role} onValueChange={(role) => setForm((f) => ({ ...f, role }))}>
              <SelectTrigger id="create-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                setFormErrors({});
              }}
            >
              Avbryt
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="animate-spin" />}
              Opprett bruker
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Role change confirm */}
      <AdminConfirmDialog
        title="Deaktiver bruker?"
        description={`"${statusTarget?.name}" mister tilgangen, men historiske data beholdes.`}
        confirmText="Ja, deaktiver"
        cancelText="Avbryt"
        variant="destructive"
        isOpen={!!statusTarget}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        onConfirm={async () => {
          if (!statusTarget) return;
          await statusMutation.mutateAsync({ id: statusTarget._id, accountStatus: 'inactive' });
          setStatusTarget(null);
        }}
      />

      <AdminConfirmDialog
        title="Endre brukerrolle?"
        description={`Vil du endre rollen til "${roleTarget?.user.name}" til "${roleTarget?.newRole}"?`}
        confirmText="Ja, endre rolle"
        cancelText="Avbryt"
        isOpen={!!roleTarget}
        onOpenChange={(open) => !open && setRoleTarget(null)}
        onConfirm={async () => {
          if (!roleTarget) return;
          await roleMutation.mutateAsync({ id: roleTarget.user._id, role: roleTarget.newRole });
          setRoleTarget(null);
        }}
      />
    </div>
  );
}
