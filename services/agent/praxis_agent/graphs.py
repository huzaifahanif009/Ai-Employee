"""Stub role implementations. Phase 3 replaces these with real LangGraph graphs
(Triager / Planner / Coder / Reviewer) driven by the Model Router (ADR-0002, ADR-0003)."""
from __future__ import annotations

import re

from .models import (
    Finding,
    PlanRequest,
    PlanResult,
    PlanStepDraft,
    ReviewRequest,
    ReviewResult,
    StepRequest,
    StepResult,
    TriageRequest,
    TriageResult,
)

_SIZE_HINTS = [
    (r"\b(typo|rename|bump|comment|doc)\b", "S"),
    (r"\b(add|fix|update|refactor)\b", "M"),
    (r"\b(migrat|rewrite|redesign|overhaul)\b", "L"),
]


def triage(req: TriageRequest) -> TriageResult:
    text = f"{req.workItem.title}\n{req.workItem.bodyMd}".lower()
    kind = "bug" if re.search(r"\b(bug|fix|broken|error|fail)\b", text) else (
        "docs" if "doc" in text else (
            "test" if "test" in text else (
                "refactor" if "refactor" in text else "feature"
            )
        )
    )
    size = "M"
    for pat, s in _SIZE_HINTS:
        if re.search(pat, text):
            size = s
    ac = req.workItem.acceptanceCriteria
    verdict = "ready" if (ac or len(req.workItem.bodyMd) > 40) else "needs_info"
    questions = None
    if verdict == "needs_info":
        questions = [
            "What is the expected behaviour once fixed?",
            "Are there acceptance criteria or a reproduction case?",
        ]
    return TriageResult(
        type=kind,  # type: ignore[arg-type]
        size=size,  # type: ignore[arg-type]
        verdict=verdict,  # type: ignore[arg-type]
        reasoning=f"Heuristic triage (stub): classified as {kind}/{size}. "
        f"{'Has acceptance criteria.' if ac else 'Body length used as readiness proxy.'}",
        questions=questions,
    )


def plan(req: PlanRequest) -> PlanResult:
    files = req.workItem.acceptanceCriteria and ["src/target.ts"] or ["src/target.ts"]
    steps = [
        PlanStepDraft(
            index=1,
            title="Locate the code paths referenced by the ticket",
            rationale="Orient in the repo before editing (context engineering, prd/06 §4).",
            files=files,
            kind="investigate",
            riskTier="auto",
        ),
        PlanStepDraft(
            index=2,
            title="Implement the change",
            rationale="Smallest edit that satisfies the acceptance criteria.",
            files=files,
            kind="edit",
            riskTier="notify",
        ),
        PlanStepDraft(
            index=3,
            title="Add/adjust tests and run the suite",
            rationale="Every change ships with a test (prd/02 FR-VERIFY).",
            files=["src/target.spec.ts"],
            kind="test",
            riskTier="auto",
        ),
    ]
    return PlanResult(
        version=1,
        summaryMd=f"Stub plan for: {req.workItem.title}",
        steps=steps,
        testStrategyMd="Run unit tests for the touched module; add a regression test.",
        riskMd="Low–medium. No infra or CI changes.",
        filesEstimate=sorted({f for s in steps for f in s.files}),
    )


def execute_step(req: StepRequest) -> StepResult:
    # Stub: pretend the step succeeded and touched its planned files.
    return StepResult(
        kind="completed",
        filesTouched=req.planStep.files,
        iterations=1,
    )


def review(req: ReviewRequest) -> ReviewResult:
    return ReviewResult(
        verdict="pass",
        findings=[
            Finding(
                severity="info",
                message="Stub reviewer: no static analysis performed. "
                f"{len(req.acceptanceCriteria)} acceptance criteria on file.",
            )
        ],
    )
