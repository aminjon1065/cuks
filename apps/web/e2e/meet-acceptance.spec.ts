import { expect, request, test } from '@playwright/test';
import { apiLogin } from './support/api';
import { E2E_DUTY, E2E_SUGHD, STORAGE_STATE } from './support/fixtures';

/**
 * Task 6.7 — Phase 6 acceptance (docs/modules/14 §9). The automatable criterion: a recording is
 * accessible only to its participants (and meet.recordings.manage). The recording is a seeded `ready`
 * fixture (packages/db/src/seed-e2e.ts provisionRecording) with the duty officer as its only
 * participant; the media-dependent criteria (8 participants, TURN, reconnect, screen-share, actual
 * playback, pre-join audio-only/viewer) are in the manual runbook docs/modules/14-acceptance.md.
 */
const API = 'http://localhost:3000';
const REC_ID = '01900000-0000-7000-8000-0000000000a2'; // seed-e2e.ts provisionRecording REC_ID

async function j<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
const redirect = { maxRedirects: 0 } as const;

test('recording is accessible only to its participants (§9)', async () => {
  const duty = await apiLogin(E2E_DUTY.username, E2E_DUTY.password);
  const sughd = await apiLogin(E2E_SUGHD.username, E2E_SUGHD.password);
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  try {
    // The participant can read the card and obtain a presigned stream + download URL (302 redirect).
    expect((await duty.get(`/api/v1/meet/recordings/${REC_ID}`)).status()).toBe(200);
    expect((await duty.get(`/api/v1/meet/recordings/${REC_ID}/stream`, redirect)).status()).toBe(
      302,
    );
    expect((await duty.get(`/api/v1/meet/recordings/${REC_ID}/download`, redirect)).status()).toBe(
      302,
    );
    const dutyList = await j<{ id: string }[]>(await duty.get('/api/v1/meet/recordings'));
    expect(dutyList.some((r) => r.id === REC_ID)).toBe(true);

    // A non-participant (meet.use via duty_officer, but not invited and no manage): 403 everywhere,
    // and it never appears in their list.
    expect((await sughd.get(`/api/v1/meet/recordings/${REC_ID}`)).status()).toBe(403);
    expect((await sughd.get(`/api/v1/meet/recordings/${REC_ID}/stream`, redirect)).status()).toBe(
      403,
    );
    expect((await sughd.get(`/api/v1/meet/recordings/${REC_ID}/download`, redirect)).status()).toBe(
      403,
    );
    const sughdList = await j<{ id: string }[]>(await sughd.get('/api/v1/meet/recordings'));
    expect(sughdList.some((r) => r.id === REC_ID)).toBe(false);

    // meet.recordings.manage (the superadmin) sees any recording.
    expect((await admin.get(`/api/v1/meet/recordings/${REC_ID}`)).status()).toBe(200);
  } finally {
    await duty.dispose();
    await sughd.dispose();
    await admin.dispose();
  }
});
