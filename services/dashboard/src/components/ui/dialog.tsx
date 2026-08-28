"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  children,
  title,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-panel p-5 shadow-[var(--shadow)]",
          className,
        )}
        {...props}
      >
        <div className="mb-3 flex items-center justify-between">
          <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="rounded-md p-1 text-muted hover:bg-panel-2 hover:text-text">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
