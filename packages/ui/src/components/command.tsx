import { forwardRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Command menu (docs/06 §4) — the Cmd+K palette primitive on cmdk. Chrome is
 * icon/structure only; all labels are supplied by the consumer (i18n).
 */
export const Command = forwardRef<
  React.ComponentRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn('flex h-full w-full flex-col overflow-hidden text-text', className)}
    {...props}
  />
));
Command.displayName = 'Command';

export const CommandInput = forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center gap-2 border-b border-border px-3">
    <Search className="size-4 shrink-0 text-text-muted" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'h-11 w-full bg-transparent text-[13px] outline-none placeholder:text-text-muted',
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = 'CommandInput';

export const CommandList = forwardRef<
  React.ComponentRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn('max-h-80 overflow-y-auto overflow-x-hidden p-1', className)}
    {...props}
  />
));
CommandList.displayName = 'CommandList';

export const CommandEmpty = forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cn('py-8 text-center text-[13px] text-text-muted', className)}
    {...props}
  />
));
CommandEmpty.displayName = 'CommandEmpty';

export const CommandGroup = forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
      '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-muted',
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = 'CommandGroup';

export const CommandItem = forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-2 text-[13px] outline-none',
      'data-[selected=true]:bg-surface-2 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
      '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-muted',
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = 'CommandItem';

export const CommandSeparator = forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border', className)}
    {...props}
  />
));
CommandSeparator.displayName = 'CommandSeparator';

/** Modal command palette: a centered dialog hosting a {@link Command}. */
export interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  children: React.ReactNode;
}

export function CommandDialog({
  open,
  onOpenChange,
  label,
  children,
}: CommandDialogProps): React.JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content
          aria-label={label}
          className={cn(
            'fixed left-1/2 top-[15%] z-50 w-full max-w-xl -translate-x-1/2',
            'overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow-2)]',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          <Command>{children}</Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
