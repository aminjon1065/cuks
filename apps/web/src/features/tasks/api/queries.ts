import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  BoardDto,
  ColumnDto,
  CreateColumnInput,
  CreateProjectInput,
  CreateTaskInput,
  MoveColumnInput,
  MoveTaskInput,
  ProjectDto,
  TaskCardDto,
  UpdateTaskInput,
} from '@cuks/shared';
import { api } from '@/lib/api-client';

export const tasksKey = ['tasks'] as const;
export const projectsKey = [...tasksKey, 'projects'] as const;
export const boardKey = (projectId: string) => [...tasksKey, 'board', projectId] as const;

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
