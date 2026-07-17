import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { KanbanSquare, Plus } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  StatusBadge,
  toast,
} from '@cuks/ui';
import { useCan } from '@/lib/ability';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useCreateProject, useProjects } from '../api/queries';

/** «Проекты задач» (docs/modules/15 §1, task 4.2): the caller's boards + create. */
export function ProjectsPage(): React.JSX.Element {
  const { t } = useTranslation('tasks');
  useDocumentTitle(t('projects.title'));
  const navigate = useNavigate();
  const projects = useProjects();
  const canCreate = useCan('tasks.projects.create');
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('projects.title')}
        description={t('projects.subtitle')}
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> {t('projects.create')}
            </Button>
          ) : undefined
        }
      />

      {projects.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : projects.isError ? (
        <EmptyState
          icon={KanbanSquare}
          title={t('projects.loadError')}
          action={<Button onClick={() => void projects.refetch()}>{t('actions.retry')}</Button>}
        />
      ) : (projects.data ?? []).length === 0 ? (
        <EmptyState
          icon={KanbanSquare}
          title={t('projects.empty.title')}
          description={t('projects.empty.description')}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data!.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => navigate(`/app/tasks/projects/${p.key}`)}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-left hover:border-primary/40"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-text-muted">{p.key}</span>
                {p.isArchived ? (
                  <StatusBadge tone="neutral" label={t('projects.archived')} />
                ) : null}
              </div>
              <span className="font-medium text-text">{p.name}</span>
              {p.description ? (
                <span className="line-clamp-2 text-[13px] text-text-muted">{p.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {creating ? <CreateDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation('tasks');
  const navigate = useNavigate();
  const create = useCreateProject();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !key.trim()) return;
    create.mutate(
      {
        name: name.trim(),
        key: key.trim().toUpperCase(),
        description: description.trim() || null,
        visibleToOrgUnit: false,
      },
      {
        onSuccess: (p) => {
          toast({ title: t('projects.createdToast'), tone: 'success' });
          onClose();
          navigate(`/app/tasks/projects/${p.key}`);
        },
        onError: () => toast({ title: t('projects.createFailed'), tone: 'danger' }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('projects.create')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="proj-name">{t('projects.form.name')}</Label>
            <Input id="proj-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="proj-key">{t('projects.form.key')}</Label>
            <Input
              id="proj-key"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder={t('projects.form.keyPlaceholder')}
              maxLength={12}
              required
            />
            <span className="text-xs text-text-muted">{t('projects.form.keyHint')}</span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="proj-desc">{t('projects.form.description')}</Label>
            <Input
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim() || !key.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
