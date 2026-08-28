import { Global, Module } from "@nestjs/common";
import { PraxisError } from "@praxis/contracts";
import type { SandboxProvider } from "@praxis/contracts";
import { AppConfig, CONFIG } from "../config/config";
import { DockerSandboxProvider } from "./docker-sandbox.provider";

export const SANDBOX_PROVIDER = Symbol("SANDBOX_PROVIDER");

class NoneSandboxProvider implements Partial<SandboxProvider> {
  readonly backend = "docker" as const;
  acquire(): never {
    throw new PraxisError("SANDBOX_ERROR", "SANDBOX_BACKEND=none — no sandbox available", 503);
  }
  async healthCheck() {
    return { status: "down" as const, checkedAt: new Date().toISOString(), detail: "backend=none" };
  }
  async poolStats() {
    return { total: 0, warm: 0, leased: 0, failed: 0 };
  }
}

@Global()
@Module({
  providers: [
    {
      provide: SANDBOX_PROVIDER,
      inject: [CONFIG],
      useFactory: (cfg: AppConfig): SandboxProvider => {
        if (cfg.sandboxBackend === "docker") {
          return new DockerSandboxProvider(
            cfg.sandboxImage,
            cfg.sandboxDockerNetwork,
            cfg.sandboxWorkdir,
          );
        }
        return new NoneSandboxProvider() as unknown as SandboxProvider;
      },
    },
  ],
  exports: [SANDBOX_PROVIDER],
})
export class SandboxModule {}
