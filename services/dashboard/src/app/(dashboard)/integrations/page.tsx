"use client";

import { Copy, GitBranch, KeyRound, Link2, Loader2, Plus, RefreshCw, Trash2, Webhook } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { API_URL } from "@/lib/config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { authErrorMessage } from "@/lib/auth";
import {
  useBindProjectRepo,
  useConnectorRepos,
  useConnectors,
  useCreateConnector,
  useDeleteConnector,
  useProjects,
  useRotateWebhookSecret,
  useTestConnector,
} from "@/lib/hooks";
import type { Connector } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

const STATUS_VARIANT = {
  healthy: "ok",
  degraded: "warn",
  down: "err",
  unconfigured: "muted",
} as const;

export default function IntegrationsPage() {
  const { data: connectors, isLoading } = useConnectors();
  const [open, setOpen] = useState(false);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          Git hosts, trackers and chat — connected per tenant. GitLab (self-hosted or SaaS) is
          wired; GitHub / Bitbucket use the same contract.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Add connector
            </Button>
          </DialogTrigger>
          <DialogContent title="Add a Git connector">
            <AddConnectorForm onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && <Skeleton className="h-28 w-full" />}
      {!isLoading && (connectors?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted">
            No connectors yet. Add one to let runs push branches and open merge requests.
          </CardContent>
        </Card>
      )}
      {connectors?.map((c) => (
        <ConnectorCard key={c.id} connector={c} />
      ))}
    </div>
  );
}

function ConnectorCard({ connector: c }: { connector: Connector }) {
  const test = useTestConnector();
  const del = useDeleteConnector();
  const [showRepos, setShowRepos] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{c.name}</CardTitle>
          <Badge variant="muted">{c.kind}</Badge>
          <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={test.isPending}
            onClick={() =>
              test
                .mutateAsync(c.id)
                .then((r) => toast.success(`${r.status}${r.detail ? ` — ${r.detail}` : ""}`))
                .catch((e) => toast.error(authErrorMessage(e)))
            }
          >
            {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Test
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm(`Delete connector "${c.name}"?`)) {
                del.mutateAsync(c.id).then(() => toast.success("Deleted")).catch((e) => toast.error(authErrorMessage(e)));
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted">Base URL</dt>
          <dd className="font-mono">{c.config.baseUrl ?? "—"}</dd>
          {c.config.projectPath && (
            <>
              <dt className="text-muted">Project</dt>
              <dd className="font-mono">{c.config.projectPath}</dd>
            </>
          )}
          <dt className="text-muted">Token</dt>
          <dd className="font-mono">{c.secretHint ?? "—"}</dd>
          <dt className="text-muted">Health</dt>
          <dd className="text-muted">
            {c.healthDetail ?? "not checked"}{" "}
            {c.lastHealthAt && <span>· {relativeTime(c.lastHealthAt)}</span>}
          </dd>
          <dt className="text-muted">Projects</dt>
          <dd>{c.usedByProjects.length ? c.usedByProjects.map((p) => p.name).join(", ") : "none"}</dd>
        </dl>

        <WebhookPanel connector={c} />

        <button
          className="flex items-center gap-1 text-xs text-accent hover:underline"
          onClick={() => setShowRepos((v) => !v)}
        >
          <GitBranch className="h-3 w-3" />
          {showRepos ? "hide" : "browse"} repositories
        </button>
        {showRepos && <RepoBrowser connectorId={c.id} kind={c.kind} />}
      </CardContent>
    </Card>
  );
}

function WebhookPanel({ connector: c }: { connector: Connector }) {
  const rotate = useRotateWebhookSecret();
  const [revealed, setRevealed] = useState<string | null>(null);
  const deliveryUrl = `${API_URL}/webhooks/in/${c.id}`;
  const isGithub = c.kind === "github";

  const copy = (text: string, label: string) =>
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));

  return (
    <div className="space-y-2 rounded-lg border border-line bg-bg p-2.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-text">
        <Webhook className="h-3.5 w-3.5" />
        Inbound webhook
        {c.webhookSecretHint ? (
          <Badge variant="ok">secret set</Badge>
        ) : (
          <Badge variant="warn">no secret — deliveries rejected</Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-panel-2 px-1.5 py-1 font-mono">{deliveryUrl}</code>
        <Button variant="ghost" size="sm" onClick={() => copy(deliveryUrl, "Payload URL")}>
          <Copy className="h-3 w-3" />
        </Button>
      </div>

      <p className="text-muted">
        In {isGithub ? "GitHub → Settings → Webhooks" : "GitLab → Settings → Webhooks"}: set the payload URL
        above, {isGithub
          ? "content type application/json, and paste the secret below (used as the HMAC-SHA256 key, sent as X-Hub-Signature-256)."
          : "and paste the secret below into the Secret token field (sent as X-Gitlab-Token)."}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="subtle"
          size="sm"
          disabled={rotate.isPending}
          onClick={() =>
            rotate
              .mutateAsync(c.id)
              .then((r) => {
                setRevealed(r.secret);
                toast.success("New webhook secret generated — copy it now, it won't be shown again");
              })
              .catch((e) => toast.error(authErrorMessage(e)))
          }
        >
          {rotate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
          {c.webhookSecretHint ? "Rotate secret" : "Generate secret"}
        </Button>
        {c.webhookSecretHint && !revealed && (
          <span className="font-mono text-muted">current: {c.webhookSecretHint}</span>
        )}
      </div>

      {revealed && (
        <div className="flex items-center gap-2 rounded bg-panel-2 p-1.5">
          <code className="min-w-0 flex-1 truncate font-mono text-text">{revealed}</code>
          <Button variant="ghost" size="sm" onClick={() => copy(revealed, "Secret")}>
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRevealed(null)}>
            hide
          </Button>
        </div>
      )}
    </div>
  );
}

function RepoBrowser({ connectorId, kind }: { connectorId: string; kind: string }) {
  const { data: repos, isLoading, error } = useConnectorRepos(connectorId);
  const { data: projects } = useProjects();
  const bind = useBindProjectRepo();
  const project = projects?.[0];

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (error) return <p className="text-xs text-err">{authErrorMessage(error)}</p>;

  return (
    <ul className="mt-1 space-y-1 rounded-lg border border-line bg-bg p-2">
      {(repos ?? []).slice(0, 15).map((r) => (
        <li key={r.id} className="flex items-center justify-between text-xs">
          <span className="font-mono">
            {r.owner}/{r.name}
            <span className="ml-2 text-muted">{r.visibility}</span>
          </span>
          <Button
            variant="subtle"
            size="sm"
            disabled={!project || bind.isPending}
            onClick={() =>
              bind
                .mutateAsync({
                  projectId: project!.id,
                  vcsConnectorId: connectorId,
                  repoRef: { provider: kind, owner: r.owner, name: r.name, path: `${r.owner}/${r.name}` },
                })
                .then(() => toast.success(`Bound to project "${project!.name}"`))
                .catch((e) => toast.error(authErrorMessage(e)))
            }
          >
            <Link2 className="h-3 w-3" />
            use in {project?.name ?? "project"}
          </Button>
        </li>
      ))}
      {(repos?.length ?? 0) === 0 && <li className="text-xs text-muted">No repositories visible to this token.</li>}
    </ul>
  );
}

const DEFAULT_BASE: Record<string, string> = {
  gitlab: "https://gitlab.edap.com.pk",
  github: "https://api.github.com",
};

function AddConnectorForm({ onDone }: { onDone: () => void }) {
  const create = useCreateConnector();
  const [kind, setKind] = useState<"gitlab" | "github">("gitlab");
  const [name, setName] = useState("EDAP GitLab");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE.gitlab);
  const [projectPath, setProjectPath] = useState("");
  const [token, setToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  function switchKind(k: "gitlab" | "github") {
    setKind(k);
    setBaseUrl(DEFAULT_BASE[k]);
    setName(k === "github" ? "GitHub" : "EDAP GitLab");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const c = await create.mutateAsync({
        kind,
        name,
        config: { baseUrl, projectPath: projectPath.trim() || undefined },
        token: token.trim(),
        webhookSecret: webhookSecret.trim() || undefined,
      });
      toast.success(`Connector added — ${c.status}`);
      onDone();
    } catch (err) {
      toast.error(authErrorMessage(err));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-1 rounded-md bg-panel-2 p-1 text-sm">
        {(["gitlab", "github"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => switchKind(k)}
            className={`flex-1 rounded px-2 py-1.5 capitalize ${kind === k ? "bg-panel text-text" : "text-muted"}`}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="baseUrl">API base URL</Label>
        <Input id="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
        <p className="text-[11px] text-muted">
          {kind === "github"
            ? "https://api.github.com — or https://<ghe-host>/api/v3 for Enterprise"
            : "Your GitLab host, e.g. https://gitlab.com or a self-hosted instance"}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="path">{kind === "github" ? "owner/repo" : "Project path"} (optional)</Label>
        <Input
          id="path"
          placeholder={kind === "github" ? "octocat/hello-world" : "huzaifahanif307/calculator"}
          value={projectPath}
          onChange={(e) => setProjectPath(e.target.value)}
        />
        <p className="text-[11px] text-muted">
          Leave blank to browse and pick a repo after; set it to scope this connector to one repo.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="token">Access token</Label>
        <Input
          id="token"
          type="password"
          placeholder={kind === "github" ? "ghp_… / github_pat_…" : "glpat-…"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        <p className="text-[11px] text-muted">
          {kind === "github" ? (
            <>PAT with <code>repo</code> scope (classic) or contents+PRs+issues (fine-grained).</>
          ) : (
            <>PAT with <code>api</code> + <code>write_repository</code> scope.</>
          )}{" "}
          Stored encrypted at rest.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="whsecret">Webhook secret (optional)</Label>
        <Input
          id="whsecret"
          type="password"
          placeholder="leave blank to generate one after"
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
        />
        <p className="text-[11px] text-muted">
          Verifies inbound webhooks ({kind === "github" ? "X-Hub-Signature-256 HMAC" : "X-Gitlab-Token"}).
          You can also generate/rotate it from the connector card. Stored encrypted at rest.
        </p>
      </div>
      <Button type="submit" className="w-full" disabled={create.isPending}>
        {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Add & test
      </Button>
    </form>
  );
}
