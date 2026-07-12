import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
  type RawRuleOf,
} from '@casl/ability';
import { PERMISSION_WILDCARD } from '../permissions/index';

/**
 * App ability: subjects are permission strings (`module.action`), the action is
 * always `access`. Superadmin gets `manage all` (docs/05 §3). Built identically
 * on the backend (from DB roles) and the frontend (from packed rules in /auth/me).
 */
export type AppAbility = MongoAbility<['access' | 'manage', string]>;

export interface AbilityInput {
  permissions: readonly string[];
  isSuperadmin: boolean;
}

export function buildAbility(input: AbilityInput): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  if (input.isSuperadmin || input.permissions.includes(PERMISSION_WILDCARD)) {
    can('manage', 'all');
  } else {
    for (const permission of input.permissions) {
      can('access', permission);
    }
  }
  return build();
}

/** True if the ability grants the given permission (or is superadmin). */
export function hasPermission(ability: AppAbility, permission: string): boolean {
  return ability.can('access', permission);
}

/** Serialize rules for transport in GET /auth/me; the frontend rebuilds the ability. */
export function serializeAbility(ability: AppAbility): RawRuleOf<AppAbility>[] {
  return ability.rules as RawRuleOf<AppAbility>[];
}

/** Rebuild an ability from serialized rules (frontend). */
export function abilityFromRules(rules: RawRuleOf<AppAbility>[]): AppAbility {
  return createMongoAbility<AppAbility>(rules);
}
