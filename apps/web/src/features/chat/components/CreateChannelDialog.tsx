import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  cn,
  toast,
} from '@cuks/ui';
import type { ChannelKind } from '@cuks/shared';
import { useCreateChannel } from '../api/queries';

/** Create a standalone public or private channel (docs/modules/13 §2). */
export function CreateChannelDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (channelId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const create = useCreateChannel();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<Extract<ChannelKind, 'public' | 'private'>>('private');

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { kind, name: name.trim(), topic: topic.trim() || null },
      {
        onSuccess: (ch) => {
          toast({ title: t('create.created'), tone: 'success' });
          onCreated(ch.id);
          onClose();
        },
        onError: () => toast({ title: t('create.failed'), tone: 'danger' }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="chan-name">{t('create.name')}</Label>
            <Input
              id="chan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create.namePlaceholder')}
              maxLength={120}
              autoFocus
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="chan-topic">{t('create.topic')}</Label>
            <Input
              id="chan-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t('create.topicPlaceholder')}
              maxLength={500}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-medium text-text">{t('create.kind')}</legend>
            {(['public', 'private'] as const).map((k) => (
              <label
                key={k}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-[13px] transition-colors',
                  kind === k ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-2',
                )}
              >
                <input
                  type="radio"
                  name="chan-kind"
                  className="mt-0.5"
                  checked={kind === k}
                  onChange={() => setKind(k)}
                />
                <span className="text-text-muted">
                  {k === 'public' ? t('create.kindPublic') : t('create.kindPrivate')}
                </span>
              </label>
            ))}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {t('create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
