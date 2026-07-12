import { forwardRef } from 'react';
import { cn } from '../lib/cn';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label ref={ref} className={cn('text-xs font-medium text-text', className)} {...props}>
      {children}
      {required ? <span className="ml-0.5 text-danger">*</span> : null}
    </label>
  ),
);
Label.displayName = 'Label';
