from praxis_agent.graphs import plan, triage
from praxis_agent.models import PlanRequest, RepoLocator, TriageRequest, WorkItemRef


def _repo() -> RepoLocator:
    return RepoLocator(sandboxId="sbx", repoPath="/w/repo", baseBranch="main", baseSha="abc123")


def test_triage_marks_needs_info_when_underspecified():
    r = triage(TriageRequest(runId="r1", workItem=WorkItemRef(title="fix thing")))
    assert r.verdict == "needs_info"
    assert r.questions


def test_triage_ready_with_acceptance_criteria():
    r = triage(
        TriageRequest(
            runId="r1",
            workItem=WorkItemRef(
                title="Add retry to notifications",
                bodyMd="wrap send() with backoff",
                acceptanceCriteria=["retries 3x", "configurable"],
            ),
        )
    )
    assert r.verdict == "ready"
    assert r.type in {"feature", "bug"}


def test_plan_returns_ordered_steps():
    p = plan(
        PlanRequest(
            runId="r1",
            repo=_repo(),
            workItem=WorkItemRef(title="do X", bodyMd="details", acceptanceCriteria=["y"]),
        )
    )
    assert [s.index for s in p.steps] == [1, 2, 3]
    assert p.filesEstimate
