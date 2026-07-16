import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { PROJECT_ROLES, TASK_PRIORITIES } from '@cuks/shared';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { orgUnits } from './org';
import { users } from './users';

/** FTS vector (docs/07 §Поиск, config `russian`); generated, GIN-indexed. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * A fractional order key (docs/modules/15 §3). Byte-ordered via `COLLATE "C"` so Postgres
 * `ORDER BY` matches the JS `keyBetween` ASCII-lexicographic ordering. The cluster collation is
 * en_US.utf8, which case-folds and interleaves the base-62 alphabet (e.g. it sorts 'd' before
 * 'V') — plain `text` would scramble the board and could even make a neighbour comparison throw.
 */
const orderKeyCol = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text collate "C"';
  },
});

/**
 * Kanban projects (docs/modules/15 §2, task 4.1). `key` is the short code that prefixes card
 * numbers (`ОПЕР-142`); `last_seq` is the per-project card counter, minted atomically on create.
 * Visibility is the membership ACL (task_project_members) plus an optional «виден подразделению»
 * flag over `org_unit_id`.
 */
export const taskProjects = appSchema.table(
  'task_projects',
  {
    id: primaryId(),
    name: text('name').notNull(),
    key: text('key').notNull(),
    description: text('description'),
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id, { onDelete: 'set null' }),
    // When true, members of `org_unit_id` may view the board without an explicit membership row.
    visibleToOrgUnit: boolean('visible_to_org_unit').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    lastSeq: integer('last_seq').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // The project key is unique among live projects (card numbers must be unambiguous).
    uniqueIndex('task_projects_key_uq')
      .on(t.key)
      .where(sql`${t.deletedAt} is null`),
    index('task_projects_org_unit_idx').on(t.orgUnitId),
  ],
);

/** Per-project ACL (docs/modules/15 §1): a user holds one role in a project. */
export const taskProjectMembers = appSchema.table(
  'task_project_members',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => taskProjects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: PROJECT_ROLES }).notNull().default('editor'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('task_project_members_uq').on(t.projectId, t.userId),
    index('task_project_members_user_idx').on(t.userId),
  ],
);

/** Board columns (docs/modules/15 §3). `order_key` is a fractional index so a column drag rewrites
 *  only its own row; `wip_limit` (null = none) warns when exceeded; `is_done_column` completes a
 *  card moved into it. */
export const taskColumns = appSchema.table(
  'task_columns',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => taskProjects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    orderKey: orderKeyCol('order_key').notNull(),
    wipLimit: integer('wip_limit'),
    isDoneColumn: boolean('is_done_column').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('task_columns_project_idx').on(t.projectId)],
);

/** Project labels (docs/modules/15 §2). `color` is a design-token palette name. */
export const taskLabels = appSchema.table(
  'task_labels',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => taskProjects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('task_labels_project_idx').on(t.projectId)],
);

/**
 * Cards (docs/modules/15 §2/§4). `seq` is the per-project number; `order_in_column` is a fractional
 * index (drag rewrites only the moved card). `description` is TipTap JSON with a plain-text mirror
 * `description_text` that — together with the title — feeds the FTS vector. `labels`/`assignee_ids`/
 * `watcher_ids` are uuid arrays (GIN-indexed for the queues).
 */
export const tasks = appSchema.table(
  'tasks',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => taskProjects.id, { onDelete: 'cascade' }),
    columnId: uuid('column_id')
      .notNull()
      .references(() => taskColumns.id, { onDelete: 'restrict' }),
    seq: integer('seq').notNull(),
    title: text('title').notNull(),
    description: jsonb('description'),
    descriptionText: text('description_text'),
    assigneeIds: uuid('assignee_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    watcherIds: uuid('watcher_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    priority: text('priority', { enum: TASK_PRIORITIES }).notNull().default('p3'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    startAt: timestamp('start_at', { withTimezone: true }),
    labels: uuid('labels')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    orderInColumn: orderKeyCol('order_in_column').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('russian', "title" || ' ' || coalesce("description_text", ''))`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('tasks_project_column_idx').on(t.projectId, t.columnId),
    uniqueIndex('tasks_project_seq_uq').on(t.projectId, t.seq),
    index('tasks_assignees_idx').using('gin', t.assigneeIds),
    index('tasks_watchers_idx').using('gin', t.watcherIds),
    // «Мои задачи» / deadline sweep scan by due date.
    index('tasks_due_idx').on(t.dueAt),
    index('tasks_search_idx').using('gin', t.searchTsv),
  ],
);

/** A card's checklist items (docs/modules/15 §4); `order_key` is a fractional index. */
export const taskChecklistItems = appSchema.table(
  'task_checklist_items',
  {
    id: primaryId(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    isDone: boolean('is_done').notNull().default(false),
    orderKey: orderKeyCol('order_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('task_checklist_task_idx').on(t.taskId)],
);

/** Project card templates (docs/modules/15 §4, task 4.5): a named preset of title / description /
 *  priority / checklist a card can be instantiated from (e.g. «Отработка донесения о ЧС»). */
export const taskTemplates = appSchema.table(
  'task_templates',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => taskProjects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    title: text('title').notNull(),
    description: jsonb('description'),
    descriptionText: text('description_text'),
    priority: text('priority', { enum: TASK_PRIORITIES }).notNull().default('p3'),
    // Ordered checklist item texts to seed on the new card.
    checklist: text('checklist')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('task_templates_project_idx').on(t.projectId)],
);

/** A card's activity trail (docs/modules/15 §2/§9) — the «История» tab. Free-form `action`
 *  (`tasks.card.created|moved|completed|assigned` …) with structured `meta`. */
export const taskActivity = appSchema.table(
  'task_activity',
  {
    id: primaryId(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    meta: jsonb('meta'),
    createdAt: createdAt(),
  },
  (t) => [index('task_activity_task_idx').on(t.taskId, t.createdAt)],
);
