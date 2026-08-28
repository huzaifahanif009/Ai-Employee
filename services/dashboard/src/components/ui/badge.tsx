import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
  {
    variants: {
      variant: {
        default: "border-line bg-panel-2 text-text",
        accent: "border-transparent bg-accent/15 text-accent",
        ok: "border-transparent bg-ok/15 text-ok",
        warn: "border-transparent bg-warn/15 text-warn",
        err: "border-transparent bg-err/15 text-err",
        muted: "border-line bg-transparent text-muted",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
