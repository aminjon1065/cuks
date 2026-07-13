import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CreateFolderInput,
  DirectoryOrgUnitDto,
  DirectoryUserDto,
  FileLinkDto,
  FileVersionDto,
  FsNodeDto,
  GrantNodeAclInput,
  NodeAclEntryDto,
  NodeAclResponse,
  PatchNodeInput,
  QuotaDto,
  RevokeNodeAclInput,
  SearchResultDto,
  TreeResponse,
} from '@cuks/shared';
import { api } from '@/lib/api-client';

export type FsSpaceParam = 'personal' | 'org';

/** One key namespace for the whole files feature so any mutation can invalidate
 *  the relevant slices without hunting individual keys. */
export const filesKey = ['files'] as const;

export interface TreeParams {
  space: FsSpaceParam;
  parentId?: string | null;
  orgUnitId?: string | undefined;
}

function treeSearch(params: TreeParams): string {
  const q = new URLSearchParams({ space: params.space });
  if (params.parentId) q.set('parentId', params.parentId);
  if (params.orgUnitId) q.set('orgUnitId', params.orgUnitId);
  return q.toString();
}

export function useTree(params: TreeParams, enabled = true): UseQueryResult<TreeResponse> {
  return useQuery({
    queryKey: [...filesKey, 'tree', params],
    queryFn: () => api.get<TreeResponse>(`/v1/files/tree?${treeSearch(params)}`),
    enabled,
  });
}

export function useSharedWithMe(enabled = true): UseQueryResult<FsNodeDto[]> {
  return useQuery({
    queryKey: [...filesKey, 'shared'],
    queryFn: () => api.get<FsNodeDto[]>('/v1/files/shared'),
    enabled,
  });
}

export function useTrash(
  space: FsSpaceParam,
  orgUnitId: string | undefined,
  enabled = true,
): UseQueryResult<FsNodeDto[]> {
  const q = new URLSearchParams({ space });
  if (orgUnitId) q.set('orgUnitId', orgUnitId);
  return useQuery({
    queryKey: [...filesKey, 'trash', space, orgUnitId],
    queryFn: () => api.get<FsNodeDto[]>(`/v1/files/trash?${q}`),
    enabled,
  });
}

export function useRecent(enabled = true): UseQueryResult<FsNodeDto[]> {
  return useQuery({
    queryKey: [...filesKey, 'recent'],
    queryFn: () => api.get<FsNodeDto[]>('/v1/files/recent'),
    enabled,
  });
}

/** Global file search (name + tags + extracted text). Disabled for a blank query.
 *  Keeps the previous hits visible while a refined query loads (no skeleton flash
 *  on every keystroke). */
export function useSearch(q: string, enabled = true): UseQueryResult<SearchResultDto[]> {
  const query = q.trim();
  return useQuery({
    queryKey: [...filesKey, 'search', query],
    queryFn: () => api.get<SearchResultDto[]>(`/v1/files/search?q=${encodeURIComponent(query)}`),
    enabled: enabled && query.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useQuota(
  space: FsSpaceParam,
  orgUnitId: string | undefined,
): UseQueryResult<QuotaDto> {
  const q = new URLSearchParams({ space });
  if (orgUnitId) q.set('orgUnitId', orgUnitId);
  return useQuery({
    queryKey: [...filesKey, 'quota', space, orgUnitId],
    queryFn: () => api.get<QuotaDto>(`/v1/files/quota?${q}`),
  });
}

export function useVersions(nodeId: string | null): UseQueryResult<FileVersionDto[]> {
  return useQuery({
    queryKey: [...filesKey, 'versions', nodeId],
    queryFn: () => api.get<FileVersionDto[]>(`/v1/files/${nodeId}/versions`),
    enabled: !!nodeId,
  });
}

export function useNodeAcl(nodeId: string | null): UseQueryResult<NodeAclResponse> {
  return useQuery({
    queryKey: [...filesKey, 'acl', nodeId],
    queryFn: () => api.get<NodeAclResponse>(`/v1/files/${nodeId}/acl`),
    enabled: !!nodeId,
  });
}

export function useNodeLinks(nodeId: string | null): UseQueryResult<FileLinkDto[]> {
  return useQuery({
    queryKey: [...filesKey, 'links', nodeId],
    queryFn: () => api.get<FileLinkDto[]>(`/v1/files/${nodeId}/links`),
    enabled: !!nodeId,
  });
}

// ---- Mutations -------------------------------------------------------------

function useInvalidateFiles() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: filesKey });
}

export function useCreateFolder() {
  const invalidate = useInvalidateFiles();
  return useMutation({
    mutationFn: (input: CreateFolderInput) => api.post<FsNodeDto>('/v1/files/folders', input),
    onSuccess: invalidate,
  });
}

export function usePatchNode() {
  const invalidate = useInvalidateFiles();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchNodeInput }) =>
      api.patch<FsNodeDto>(`/v1/files/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useTrashNode() {
  const invalidate = useInvalidateFiles();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/files/${id}`),
    onSuccess: invalidate,
  });
}

export function useRestoreNode() {
  const invalidate = useInvalidateFiles();
  return useMutation({
    mutationFn: (id: string) => api.post<FsNodeDto>(`/v1/files/${id}/restore`),
    onSuccess: invalidate,
  });
}

export function useRestoreVersion() {
  const invalidate = useInvalidateFiles();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post<FsNodeDto>(`/v1/files/${id}/versions/${version}/restore`),
    onSuccess: invalidate,
  });
}

export function useGrantAcl() {
  const invalidate = useInvalidateFiles();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: GrantNodeAclInput }) =>
      api.put<NodeAclEntryDto>(`/v1/files/${id}/acl`, input),
    onSuccess: invalidate,
  });
}

export function useRevokeAcl() {
  const invalidate = useInvalidateFiles();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RevokeNodeAclInput }) =>
      api.delete<{ ok: true }>(`/v1/files/${id}/acl`, input),
    onSuccess: invalidate,
  });
}

export function useCreateLink() {
  const invalidate = useInvalidateFiles();
  return useMutation({
    mutationFn: ({ id, expiresInDays }: { id: string; expiresInDays: number | null }) =>
      api.post<FileLinkDto>(`/v1/files/${id}/links`, { expiresInDays }),
    onSuccess: invalidate,
  });
}

export function useRevokeLink() {
  const invalidate = useInvalidateFiles();
  return useMutation({
    mutationFn: ({ id, linkId }: { id: string; linkId: string }) =>
      api.delete<{ ok: true }>(`/v1/files/${id}/links/${linkId}`),
    onSuccess: invalidate,
  });
}

// ---- Directory (people/unit pickers) ---------------------------------------

export function useDirectoryUsers(q: string): UseQueryResult<DirectoryUserDto[]> {
  return useQuery({
    queryKey: ['directory', 'users', q],
    queryFn: () => api.get<DirectoryUserDto[]>(`/v1/directory/users?q=${encodeURIComponent(q)}`),
  });
}

export function useDirectoryOrgUnits(enabled = true): UseQueryResult<DirectoryOrgUnitDto[]> {
  return useQuery({
    queryKey: ['directory', 'org-units'],
    queryFn: () => api.get<DirectoryOrgUnitDto[]>('/v1/directory/org-units'),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}
