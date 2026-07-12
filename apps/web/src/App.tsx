import { UiShowcase } from './dev/UiShowcase';

/**
 * Phase 0.7 renders the design-system gallery. The real application shell
 * (router, sidebar, topbar, command palette, i18n) replaces this in phase 0.8.
 */
export function App(): React.JSX.Element {
  return <UiShowcase />;
}
