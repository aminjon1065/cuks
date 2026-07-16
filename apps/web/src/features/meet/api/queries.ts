import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  CreateRoomInput,
  MeetHostTargetInput,
  MeetRoomDto,
  MeetTokenDto,
  StartRingInput,
} from '@cuks/shared';
import { api } from '@/lib/api-client';

export const meetKey = ['meet'] as const;
export const roomsKey = [...meetKey, 'rooms'] as const;
export const roomKey = (slug: string) => [...roomsKey, slug] as const;

/** A call room by its permanent slug (the `/app/meet/r/:slug` route param). */
export function useRoom(slug: string | undefined): UseQueryResult<MeetRoomDto> {
  return useQuery({
    queryKey: roomKey(slug ?? ''),
    queryFn: () => api.get<MeetRoomDto>(`/v1/meet/rooms/${slug}`),
    enabled: !!slug,
    retry: false,
  });
}

/** Open (or reuse) a call room — ad-hoc «new meeting» or a DM/channel call. */
export function useCreateRoom() {
  return useMutation({
    mutationFn: (body: CreateRoomInput) => api.post<MeetRoomDto>('/v1/meet/rooms', body),
  });
}

/** Mint a short-lived LiveKit join token. Modelled as a mutation — it is requested once, on Join. */
export function useMintToken() {
  return useMutation({
    mutationFn: (roomId: string) => api.post<MeetTokenDto>(`/v1/meet/rooms/${roomId}/token`),
  });
}

/** Ring the other member of a DM for a 1:1 call (docs/modules/14 §2). */
export function useStartRing() {
  return useMutation({
    mutationFn: (body: StartRingInput) => api.post<void>('/v1/meet/ring', body),
  });
}

/** Accept / decline an incoming ring, or cancel one you started (docs/modules/14 §2). */
export function useRingActions() {
  const accept = useMutation({
    mutationFn: (roomId: string) => api.post<void>(`/v1/meet/ring/${roomId}/accept`),
  });
  const decline = useMutation({
    mutationFn: (roomId: string) => api.post<void>(`/v1/meet/ring/${roomId}/decline`),
  });
  const cancel = useMutation({
    mutationFn: (roomId: string) => api.post<void>(`/v1/meet/ring/${roomId}/cancel`),
  });
  return { accept, decline, cancel };
}

/** Host moderation (docs/modules/14 §3). All gated server-side to the room host. */
export function useHostActions(roomId: string) {
  const mute = useMutation({
    mutationFn: (body: MeetHostTargetInput) =>
      api.post<void>(`/v1/meet/rooms/${roomId}/host/mute`, body),
  });
  const remove = useMutation({
    mutationFn: (body: MeetHostTargetInput) =>
      api.post<void>(`/v1/meet/rooms/${roomId}/host/remove`, body),
  });
  const muteAll = useMutation({
    mutationFn: () => api.post<void>(`/v1/meet/rooms/${roomId}/host/mute-all`),
  });
  const end = useMutation({
    mutationFn: () => api.post<void>(`/v1/meet/rooms/${roomId}/host/end`),
  });
  return { mute, remove, muteAll, end };
}
