import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  AcknowledgementSheetDto,
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
  DocumentHistoryEntryDto,
  DocumentLinkDto,
  DocumentQueueCountsDto,
  ExtendResolutionInput,
  ReportResolutionInput,
  ResolutionDto,
  RouteDto,
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
  UpdateCorrespondentInput,
  UpdateDocumentInput,
  UpdateJournalInput,
  UpdateNomenclatureInput,
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

export function useActRouteStep(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      stepId,
      action,
      comment,
    }: {
      stepId: string;
      action: 'approve' | 'reject';
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
