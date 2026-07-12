import { config } from 'dotenv';

// Load environment variables before anything reads them. Dev runs with cwd
// = apps/api, so the monorepo-root `.env` is two levels up; in the prod
// container cwd is the app root and `.env` (if any) sits alongside. Existing
// process.env values always win (dotenv does not override).
config({ path: ['.env', '../../.env', '../../../.env'] });
