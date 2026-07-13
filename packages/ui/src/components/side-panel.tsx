import { Sheet, SheetContent, SheetTitle } from './sheet';

/** Right-side peek panel for list→detail without leaving the page (docs/06 §5).
 *  `modal` defaults to true (backdrop, focus trap); pass `false` for a true
 *  peek that leaves the underlying list interactive (e.g. double-click a row). */
export interface SidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeLabel?: string;
  modal?: boolean;
}

export function SidePanel({
  open,
  onOpenChange,
  title,
  children,
  footer,
  closeLabel,
  modal = true,
}: SidePanelProps): React.JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={modal}>
      <SheetContent modal={modal} {...(closeLabel ? { closeLabel } : {})}>
        {title ? (
          <div className="border-b border-border px-5 py-4">
            <SheetTitle>{title}</SheetTitle>
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="border-t border-border px-5 py-3">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}
