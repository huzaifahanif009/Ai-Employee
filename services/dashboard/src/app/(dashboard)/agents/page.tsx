"use client";

import { Bot, Code2, ShieldCheck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashSystem, useModelCatalog, useProjects, useToolCatalog } from "@/lib/hooks";

/* Read-only overview of how the agent is wired and what policy governs it.
   Models are managed on AI Providers; gate flags are env config; per-project
   policy lives on Projects — this page just shows the resolved picture. */

const ROLES = [
  { role: "Planner", routing: "fast", purpose: "turns the work item + repo into an ordered plan", icon: Bot },
  { role: "Coder", routing: "code", purpose: "writes the file contents for each step", icon: Code2 },
  { role: "Reviewer", routing: "fast", purpose: "judges the staged diff against acceptance criteria", icon: ShieldCheck },
];

const RISK_TONE: Record<string, "ok" | "warn" | "err" | "muted"> = {
  auto: "ok",
  notify: "warn",
  approve: "err",
  forbidden: "err",
};

export default function AgentsPage() {
  const { data: models } = useModelCatalog();
  const { data: tools } = useToolCatalog();
  const { data: sys } = useDashSystem();
  const { data: projects } = useProjects();

  const resolve = (routing: string) => {
    const inClass = (models ?? []).filter((m) => m.routingClasses?.includes(routing) && m.enabled);
    const pick = inClass.find((m) => m.isDefault) ?? inClass[0] ?? (models ?? []).find((m) => m.isDefault);
    return pick ? `${pick.alias} → ${pick.providerModel}` : "stub (no model configured)";
  };

  const gates = sys
    ? [
        ["Plan approval", sys.config.requirePlanApproval],
        ["Delivery approval", sys.config.requireDeliveryApproval],
        ["Webhook signature required", sys.config.webhookRequireSignature],
        ["Iterative agent loop", sys.config.agentLoop],
      ]
    : [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        How the agent is composed and the policy that constrains it. Models are set on{" "}
        <span className="text-text">AI Providers</span>, per-project policy on{" "}
        <span className="text-text">Projects</span>.
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Agent roles</CardTitle>
            <span className="text-xs text-muted-2">role → routing class → resolved model</span>
          </CardHeader>
          <CardContent className="space-y-2">
            {!models && <Skeleton className="h-32 w-full" />}
            {models &&
              ROLES.map((r) => {
                const Icon = r.icon;
                return (
                  <div key={r.role} className="rounded-[10px] border border-line bg-panel-2/40 p-3">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-accent" />
                      <span className="text-sm font-medium">{r.role}</span>
                      <Badge variant="muted">{r.routing}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted">{r.purpose}</p>
                    <p className="mt-1 font-mono text-[11px] text-accent">{resolve(r.routing)}</p>
                  </div>
                );
              })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approval gates</CardTitle>
            <ShieldCheck className="h-4 w-4 text-ok" />
          </CardHeader>
          <CardContent className="space-y-2">
            {gates.map(([label, on]) => (
              <div key={String(label)} className="flex items-center justify-between text-sm">
                <span className="text-muted">{label}</span>
                <Badge variant={on ? "ok" : "muted"}>{on ? "on" : "off"}</Badge>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-muted-2">
              Gate flags are process configuration. A plan gate is also always editable by the reviewer.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5 text-muted-2" /> Tool policy
          </CardTitle>
          <span className="text-xs text-muted-2">{tools?.length ?? 0} native tools</span>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-2">
                <th className="pb-2 font-medium">Tool</th>
                <th className="pb-2 font-medium">Execution</th>
                <th className="pb-2 font-medium">Risk tier</th>
                <th className="pb-2 font-medium">Idempotent</th>
                <th className="pb-2 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {(tools ?? []).map((t) => (
                <tr key={t.name} className="border-t border-line">
                  <td className="py-2 font-mono text-xs">{t.name}</td>
                  <td className="py-2 text-xs text-muted">{t.execution}</td>
                  <td className="py-2">
                    <Badge variant={RISK_TONE[t.riskTier] ?? "muted"}>{t.riskTier}</Badge>
                  </td>
                  <td className="py-2 text-xs text-muted">{t.idempotent ? "yes" : "no"}</td>
                  <td className="py-2 text-xs text-muted">{t.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-project policy</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-2">
                <th className="pb-2 font-medium">Project</th>
                <th className="pb-2 font-medium">Policy preset</th>
                <th className="pb-2 font-medium">Intake</th>
                <th className="pb-2 font-medium">Base branch</th>
              </tr>
            </thead>
            <tbody>
              {(projects ?? []).map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-2">{p.name}</td>
                  <td className="py-2">
                    <Badge variant="muted">{p.policyPreset}</Badge>
                  </td>
                  <td className="py-2 text-xs capitalize text-muted">{p.intake.mode}</td>
                  <td className="py-2 font-mono text-xs text-muted">{p.baseBranch}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
