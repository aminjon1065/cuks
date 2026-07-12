/**
 * Conventional Commits (docs/04-conventions.md §Git).
 * Scope = module name (e.g. feat(docflow): ...).
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0, 'always'],
  },
};
