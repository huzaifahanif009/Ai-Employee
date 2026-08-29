import * as React from "react";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  glass?: boolean;
  glow?: boolean;
}

export function Card({ className, interactive, glass, glow, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "relative rounded-[var(--radius)] border border-line shadow-[var(--shadow)]",
        glass ? "surface-glass" : "bg-panel",
        interactive && "hover-lift cursor-pointer",
        glow && "ring-accent",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-between gap-3 px-4 pt-4 pb-2", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold tracking-tight", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4", className)} {...props} />;
}
