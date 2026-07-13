import { config } from 'dotenv';

// Load env before anything reads it. Dev cwd = apps/worker, so the monorepo-root
// `.env` is two levels up; existing process.env values win (dotenv never overrides).
config({ path: ['.env', '../../.env', '../../../.env'] });
