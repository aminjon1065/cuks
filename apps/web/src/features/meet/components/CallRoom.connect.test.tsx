import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The meet-call regression this guards: under React StrictMode's dev
 * double-mount, `<LiveKitRoom connect>` aborted its first in-flight connect and
 * the re-issued connect wedged inside livekit-client — an endless spinner with
 * no WS frame ever leaving the browser. CallRoom now owns the connection
 * imperatively (deferred one macrotask, cancelled by the throwaway mount's
 * cleanup), so exactly ONE clean `Room.connect` must happen per surviving
 * mount — which is precisely what these tests pin down, in StrictMode.
 */

const connectMock = vi.fn(() => Promise.resolve());
const disconnectMock = vi.fn(() => Promise.resolve());

vi.mock('livekit-client', () => {
  class FakeRoom {
    connect = connectMock;
    disconnect = disconnectMock;
    on = vi.fn().mockReturnThis();
    off = vi.fn().mockReturnThis();
    localParticipant = {
      setMicrophoneEnabled: vi.fn(() => Promise.resolve()),
      setCameraEnabled: vi.fn(() => Promise.resolve()),
    };
  }
  return { Room: FakeRoom, RoomEvent: { Disconnected: 'disconnected' } };
});

vi.mock('../api/queries', () => ({
  useMintToken: () => ({
    // CallRoom must consume the PROMISE (mutateAsync), never per-mutate
    // callbacks — react-query drops those when StrictMode's throwaway render's
    // mutation observer is replaced, which was the real endless-spinner root.
    mutateAsync: (_roomId: string) =>
      new Promise<{ token: string; url: string }>((resolve) => {
        setTimeout(() => resolve({ token: 'test-token', url: 'ws://test:7880' }), 0);
      }),
  }),
}));

// The connected-room UI pulls half the LiveKit component tree through context;
// none of it matters for the connect contract under test.
vi.mock('./ConferenceStage', () => ({ ConferenceStage: () => null }));
vi.mock('./CallControlBar', () => ({ CallControlBar: () => null }));
vi.mock('./ParticipantsPanel', () => ({ ParticipantsPanel: () => null }));
vi.mock('./RoomChatPanel', () => ({ RoomChatPanel: () => null }));
vi.mock('./RecordingBadge', () => ({ RecordingBadge: () => null }));
vi.mock('./ReactionsOverlay', () => ({ ReactionsOverlay: () => null }));
vi.mock('../hooks/useIncomingVideo', () => ({ useIncomingVideo: () => undefined }));
vi.mock('../hooks/useReactions', () => ({
  useReactions: () => ({ reactions: [], react: vi.fn() }),
}));
vi.mock('@livekit/components-react', () => ({
  LayoutContextProvider: ({ children }: { children?: React.ReactNode }) => children,
  RoomAudioRenderer: () => null,
  RoomContext: { Provider: ({ children }: { children?: React.ReactNode }) => children },
}));
vi.mock('@livekit/components-styles', () => ({}));

import { CallRoom } from './CallRoom';
import type { MeetRoomDto } from '@cuks/shared';

const room = { id: 'room-1', slug: 'slug-1', kind: 'adhoc', isActive: true } as MeetRoomDto;
const choices = {
  username: 'u',
  videoEnabled: false,
  audioEnabled: false,
  videoDeviceId: '',
  audioDeviceId: '',
};

describe('CallRoom connection under StrictMode', () => {
  beforeEach(() => {
    connectMock.mockClear();
    disconnectMock.mockClear();
  });

  it('connects exactly once after creds arrive', async () => {
    render(
      <StrictMode>
        <CallRoom room={room} choices={choices} onLeave={() => undefined} />
      </StrictMode>,
    );
    await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1));
    // Give the strict double-invoke every chance to sneak in a second connect.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith('ws://test:7880', 'test-token');
  });

  it('never lets a disconnect cancel the in-flight connect', async () => {
    render(
      <StrictMode>
        <CallRoom room={room} choices={choices} onLeave={() => undefined} />
      </StrictMode>,
    );
    await waitFor(() => expect(connectMock).toHaveBeenCalled());
    // Any disconnect must have happened strictly BEFORE the (single) connect —
    // a disconnect after it is the exact wedge this component exists to avoid.
    const connectOrder = connectMock.mock.invocationCallOrder[0]!;
    for (const order of disconnectMock.mock.invocationCallOrder) {
      expect(order).toBeLessThan(connectOrder);
    }
  });
});
