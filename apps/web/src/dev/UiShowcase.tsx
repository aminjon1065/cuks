import { useEffect, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { FileX, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  Label,
  OrgUnitPicker,
  PageHeader,
  SeverityBadge,
  SidePanel,
  Skeleton,
  StatusBadge,
  UserChip,
  UserPicker,
  cn,
} from '@cuks/ui';

/**
 * Temporary component gallery for phase 0.7 — verifies every design-system
 * component in both themes. Replaced by the real i18n application shell in 0.8,
 * so the literal strings here are dev-only, not product copy.
 */
interface Person {
  id: string;
  name: string;
  position: string;
  status: { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' };
}

const PEOPLE: Person[] = [
  {
    id: '1',
    name: 'Иванов Пётр Сергеевич',
    position: 'Оперативный дежурный',
    status: { label: 'Активен', tone: 'success' },
  },
  {
    id: '2',
    name: 'Каримова Дилноза',
    position: 'Аналитик ГИС',
    status: { label: 'Активен', tone: 'success' },
  },
  {
    id: '3',
    name: 'Рахимов Умед',
    position: 'Делопроизводитель',
    status: { label: 'Заблокирован', tone: 'danger' },
  },
  {
    id: '4',
    name: 'Назарова Гульнора',
    position: 'Руководитель',
    status: { label: 'Отпуск', tone: 'warning' },
  },
];

const columns: ColumnDef<Person, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Сотрудник',
    cell: ({ row }) => <UserChip name={row.original.name} position={row.original.position} />,
  },
  {
    accessorKey: 'status',
    header: 'Статус',
    cell: ({ row }) => (
      <StatusBadge tone={row.original.status.tone} label={row.original.status.label} />
    ),
  },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h2>
      <div className="rounded-lg border border-border bg-surface p-5">{children}</div>
    </section>
  );
}

export function UiShowcase(): React.JSX.Element {
  const [dark, setDark] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [userValue, setUserValue] = useState<string | null>('2');
  const [unitValue, setUnitValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const orgTree = [
    {
      id: 'root',
      name: 'КЧС',
      children: [
        {
          id: 'ca',
          name: 'Центральный аппарат',
          children: [
            { id: 'uzn', name: 'Управление защиты населения' },
            { id: 'ugo', name: 'Управление гражданской обороны' },
          ],
        },
        { id: 'sogd', name: 'Управление по Согдийской области' },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-8" data-testid="ui-showcase">
      <PageHeader
        title="Дизайн-система ЦУКС"
        status={<StatusBadge tone="primary" label="Фаза 0.7" />}
        description="Компоненты packages/ui — базовые примитивы и составные компоненты."
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="theme"
              onClick={() => setDark((d) => !d)}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button>
              <Plus /> Создать
            </Button>
          </>
        }
      />

      <Section title="Кнопки">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Основная</Button>
          <Button variant="secondary">Вторичная</Button>
          <Button variant="outline">Контур</Button>
          <Button variant="ghost">Призрак</Button>
          <Button variant="danger">
            <Trash2 /> Удалить
          </Button>
          <Button size="sm">Малая</Button>
          <Button disabled>Отключена</Button>
        </div>
      </Section>

      <Section title="Бейджи статусов и уровней ЧС">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="success" label="Исполнено" />
          <StatusBadge tone="warning" label="Скоро срок" />
          <StatusBadge tone="danger" label="Просрочено" />
          <StatusBadge tone="info" label="На согласовании" />
          <Badge tone="primary">Черновик</Badge>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SeverityBadge level={1} label="Объектовый" />
          <SeverityBadge level={2} label="Местный" />
          <SeverityBadge level={3} label="Региональный" />
          <SeverityBadge level={4} label="Республиканский" />
          <SeverityBadge level={5} label="Трансграничный" />
        </div>
      </Section>

      <Section title="Поля и пикеры">
        <div className="grid max-w-md gap-4">
          <div className="space-y-1.5">
            <Label required>Название</Label>
            <Input placeholder="Введите название" />
          </div>
          <div className="space-y-1.5">
            <Label>Исполнитель</Label>
            <UserPicker
              options={PEOPLE.map((p) => ({ id: p.id, label: p.name, sublabel: p.position }))}
              value={userValue}
              onChange={setUserValue}
              searchPlaceholder="Поиск сотрудника…"
              emptyLabel="Ничего не найдено"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Подразделение</Label>
            <OrgUnitPicker
              tree={orgTree}
              value={unitValue}
              onChange={setUnitValue}
              placeholder="Выберите…"
            />
          </div>
        </div>
      </Section>

      <Section title="Таблица (DataTable)">
        <FilterBar
          chips={[{ key: 'active', label: 'Только активные', onRemove: () => undefined }]}
          onReset={() => undefined}
          resetLabel="Сбросить"
          className="mb-3"
        >
          <Button variant="outline" size="sm" onClick={() => setLoading((l) => !l)}>
            {loading ? 'Показать данные' : 'Показать загрузку'}
          </Button>
        </FilterBar>
        <DataTable
          columns={columns}
          data={PEOPLE}
          loading={loading}
          enableSelection
          onRowClick={() => setPanelOpen(true)}
          empty={
            <EmptyState
              icon={FileX}
              title="Нет сотрудников"
              description="Добавьте первого сотрудника."
            />
          }
          pageSize={10}
        />
      </Section>

      <Section title="Панели и диалоги">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setPanelOpen(true)}>
            Открыть SidePanel
          </Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Удалить (ConfirmDialog)
          </Button>
        </div>
      </Section>

      <Section title="Загрузка / пусто">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <EmptyState
            icon={FileX}
            title="Здесь пока пусто"
            description="Данные появятся после первого действия."
            action={<Button size="sm">Создать</Button>}
          />
        </div>
      </Section>

      <SidePanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        closeLabel="Закрыть"
        title="Карточка сотрудника"
        footer={
          <div className={cn('flex justify-end gap-2')}>
            <Button variant="outline" onClick={() => setPanelOpen(false)}>
              Закрыть
            </Button>
            <Button>Сохранить</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <UserChip name="Иванов Пётр Сергеевич" position="Оперативный дежурный" />
          <p className="text-[13px] text-text-muted">
            Правая панель для просмотра деталей строки без ухода со страницы.
          </p>
        </div>
      </SidePanel>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Удалить сотрудника?"
        description="Это действие нельзя отменить."
        entityName="Рахимов Умед"
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        closeLabel="Закрыть"
        onConfirm={() => setConfirmOpen(false)}
      />
    </div>
  );
}
