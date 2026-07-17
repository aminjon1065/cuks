import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@cuks/ui';
import { DRAWN_LAYER_GEOMETRY_TYPES, type CreateGisLayerInput } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { cssToken } from '../lib/map-config';
import { useCreateGisLayer } from '../api/queries';

/**
 * Palette for a drawn layer: design-system tokens only (docs/06 §2 — no free-form
 * colors). The stored style needs a literal hex (MapLibre paints from it), so the
 * token is resolved at pick time; a layer therefore keeps the color it was given,
 * which is the point of a user-chosen layer style.
 */
const COLOR_TOKENS = ['--success', '--primary', '--warning', '--danger', '--info'] as const;

const selectClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

export interface CreateLayerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The new layer becomes the drawing target. */
  onCreated: (layerId: string) => void;
}

/** Create a drawn layer (docs/modules/10 §4 «Мои слои»). The creator becomes its
 *  manager server-side, so it is immediately editable. */
export function CreateLayerDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateLayerDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation('map');
  const create = useCreateGisLayer();
  const palette = useMemo(
    () => COLOR_TOKENS.map((token) => ({ token, hex: cssToken(token, '#15803d') })),
    [],
  );
  const [title, setTitle] = useState('');
  const [geometryType, setGeometryType] = useState<CreateGisLayerInput['geometryType']>('Geometry');
  const [color, setColor] = useState<string>(() => cssToken('--success', '#15803d'));

  const close = (): void => {
    onOpenChange(false);
    setTitle('');
    setGeometryType('Geometry');
    setColor(cssToken('--success', '#15803d'));
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;
    create.mutate(
      { title: name, geometryType, style: { color } },
      {
        onSuccess: (layer) => {
          toast({ title: t('drawn.created'), tone: 'success' });
          close();
          onCreated(layer.id);
        },
        onError: (error) => {
          // Server errors carry a stable code (docs/04 §REST); the message is an
          // English log line, so localize the codes we know and fall back for the rest.
          const code = error instanceof ApiError ? error.code : null;
          const key = code ? `errors.${code}` : null;
          toast({
            title: key && i18n.exists(`map:${key}`) ? t(key) : t('drawn.createFailed'),
            tone: 'danger',
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={t('drawn.close')} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('drawn.newLayer')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="layer-title">{t('drawn.layerTitle')}</Label>
            <Input
              id="layer-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('drawn.layerTitlePlaceholder')}
              maxLength={200}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="layer-geometry">{t('drawn.geometryType')}</Label>
            <select
              id="layer-geometry"
              className={selectClass}
              value={geometryType}
              onChange={(event) =>
                setGeometryType(event.target.value as CreateGisLayerInput['geometryType'])
              }
            >
              {DRAWN_LAYER_GEOMETRY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`drawn.geometry.${type}`)}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-muted">{t('drawn.geometryHint')}</p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-text">{t('drawn.color')}</legend>
            <div className="flex gap-2">
              {palette.map((option) => (
                <button
                  key={option.token}
                  type="button"
                  onClick={() => setColor(option.hex)}
                  aria-label={t(`drawn.colors.${option.token.slice(2)}`)}
                  aria-pressed={color === option.hex}
                  className={cn(
                    'size-7 rounded-full border-2 transition-colors',
                    color === option.hex ? 'border-text' : 'border-transparent',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                  )}
                  style={{ background: `var(${option.token})` }}
                />
              ))}
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {t('drawn.cancel')}
            </Button>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              {t('drawn.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
