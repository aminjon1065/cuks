import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  CorrespondentCategoryDto,
  CorrespondentDto,
  CreateCorrespondentInput,
  CreateJournalInput,
  CreateNomenclatureInput,
  DocumentTypeDto,
  JournalDto,
  NomenclatureDto,
  UpdateCorrespondentInput,
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
