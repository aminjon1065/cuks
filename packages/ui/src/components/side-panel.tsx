import { Sheet, SheetContent, SheetTitle } from './sheet';

/** Right-side peek panel for list→detail without leaving the page (docs/06 §5). */
export interface SidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeLabel?: string;
}

export function SidePanel({
  open,
  onOpenChange,
  title,
  children,
  footer,
  closeLabel,
}: SidePanelProps): React.JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent {...(closeLabel ? { closeLabel } : {})}>
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
