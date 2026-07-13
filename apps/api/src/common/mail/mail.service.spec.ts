import { describe, expect, it, vi } from 'vitest';
import { MailService } from './mail.service';

describe('MailService', () => {
  it('enqueues an email job onto the email queue', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const service = new MailService({ add } as never);
    await service.send({ to: 'a@b.tj', subject: 'Hi', text: 'Body' });
    expect(add).toHaveBeenCalledWith('send', { to: 'a@b.tj', subject: 'Hi', text: 'Body' });
  });

  it('never throws when enqueue fails (mail is best-effort)', async () => {
    const add = vi.fn().mockRejectedValue(new Error('redis down'));
    const service = new MailService({ add } as never);
    await expect(
      service.send({ to: 'a@b.tj', subject: 'Hi', text: 'Body' }),
    ).resolves.toBeUndefined();
  });
});
