import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  ChangeDocumentStatusInput,
  CorrespondentCategoryDto,
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
  return `/v1/docflow/documents?${params}`;
}

export function useDocuments(
  query: ListDocumentsQuery,
): UseQueryResult<PaginatedResult<DocumentListItemDto>> {
  return useQuery({
    queryKey: [...documentsKey, 'list', query],
    queryFn: () => api.get<PaginatedResult<DocumentListItemDto>>(documentsPath(query)),
  });
}

export function useDocument(id: string | null): UseQueryResult<DocumentDetailDto> {
  return useQuery({
    queryKey: [...documentsKey, id],
    queryFn: () => api.get<DocumentDetailDto>(`/v1/docflow/documents/${id}`),
    enabled: !!id,
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
