"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  Approval,
  ApprovalDecision,
  ModelCall,
  ModelCatalogEntry,
  Page,
  Project,
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
    queryKey: ["model-catalog"],
    queryFn: () => api.get<ModelCatalogEntry[]>("/model/catalog"),
    staleTime: 60_000,
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

export function useRunControl(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { op: "pause" | "resume" | "cancel" | "comment"; body?: object }) =>
      api.post(`/runs/${runId}/${input.op}`, input.body ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.run(runId) });
      qc.invalidateQueries({ queryKey: ["runs"] });
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
