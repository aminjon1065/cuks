/**
 * BullMQ queue contract (docs/01 §Фоновые задачи). Queue names + job payloads are
 * shared so the api (producer) and worker (consumer) can't drift. Extended per
 * feature phase (av-scan, preview, geo, … land with their modules).
 */
export const QUEUE = {
  email: 'email',
  deadlines: 'deadlines',
  auditMaintenance: 'audit-maintenance',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/** `email` queue — one outgoing message (docs/02 §Email: nodemailer → SMTP). */
export interface EmailJobData {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Default job options: a few retries with exponential backoff, and bounded
 * retention of finished jobs so Redis doesn't grow unbounded (docs/01 §73).
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: 500,
  removeOnFail: 1_000,
};
