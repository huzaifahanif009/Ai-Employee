"""Praxis agent runtime — HTTP surface (Phase 1 skeleton).

gRPC (prd/13 §4) replaces this in Phase 2; the method set is identical so the
orchestrator's client swap is mechanical.
"""
from __future__ import annotations

import os

import structlog
from fastapi import FastAPI

from . import __version__, graphs
from .models import (
    PlanRequest,
    PlanResult,
    RepoMapRequest,
    RepoMapResult,
    ReviewRequest,
    ReviewResult,
    StepRequest,
    StepResult,
    TriageRequest,
    TriageResult,
)

log = structlog.get_logger()
app = FastAPI(title="Praxis Agent Runtime", version=__version__)

MODEL_ROUTER_URL = os.environ.get("LITELLM_BASE_URL", "http://localhost:4000")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "agent", "version": __version__}


@app.get("/readyz")
def readyz() -> dict[str, object]:
    # Phase 1: no hard deps. Phase 3 checks the Model Router.
    return {"status": "ok", "checks": {"modelRouter": "unchecked"}}


@app.post("/v1/triage", response_model=TriageResult)
def triage(req: TriageRequest) -> TriageResult:
    log.info("triage", run_id=req.runId)
    return graphs.triage(req)


@app.post("/v1/repo-map", response_model=RepoMapResult)
def repo_map(req: RepoMapRequest) -> RepoMapResult:
    log.info("repo_map", run_id=req.runId, sandbox=req.repo.sandboxId)
    # Stub numbers until tree-sitter indexing lands (Phase 3, P3-AGENT-2).
    return RepoMapResult(tokens=4200, fileCount=128, symbolCount=430, embeddedChunks=0)


@app.post("/v1/plan", response_model=PlanResult)
def plan(req: PlanRequest) -> PlanResult:
    log.info("plan", run_id=req.runId)
    return graphs.plan(req)


@app.post("/v1/execute-step", response_model=StepResult)
def execute_step(req: StepRequest) -> StepResult:
    log.info("execute_step", run_id=req.runId, step_id=req.stepId)
    return graphs.execute_step(req)


@app.post("/v1/review", response_model=ReviewResult)
def review(req: ReviewRequest) -> ReviewResult:
    log.info("review", run_id=req.runId)
    return graphs.review(req)


def main() -> None:
    import uvicorn

    port = int(os.environ.get("AGENT_HTTP_PORT", "8081"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
