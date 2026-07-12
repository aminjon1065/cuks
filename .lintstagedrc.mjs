export default {
  '*.{ts,tsx}': ['eslint --fix --max-warnings 0', 'prettier --write'],
  // Markdown is intentionally excluded: docs are hand-authored specs (see STATUS decisions).
  '*.{js,mjs,cjs,json,yaml,yml,css}': ['prettier --write'],
};
