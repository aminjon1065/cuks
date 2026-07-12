import { z } from 'zod';
import { ORG_UNIT_TYPES } from '../enums/index';

export const createOrgUnitSchema = z.object({
  parentId: z.string().uuid().nullish(),
  name: z.string().min(1).max(200),
  shortName: z.string().max(64).nullish(),
  type: z.enum(ORG_UNIT_TYPES),
  sort: z.number().int().optional(),
});
export type CreateOrgUnitInput = z.infer<typeof createOrgUnitSchema>;

export const updateOrgUnitSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  shortName: z.string().max(64).nullish(),
  type: z.enum(ORG_UNIT_TYPES).optional(),
  sort: z.number().int().optional(),
  headPositionId: z.string().uuid().nullish(),
});
export type UpdateOrgUnitInput = z.infer<typeof updateOrgUnitSchema>;

/** Move a unit under a new parent; `parentId: null` makes it a root. */
export const moveOrgUnitSchema = z.object({
  parentId: z.string().uuid().nullable(),
});
export type MoveOrgUnitInput = z.infer<typeof moveOrgUnitSchema>;

export const createPositionSchema = z.object({
  orgUnitId: z.string().uuid(),
  name: z.string().min(1).max(200),
  rank: z.number().int().optional(),
  isHead: z.boolean().optional(),
});
export type CreatePositionInput = z.infer<typeof createPositionSchema>;

export const updatePositionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  rank: z.number().int().optional(),
  isHead: z.boolean().optional(),
});
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;

export const assignPositionSchema = z.object({
  userId: z.string().uuid(),
  positionId: z.string().uuid(),
  isPrimary: z.boolean().optional().default(false),
});
export type AssignPositionInput = z.infer<typeof assignPositionSchema>;

export interface OrgUnitDto {
  id: string;
  parentId: string | null;
  name: string;
  shortName: string | null;
  type: string;
  path: string;
  sort: number;
  headPositionId: string | null;
  employeeCount: number;
}

export interface OrgUnitTreeNode extends OrgUnitDto {
  children: OrgUnitTreeNode[];
}

export interface PositionDto {
  id: string;
  orgUnitId: string;
  name: string;
  rank: number;
  isHead: boolean;
}

export interface UserPositionDto {
  id: string;
  userId: string;
  positionId: string;
  positionName: string;
  orgUnitId: string;
  orgUnitName: string;
  isPrimary: boolean;
}
