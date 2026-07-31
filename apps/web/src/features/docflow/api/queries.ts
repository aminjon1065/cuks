import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  AcknowledgementSheetDto,
  AttentionCountsDto,
  DocumentSearchHitDto,
  QuickSearchHitDto,
  ActivateCertificateInput,
  AddDocumentFileInput,
  CertificateDto,
  ChangeDocumentStatusInput,
  ControlItemDto,
  CorrespondentCategoryDto,
  CreateDocumentLinkInput,
  CreateResolutionInput,
  CreateSubstitutionInput,
  DisciplineReportDto,
  DisciplineReportQuery,
  DocumentAccessDto,
  ReadLogEntryDto,
  SetDocumentAccessInput,
  SubstitutionDto,
  RemoveResolutionControlInput,
  DirectoryUserDto,
  AddDocumentCollaboratorInput,
  DocumentCollaboratorDto,
  CreateDocumentTemplateInput,
  CreateTemplateVersionInput,
  DocumentHistoryEntryDto,
  DocumentTemplateDto,
  DocumentTimelineEntryDto,
  InstantiateDocumentTemplateInput,
  DocumentLinkDto,
  DocumentQueueCountsDto,
  ExtendResolutionInput,
  ReportResolutionInput,
  ResolutionDto,
  RouteDto,
  RouteTemplateDto,
  RouteValidationDto,
  UpdateRouteTemplateInput,
  SignatureDto,
  SignDocumentInput,
  SignPayloadDto,
  StartRouteInput,
  VerifyResultDto,
  CorrespondentDto,
  CreateCorrespondentInput,
  CreateDocumentInput,
  CreateJournalInput,
  CreateNomenclatureInput,
  DocumentDetailDto,
  DocumentListItemDto,
  DocumentTypeDto,
  JournalDto,
  ListDocumentsQuery,
  NomenclatureDto,
  PaginatedResult,
  RegisterDocumentInput,
  RegisterIncomingInput,
  UpdateCorrespondentInput,
  UpdateDocumentInput,
  UpdateJournalInput,
  UpdateNomenclatureInput,
  AcquaintanceGateDto,
  ApproveResolutionProposalInput,
  CreateResolutionProposalInput,
  CreateResolutionTypeInput,
  RejectResolutionProposalInput,
  ResolutionProposalDto,
  ResolutionTypeDto,
  UpdateResolutionProposalInput,
  UpdateResolutionTypeInput,
  CancelDispatchInput,
  ConfirmDispatchInput,
  CreateDispatchInput,
  CreateResponseInput,
  DocumentDispatchDto,
  FailDispatchInput,
  AcknowledgementReportDto,
  AcknowledgementReportQuery,
  CreateDistributionInput,
  DistributionDto,
  ArchiveDocumentInput,
  ArchiveEntryDto,
  ArchiveQuery,
  CreateDispositionBatchInput,
  DispositionBatchDto,
  DispositionDecisionInput,
  LegalHoldInput,
  RestoreDocumentInput,
} from '@cuks/shared';
import { CSRF_COOKIE, CSRF_HEADER } from '@cuks/shared';
import { api } from '@/lib/api-client';

/** Query-key factory for the docflow reference data (docs/04 §Frontend). */
export const docflowKey = ['docflow'] as const;
export const journalsKey = [...docflowKey, 'journals'] as const;
export const correspondentsKey = [...docflowKey, 'correspondents'] as const;
export const nomenclatureKey = [...docflowKey, 'nomenclature'] as const;
export const documentTypesKey = [...docflowKey, 'document-types'] as const;

// ---- Journals --------------------------------------------------------------

export function useJournals(): UseQueryResult<JournalDto[]> {
  return useQuery({
    queryKey: journalsKey,
    queryFn: () => api.get<JournalDto[]>('/v1/docflow/journals'),
  });
}
export function useCreateJournal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateJournalInput) => api.post<JournalDto>('/v1/docflow/journals', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: journalsKey }),
  });
}
export function useUpdateJournal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateJournalInput }) =>
      api.patch<JournalDto>(`/v1/docflow/journals/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: journalsKey }),
  });
}
export function useDeleteJournal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/docflow/journals/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: journalsKey }),
  });
}

// ---- Correspondents --------------------------------------------------------

export function useCorrespondents(search: string): UseQueryResult<CorrespondentDto[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const qs = params.toString();
  return useQuery({
    queryKey: [...correspondentsKey, search],
    queryFn: () => api.get<CorrespondentDto[]>(`/v1/docflow/correspondents${qs ? `?${qs}` : ''}`),
  });
}
export function useCreateCorrespondent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCorrespondentInput) =>
      api.post<CorrespondentDto>('/v1/docflow/correspondents', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: correspondentsKey }),
  });
}
export function useUpdateCorrespondent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCorrespondentInput }) =>
      api.patch<CorrespondentDto>(`/v1/docflow/correspondents/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: correspondentsKey }),
  });
}
export function useDeleteCorrespondent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/docflow/correspondents/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: correspondentsKey }),
  });
}

// ---- Nomenclature ----------------------------------------------------------

export function useNomenclature(): UseQueryResult<NomenclatureDto[]> {
  return useQuery({
    queryKey: nomenclatureKey,
    queryFn: () => api.get<NomenclatureDto[]>('/v1/docflow/nomenclature'),
  });
}
export function useCreateNomenclature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNomenclatureInput) =>
      api.post<NomenclatureDto>('/v1/docflow/nomenclature', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: nomenclatureKey }),
  });
}
export function useUpdateNomenclature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateNomenclatureInput }) =>
      api.patch<NomenclatureDto>(`/v1/docflow/nomenclature/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: nomenclatureKey }),
  });
}
export function useDeleteNomenclature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/docflow/nomenclature/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: nomenclatureKey }),
  });
}

// ---- Document types (read-only) --------------------------------------------

export function useDocumentTypes(): UseQueryResult<DocumentTypeDto[]> {
  return useQuery({
    queryKey: documentTypesKey,
    queryFn: () => api.get<DocumentTypeDto[]>('/v1/docflow/document-types'),
    staleTime: 30 * 60 * 1000,
  });
}

export function useCorrespondentCategories(): UseQueryResult<CorrespondentCategoryDto[]> {
  return useQuery({
    queryKey: [...docflowKey, 'correspondent-categories'],
    queryFn: () => api.get<CorrespondentCategoryDto[]>('/v1/docflow/correspondent-categories'),
    staleTime: 30 * 60 * 1000,
  });
}

// ---- Documents -------------------------------------------------------------

export const documentsKey = [...docflowKey, 'documents'] as const;

function documentsPath(query: ListDocumentsQuery): string {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('limit', String(query.limit));
  params.set('queue', query.queue);
  if (query.status) params.set('status', query.status);
  if (query.docClass) params.set('docClass', query.docClass);
  if (query.journalId) params.set('journalId', query.journalId);
  if (query.search) params.set('search', query.search);
  if (query.year) params.set('year', String(query.year));
  return `/v1/docflow/documents?${params}`;
}

export function useDocuments(
  query: ListDocumentsQuery,
  options?: { enabled?: boolean },
): UseQueryResult<PaginatedResult<DocumentListItemDto>> {
  return useQuery({
    queryKey: [...documentsKey, 'list', query],
    queryFn: () => api.get<PaginatedResult<DocumentListItemDto>>(documentsPath(query)),
    enabled: options?.enabled ?? true,
  });
}

export function useDocument(id: string | null): UseQueryResult<DocumentDetailDto> {
  return useQuery({
    queryKey: [...documentsKey, id],
    queryFn: () => api.get<DocumentDetailDto>(`/v1/docflow/documents/${id}`),
    enabled: !!id,
  });
}

export function useQueueCounts(): UseQueryResult<DocumentQueueCountsDto> {
  return useQuery({
    queryKey: [...documentsKey, 'queue-counts'],
    queryFn: () => api.get<DocumentQueueCountsDto>('/v1/docflow/documents/queue-counts'),
    staleTime: 15 * 1000,
  });
}

/** «Требует внимания» on the dashboard — the eight queues, minus the ones this caller may
 *  not see (the server omits those rather than sending a zero). */
export function useAttentionCounts(): UseQueryResult<AttentionCountsDto> {
  return useQuery({
    queryKey: [...documentsKey, 'attention'],
    queryFn: () => api.get<AttentionCountsDto>('/v1/docflow/attention'),
    staleTime: 30 * 1000,
  });
}

/**
 * Full-text search over the register. `enabled` on a non-empty query so an empty box makes
 * no request at all — the empty search is the register, and it has its own screen.
 */
export function useDocumentSearch(
  query: string,
  params: { page: number; limit: number; sort?: string },
): UseQueryResult<PaginatedResult<DocumentSearchHitDto>> {
  const q = query.trim();
  const search = new URLSearchParams({
    q,
    page: String(params.page),
    limit: String(params.limit),
    ...(params.sort ? { sort: params.sort } : {}),
  });
  return useQuery({
    queryKey: [...documentsKey, 'search', q, params.page, params.limit, params.sort],
    queryFn: () =>
      api.get<PaginatedResult<DocumentSearchHitDto>>(`/v1/docflow/search?${search.toString()}`),
    enabled: q.length > 0,
    staleTime: 15 * 1000,
  });
}

/** The command palette's document source: at most five, same server policy as the search. */
export function useQuickSearch(query: string): UseQueryResult<QuickSearchHitDto[]> {
  const q = query.trim();
  return useQuery({
    queryKey: [...documentsKey, 'quick', q],
    queryFn: () =>
      api.get<QuickSearchHitDto[]>(`/v1/docflow/search/quick?q=${encodeURIComponent(q)}`),
    enabled: q.length > 1,
    staleTime: 10 * 1000,
  });
}

export function useDocumentHistory(id: string | null): UseQueryResult<DocumentHistoryEntryDto[]> {
  return useQuery({
    queryKey: [...documentsKey, id, 'history'],
    queryFn: () => api.get<DocumentHistoryEntryDto[]>(`/v1/docflow/documents/${id}/history`),
    enabled: !!id,
  });
}

// ---- ДСП access / read log (docs/09-security.md §3, task 3.10) ------------

export function useDocumentAccess(id: string): UseQueryResult<DocumentAccessDto> {
  return useQuery({
    queryKey: [...documentsKey, id, 'access'],
    queryFn: () => api.get<DocumentAccessDto>(`/v1/docflow/documents/${id}/access`),
  });
}

/** Set the grif + allow-list; refreshes the access block, the card and its lists (the ДСП
 *  guard changes who sees the document). */
export function useSetDocumentAccess(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetDocumentAccessInput) =>
      api.patch<DocumentAccessDto>(`/v1/docflow/documents/${id}/access`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...documentsKey, id] });
      void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
    },
  });
}

export function useDocumentReadLog(
  id: string,
  enabled: boolean,
): UseQueryResult<ReadLogEntryDto[]> {
  return useQuery({
    queryKey: [...documentsKey, id, 'read-log'],
    queryFn: () => api.get<ReadLogEntryDto[]>(`/v1/docflow/documents/${id}/read-log`),
    enabled,
  });
}

export function useDocumentLinks(id: string | null): UseQueryResult<DocumentLinkDto[]> {
  return useQuery({
    queryKey: [...documentsKey, id, 'links'],
    queryFn: () => api.get<DocumentLinkDto[]>(`/v1/docflow/documents/${id}/links`),
    enabled: !!id,
  });
}

export function useAddDocumentLink(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDocumentLinkInput) =>
      api.post<DocumentLinkDto[]>(`/v1/docflow/documents/${documentId}/links`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...documentsKey, documentId, 'links'] }),
  });
}

export function useRemoveDocumentLink(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      api.delete<DocumentLinkDto[]>(`/v1/docflow/documents/${documentId}/links/${linkId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...documentsKey, documentId, 'links'] }),
  });
}

/** Attach an already-uploaded file (fs node) to a draft document. */
export function useAddDocumentFile(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddDocumentFileInput) =>
      api.post<DocumentDetailDto>(`/v1/docflow/documents/${documentId}/files`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...documentsKey, documentId] }),
  });
}

function invalidateDocuments(qc: ReturnType<typeof useQueryClient>, id?: string) {
  void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
  if (id) void qc.invalidateQueries({ queryKey: [...documentsKey, id] });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDocumentInput) =>
      api.post<DocumentDetailDto>('/v1/docflow/documents', input),
    onSuccess: () => invalidateDocuments(qc),
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDocumentInput }) =>
      api.patch<DocumentDetailDto>(`/v1/docflow/documents/${id}`, input),
    onSuccess: (_data, { id }) => invalidateDocuments(qc, id),
  });
}

export function useRegisterDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RegisterDocumentInput }) =>
      api.post<DocumentDetailDto>(`/v1/docflow/documents/${id}/actions/register`, input),
    onSuccess: (_data, { id }) => invalidateDocuments(qc, id),
  });
}

/**
 * Atomic incoming registration (docs/modules/11 §12.2): one request creates the card,
 * mints the number and links the files. `idempotencyKey` is minted once per wizard
 * attempt, so retrying after a dropped response returns the same document and number
 * instead of a second registration.
 */
export function useRegisterIncoming() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterIncomingInput) =>
      api.post<DocumentDetailDto>('/v1/docflow/documents/register-incoming', input),
    onSuccess: (doc) => invalidateDocuments(qc, doc.id),
  });
}

export function useDocumentTimeline(id: string | null): UseQueryResult<DocumentTimelineEntryDto[]> {
  return useQuery({
    queryKey: [...documentsKey, id, 'timeline'],
    queryFn: () => api.get<DocumentTimelineEntryDto[]>(`/v1/docflow/documents/${id}/timeline`),
    enabled: !!id,
  });
}

// ---- Document templates (docs/modules/11 §12.7) -----------------------------

export const documentTemplatesKey = [...docflowKey, 'document-templates'] as const;

export function useDocumentTemplates(enabled = true): UseQueryResult<DocumentTemplateDto[]> {
  return useQuery({
    queryKey: documentTemplatesKey,
    queryFn: () => api.get<DocumentTemplateDto[]>('/v1/docflow/document-templates'),
    enabled,
  });
}

export function useCreateDocumentTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDocumentTemplateInput) =>
      api.post<DocumentTemplateDto>('/v1/docflow/document-templates', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: documentTemplatesKey }),
  });
}

export function useAddTemplateVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateId,
      input,
    }: {
      templateId: string;
      input: CreateTemplateVersionInput;
    }) =>
      api.post<DocumentTemplateDto>(`/v1/docflow/document-templates/${templateId}/versions`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: documentTemplatesKey }),
  });
}

export function usePublishTemplateVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, version }: { templateId: string; version: number }) =>
      api.post<DocumentTemplateDto>(
        `/v1/docflow/document-templates/${templateId}/versions/${version}/actions/publish`,
        {},
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: documentTemplatesKey }),
  });
}

export function useDeactivateDocumentTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) =>
      api.post<DocumentTemplateDto>(
        `/v1/docflow/document-templates/${templateId}/actions/deactivate`,
        {},
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: documentTemplatesKey }),
  });
}

export function useInstantiateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateId,
      input,
    }: {
      templateId: string;
      input: InstantiateDocumentTemplateInput;
    }) =>
      api.post<{ documentId: string }>(
        `/v1/docflow/document-templates/${templateId}/actions/instantiate`,
        input,
      ),
    onSuccess: () => invalidateDocuments(qc),
  });
}

export function useAddCollaborator(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddDocumentCollaboratorInput) =>
      api.post<DocumentCollaboratorDto[]>(
        `/v1/docflow/documents/${documentId}/collaborators`,
        input,
      ),
    onSuccess: () => invalidateDocuments(qc, documentId),
  });
}

export function useRemoveCollaborator(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (collaboratorId: string) =>
      api.delete<DocumentCollaboratorDto[]>(
        `/v1/docflow/documents/${documentId}/collaborators/${collaboratorId}`,
      ),
    onSuccess: () => invalidateDocuments(qc, documentId),
  });
}

export function useChangeDocumentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ChangeDocumentStatusInput }) =>
      api.post<DocumentDetailDto>(`/v1/docflow/documents/${id}/actions/status`, input),
    onSuccess: (_data, { id }) => invalidateDocuments(qc, id),
  });
}

// ---- Routes ----------------------------------------------------------------

export function useDocumentRoutes(documentId: string | null): UseQueryResult<RouteDto[]> {
  return useQuery({
    queryKey: [...documentsKey, documentId, 'routes'],
    queryFn: () => api.get<RouteDto[]>(`/v1/docflow/documents/${documentId}/routes`),
    enabled: !!documentId,
  });
}

/** After a route mutation the document status changes too — refresh both. */
function invalidateRoutes(qc: ReturnType<typeof useQueryClient>, documentId: string) {
  void qc.invalidateQueries({ queryKey: [...documentsKey, documentId] });
  void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
}

export function useStartRoute(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartRouteInput) =>
      api.post<RouteDto[]>(`/v1/docflow/documents/${documentId}/route`, input),
    onSuccess: () => invalidateRoutes(qc, documentId),
  });
}

/** Dry-run a route definition before starting it (docs/modules/11 §12.9). */
export function useValidateRoute(documentId: string) {
  return useMutation({
    mutationFn: (input: StartRouteInput) =>
      api.post<RouteValidationDto>(`/v1/docflow/documents/${documentId}/route/validate`, input),
  });
}

export function useActRouteStep(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      stepId,
      action,
      comment,
    }: {
      stepId: string;
      /** Only the actions a step row itself performs — `sign`/`acknowledge`/`register`
       *  steps are completed from their own surfaces (docs/modules/11 §4). */
      action: 'approve' | 'reject' | 'complete';
      comment?: string;
    }) => api.post<RouteDto[]>(`/v1/docflow/route-steps/${stepId}/actions/${action}`, { comment }),
    onSuccess: () => invalidateRoutes(qc, documentId),
  });
}

// ---- Resolutions -----------------------------------------------------------

export function useDocumentResolutions(documentId: string | null): UseQueryResult<ResolutionDto[]> {
  return useQuery({
    queryKey: [...documentsKey, documentId, 'resolutions'],
    queryFn: () => api.get<ResolutionDto[]>(`/v1/docflow/documents/${documentId}/resolutions`),
    enabled: !!documentId,
  });
}

/** A resolution mutation may change the document status too — refresh both. */
function invalidateResolutions(qc: ReturnType<typeof useQueryClient>, documentId: string) {
  void qc.invalidateQueries({ queryKey: [...documentsKey, documentId] });
  void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
}

export function useCreateResolution(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateResolutionInput) =>
      api.post<ResolutionDto[]>(`/v1/docflow/documents/${documentId}/resolutions`, input),
    onSuccess: () => invalidateResolutions(qc, documentId),
  });
}

export function useCreateSubResolution(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, input }: { parentId: string; input: CreateResolutionInput }) =>
      api.post<ResolutionDto[]>(`/v1/docflow/resolutions/${parentId}/subresolutions`, input),
    onSuccess: () => invalidateResolutions(qc, documentId),
  });
}

type ResolutionActionBody = ReportResolutionInput | ExtendResolutionInput | Record<string, never>;

export function useResolutionAction(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      resolutionId,
      action,
      body,
    }: {
      resolutionId: string;
      action: 'report' | 'done' | 'extend' | 'cancel';
      body?: ResolutionActionBody;
    }) =>
      api.post<ResolutionDto[]>(
        `/v1/docflow/resolutions/${resolutionId}/actions/${action}`,
        body ?? {},
      ),
    onSuccess: () => invalidateResolutions(qc, documentId),
  });
}

// ---- Execution control (контроль) -----------------------------------------

export const controlKey = [...docflowKey, 'control'] as const;

export function useControlList(): UseQueryResult<ControlItemDto[]> {
  return useQuery({
    queryKey: controlKey,
    queryFn: () => api.get<ControlItemDto[]>('/v1/docflow/control'),
  });
}

/** Extend a controlled resolution's deadline or remove it from control (docs/modules/11
 *  §5) — refreshes the flat control list. */
export function useControlResolutionAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      resolutionId,
      action,
      body,
    }: {
      resolutionId: string;
      action: 'extend' | 'uncontrol';
      body: ExtendResolutionInput | RemoveResolutionControlInput;
    }) =>
      api.post<ResolutionDto[]>(`/v1/docflow/resolutions/${resolutionId}/actions/${action}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: controlKey }),
  });
}

// ---- Executive-discipline report (docs/modules/11 §5, task 3.9) -----------

export const reportsKey = [...docflowKey, 'reports'] as const;

/** Build the `?from&to&orgUnitId` query string for the discipline endpoints. */
function disciplineParams(query: DisciplineReportQuery): string {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.orgUnitId) params.set('orgUnitId', query.orgUnitId);
  return params.toString();
}

export function useDisciplineReport(
  query: DisciplineReportQuery,
  enabled = true,
): UseQueryResult<DisciplineReportDto> {
  return useQuery({
    queryKey: [...reportsKey, 'discipline', query.from, query.to, query.orgUnitId ?? null],
    queryFn: () =>
      api.get<DisciplineReportDto>(`/v1/docflow/reports/discipline?${disciplineParams(query)}`),
    enabled,
  });
}

/** Download the discipline report as XLSX (a binary GET — bypasses the JSON api client). */
export async function exportDisciplineXlsx(query: DisciplineReportQuery): Promise<void> {
  const res = await fetch(`/api/v1/docflow/reports/discipline/export?${disciplineParams(query)}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`export failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFromDisposition(res.headers.get('content-disposition')) ?? 'discipline.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function useDirectoryUsers(search: string): UseQueryResult<DirectoryUserDto[]> {
  const qs = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : '';
  return useQuery({
    queryKey: ['directory', 'users', search.trim()],
    queryFn: () => api.get<DirectoryUserDto[]>(`/v1/directory/users${qs}`),
    staleTime: 60 * 1000,
  });
}

// ---- Substitutions / замещения (docs/05 §6, task 3.11) --------------------

export const substitutionsKey = [...docflowKey, 'substitutions'] as const;

export function useSubstitutions(): UseQueryResult<SubstitutionDto[]> {
  return useQuery({
    queryKey: substitutionsKey,
    queryFn: () => api.get<SubstitutionDto[]>('/v1/docflow/substitutions'),
  });
}

export function useCreateSubstitution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSubstitutionInput) =>
      api.post<SubstitutionDto>('/v1/docflow/substitutions', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: substitutionsKey }),
  });
}

export function useRemoveSubstitution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/docflow/substitutions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: substitutionsKey }),
  });
}

// ---- Signatures (ЭЦП) ------------------------------------------------------

export function useDocumentSignatures(documentId: string | null): UseQueryResult<SignatureDto[]> {
  return useQuery({
    queryKey: [...documentsKey, documentId, 'signatures'],
    queryFn: () => api.get<SignatureDto[]>(`/v1/docflow/documents/${documentId}/signatures`),
    enabled: !!documentId,
  });
}

export function useMyCertificates(): UseQueryResult<CertificateDto[]> {
  return useQuery({
    queryKey: [...docflowKey, 'certificates'],
    queryFn: () => api.get<CertificateDto[]>('/v1/signatures/certificates'),
  });
}

export function useActivateCertificate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ActivateCertificateInput) =>
      api.post<CertificateDto>('/v1/signatures/activate', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...docflowKey, 'certificates'] }),
  });
}

/** Fetch the canonical payload to sign for a document's current file version. */
export function fetchSignPayload(documentId: string): Promise<SignPayloadDto> {
  return api.get<SignPayloadDto>(`/v1/docflow/documents/${documentId}/sign-payload`);
}

export function useSignDocument(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SignDocumentInput) =>
      api.post<SignatureDto[]>(`/v1/docflow/documents/${documentId}/actions/sign`, input),
    onSuccess: () => {
      // Signing advances the route step and freezes the file — refresh the whole card.
      void qc.invalidateQueries({ queryKey: [...documentsKey, documentId] });
      void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
    },
  });
}

export function useVerifySignature(signatureId: string | null): UseQueryResult<VerifyResultDto> {
  return useQuery({
    queryKey: [...docflowKey, 'verify', signatureId],
    queryFn: () => api.get<VerifyResultDto>(`/v1/verify/${signatureId}`),
    enabled: !!signatureId,
  });
}

// ---- Acknowledgements (ознакомление) --------------------------------------

export function useDocumentAcquaintances(
  documentId: string | null,
): UseQueryResult<AcknowledgementSheetDto> {
  return useQuery({
    queryKey: [...documentsKey, documentId, 'acquaintances'],
    queryFn: () =>
      api.get<AcknowledgementSheetDto>(`/v1/docflow/documents/${documentId}/acquaintances`),
    enabled: !!documentId,
  });
}

export function useAcknowledge(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stepId: string) =>
      api.post<AcknowledgementSheetDto>(`/v1/docflow/route-steps/${stepId}/actions/acknowledge`),
    onSuccess: () => {
      // Acknowledging may complete the step and advance the route — refresh the card.
      void qc.invalidateQueries({ queryKey: [...documentsKey, documentId] });
      void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
    },
  });
}

/** Download the stamped-PDF artifact (a binary POST — bypasses the JSON api client). */
export async function exportSignedPdf(documentId: string): Promise<void> {
  const csrf = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`))?.[1];
  const res = await fetch(`/api/v1/docflow/documents/${documentId}/export-pdf`, {
    method: 'POST',
    credentials: 'include',
    headers: csrf ? { [CSRF_HEADER]: decodeURIComponent(csrf) } : {},
  });
  if (!res.ok) throw new Error(`export failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFromDisposition(res.headers.get('content-disposition')) ?? 'signatures.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) return decodeURIComponent(utf8[1]);
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain?.[1] ?? null;
}

// ---- Route templates (docs/modules/11 §12.9) --------------------------------

export const routeTemplatesKey = [...docflowKey, 'route-templates'] as const;

export function useRouteTemplates(): UseQueryResult<RouteTemplateDto[]> {
  return useQuery({
    queryKey: routeTemplatesKey,
    queryFn: () => api.get<RouteTemplateDto[]>('/v1/docflow/route-templates'),
  });
}

export function useUpdateRouteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRouteTemplateInput }) =>
      api.patch<RouteTemplateDto>(`/v1/docflow/route-templates/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: routeTemplatesKey }),
  });
}

/** Copy a template as a retired draft — a started route keeps its own snapshot, so the
 *  original is never disturbed by editing the copy. */
export function useCloneRouteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<RouteTemplateDto>(`/v1/docflow/route-templates/${id}/actions/clone`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: routeTemplatesKey }),
  });
}

export function useDeleteRouteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/docflow/route-templates/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: routeTemplatesKey }),
  });
}

// ---- Resolution proposals + the pre-execution gate (docs/modules/11 §12.11) ---

export const resolutionTypesKey = [...docflowKey, 'resolution-types'] as const;

export function useResolutionTypes(activeOnly = false): UseQueryResult<ResolutionTypeDto[]> {
  return useQuery({
    queryKey: [...resolutionTypesKey, { activeOnly }],
    queryFn: () =>
      api.get<ResolutionTypeDto[]>(
        `/v1/docflow/resolution-types${activeOnly ? '?active=true' : ''}`,
      ),
  });
}

export function useCreateResolutionType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateResolutionTypeInput) =>
      api.post<ResolutionTypeDto>('/v1/docflow/resolution-types', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: resolutionTypesKey }),
  });
}

export function useUpdateResolutionType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateResolutionTypeInput }) =>
      api.patch<ResolutionTypeDto>(`/v1/docflow/resolution-types/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: resolutionTypesKey }),
  });
}

export function useDeleteResolutionType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/v1/docflow/resolution-types/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: resolutionTypesKey }),
  });
}

export function useDocumentProposals(
  documentId: string | null,
): UseQueryResult<ResolutionProposalDto[]> {
  return useQuery({
    queryKey: [...documentsKey, documentId, 'proposals'],
    queryFn: () =>
      api.get<ResolutionProposalDto[]>(`/v1/docflow/documents/${documentId}/resolution-proposals`),
    enabled: !!documentId,
  });
}

/** A decision issues a resolution and may change the document — refresh the whole card. */
function invalidateProposals(qc: ReturnType<typeof useQueryClient>, documentId: string) {
  void qc.invalidateQueries({ queryKey: [...documentsKey, documentId] });
  void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
}

export function useCreateProposal(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateResolutionProposalInput) =>
      api.post<ResolutionProposalDto>(
        `/v1/docflow/documents/${documentId}/resolution-proposals`,
        input,
      ),
    onSuccess: () => invalidateProposals(qc, documentId),
  });
}

export function useUpdateProposal(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateResolutionProposalInput }) =>
      api.patch<ResolutionProposalDto>(`/v1/docflow/resolution-proposals/${id}`, input),
    onSuccess: () => invalidateProposals(qc, documentId),
  });
}

type ProposalActionBody =
  ApproveResolutionProposalInput | RejectResolutionProposalInput | Record<string, never>;

export function useProposalAction(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      proposalId,
      action,
      body,
    }: {
      proposalId: string;
      action: 'submit' | 'approve' | 'reject';
      body?: ProposalActionBody;
    }) =>
      api.post<ResolutionProposalDto>(
        `/v1/docflow/resolution-proposals/${proposalId}/actions/${action}`,
        body ?? {},
      ),
    onSuccess: () => invalidateProposals(qc, documentId),
  });
}

/** Confirm reading in a pre-execution gate; the last reader opens it immediately. */
export function useAcknowledgeGate(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) =>
      api.post<AcquaintanceGateDto>(
        `/v1/docflow/acquaintance-batches/${batchId}/actions/acknowledge`,
        {},
      ),
    onSuccess: () => invalidateProposals(qc, documentId),
  });
}

// ---- Outgoing response + dispatch (docs/modules/11 §12.3) ------------------

/** Draft the answer to an incoming document; returns the new outgoing card. */
export function useCreateResponse(sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateResponseInput) =>
      api.post<DocumentDetailDto>(
        `/v1/docflow/documents/${sourceId}/actions/create-response`,
        input,
      ),
    onSuccess: () => {
      // The source card gains a link, and the queues gain a draft.
      void qc.invalidateQueries({ queryKey: [...documentsKey, sourceId] });
      void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
    },
  });
}

export function useDocumentDispatches(
  documentId: string | null,
): UseQueryResult<DocumentDispatchDto[]> {
  return useQuery({
    queryKey: [...documentsKey, documentId, 'dispatches'],
    queryFn: () => api.get<DocumentDispatchDto[]>(`/v1/docflow/documents/${documentId}/dispatches`),
    enabled: !!documentId,
  });
}

/** A send can complete the document, so the whole card is refreshed. */
function invalidateDispatches(qc: ReturnType<typeof useQueryClient>, documentId: string) {
  void qc.invalidateQueries({ queryKey: [...documentsKey, documentId] });
  void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
}

export function useCreateDispatch(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDispatchInput) =>
      api.post<DocumentDispatchDto>(`/v1/docflow/documents/${documentId}/dispatches`, input),
    onSuccess: () => invalidateDispatches(qc, documentId),
  });
}

type DispatchActionBody =
  ConfirmDispatchInput | FailDispatchInput | CancelDispatchInput | Record<string, never>;

export function useDispatchAction(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      dispatchId,
      action,
      body,
    }: {
      dispatchId: string;
      action: 'confirm' | 'fail' | 'cancel' | 'retry';
      body?: DispatchActionBody;
    }) =>
      api.post<DocumentDispatchDto>(
        `/v1/docflow/dispatches/${dispatchId}/actions/${action}`,
        body ?? {},
      ),
    onSuccess: () => invalidateDispatches(qc, documentId),
  });
}

// ---- Internal distribution (docs/modules/11 §12.4) -------------------------

export function useDocumentDistributions(
  documentId: string | null,
): UseQueryResult<DistributionDto[]> {
  return useQuery({
    queryKey: [...documentsKey, documentId, 'distributions'],
    queryFn: () => api.get<DistributionDto[]>(`/v1/docflow/documents/${documentId}/distributions`),
    enabled: !!documentId,
  });
}

export function useCreateDistribution(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDistributionInput) =>
      api.post<DistributionDto>(`/v1/docflow/documents/${documentId}/distributions`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...documentsKey, documentId] });
      void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
    },
  });
}

// ---- Acknowledgement report (plan этап 7) ---------------------------------

function acknowledgementParams(query: AcknowledgementReportQuery): string {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.orgUnitId) params.set('orgUnitId', query.orgUnitId);
  return params.toString();
}

export function useAcknowledgementReport(
  query: AcknowledgementReportQuery,
  enabled: boolean,
): UseQueryResult<AcknowledgementReportDto> {
  return useQuery({
    queryKey: [...reportsKey, 'acknowledgement', query],
    queryFn: () =>
      api.get<AcknowledgementReportDto>(
        `/v1/docflow/reports/acknowledgement?${acknowledgementParams(query)}`,
      ),
    enabled,
  });
}

/** A binary GET — bypasses the JSON api client, like the discipline export beside it. */
export async function exportAcknowledgementXlsx(query: AcknowledgementReportQuery): Promise<void> {
  const res = await fetch(
    `/api/v1/docflow/reports/acknowledgement/export?${acknowledgementParams(query)}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(`export failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    filenameFromDisposition(res.headers.get('content-disposition')) ?? 'acknowledgement.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Archive, retention and disposition (docs/modules/11 §12.12) -----------

export const archiveKey = [...docflowKey, 'archive'] as const;

function archivePath(query: ArchiveQuery): string {
  const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
  if (query.caseIndex) params.set('caseIndex', query.caseIndex);
  if (query.search) params.set('search', query.search);
  if (query.candidatesOnly) params.set('candidatesOnly', 'true');
  if (query.legalHoldOnly) params.set('legalHoldOnly', 'true');
  return `/v1/docflow/archive?${params.toString()}`;
}

export function useArchive(query: ArchiveQuery): UseQueryResult<PaginatedResult<ArchiveEntryDto>> {
  return useQuery({
    queryKey: [...archiveKey, 'list', query],
    queryFn: () => api.get<PaginatedResult<ArchiveEntryDto>>(archivePath(query)),
  });
}

/** Filing, restoring and holding all change the card and the lists it appears in. */
function invalidateArchive(qc: ReturnType<typeof useQueryClient>, documentId: string) {
  void qc.invalidateQueries({ queryKey: [...documentsKey, documentId] });
  void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
  void qc.invalidateQueries({ queryKey: archiveKey });
}

export function useArchiveDocument(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ArchiveDocumentInput) =>
      api.post<DocumentDetailDto>(`/v1/docflow/documents/${documentId}/actions/archive`, input),
    onSuccess: () => invalidateArchive(qc, documentId),
  });
}

export function useRestoreDocument(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RestoreDocumentInput) =>
      api.post<DocumentDetailDto>(`/v1/docflow/documents/${documentId}/actions/restore`, input),
    onSuccess: () => invalidateArchive(qc, documentId),
  });
}

export function useSetLegalHold(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LegalHoldInput) =>
      api.post<DocumentDetailDto>(`/v1/docflow/documents/${documentId}/actions/legal-hold`, input),
    onSuccess: () => invalidateArchive(qc, documentId),
  });
}

export function useClearLegalHold(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LegalHoldInput) =>
      api.delete<DocumentDetailDto>(`/v1/docflow/documents/${documentId}/legal-hold`, input),
    onSuccess: () => invalidateArchive(qc, documentId),
  });
}

export function useDispositionBatches(): UseQueryResult<DispositionBatchDto[]> {
  return useQuery({
    queryKey: [...archiveKey, 'batches'],
    queryFn: () => api.get<DispositionBatchDto[]>('/v1/docflow/archive/disposition-batches'),
  });
}

export function useCreateDispositionBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDispositionBatchInput) =>
      api.post<DispositionBatchDto>('/v1/docflow/archive/disposition-batches', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: archiveKey }),
  });
}

export function useDispositionAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      batchId,
      action,
      body,
    }: {
      batchId: string;
      action: 'submit' | 'approve' | 'reject' | 'execute';
      body?: DispositionDecisionInput;
    }) =>
      api.post<DispositionBatchDto>(
        `/v1/docflow/archive/disposition-batches/${batchId}/actions/${action}`,
        body ?? {},
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: archiveKey }),
  });
}

export function useAddDispositionItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, documentIds }: { batchId: string; documentIds: string[] }) =>
      api.post<DispositionBatchDto>(`/v1/docflow/archive/disposition-batches/${batchId}/items`, {
        documentIds,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: archiveKey }),
  });
}
