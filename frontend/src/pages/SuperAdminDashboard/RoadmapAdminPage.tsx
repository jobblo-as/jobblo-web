import { useState, type FormEvent } from 'react';
import { Trash2, Edit3, Plus } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AdminConfirmDialog, AdminDataTable, AdminPageHeader } from '../../components/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { StatusBadge } from '../../components/developer/kit';
import { Badge } from '../../components/developer/ui/badge';
import { Button } from '../../components/developer/ui/button';
import { Input } from '../../components/developer/ui/input';
import { Label } from '../../components/developer/ui/label';
import { Progress } from '../../components/developer/ui/progress';
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
import {
  useRoadmapFeatures,
  useCreateRoadmapFeature,
  useUpdateRoadmapFeature,
  useDeleteRoadmapFeature,
} from '../../features/roadMap/hooks/useRoadmap';
import type { RoadmapFeature, RoadmapFeatureInput } from '../../features/roadMap/types/roadmap';

const emptyForm: RoadmapFeatureInput = {
  title: '',
  description: '',
  status: 'planned',
  tag: 'feature',
  progress: 0,
};

const STATUS_TONE = { completed: 'success', 'in-progress': 'info', planned: 'neutral' } as const;

export default function RoadmapAdminPage() {
  const { data: features = [], isLoading: loading, isError, refetch } = useRoadmapFeatures();
  const createMutation = useCreateRoadmapFeature();
  const updateMutation = useUpdateRoadmapFeature();
  const deleteMutation = useDeleteRoadmapFeature();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFeature, setEditingFeature] = useState<RoadmapFeature | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ visible: boolean; id: string }>({
    visible: false,
    id: '',
  });
  const [form, setForm] = useState<RoadmapFeatureInput>(emptyForm);

  const handleOpenModal = (feature: RoadmapFeature | null = null) => {
    setEditingFeature(feature);
    setForm(
      feature
        ? {
            title: feature.title,
            description: feature.description,
            status: feature.status,
            tag: feature.tag,
            progress: feature.progress,
          }
        : emptyForm
    );
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (editingFeature) {
        await updateMutation.mutateAsync({ id: editingFeature._id, data: form });
      } else {
        await createMutation.mutateAsync(form);
      }
      setIsModalOpen(false);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Action failed');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(deleteConfirm.id);
      setDeleteConfirm({ visible: false, id: '' });
    } catch {
      toast.error('Deletion failed');
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const columns: ColumnDef<RoadmapFeature>[] = [
    {
      key: 'feature',
      header: 'Feature',
      className: 'max-w-md whitespace-normal',
      render: (record) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">{record.title}</p>
          <p className="text-xs text-muted-foreground">{record.description}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (record) => (
        <StatusBadge status={record.status} tone={STATUS_TONE[record.status] ?? 'neutral'} />
      ),
    },
    {
      key: 'tag',
      header: 'Tag',
      render: (record) => (
        <Badge variant="outline" className="capitalize text-muted-foreground">
          {record.tag}
        </Badge>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (record) => (
        <div className="flex w-36 items-center gap-2">
          <Progress value={record.progress} className="h-1.5" />
          <span className="text-xs tabular-nums text-muted-foreground">{record.progress}%</span>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      className: 'whitespace-nowrap',
      render: (record) => (
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => handleOpenModal(record)}>
            <Edit3 /> Edit
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteConfirm({ visible: true, id: record._id })}
          >
            <Trash2 /> Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Roadmap Management"
        actions={
          <Button size="sm" onClick={() => handleOpenModal()}>
            <Plus /> Add New Entry
          </Button>
        }
      />

      <AdminDataTable
        columns={columns}
        data={features}
        keyExtractor={(row) => row._id}
        loading={loading}
        error={isError}
        onRetry={() => refetch()}
        emptyTitle="No roadmap entries"
        emptyDescription="Add the first entry to the roadmap."
      />

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingFeature ? 'Edit Feature' : 'Add New Feature'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="roadmap-title">Title</Label>
              <Input
                id="roadmap-title"
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="E.g. Chat Improvements"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="roadmap-description">Description</Label>
              <Textarea
                id="roadmap-description"
                required
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Detailed description..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="roadmap-status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(status) =>
                    setForm({ ...form, status: status as RoadmapFeature['status'] })
                  }
                >
                  <SelectTrigger id="roadmap-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="roadmap-tag">Tag</Label>
                <Select
                  value={form.tag}
                  onValueChange={(tag) => setForm({ ...form, tag: tag as RoadmapFeature['tag'] })}
                >
                  <SelectTrigger id="roadmap-tag" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feature">Feature</SelectItem>
                    <SelectItem value="bugfix">Bugfix</SelectItem>
                    <SelectItem value="improvement">Improvement</SelectItem>
                    <SelectItem value="security">Security</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="roadmap-progress">Progress (%)</Label>
              <Input
                id="roadmap-progress"
                type="number"
                min={0}
                max={100}
                value={form.progress}
                onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {editingFeature ? 'Update Feature' : 'Add Feature'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AdminConfirmDialog
        title="Are you sure?"
        description="You cannot undo this!"
        confirmText="Yes, delete it!"
        cancelText="Cancel"
        variant="destructive"
        isOpen={deleteConfirm.visible}
        onOpenChange={(open) => !open && setDeleteConfirm({ visible: false, id: '' })}
        onConfirm={handleDelete}
      />
    </div>
  );
}
