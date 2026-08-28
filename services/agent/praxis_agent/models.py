"""Request/response models mirroring @praxis/contracts AgentRuntime (prd/13 §4)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class WorkItemRef(BaseModel):
    title: str
    bodyMd: str = ""
    acceptanceCriteria: list[str] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)


class RepoLocator(BaseModel):
    sandboxId: str
    repoPath: str
    baseBranch: str
    baseSha: str


class TriageRequest(BaseModel):
    runId: str
    workItem: WorkItemRef


class TriageResult(BaseModel):
    type: Literal["feature", "bug", "chore", "refactor", "test", "docs"]
    size: Literal["S", "M", "L", "XL"]
    verdict: Literal["ready", "needs_info", "not_suitable"]
    reasoning: str
    questions: list[str] | None = None


class RepoMapRequest(BaseModel):
    runId: str
    repo: RepoLocator


class RepoMapResult(BaseModel):
    tokens: int
    fileCount: int
    symbolCount: int
    embeddedChunks: int


class PlanStepDraft(BaseModel):
    index: int
    title: str
    rationale: str
    files: list[str]
    kind: str
    riskTier: Literal["auto", "notify", "approve"]


class PlanRequest(BaseModel):
    runId: str
    repo: RepoLocator
    workItem: WorkItemRef


class PlanResult(BaseModel):
    version: int
    summaryMd: str
    steps: list[PlanStepDraft]
    testStrategyMd: str
    riskMd: str
    filesEstimate: list[str]


class StepRequest(BaseModel):
    runId: str
    stepId: str
    planStep: PlanStepDraft
    repo: RepoLocator
    operatorMessages: list[str] | None = None
    resumedApproval: dict[str, Any] | None = None


class StepResult(BaseModel):
    kind: Literal["completed", "needs_approval", "failed"]
    filesTouched: list[str] = Field(default_factory=list)
    iterations: int = 1
    category: str | None = None
    message: str | None = None
    approval: dict[str, Any] | None = None


class ReviewRequest(BaseModel):
    runId: str
    repo: RepoLocator
    diffRef: str
    acceptanceCriteria: list[str]


class Finding(BaseModel):
    severity: Literal["info", "low", "medium", "high"]
    message: str
    file: str | None = None
    line: int | None = None


class ReviewResult(BaseModel):
    verdict: Literal["pass", "concerns", "block"]
    findings: list[Finding]
