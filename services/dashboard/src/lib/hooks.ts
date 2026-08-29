"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  AiModel,
  AiProvider,
  AiProviderKey,
  Approval,
  ApprovalDecision,
  Connector,
  ModelCall,
  Page,
  Project,
  RepoRef,
  Run,
  ToolCall,
  WorkItem,
} from "./types";

const keys = {
  projects: ["projects"] as const,
  workItems: (projectId?: string) => ["work-items", projectId ?? "all"] as const,
  runs: (filter?: Record<string, string>) => ["runs", filter ?? {}] as const,
  run: (id: string) => ["runs", id] as const,
  approvals: (state?: string) => ["approvals", state ?? "all"] as const,
};

export function useProjects() {
  return useQuery({ queryKey: keys.projects, queryFn: () => api.get<Project[]>("/projects") });
}

// ---------- connectors ----------

export function useConnectors() {
  return useQuery({
    queryKey: ["connectors"],
    queryFn: () => api.get<Connector[]>("/connectors"),
    refetchInterval: 15000,
  });
}

export function useCreateConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      kind: string;
      name: string;
      config: { baseUrl: string; projectPath?: string };
      token: string;
      webhookSecret?: string;
    }) => api.post<Connector>("/connectors", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });
}

export function useRotateWebhookSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ secret: string; hint: string; family: string | null; header: string }>(
        `/connectors/${id}/webhook-secret`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });
}

export function useTestConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ status: string; detail: string }>(`/connectors/${id}/test`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });
}

export function useDeleteConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/connectors/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });
}

export function useConnectorRepos(id: string | null) {
  return useQuery({
    queryKey: ["connectors", id, "repos"],
    queryFn: () => api.get<RepoRef[]>(`/connectors/${id}/repos`),
    enabled: !!id,
  });
}

export function useBindProjectRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      projectId: string;
      vcsConnectorId: string;
      repoRef: { provider: string; owner: string; name: string; path: string };
    }) =>
      // a GitLab connector serves both contracts — bind it as VCS *and* tracker
      api.patch<Project>(`/projects/${input.projectId}`, {
        vcsConnectorId: input.vcsConnectorId,
        trackerConnectorId: input.vcsConnectorId,
        repoRef: input.repoRef,
        intake: { mode: "manual", labelAllowlist: [] },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["connectors"] });
      qc.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

export function useSyncIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) =>
      api.post<{ polled: number; created: number; started: number }>(
        `/projects/${projectId}/intake/sync`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-items"] }),
  });
}

export function useWorkItems(projectId?: string) {
  return useQuery({
    queryKey: keys.workItems(projectId),
    queryFn: () =>
      api.get<WorkItem[]>(`/work-items${projectId ? `?projectId=${projectId}` : ""}`),
  });
}

export function useRuns(limit = 50) {
  return useQuery({
    queryKey: keys.runs({ limit: String(limit) }),
    queryFn: () => api.get<Page<Run>>(`/runs?limit=${limit}`),
    refetchInterval: 5000, // self-heals if an SSE event was missed (prd/12 §16 rule 3)
  });
}

export function useRun(id: string | null) {
  return useQuery({
    queryKey: keys.run(id ?? ""),
    queryFn: () => api.get<Run>(`/runs/${id}`),
    enabled: !!id,
    refetchInterval: 4000,
  });
}

export function useRunModelCalls(runId: string | null, live: boolean) {
  return useQuery({
    queryKey: ["runs", runId ?? "", "model-calls"],
    queryFn: () => api.get<ModelCall[]>(`/runs/${runId}/model-calls`),
    enabled: !!runId,
    refetchInterval: live ? 3000 : false,
  });
}

export function useRunToolCalls(runId: string | null, live: boolean) {
  return useQuery({
    queryKey: ["runs", runId ?? "", "tool-calls"],
    queryFn: () => api.get<ToolCall[]>(`/runs/${runId}/tool-calls`),
    enabled: !!runId,
    refetchInterval: live ? 3000 : false,
  });
}

export function useModelCatalog() {
  return useQuery({
    queryKey: ["ai", "models"],
    queryFn: () => api.get<AiModel[]>("/ai/models"),
    staleTime: 30_000,
  });
}

// ---------- AI providers / keys / models ----------

const AI_KEY = ["ai", "providers"] as const;

export function useAiProviders() {
  return useQuery({ queryKey: AI_KEY, queryFn: () => api.get<AiProvider[]>("/ai/providers") });
}
export function useProviderKinds() {
  return useQuery({ queryKey: ["ai", "kinds"], queryFn: () => api.get<string[]>("/ai/provider-kinds"), staleTime: 300_000 });
}

function aiMutation<TArgs, TRes>(fn: (a: TArgs) => Promise<TRes>) {
  return function useAiMut() {
    const qc = useQueryClient();
    return useMutation<TRes, Error, TArgs>({
      mutationFn: fn,
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["ai"] });
      },
    });
  };
}

export const useCreateProvider = aiMutation((i: {
  kind: string;
  name: string;
  baseUrl?: string;
  config?: Record<string, unknown>;
}) => api.post<AiProvider>("/ai/providers", i));

export const useUpdateProvider = aiMutation((i: { id: string; patch: Record<string, unknown> }) =>
  api.patch<AiProvider>(`/ai/providers/${i.id}`, i.patch),
);
export const useDeleteProvider = aiMutation((id: string) => api.del(`/ai/providers/${id}`));
export const useSeedModels = aiMutation((id: string) => api.post(`/ai/providers/${id}/seed-models`));

export const useAddKey = aiMutation((i: {
  providerId: string;
  label: string;
  apiKey: string;
  isDefault?: boolean;
}) => api.post<AiProviderKey>(`/ai/providers/${i.providerId}/keys`, i));
export const useUpdateKey = aiMutation((i: { id: string; patch: Record<string, unknown> }) =>
  api.patch<AiProviderKey>(`/ai/keys/${i.id}`, i.patch),
);
export const useDeleteKey = aiMutation((id: string) => api.del(`/ai/keys/${id}`));
export const useTestKey = aiMutation((id: string) =>
  api.post<{ status: string; detail: string }>(`/ai/keys/${id}/test`),
);

export const useCreateModel = aiMutation((i: Record<string, unknown>) => api.post<AiModel>("/ai/models", i));
export const useUpdateModel = aiMutation((i: { id: string; patch: Record<string, unknown> }) =>
  api.patch<AiModel>(`/ai/models/${i.id}`, i.patch),
);
export const useDeleteModel = aiMutation((id: string) => api.del(`/ai/models/${id}`));

export function useDiscoverModels(providerId: string | null) {
  return useQuery({
    queryKey: ["ai", "discover", providerId],
    queryFn: () => api.get<string[]>(`/ai/providers/${providerId}/discover-models`),
    enabled: !!providerId,
  });
}

export function useApprovals(state = "open") {
  return useQuery({
    queryKey: keys.approvals(state),
    queryFn: () => api.get<Approval[]>(`/approvals?state=${state}`),
    refetchInterval: 5000,
  });
}

export function useInvalidateRuns() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["runs"] });
}

export function useInvalidateApprovals() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["approvals"] });
}

export function useCreateWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      projectId: string;
      title: string;
      bodyMd?: string;
      acceptanceCriteria?: string[];
    }) => api.post<WorkItem>("/work-items", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-items"] }),
  });
}

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workItemId: string) =>
      api.post<Run>(
        "/runs",
        { workItemId },
        { idempotencyKey: crypto.randomUUID() },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; decision: ApprovalDecision; note?: string }) =>
      api.post<Approval>(`/approvals/${input.id}/decision`, {
        decision: input.decision,
        note: input.note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
}
