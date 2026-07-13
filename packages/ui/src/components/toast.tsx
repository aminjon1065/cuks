import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Toasts (docs/06 §5): success ~3s, errors persist until dismissed. A tiny
 * module-level store drives an imperative `toast()` from anywhere; mount one
 * {@link Toaster} at the app root. Text is passed in (i18n) — no product copy here.
 */
export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone?: 'default' | 'success' | 'danger';
  /** ms; 0 = sticky. Defaults to 3000 (default/success) or sticky for danger. */
  duration?: number;
}

let items: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function toast(input: Omit<ToastItem, 'id'>): string {
  const id = crypto.randomUUID();
  items = [...items, { id, ...input }];
  emit();
  const duration = input.duration ?? (input.tone === 'danger' ? 0 : 3000);
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}

export function dismissToast(id: string): void {
  items = items.filter((i) => i.id !== id);
  emit();
}

const toneRing: Record<NonNullable<ToastItem['tone']>, string> = {
  default: 'border-border',
  success: 'border-success/40',
  danger: 'border-danger/40',
};

export function Toaster(): React.JSX.Element | null {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
    () => items,
  );
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'danger' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-md border bg-surface p-3 text-text shadow-[var(--shadow-2)]',
            toneRing[t.tone ?? 'default'],
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{t.title}</div>
            {t.description ? (
              <div className="mt-0.5 text-xs text-text-muted">{t.description}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="text-text-muted transition-colors hover:text-text"
            aria-label="close"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
