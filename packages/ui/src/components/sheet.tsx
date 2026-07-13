import { forwardRef } from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

/** `closeLabel` is the accessible name of the ✕ button; the app passes an i18n
 * value, the English default is only a fallback (docs/06 §4). `modal={false}`
 * makes it a non-blocking peek panel (no backdrop) so the underlying list stays
 * interactive (docs/06 §5) — pair with `<Sheet modal={false}>`. */
export interface SheetContentProps extends React.ComponentPropsWithoutRef<
  typeof SheetPrimitive.Content
> {
  closeLabel?: string;
  modal?: boolean;
}

export const SheetContent = forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ className, children, closeLabel = 'Close', modal = true, ...props }, ref) => (
  <SheetPrimitive.Portal>
    {modal ? <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" /> : null}
    <SheetPrimitive.Content
      ref={ref}
      // Non-modal content keeps interaction-outside from closing it (a peek panel
      // is dismissed via the ✕ or by selecting another row), and doesn't steal
      // focus back on open.
      {...(modal
        ? {}
        : {
            onInteractOutside: (e: Event) => e.preventDefault(),
            onOpenAutoFocus: (e: Event) => e.preventDefault(),
          })}
      className={cn(
        'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-surface text-text shadow-[var(--shadow-2)]',
        className,
      )}
      {...props}
    >
      {children}
      <SheetPrimitive.Close
        aria-label={closeLabel}
        className="absolute right-4 top-4 rounded-sm text-text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <X className="size-4" />
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';

export const SheetTitle = forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold text-text', className)}
    {...props}
  />
));
SheetTitle.displayName = 'SheetTitle';

export const SheetDescription = forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn('text-[13px] text-text-muted', className)}
    {...props}
  />
));
SheetDescription.displayName = 'SheetDescription';
