"use client";

import { FolderGit2, Loader2, Plug, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { authErrorMessage } from "@/lib/auth";
import { useConnectors, useProjects, useUpdateProject } from "@/lib/hooks";
import type { Project } from "@/lib/types";

export default function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-muted">
        One project per repository. Binding is done from Integrations; here you tune intake, branch
        and policy.
      </p>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {projects?.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
      {!isLoading && (projects?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted">No projects yet.</CardContent>
        </Card>
      )}
    </div>
  );
}

function ProjectCard({ project: p }: { project: Project }) {
  const update = useUpdateProject();
  const { data: connectors } = useConnectors();
  const [mode, setMode] = useState(p.intake.mode);
  const [labels, setLabels] = useState(p.intake.labelAllowlist.join(", "));
  const [baseBranch, setBaseBranch] = useState(p.baseBranch);
  const [preset, setPreset] = useState(p.policyPreset);

  const vcs = connectors?.find((c) => c.id === p.vcsConnectorId);
  const dirty =
    mode !== p.intake.mode ||
    labels !== p.intake.labelAllowlist.join(", ") ||
    baseBranch !== p.baseBranch ||
    preset !== p.policyPreset;

  async function save() {
    try {
      await update.mutateAsync({
        id: p.id,
        patch: {
          baseBranch,
          policyPreset: preset,
          intake: { mode, labelAllowlist: labels.split(",").map((s) => s.trim()).filter(Boolean) },
        },
      });
      toast.success("Project updated");
    } catch (e) {
      toast.error(authErrorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FolderGit2 className="h-4 w-4 text-muted-2" />
          <CardTitle>{p.name}</CardTitle>
          <Badge variant="muted">{p.slug}</Badge>
        </div>
        {p.repoRef ? (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Plug className="h-3 w-3" />
            {vcs?.name ?? p.repoRef.provider} · {p.repoRef.path ?? `${p.repoRef.owner}/${p.repoRef.name}`}
          </span>
        ) : (
          <Badge variant="warn">no repo bound</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Intake mode">
            <div className="flex gap-1 rounded-md bg-panel-2 p-1 text-xs">
              {(["manual", "auto"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded px-2 py-1 capitalize ${mode === m ? "bg-panel text-text" : "text-muted"}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-2">
              {mode === "auto" ? "matching tracker issues start a run automatically" : "runs are started by an operator"}
            </p>
          </Field>

          <Field label="Base branch">
            <Input value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} className="h-8 text-xs" />
          </Field>

          <Field label="Label allowlist">
            <Input
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder="e.g. ai-ready, automate"
              className="h-8 font-mono text-xs"
            />
            <p className="mt-1 text-[11px] text-muted-2">blank = any issue is eligible for intake</p>
          </Field>

          <Field label="Policy preset">
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as Project["policyPreset"])}
              className="h-8 w-full rounded-md border border-line bg-panel-2 px-2 text-xs"
            >
              <option>Conservative</option>
              <option>Balanced</option>
              <option>Autonomous</option>
            </select>
          </Field>
        </div>

        <div className="flex items-center gap-2 border-t border-line pt-3">
          <Button size="sm" onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save changes
          </Button>
          {dirty && <span className="text-[11px] text-muted-2">unsaved</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-2">{label}</label>
      {children}
    </div>
  );
}
