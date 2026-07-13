import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Reusable drag-and-drop / click-to-browse upload area (docs/modules/12 §4).
 * Presentational: it only surfaces the selected {@link File}s via `onFiles` — the
 * caller owns the upload flow. All labels are supplied by the consumer (i18n),
 * matching the design-system convention (see UserPicker). Keyboard-accessible:
 * the drop area is a real `<button>`, so Tab/Enter/Space open the file picker.
 */
export interface FileDropzoneProps {
  onFiles: (files: File[]) => void;
  /** `accept` attribute for the file input (e.g. "image/*"). */
  accept?: string;
  /** Allow selecting more than one file (default true). */
  multiple?: boolean;
  disabled?: boolean;
  /** Primary line, e.g. "Перетащите файлы сюда". */
  label?: React.ReactNode;
  /** Secondary hint, e.g. "или нажмите, чтобы выбрать". */
  hint?: React.ReactNode;
  className?: string;
  /** testid for the drop area button (e2e/analytics). */
  'data-testid'?: string;
  /** testid forwarded to the hidden file input (e2e drives uploads through it). */
  inputTestId?: string;
}

export function FileDropzone({
  onFiles,
  accept,
  multiple = true,
  disabled = false,
  label,
  hint,
  className,
  'data-testid': testId,
  inputTestId,
}: FileDropzoneProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const emit = (files: FileList | null): void => {
    const list = files ? [...files] : [];
    if (list.length > 0) onFiles(multiple ? list : list.slice(0, 1));
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        data-testid={testId}
        data-dragging={dragging ? '' : undefined}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(e) => {
          // Ignore drag-leave bubbling up from children — only reset when the
          // pointer actually leaves the drop area.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          // Stop the drop from also reaching an ancestor drop handler — a dropzone
          // that handled the drop must not double-fire the surrounding area's
          // upload (e.g. the files page wraps the content in its own onDrop).
          e.stopPropagation();
          setDragging(false);
          if (!disabled) emit(e.dataTransfer.files);
        }}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center transition-colors',
          'hover:border-primary/50 hover:bg-surface-2',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          'disabled:pointer-events-none disabled:opacity-50',
          dragging && 'border-primary bg-primary/5',
          className,
        )}
      >
        <UploadCloud className={cn('size-8', dragging ? 'text-primary' : 'text-text-muted')} />
        {label ? <span className="text-[13px] font-medium text-text">{label}</span> : null}
        {hint ? <span className="text-xs text-text-muted">{hint}</span> : null}
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple={multiple}
        {...(accept ? { accept } : {})}
        {...(inputTestId ? { 'data-testid': inputTestId } : {})}
        onChange={(e) => {
          emit(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}
