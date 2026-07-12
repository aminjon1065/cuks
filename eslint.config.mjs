import config from '@cuks/config/eslint';

/**
 * Root ESLint flat config. ESLint resolves the nearest config walking up from
 * each package's cwd, so `eslint .` in any workspace reuses this shared config.
 */
export default config;
