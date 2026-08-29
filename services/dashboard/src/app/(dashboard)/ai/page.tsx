"use client";

import { KeyRound, Loader2, Plus, RefreshCw, Sparkles, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { authErrorMessage } from "@/lib/auth";
import {
  useAddKey,
  useAiProviders,
  useCreateModel,
  useCreateProvider,
  useDeleteKey,
  useDeleteModel,
  useDeleteProvider,
  useDiscoverModels,
  useProviderKinds,
  useSeedModels,
  useTestKey,
  useUpdateKey,
  useUpdateModel,
  useUpdateProvider,
} from "@/lib/hooks";
import type { AiProvider } from "@/lib/types";

const STATUS_VARIANT = { valid: "ok", invalid: "err", error: "err", untested: "muted" } as const;
const ROUTING = ["fast", "balanced", "strong", "code", "long-context"] as const;

export default function AiProvidersPage() {
  const { data: providers, isLoading } = useAiProviders();
  const [open, setOpen] = useState(false);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          Providers, API keys and models are stored server-side, encrypted at rest. Keys are shown
          masked and never returned by the API.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Add provider
            </Button>
          </DialogTrigger>
          <DialogContent title="Add an AI provider">
            <AddProviderForm onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && <Skeleton className="h-40 w-full" />}
      {!isLoading && (providers?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted">
            No providers yet. Add OpenAI, Anthropic, Google, or any OpenAI-compatible endpoint.
          </CardContent>
        </Card>
      )}
      {providers?.map((p) => (
        <ProviderCard key={p.id} provider={p} />
      ))}
    </div>
  );
}

function ProviderCard({ provider: p }: { provider: AiProvider }) {
  const upd = useUpdateProvider();
  const del = useDeleteProvider();
  const seed = useSeedModels();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{p.name}</CardTitle>
          <Badge variant="muted">{p.kind}</Badge>
          {p.isDefault && <Badge variant="accent">default</Badge>}
          {!p.enabled && <Badge variant="err">disabled</Badge>}
        </div>
        <div className="flex gap-1">
          {!p.isDefault && (
            <Button variant="ghost" size="sm" onClick={() => upd.mutate({ id: p.id, patch: { isDefault: true } })}>
              <Star className="h-3.5 w-3.5" />
              default
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => upd.mutate({ id: p.id, patch: { enabled: !p.enabled } })}
          >
            {p.enabled ? "disable" : "enable"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              confirm(`Delete provider "${p.name}" and all its keys + models?`) &&
              del.mutateAsync(p.id).then(() => toast.success("Deleted")).catch((e) => toast.error(authErrorMessage(e)))
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {p.baseUrl && <p className="font-mono text-xs text-muted">{p.baseUrl}</p>}

        {/* keys */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <KeyRound className="h-3.5 w-3.5" /> API keys
          </div>
          <div className="space-y-1">
            {p.keys.map((k) => (
              <KeyRow key={k.id} k={k} />
            ))}
            {p.keys.length === 0 && <p className="text-xs text-muted">No keys — add one to use this provider.</p>}
          </div>
          <AddKeyForm providerId={p.id} />
        </div>

        {/* models */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              <Sparkles className="h-3.5 w-3.5" /> Models
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={seed.isPending}
              onClick={() => seed.mutateAsync(p.id).then(() => toast.success("Seeded defaults")).catch((e) => toast.error(authErrorMessage(e)))}
            >
              seed defaults
            </Button>
          </div>
          <div className="space-y-1">
            {p.models.map((m) => (
              <ModelRow key={m.id} m={m} />
            ))}
            {p.models.length === 0 && <p className="text-xs text-muted">No models.</p>}
          </div>
          <AddModelForm providerId={p.id} />
        </div>
      </CardContent>
    </Card>
  );
}

function KeyRow({ k }: { k: AiProvider["keys"][number] }) {
  const upd = useUpdateKey();
  const del = useDeleteKey();
  const test = useTestKey();
  return (
    <div className="flex items-center justify-between rounded-md border border-line bg-bg px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">{k.label}</span>
        <span className="font-mono text-muted">{k.last4}</span>
        <Badge variant={STATUS_VARIANT[k.status]}>{k.status}</Badge>
        {k.isDefault && <Badge variant="accent">default</Badge>}
        {k.lastTestDetail && <span className="text-muted/70">{k.lastTestDetail}</span>}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={test.isPending}
          onClick={() => test.mutateAsync(k.id).then((r) => toast.success(`${r.status} — ${r.detail}`)).catch((e) => toast.error(authErrorMessage(e)))}
        >
          {test.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
        {!k.isDefault && (
          <Button variant="ghost" size="sm" onClick={() => upd.mutate({ id: k.id, patch: { isDefault: true } })}>
            <Star className="h-3 w-3" />
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => upd.mutate({ id: k.id, patch: { enabled: !k.enabled } })}>
          {k.enabled ? "off" : "on"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => del.mutate(k.id)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function ModelRow({ m }: { m: AiProvider["models"][number] }) {
  const upd = useUpdateModel();
  const del = useDeleteModel();
  return (
    <div className="flex items-center justify-between rounded-md border border-line bg-bg px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">{m.alias}</span>
        <span className="font-mono text-muted">{m.providerModel}</span>
        <span className="text-muted/70">{m.routingClasses.join(", ") || "—"}</span>
        <span className="text-muted/70">
          ${Number(m.priceInputPerMTok)}/${Number(m.priceOutputPerMTok)} per MTok
        </span>
        {m.isDefault && <Badge variant="accent">default</Badge>}
      </div>
      <div className="flex items-center gap-1">
        {!m.isDefault && (
          <Button variant="ghost" size="sm" onClick={() => upd.mutate({ id: m.id, patch: { isDefault: true } })}>
            <Star className="h-3 w-3" />
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => upd.mutate({ id: m.id, patch: { enabled: !m.enabled } })}>
          {m.enabled ? "off" : "on"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => del.mutate(m.id)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function AddKeyForm({ providerId }: { providerId: string }) {
  const add = useAddKey();
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        add
          .mutateAsync({ providerId, label: label || "default", apiKey })
          .then(() => {
            setLabel("");
            setApiKey("");
            toast.success("Key added — testing…");
          })
          .catch((err) => toast.error(authErrorMessage(err)));
      }}
    >
      <Input className="h-8 w-32 text-xs" placeholder="label" value={label} onChange={(e) => setLabel(e.target.value)} />
      <Input
        className="h-8 flex-1 text-xs"
        type="password"
        placeholder="paste API key (write-only)"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        required
      />
      <Button size="sm" type="submit" disabled={add.isPending}>
        add key
      </Button>
    </form>
  );
}

function AddModelForm({ providerId }: { providerId: string }) {
  const create = useCreateModel();
  const { data: discovered } = useDiscoverModels(providerId);
  const [alias, setAlias] = useState("");
  const [providerModel, setProviderModel] = useState("");
  const [classes, setClasses] = useState<string[]>(["balanced"]);
  const [priceIn, setPriceIn] = useState("");
  const [priceOut, setPriceOut] = useState("");

  return (
    <form
      className="mt-2 space-y-2 rounded-md border border-line bg-bg p-2"
      onSubmit={(e) => {
        e.preventDefault();
        create
          .mutateAsync({
            providerId,
            alias,
            providerModel,
            routingClasses: classes,
            priceInputPerMTok: Number(priceIn) || 0,
            priceOutputPerMTok: Number(priceOut) || 0,
          })
          .then(() => {
            setAlias("");
            setProviderModel("");
            toast.success("Model added");
          })
          .catch((err) => toast.error(authErrorMessage(err)));
      }}
    >
      <div className="flex gap-2">
        <Input className="h-8 w-28 text-xs" placeholder="alias" value={alias} onChange={(e) => setAlias(e.target.value)} required />
        <Input
          className="h-8 flex-1 text-xs"
          placeholder="provider model id (e.g. gpt-4o-mini)"
          list={`models-${providerId}`}
          value={providerModel}
          onChange={(e) => setProviderModel(e.target.value)}
          required
        />
        <datalist id={`models-${providerId}`}>
          {(discovered ?? []).map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ROUTING.map((c) => (
          <label key={c} className="flex items-center gap-1 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={classes.includes(c)}
              onChange={(e) => setClasses((prev) => (e.target.checked ? [...prev, c] : prev.filter((x) => x !== c)))}
            />
            {c}
          </label>
        ))}
        <Input className="h-7 w-20 text-xs" placeholder="$in/M" value={priceIn} onChange={(e) => setPriceIn(e.target.value)} />
        <Input className="h-7 w-20 text-xs" placeholder="$out/M" value={priceOut} onChange={(e) => setPriceOut(e.target.value)} />
        <Button size="sm" type="submit" disabled={create.isPending}>
          add model
        </Button>
      </div>
    </form>
  );
}

function AddProviderForm({ onDone }: { onDone: () => void }) {
  const create = useCreateProvider();
  const { data: kinds } = useProviderKinds();
  const [kind, setKind] = useState("openai");
  const [name, setName] = useState("OpenAI");
  const [baseUrl, setBaseUrl] = useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        create
          .mutateAsync({ kind, name, baseUrl: baseUrl.trim() || undefined })
          .then(() => {
            toast.success("Provider added (default models seeded)");
            onDone();
          })
          .catch((err) => toast.error(authErrorMessage(err)));
      }}
    >
      <div className="space-y-1.5">
        <Label>Kind</Label>
        <div className="flex flex-wrap gap-1 rounded-md bg-panel-2 p-1 text-xs">
          {(kinds ?? ["openai", "anthropic", "google", "openai-compatible", "azure-openai"]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setName(k === "openai" ? "OpenAI" : k === "anthropic" ? "Anthropic" : k === "google" ? "Google" : k);
              }}
              className={`rounded px-2 py-1 ${kind === k ? "bg-panel text-text" : "text-muted"}`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pname">Name</Label>
        <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="burl">Base URL (optional)</Label>
        <Input
          id="burl"
          placeholder={
            kind === "openai-compatible"
              ? "https://your-endpoint/v1"
              : kind === "azure-openai"
                ? "https://<resource>.openai.azure.com"
                : "leave blank for the provider default"
          }
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <p className="text-[11px] text-muted">Add API keys after creating the provider. Default models are seeded automatically.</p>
      <Button type="submit" className="w-full" disabled={create.isPending}>
        {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Add provider
      </Button>
    </form>
  );
}
