import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Info, AlertTriangle, Tag, Plus, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { fetchSystemHistory, sendSystemNotification } from '../../api/admin';
import { AdminConfirmDialog, AdminDataTable, AdminPageHeader } from '../../components/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { Section, StatusBadge } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
import { Label } from '../../components/developer/ui/label';
import { Textarea } from '../../components/developer/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/developer/ui/select';

type SystemNotification = { _id: string; type: string; content: string; createdAt: string };

const notificationTypes = [
  { id: 'system_update', label: 'Update', icon: <Info />, tone: 'info' },
  { id: 'alert', label: 'Alert', icon: <AlertTriangle />, tone: 'danger' },
  { id: 'promotion', label: 'Offer', icon: <Tag />, tone: 'warning' },
  { id: 'general', label: 'General', icon: <Bell />, tone: 'neutral' },
] as const;

const getTypeInfo = (type: string) =>
  notificationTypes.find((t) => t.id === type) || notificationTypes[3];

const emptyForm = { type: 'system_update', content: '' };

export default function NotificationsPage() {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const historyQuery = useQuery({
    queryKey: ['admin', 'system-history', page],
    queryFn: () => fetchSystemHistory(page),
    placeholderData: keepPreviousData,
  });
  const history: SystemNotification[] = historyQuery.data?.data ?? [];
  const totalPages: number = historyQuery.data?.totalPages ?? 1;
  const sendMutation = useMutation({ mutationFn: sendSystemNotification });
  const [form, setForm] = useState(emptyForm);
  const [sendConfirm, setSendConfirm] = useState<{
    visible: boolean;
    data: typeof emptyForm | null;
  }>({ visible: false, data: null });

  const handleSendConfirm = (e: FormEvent) => {
    e.preventDefault();
    setSendConfirm({ visible: true, data: form });
  };

  const handleSubmit = async () => {
    try {
      const data = await sendMutation.mutateAsync({
        ...sendConfirm.data,
        isSystem: true,
        userId: null,
      });
      toast.success(data.message);
      setForm(emptyForm);
      setShowForm(false);
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ['admin', 'system-history'] });
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to send');
    } finally {
      setSendConfirm({ visible: false, data: null });
    }
  };

  const columns: ColumnDef<SystemNotification>[] = [
    {
      key: 'type',
      header: 'Type',
      render: (record) => {
        const typeInfo = getTypeInfo(record.type);
        return (
          <span className="inline-flex items-center gap-2 text-muted-foreground [&_svg]:size-4">
            {typeInfo.icon}
            <StatusBadge status={typeInfo.id} label={typeInfo.label} tone={typeInfo.tone} />
          </span>
        );
      },
    },
    {
      key: 'content',
      header: 'Content',
      className: 'max-w-md truncate',
      render: (record) => record.content,
    },
    {
      key: 'created',
      header: 'Created',
      className: 'text-xs text-muted-foreground',
      render: (record) => new Date(record.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="System Notifications"
        description="Manage global broadcasts"
        actions={
          <Button
            size="sm"
            variant={showForm ? 'outline' : 'default'}
            className={showForm ? 'bg-card' : undefined}
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? <X /> : <Plus />}
            {showForm ? 'Close Form' : 'Create Notification'}
          </Button>
        }
      />

      {showForm && (
        <Section title="Create Notification">
          <form onSubmit={handleSendConfirm} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="notification-type">Notification Type</Label>
              <Select value={form.type} onValueChange={(type) => setForm({ ...form, type })}>
                <SelectTrigger id="notification-type" className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {notificationTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.icon}
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notification-content">Notification Content</Label>
              <Textarea
                id="notification-content"
                rows={3}
                required
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="Enter notification content..."
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm">
                Send Notification
              </Button>
            </div>
          </form>
        </Section>
      )}

      <AdminDataTable
        columns={columns}
        data={history}
        keyExtractor={(row) => row._id}
        loading={historyQuery.isLoading}
        error={historyQuery.isError}
        onRetry={() => historyQuery.refetch()}
        emptyTitle="No notifications"
        emptyDescription="No global broadcasts have been sent yet."
        pagination={{
          page,
          limit: 5,
          total: historyQuery.data?.total ?? totalPages * 5,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        }}
        onPageChange={setPage}
      />

      <AdminConfirmDialog
        title="Confirm Broadcast?"
        description="This will create a single global notification for all users."
        confirmText="Yes, Send!"
        cancelText="Cancel"
        isOpen={sendConfirm.visible}
        onOpenChange={(open) => !open && setSendConfirm({ visible: false, data: null })}
        onConfirm={handleSubmit}
      />
    </div>
  );
}
