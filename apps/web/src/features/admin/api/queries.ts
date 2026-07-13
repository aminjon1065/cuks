import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  AssignPositionInput,
  AssignRoleInput,
  AuditLogDto,
  AuditLogQuery,
  CreateOrgUnitInput,
  CreatePositionInput,
  CreateRoleInput,
  CreateUserInput,
  ListUsersQuery,
  MoveOrgUnitInput,
  OrgUnitTreeNode,
  PaginatedResult,
  PermissionCatalogEntry,
  PositionDto,
  RoleAssignmentDto,
  RoleDto,
  TempPasswordDto,
  UpdateOrgUnitInput,
  UpdatePositionInput,
  UpdateRoleInput,
  UpdateUserInput,
  UserDetailDto,
  UserListItemDto,
  UserPositionDto,
} from '@cuks/shared';
import { api } from '@/lib/api-client';

// ---- Users -----------------------------------------------------------------
export const usersKey = ['admin', 'users'] as const;

export function useUsers(query: ListUsersQuery): UseQueryResult<PaginatedResult<UserListItemDto>> {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('limit', String(query.limit));
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  return useQuery({
    queryKey: [...usersKey, 'list', query],
    queryFn: () => api.get<PaginatedResult<UserListItemDto>>(`/v1/admin/users?${params}`),
  });
}

export function useUser(id: string | null): UseQueryResult<UserDetailDto> {
  return useQuery({
    queryKey: [...usersKey, id],
    queryFn: () => api.get<UserDetailDto>(`/v1/admin/users/${id}`),
    enabled: !!id,
  });
}

function invalidateUsers(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: usersKey });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post<TempPasswordDto>('/v1/admin/users', input),
    onSuccess: () => invalidateUsers(qc),
  });
}
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      api.patch<{ ok: true }>(`/v1/admin/users/${id}`, input),
    onSuccess: () => invalidateUsers(qc),
  });
}
export function useUserAction(action: 'block' | 'unblock' | 'reset-totp') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: true }>(`/v1/admin/users/${id}/${action}`),
    onSuccess: () => invalidateUsers(qc),
  });
}
export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<TempPasswordDto>(`/v1/admin/users/${id}/reset-password`),
    onSuccess: () => invalidateUsers(qc),
  });
}
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/admin/users/${id}`),
    onSuccess: () => invalidateUsers(qc),
  });
}

// ---- Roles -----------------------------------------------------------------
export const rolesKey = ['admin', 'roles'] as const;

export function useRoles(): UseQueryResult<RoleDto[]> {
  return useQuery({ queryKey: rolesKey, queryFn: () => api.get<RoleDto[]>('/v1/admin/roles') });
}
export function usePermissionCatalog(): UseQueryResult<PermissionCatalogEntry[]> {
  return useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: () => api.get<PermissionCatalogEntry[]>('/v1/admin/permissions'),
    staleTime: Infinity,
  });
}
export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoleInput) => api.post<RoleDto>('/v1/admin/roles', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rolesKey }),
  });
}
export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRoleInput }) =>
      api.patch<RoleDto>(`/v1/admin/roles/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rolesKey }),
  });
}
export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/admin/roles/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rolesKey }),
  });
}

// ---- Role assignments (from the user card) ---------------------------------
export function useRoleAssignments(userId: string | null): UseQueryResult<RoleAssignmentDto[]> {
  return useQuery({
    queryKey: ['admin', 'role-assignments', userId],
    queryFn: () => api.get<RoleAssignmentDto[]>(`/v1/admin/role-assignments?userId=${userId}`),
    enabled: !!userId,
  });
}
function invalidateAssignments(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['admin', 'role-assignments'] });
  void qc.invalidateQueries({ queryKey: usersKey }); // list roles column
}
export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignRoleInput) =>
      api.post<RoleAssignmentDto>('/v1/admin/role-assignments', input),
    onSuccess: () => invalidateAssignments(qc),
  });
}
export function useRevokeRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/admin/role-assignments/${id}`),
    onSuccess: () => invalidateAssignments(qc),
  });
}

// ---- Org structure ---------------------------------------------------------
export const orgTreeKey = ['admin', 'org-units'] as const;

export function useOrgTree(): UseQueryResult<OrgUnitTreeNode[]> {
  return useQuery({
    queryKey: orgTreeKey,
    queryFn: () => api.get<OrgUnitTreeNode[]>('/v1/admin/org-units'),
  });
}
function invalidateOrg(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: orgTreeKey });
  void qc.invalidateQueries({ queryKey: ['admin', 'positions'] });
}
export function useCreateOrgUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrgUnitInput) => api.post('/v1/admin/org-units', input),
    onSuccess: () => invalidateOrg(qc),
  });
}
export function useUpdateOrgUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateOrgUnitInput }) =>
      api.patch(`/v1/admin/org-units/${id}`, input),
    onSuccess: () => invalidateOrg(qc),
  });
}
export function useMoveOrgUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MoveOrgUnitInput }) =>
      api.post(`/v1/admin/org-units/${id}/move`, input),
    onSuccess: () => invalidateOrg(qc),
  });
}
export function useDeleteOrgUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/admin/org-units/${id}`),
    onSuccess: () => invalidateOrg(qc),
  });
}
export function usePositions(orgUnitId: string | null): UseQueryResult<PositionDto[]> {
  return useQuery({
    queryKey: ['admin', 'positions', orgUnitId],
    queryFn: () => api.get<PositionDto[]>(`/v1/admin/positions?orgUnitId=${orgUnitId}`),
    enabled: !!orgUnitId,
  });
}
export function useCreatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePositionInput) => api.post('/v1/admin/positions', input),
    onSuccess: () => invalidateOrg(qc),
  });
}
export function useUpdatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePositionInput }) =>
      api.patch(`/v1/admin/positions/${id}`, input),
    onSuccess: () => invalidateOrg(qc),
  });
}
export function useDeletePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/admin/positions/${id}`),
    onSuccess: () => invalidateOrg(qc),
  });
}

// ---- User positions (from the user card) -----------------------------------
export function useUserPositions(userId: string | null): UseQueryResult<UserPositionDto[]> {
  return useQuery({
    queryKey: ['admin', 'user-positions', userId],
    queryFn: () => api.get<UserPositionDto[]>(`/v1/admin/user-positions?userId=${userId}`),
    enabled: !!userId,
  });
}
function invalidatePositions(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['admin', 'user-positions'] });
  void qc.invalidateQueries({ queryKey: usersKey }); // list primaryPosition column
}
export function useAssignPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignPositionInput) => api.post('/v1/admin/user-positions', input),
    onSuccess: () => invalidatePositions(qc),
  });
}
export function useUnassignPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/admin/user-positions/${id}`),
    onSuccess: () => invalidatePositions(qc),
  });
}

// ---- Audit -----------------------------------------------------------------
export function useAuditLog(query: AuditLogQuery): UseQueryResult<PaginatedResult<AuditLogDto>> {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('limit', String(query.limit));
  if (query.action) params.set('action', query.action);
  if (query.actorId) params.set('actorId', query.actorId);
  if (query.entityType) params.set('entityType', query.entityType);
  if (query.entityId) params.set('entityId', query.entityId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  return useQuery({
    queryKey: ['admin', 'audit', query],
    queryFn: () => api.get<PaginatedResult<AuditLogDto>>(`/v1/admin/audit?${params}`),
  });
}
