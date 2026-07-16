import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_DUTY, E2E_SUGHD } from './support/fixtures';

/**
 * Task 6.5 — scheduled meetings (docs/modules/14 §2/§7). Schedule a meeting inviting another user; it
 * shows in the organizer's list and the invitee can read it but not edit it; the organizer cancels it.
 */
async function j<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function jsonHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}

interface MeetingDto {
  id: string;
  slug: string;
  status: string;
  canManage: boolean;
  participantCount: number;
}

test('meetings: schedule (with invitee), list, invitee read-only, organizer cancel', async () => {
  const duty = await apiLogin(E2E_DUTY.username, E2E_DUTY.password);
  const sughd = await apiLogin(E2E_SUGHD.username, E2E_SUGHD.password);
  try {
    const sughdMe = await j<{ id: string }>(await sughd.get('/api/auth/me'));
    const dutyH = await jsonHeaders(duty);

    const startsAt = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(); // ~26h ahead → upcoming
    const meeting = await j<MeetingDto>(
      await duty.post('/api/v1/meet/meetings', {
        headers: dutyH,
        data: {
          title: `Совещание ${Date.now()}`,
          startsAt,
          durationMin: 30,
          participants: { users: [sughdMe.id], orgUnits: [] },
          recordPlanned: false,
        },
      }),
    );
    expect(meeting.slug).toMatch(/^[0-9a-f]{16}$/);
    expect(meeting.canManage).toBe(true);
    expect(meeting.participantCount).toBe(1);

    // It shows in the organizer's «upcoming» list.
    const upcoming = await j<MeetingDto[]>(await duty.get('/api/v1/meet/meetings?range=upcoming'));
    expect(upcoming.some((m) => m.id === meeting.id)).toBe(true);

    // The invitee can read it, but cannot manage or edit it.
    const asInvitee = await j<MeetingDto>(await sughd.get(`/api/v1/meet/meetings/${meeting.id}`));
    expect(asInvitee.canManage).toBe(false);
    const badPatch = await sughd.patch(`/api/v1/meet/meetings/${meeting.id}`, {
      headers: await jsonHeaders(sughd),
      data: { title: 'hijack' },
    });
    expect(badPatch.status()).toBe(403);

    // The organizer cancels it → it leaves the upcoming list.
    const cancelled = await j<MeetingDto>(
      await duty.patch(`/api/v1/meet/meetings/${meeting.id}`, {
        headers: dutyH,
        data: { status: 'cancelled' },
      }),
    );
    expect(cancelled.status).toBe('cancelled');
    const upcoming2 = await j<MeetingDto[]>(await duty.get('/api/v1/meet/meetings?range=upcoming'));
    expect(upcoming2.some((m) => m.id === meeting.id)).toBe(false);
  } finally {
    await duty.dispose();
    await sughd.dispose();
  }
});
