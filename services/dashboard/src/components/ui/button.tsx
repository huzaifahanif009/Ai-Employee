"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:opacity-90",
        outline: "border border-line bg-transparent text-text hover:bg-panel-2",
        ghost: "bg-transparent text-text hover:bg-panel-2",
        destructive: "bg-err text-err-fg hover:opacity-90",
        subtle: "bg-panel-2 text-text hover:bg-line",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-2.5 text-xs",
        icon: "h-8 w-8 shrink-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = "Button";
