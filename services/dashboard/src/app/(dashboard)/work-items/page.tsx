"use client";

import { Play, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { WorkItemStateChip } from "@/components/state-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { authErrorMessage } from "@/lib/auth";
import { useCreateWorkItem, useProjects, useStartRun, useWorkItems } from "@/lib/hooks";
import { relativeTime } from "@/lib/utils";

export default function WorkItemsPage() {
  const { data: projects } = useProjects();
  const { data: items, isLoading } = useWorkItems();
  const startRun = useStartRun();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function onStart(workItemId: string) {
    try {
      const run = await startRun.mutateAsync(workItemId);
      toast.success("Run started");
      router.push(`/runs/${run.id}`);
    } catch (err) {
      toast.error(authErrorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              New work item
            </Button>
          </DialogTrigger>
          <DialogContent title="New work item">
            <CreateWorkItemForm
              projectId={projects?.[0]?.id}
              onDone={() => setOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2 font-medium">Title</th>
                <th className="pb-2 font-medium">State</th>
                <th className="pb-2 font-medium">Labels</th>
                <th className="pb-2 font-medium">Created</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-line">
                    <td colSpan={5} className="py-2.5">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              {!isLoading && (items?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-muted">
                    No work items yet.
                  </td>
                </tr>
              )}
              {items?.map((w) => (
                <tr key={w.id} className="border-t border-line">
                  <td className="max-w-md py-2.5">
                    <div className="font-medium">{w.title}</div>
                    {w.acceptanceCriteria.length > 0 && (
                      <div className="text-xs text-muted">
                        {w.acceptanceCriteria.length} acceptance criteria
                      </div>
                    )}
                  </td>
                  <td className="py-2.5">
                    <WorkItemStateChip state={w.state} />
                  </td>
                  <td className="py-2.5 text-xs text-muted">{w.labels.join(", ") || "—"}</td>
                  <td className="py-2.5 text-muted">{relativeTime(w.createdAt)}</td>
                  <td className="py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={startRun.isPending || w.state === "in_progress"}
                      onClick={() => onStart(w.id)}
                    >
                      <Play className="h-3.5 w-3.5" />
                      Start run
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function CreateWorkItemForm({ projectId, onDone }: { projectId?: string; onDone: () => void }) {
  const create = useCreateWorkItem();
  const [title, setTitle] = useState("");
  const [bodyMd, setBodyMd] = useState("");
  const [ac, setAc] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) {
      toast.error("No project available yet.");
      return;
    }
    try {
      await create.mutateAsync({
        projectId,
        title,
        bodyMd,
        acceptanceCriteria: ac.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      toast.success("Work item created");
      setTitle("");
      setBodyMd("");
      setAc("");
      onDone();
    } catch (err) {
      toast.error(authErrorMessage(err));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="body">Description</Label>
        <Textarea id="body" rows={3} value={bodyMd} onChange={(e) => setBodyMd(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ac">Acceptance criteria (one per line)</Label>
        <Textarea id="ac" rows={3} value={ac} onChange={(e) => setAc(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={create.isPending}>
        Create
      </Button>
    </form>
  );
}
