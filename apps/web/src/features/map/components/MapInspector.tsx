import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Pencil, Trash2, X } from 'lucide-react';
import { Button, cn, SeverityBadge, StatusBadge, type SeverityLevel } from '@cuks/ui';
import type { GisLayerDto, IncidentMapFilterOptionsResponse, IncidentStatus } from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import { incidentStatusTone } from '@/features/incidents/lib';
import type { InspectedFeature, InspectKind } from '../lib/inspect';

export interface MapInspectorProps {
  /** Everything the last click / box-select hit. */
  features: InspectedFeature[];
  /** The feature whose card is open; `null` shows the selection list. */
  selected: InspectedFeature | null;
  layers: readonly GisLayerDto[];
  options: IncidentMapFilterOptionsResponse | undefined;
  /** A geometry edit is in progress on the selected feature. */
  editing: boolean;
  /** The edited geometry differs from what is stored. */
  dirty: boolean;
  busy: boolean;
  /** Shift left of the drawing toolbar when it is on screen. */
  offsetRight: boolean;
  onSelect: (feature: InspectedFeature | null) => void;
  onClose: () => void;
  onEdit: (feature: InspectedFeature) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onDelete: (feature: InspectedFeature) => void;
}

const KIND_LABEL: Record<InspectKind, string> = {
  incident: 'inspector.kinds.incident',
  drawn: 'inspector.kinds.drawn',
  facility: 'inspector.kinds.facility',
  admin_unit: 'inspector.kinds.admin_unit',
  risk_zone: 'inspector.kinds.risk_zone',
};

/** Plumbing columns the tiles carry that mean nothing to a user (ids, timestamps,
 *  the already-flattened jsonb containers). */
const HIDDEN_PROPS = new Set([
  'id',
  'layer_id',
  'feature_id',
  'parent_id',
  'geom',
  'attrs',
  'props',
  'is_cluster',
  'cluster_count',
  'created_by',
  'created_at',
  'updated_by',
  'updated_at',
  'org_unit_id',
]);

/** Attributes of the selected object. Known columns get their Russian label; a
 *  layer's own `props` keys are the author's, so they are shown as written. */
function AttributeList({ props }: { props: Record<string, unknown> }): React.JSX.Element {
  const { t, i18n } = useTranslation('map');
  const rows = Object.entries(props).filter(
    ([key, value]) =>
      !HIDDEN_PROPS.has(key) && value !== null && value !== undefined && value !== '',
  );
  if (rows.length === 0) {
    return <p className="text-xs text-text-muted">{t('inspector.noAttributes')}</p>;
  }
  const label = (key: string): string =>
    i18n.exists(`map:inspector.attributes.${key}`) ? t(`inspector.attributes.${key}`) : key;
  const display = (value: unknown): string =>
    typeof value === 'boolean' ? t(value ? 'inspector.yes' : 'inspector.no') : String(value);

  return (
    <dl className="space-y-1.5">
      {rows.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-xs">
          <dt className="w-28 shrink-0 truncate text-text-muted" title={label(key)}>
            {label(key)}
          </dt>
          <dd className="min-w-0 flex-1 break-words text-text">{display(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The rubber-band selection (docs/modules/10 §4: «Мультивыбор рамкой — таблица
 * выбранного»). A compact two-column table — what the object is, and which one —
 * grouped by kind so a box over a district reads as "3 ЧС, 2 объекта", not as one
 * long undifferentiated list. A row opens that object's card.
 */
function SelectionTable({
  features,
  onSelect,
}: {
  features: InspectedFeature[];
  onSelect: (feature: InspectedFeature) => void;
}): React.JSX.Element {
  const { t } = useTranslation('map');
  return (
    <table className="w-full text-left" data-testid="map-selection-table">
      <caption className="sr-only">
        {t('inspector.selectedCount', { count: features.length })}
      </caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="pb-1 pr-2 text-xs font-medium text-text-muted">
            {t('inspector.columnKind')}
          </th>
          <th scope="col" className="pb-1 text-xs font-medium text-text-muted">
            {t('inspector.columnName')}
          </th>
        </tr>
      </thead>
      <tbody>
        {features.map((feature) => (
          <tr
            key={`${feature.kind}:${feature.id}`}
            className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-surface-2"
            onClick={() => onSelect(feature)}
          >
            <td className="py-1.5 pr-2 align-top">
              <span className="text-xs text-text-muted">{t(KIND_LABEL[feature.kind])}</span>
            </td>
            <td className="py-1.5 align-top">
              <button
                type="button"
                className="block max-w-full truncate text-left text-sm text-text hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(feature);
                }}
              >
                {feature.title || t('inspector.unnamed')}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Peek card for an emergency (docs/modules/10 §4: «Открыть полностью» → карточка ЧС). */
function IncidentCard({
  feature,
  options,
}: {
  feature: InspectedFeature;
  options: IncidentMapFilterOptionsResponse | undefined;
}): React.JSX.Element {
  const { t, i18n } = useTranslation('map');
  const tajik = i18n.resolvedLanguage === 'tg';
  const props = feature.props;
  const severity = Number(props['severity'] ?? 0);
  const status = String(props['status'] ?? '') as IncidentStatus;
  const type = options?.types.find((item) => item.code === props['type_code']);
  const occurredAt = Number(props['occurred_at'] ?? 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {severity >= 1 && severity <= 5 && (
          <SeverityBadge
            level={severity as SeverityLevel}
            label={t(`legend.severity${severity}`)}
          />
        )}
        {status && (
          <StatusBadge tone={incidentStatusTone[status]} label={t(`filters.statuses.${status}`)} />
        )}
      </div>
      <dl className="space-y-1.5 text-xs">
        {type && (
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-text-muted">{t('inspector.incidentType')}</dt>
            <dd className="min-w-0 flex-1 text-text">{tajik ? type.nameTg : type.nameRu}</dd>
          </div>
        )}
        {occurredAt > 0 && (
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-text-muted">{t('inspector.occurredAt')}</dt>
            <dd className="min-w-0 flex-1 text-text">
              {formatDateTime(new Date(occurredAt * 1000).toISOString())}
            </dd>
          </div>
        )}
      </dl>
      <Button asChild variant="secondary" size="sm" className="w-full">
        <Link to={`/app/incidents/${feature.id}`}>
          <ExternalLink className="size-3.5" />
          {t('inspector.openFull')}
        </Link>
      </Button>
    </div>
  );
}

/**
 * Object inspector (docs/modules/10 §4). A click opens the peek card of what is
 * under the cursor; a shift+drag box opens the list of everything inside it. For
 * a drawn feature the card is also the editing surface: geometry edits happen on
 * the map (terra-draw) and are committed from here, so an accidental click can
 * never silently rewrite a geometry.
 */
export function MapInspector({
  features,
  selected,
  layers,
  options,
  editing,
  dirty,
  busy,
  offsetRight,
  onSelect,
  onClose,
  onEdit,
  onSave,
  onCancelEdit,
  onDelete,
}: MapInspectorProps): React.JSX.Element | null {
  const { t } = useTranslation('map');
  if (features.length === 0) return null;

  const layer = selected?.layerId ? layers.find((item) => item.id === selected.layerId) : undefined;
  const canEdit = selected?.kind === 'drawn' && layer?.canEdit === true;

  return (
    <aside
      className={cn(
        'absolute top-16 z-30 flex max-h-[calc(100%-9rem)] w-72 flex-col overflow-hidden rounded border border-border bg-surface shadow-[var(--shadow-2)]',
        offsetRight ? 'right-14' : 'right-3',
      )}
      aria-label={t('inspector.title')}
      data-testid="map-inspector"
    >
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        {selected && features.length > 1 && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-text-muted"
            onClick={() => onSelect(null)}
            aria-label={t('inspector.back')}
            disabled={editing}
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-medium text-text">
            {selected ? selected.title || t(KIND_LABEL[selected.kind]) : t('inspector.title')}
          </p>
          <p className="truncate text-xs text-text-muted">
            {selected
              ? t(KIND_LABEL[selected.kind])
              : t('inspector.selectedCount', { count: features.length })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-text-muted"
          onClick={onClose}
          aria-label={t('inspector.close')}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!selected ? (
          <SelectionTable features={features} onSelect={onSelect} />
        ) : selected.kind === 'incident' ? (
          <IncidentCard feature={selected} options={options} />
        ) : (
          <div className="space-y-3">
            <AttributeList props={selected.props} />
            {canEdit && (
              <div className="space-y-2 border-t border-border pt-3">
                {editing ? (
                  <>
                    <p className="text-xs text-text-muted">{t('inspector.editHint')}</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={!dirty || busy}
                        onClick={onSave}
                        data-testid="inspector-save"
                      >
                        {t('inspector.save')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={onCancelEdit} disabled={busy}>
                        {t('inspector.cancel')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1"
                      onClick={() => onEdit(selected)}
                      disabled={busy}
                      data-testid="inspector-edit"
                    >
                      <Pencil className="size-3.5" />
                      {t('inspector.editGeometry')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() => onDelete(selected)}
                      disabled={busy}
                      aria-label={t('inspector.delete')}
                      title={t('inspector.delete')}
                      data-testid="inspector-delete"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
