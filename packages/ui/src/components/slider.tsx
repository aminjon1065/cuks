import { forwardRef } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '../lib/cn';

/** Slider (docs/06 §4). Radix primitive styled with design tokens; used for the
 *  layer-opacity control on the map. Renders one thumb per value so it works for
 *  single- and range-value cases. */
export const Slider = forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby, ...props }, ref) => {
  const thumbCount = props.value?.length ?? props.defaultValue?.length ?? 1;
  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        'relative flex w-full touch-none select-none items-center',
        'data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-surface-2">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }, (_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          // The role="slider" element is the Thumb, so the accessible name must
          // live here — not on Root, where Radix would leave it unannounced.
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
          className={cn(
            'block size-3.5 rounded-full border border-primary bg-surface shadow-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
            'disabled:pointer-events-none',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
});
Slider.displayName = 'Slider';
