import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import {
  Skeleton,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  StatusBadge,
  cn,
  toast,
} from '@cuks/ui';
import {
  ROUTE_STEP_KINDS,
  type RouteStepInput,
  type RouteStepKind,
  type RouteValidationDto,
  type StartRouteInput,
} from '@cuks/shared';
import { useDirectoryUsers, useStartRoute, useValidateRoute } from '../api/queries';

const fieldClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-2 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

interface DraftStep {
  key: string;
  kind: RouteStepKind;
  assigneeId: string;
  assigneeName: string;
  dueHours: string;
  /** Steps sharing a group run in parallel; groups run one after another. */
  group: number;
}

/** The wire shape: a step's `order` IS its parallel group (docs/modules/11 §4). */
function toInput(steps: DraftStep[]): RouteStepInput[] {
  return steps.map((s) => ({
    order: s.group,
    kind: s.kind,
    assigneeType: 'user' as const,
    assigneeId: s.assigneeId,
    ...(s.dueHours.trim() ? { dueHours: Number(s.dueHours) } : {}),
  }));
}

/**
 * Visual route builder (docs/modules/11 §12.9, plan §8.4). Steps carry a kind and an
 * optional SLA, and are arranged into sequential groups — steps in the same group run in
 * parallel and the next group waits for all of them.
 *
 * Before starting, the definition is dry-run against the server: it reports who each step
 * would actually reach and what is wrong, so the author fixes it here instead of meeting
 * one error at start time with no map of the rest.
 */
export function RouteBuilderDialog({
  documentId,
  open,
  onOpenChange,
}: {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [search, setSearch] = useState('');
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [validation, setValidation] = useState<RouteValidationDto | null>(null);
  const directory = useDirectoryUsers(search);
  const validate = useValidateRoute(documentId);
  const start = useStartRoute(documentId);

  // Any edit invalidates the previous verdict — showing a stale «valid» would be worse
  // than showing none.
  useEffect(() => setValidation(null), [steps]);

  const groups = useMemo(
    () => [...new Set(steps.map((s) => s.group))].sort((a, b) => a - b),
    [steps],
  );

  const addStep = (id: string, name: string) => {
    setSteps((prev) => [
      ...prev,
      {
        key: `${id}-${prev.length}-${Date.now()}`,
        kind: 'approve',
        assigneeId: id,
        assigneeName: name,
        dueHours: '',
        group: prev.length === 0 ? 1 : Math.max(...prev.map((s) => s.group)) + 1,
      },
    ]);
    setSearch('');
  };

  const patch = (key: string, next: Partial<DraftStep>) =>
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...next } : s)));

  const move = (key: string, delta: number) =>
    setSteps((prev) =>
      prev.map((s) => (s.key === key ? { ...s, group: Math.max(1, s.group + delta) } : s)),
    );

  const runValidation = () => {
    validate.mutate(
      { steps: toInput(steps) },
      {
        onSuccess: setValidation,
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };

  const submit = () => {
    const input: StartRouteInput = { steps: toInput(steps) };
    start.mutate(input, {
      onSuccess: () => {
        toast({ title: t('route.start.done'), tone: 'success' });
        setSteps([]);
        onOpenChange(false);
      },
      onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('route.builder.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="builder-search">{t('route.builder.addStep')}</Label>
            <Input
              id="builder-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('route.start.searchPlaceholder')}
            />
            {search.trim() ? (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-sm border border-border">
                {directory.isLoading ? (
                  // A skeleton, not a spinner: this is a list, and the design system asks a
                  // loading list to keep the shape of what is arriving (06 §1).
                  <div className="flex flex-col gap-1 p-1.5" aria-busy="true">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-7 w-full" />
                    ))}
                  </div>
                ) : (directory.data ?? []).length === 0 ? (
                  <div className="py-3 text-center text-xs text-text-muted">—</div>
                ) : (
                  (directory.data ?? []).map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => addStep(u.id, u.shortName)}
                      className="flex w-full items-center px-3 py-2 text-left text-[13px] hover:bg-surface-2"
                    >
                      <Plus className="mr-2 size-4 text-text-muted" aria-hidden />
                      <span className="truncate">
                        {u.shortName}{' '}
                        <span className="font-mono text-xs text-text-muted">@{u.username}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          {steps.length === 0 ? (
            <p className="text-[13px] text-text-muted">{t('route.builder.empty')}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {groups.map((group) => (
                <li key={group} className="rounded-sm border border-border">
                  <div className="border-b border-border bg-surface-2 px-3 py-1 text-xs text-text-muted">
                    {t('route.builder.group', { n: group })}
                    {steps.filter((s) => s.group === group).length > 1
                      ? ` · ${t('route.builder.parallel')}`
                      : ''}
                  </div>
                  {steps
                    .filter((s) => s.group === group)
                    .map((s) => (
                      <div
                        key={s.key}
                        className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2 last:border-b-0"
                      >
                        <span className="min-w-32 flex-1 truncate text-[13px] text-text">
                          {s.assigneeName}
                        </span>
                        <label className="sr-only" htmlFor={`kind-${s.key}`}>
                          {t('route.builder.kind')}
                        </label>
                        <select
                          id={`kind-${s.key}`}
                          className={fieldClass}
                          value={s.kind}
                          onChange={(e) => patch(s.key, { kind: e.target.value as RouteStepKind })}
                        >
                          {ROUTE_STEP_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {t(`routeStepKind.${k}`)}
                            </option>
                          ))}
                        </select>
                        <label className="sr-only" htmlFor={`due-${s.key}`}>
                          {t('route.builder.dueHours')}
                        </label>
                        <Input
                          id={`due-${s.key}`}
                          type="number"
                          min={1}
                          className="h-9 w-24"
                          placeholder={t('route.builder.dueHours')}
                          value={s.dueHours}
                          onChange={(e) => patch(s.key, { dueHours: e.target.value })}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={t('route.builder.moveUp')}
                          onClick={() => move(s.key, -1)}
                        >
                          <ArrowUp className="size-4" aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={t('route.builder.moveDown')}
                          onClick={() => move(s.key, 1)}
                        >
                          <ArrowDown className="size-4" aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={t('route.start.remove')}
                          onClick={() => setSteps((prev) => prev.filter((x) => x.key !== s.key))}
                        >
                          <X className="size-4 text-danger" aria-hidden />
                        </Button>
                      </div>
                    ))}
                </li>
              ))}
            </ol>
          )}

          {validation ? (
            <div className="flex flex-col gap-1 rounded-sm border border-border p-3">
              <span className="flex items-center gap-2 text-[13px] font-medium text-text">
                {t('route.builder.validation')}
                <StatusBadge
                  tone={validation.valid ? 'success' : 'danger'}
                  label={validation.valid ? t('route.builder.valid') : t('route.builder.invalid')}
                />
              </span>
              <ul className="flex flex-col gap-0.5">
                {validation.steps.map((s, i) => (
                  <li key={`${s.order}-${s.assigneeId}-${i}`} className="text-xs text-text-muted">
                    {t('route.builder.group', { n: s.order })} · {t(`routeStepKind.${s.kind}`)} ·{' '}
                    {s.assigneeName ?? s.assigneeId}
                    {s.problems.length > 0 ? (
                      <span className="ml-1 text-danger">
                        {s.problems.map((p) => t(`route.builder.problem.${p}`)).join(', ')}
                      </span>
                    ) : (
                      <span className="ml-1">→ {s.actorNames.join(', ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={steps.length === 0 || validate.isPending}
              onClick={runValidation}
            >
              {t('route.builder.validate')}
            </Button>
            <Button
              type="button"
              // Starting is gated on a PASSING dry-run, not merely a run one: the builder
              // should not be able to launch a route it was just told is broken.
              disabled={steps.length === 0 || start.isPending || !validation?.valid}
              onClick={submit}
            >
              {t('route.start.action')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
