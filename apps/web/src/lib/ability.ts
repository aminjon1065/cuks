import { createContext, createElement, useContext, useMemo } from 'react';
import { abilityFromRules, hasPermission, type AppAbility } from '@cuks/shared';

/**
 * CASL ability rebuilt on the client from the rules packed into `GET /auth/me`
 * (docs/05 §2). Client checks only hide/disable UI — the server re-checks every
 * request, so this is never a security boundary. (Plain `.ts` + `createElement`
 * so the provider and its hooks can live in one module.)
 */
type AbilityRules = Parameters<typeof abilityFromRules>[0];

const AbilityContext = createContext<AppAbility | null>(null);

export function AbilityProvider({
  rules,
  children,
}: {
  rules: unknown[];
  children: React.ReactNode;
}): React.ReactElement {
  const ability = useMemo(() => abilityFromRules(rules as AbilityRules), [rules]);
  return createElement(AbilityContext.Provider, { value: ability }, children);
}

/** The current ability, or null outside a provider. */
export function useAbility(): AppAbility | null {
  return useContext(AbilityContext);
}

/** True if the current user holds `permission`. Returns false outside a provider. */
export function useCan(permission: string): boolean {
  const ability = useContext(AbilityContext);
  return ability ? hasPermission(ability, permission) : false;
}

/** Filters a list to the permissions the current user holds (no permission = kept). */
export function useVisibleByPermission<T extends { permission?: string }>(items: T[]): T[] {
  const ability = useContext(AbilityContext);
  return items.filter(
    (item) => !item.permission || (ability !== null && hasPermission(ability, item.permission)),
  );
}
