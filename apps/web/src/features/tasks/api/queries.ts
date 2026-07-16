import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  ActivityDto,
  BoardDto,
  ChecklistItemDto,
  ColumnDto,
  CommentDto,
  CreateChecklistItemInput,
  CreateColumnInput,
  CreateCommentInput,
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  LabelDto,
  MoveColumnInput,
  MoveTaskInput,
  ProjectDto,
  TaskCardDetailDto,
  TaskCardDto,
  UpdateChecklistItemInput,
  UpdateTaskInput,
} from '@cuks/shared';
import { api } from '@/lib/api-client';

export const tasksKey = ['tasks'] as const;
export const projectsKey = [...tasksKey, 'projects'] as const;
export const boardKey = (projectId: string) => [...tasksKey, 'board', projectId] as const;
export const cardKey = (cardId: string) => [...tasksKey, 'card', cardId] as const;
export const cardCommentsKey = (cardId: string) => [...cardKey(cardId), 'comments'] as const;
export const cardActivityKey = (cardId: string) => [...cardKey(cardId), 'activity'] as const;

export function useProjects(): UseQueryResult<ProjectDto[]> {
  return useQuery({
    queryKey: projectsKey,
    queryFn: () => api.get<ProjectDto[]>('/v1/tasks/projects'),
  });
}

export function useProjectByKey(key: string): UseQueryResult<ProjectDto> {
  return useQuery({
    queryKey: [...projectsKey, 'by-key', key],
    queryFn: () => api.get<ProjectDto>(`/v1/tasks/projects/by-key/${encodeURIComponent(key)}`),
    enabled: !!key,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectInput) => api.post<ProjectDto>('/v1/tasks/projects', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectsKey }),
  });
}

export function useBoard(projectId: string | undefined): UseQueryResult<BoardDto> {
  return useQuery({
    queryKey: boardKey(projectId ?? ''),
    queryFn: () => api.get<BoardDto>(`/v1/tasks/projects/${projectId}/board`),
    enabled: !!projectId,
  });
}

export function useCreateCard(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskInput) =>
      api.post<TaskCardDto>(`/v1/tasks/projects/${projectId}/cards`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKey(projectId) }),
  });
}

export function useUpdateCard(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTaskInput }) =>
      api.patch<TaskCardDto>(`/v1/tasks/cards/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKey(projectId) }),
  });
}

/** Move a card (optimistically), reconciling with the board on settle. */
export function useMoveCard(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MoveTaskInput }) =>
      api.post<TaskCardDto>(`/v1/tasks/cards/${id}/move`, body),
    onSettled: () => qc.invalidateQueries({ queryKey: boardKey(projectId) }),
  });
}

export function useArchiveCard(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/v1/tasks/cards/${id}/archive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKey(projectId) }),
  });
}

export function useCreateColumn(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateColumnInput) =>
      api.post<ColumnDto>(`/v1/tasks/projects/${projectId}/columns`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKey(projectId) }),
  });
}

export function useMoveColumn(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MoveColumnInput }) =>
      api.post<ColumnDto>(`/v1/tasks/projects/${projectId}/columns/${id}/move`, body),
    onSettled: () => qc.invalidateQueries({ queryKey: boardKey(projectId) }),
  });
}

// --- Card SidePanel (docs/modules/15 §4, task 4.3) ---

/** Invalidate the open card and the board it lives on after a card mutation. */
function useCardInvalidator(projectId: string, cardId: string): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: cardKey(cardId) });
    void qc.invalidateQueries({ queryKey: boardKey(projectId) });
  };
}

export function useCardDetail(cardId: string | undefined): UseQueryResult<TaskCardDetailDto> {
  return useQuery({
    queryKey: cardKey(cardId ?? ''),
    queryFn: () => api.get<TaskCardDetailDto>(`/v1/tasks/cards/${cardId}`),
    enabled: !!cardId,
  });
}

export function useEditCard(projectId: string, cardId: string) {
  const invalidate = useCardInvalidator(projectId, cardId);
  return useMutation({
    mutationFn: (body: UpdateTaskInput) =>
      api.patch<TaskCardDto>(`/v1/tasks/cards/${cardId}`, body),
    onSuccess: invalidate,
  });
}

export function useCompleteCard(projectId: string, cardId: string) {
  const invalidate = useCardInvalidator(projectId, cardId);
  return useMutation({
    mutationFn: () => api.post<TaskCardDto>(`/v1/tasks/cards/${cardId}/complete`),
    onSuccess: invalidate,
  });
}

export function useCopyCard(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cardId: string) => api.post<TaskCardDto>(`/v1/tasks/cards/${cardId}/copy`),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKey(projectId) }),
  });
}

export function useSetWatching(projectId: string, cardId: string) {
  const invalidate = useCardInvalidator(projectId, cardId);
  return useMutation({
    mutationFn: (watching: boolean) =>
      watching
        ? api.post<TaskCardDetailDto>(`/v1/tasks/cards/${cardId}/watch`)
        : api.delete<TaskCardDetailDto>(`/v1/tasks/cards/${cardId}/watch`),
    onSuccess: invalidate,
  });
}

export function useAddChecklistItem(projectId: string, cardId: string) {
  const invalidate = useCardInvalidator(projectId, cardId);
  return useMutation({
    mutationFn: (body: CreateChecklistItemInput) =>
      api.post<ChecklistItemDto[]>(`/v1/tasks/cards/${cardId}/checklist`, body),
    onSuccess: invalidate,
  });
}

export function useUpdateChecklistItem(projectId: string, cardId: string) {
  const invalidate = useCardInvalidator(projectId, cardId);
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: UpdateChecklistItemInput }) =>
      api.patch<ChecklistItemDto[]>(`/v1/tasks/cards/${cardId}/checklist/${itemId}`, body),
    onSuccess: invalidate,
  });
}

export function useRemoveChecklistItem(projectId: string, cardId: string) {
  const invalidate = useCardInvalidator(projectId, cardId);
  return useMutation({
    mutationFn: (itemId: string) =>
      api.delete<ChecklistItemDto[]>(`/v1/tasks/cards/${cardId}/checklist/${itemId}`),
    onSuccess: invalidate,
  });
}

export function useComments(cardId: string | undefined): UseQueryResult<CommentDto[]> {
  return useQuery({
    queryKey: cardCommentsKey(cardId ?? ''),
    queryFn: () => api.get<CommentDto[]>(`/v1/tasks/cards/${cardId}/comments`),
    enabled: !!cardId,
  });
}

export function useAddComment(projectId: string, cardId: string) {
  const qc = useQueryClient();
  const invalidate = useCardInvalidator(projectId, cardId);
  return useMutation({
    mutationFn: (body: CreateCommentInput) =>
      api.post<CommentDto>(`/v1/tasks/cards/${cardId}/comments`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cardCommentsKey(cardId) });
      invalidate();
    },
  });
}

export function useRemoveComment(projectId: string, cardId: string) {
  const qc = useQueryClient();
  const invalidate = useCardInvalidator(projectId, cardId);
  return useMutation({
    mutationFn: (commentId: string) =>
      api.delete(`/v1/tasks/cards/${cardId}/comments/${commentId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cardCommentsKey(cardId) });
      invalidate();
    },
  });
}

export function useActivity(cardId: string | undefined): UseQueryResult<ActivityDto[]> {
  return useQuery({
    queryKey: cardActivityKey(cardId ?? ''),
    queryFn: () => api.get<ActivityDto[]>(`/v1/tasks/cards/${cardId}/activity`),
    enabled: !!cardId,
  });
}

export function useCreateLabel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLabelInput) =>
      api.post<LabelDto>(`/v1/tasks/projects/${projectId}/labels`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKey(projectId) }),
  });
}
