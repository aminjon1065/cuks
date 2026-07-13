import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn().mockResolvedValue(undefined);
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }) }));

// Imported after the mock (vi.mock is hoisted, so createTransport is already stubbed).
import { EmailProcessor } from './email.processor';

const job = (data: unknown) => ({ id: '1', data }) as never;

describe('EmailProcessor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the email via the transporter', async () => {
    const processor = new EmailProcessor({ get: () => 'smtp://localhost:1025' } as never);
    await processor.process(job({ to: 'a@b.tj', subject: 'Hi', text: 'Body' }));
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.tj', subject: 'Hi', text: 'Body' }),
    );
  });

  it('is a no-op when SMTP is not configured', async () => {
    const processor = new EmailProcessor({ get: () => undefined } as never);
    await processor.process(job({ to: 'a@b.tj', subject: 'Hi', text: 'Body' }));
    expect(sendMail).not.toHaveBeenCalled();
  });
});
