"use client";

import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth";
import { AppQueryProvider } from "@/lib/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AppQueryProvider>
      <AuthProvider>
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--panel)",
              color: "var(--text)",
              border: "1px solid var(--line)",
            },
          }}
        />
      </AuthProvider>
    </AppQueryProvider>
  );
}
