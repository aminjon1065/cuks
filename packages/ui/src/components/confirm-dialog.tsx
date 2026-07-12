import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

/**
 * Destructive confirmation with the object name visible (docs/06 §8). Labels are
 * passed in (i18n). The confirm button is danger-styled unless `destructive={false}`.
 */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  entityName?: React.ReactNode;
  confirmLabel: React.ReactNode;
  cancelLabel: React.ReactNode;
  onConfirm: () => void;
  loading?: boolean;
  destructive?: boolean;
  closeLabel?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  entityName,
  confirmLabel,
  cancelLabel,
  onConfirm,
  loading = false,
  destructive = true,
  closeLabel,
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" {...(closeLabel ? { closeLabel } : {})}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {entityName ? (
          <div className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-[13px] font-medium text-text">
            {entityName}
          </div>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{cancelLabel}</Button>
          </DialogClose>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={loading}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
