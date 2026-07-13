import { forwardRef } from 'react';
import { cn } from '../lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  // Permit `data-*` hooks (e.g. data-testid for e2e); React's HTMLAttributes typing
  // omits them for custom components.
  [dataAttr: `data-${string}`]: string | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
      'placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      'disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
