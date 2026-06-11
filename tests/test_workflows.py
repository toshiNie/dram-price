from __future__ import annotations

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
UPDATE_WORKFLOW = ROOT / ".github" / "workflows" / "update-data.yml"
DEPLOY_WORKFLOW = ROOT / ".github" / "workflows" / "deploy-pages.yml"
SKIP_MARKER = "Skip-Pages-Deploy: update-data-workflow"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class WorkflowContractTests(unittest.TestCase):
    def test_update_workflow_has_expected_kst_schedules_and_backfill_branch(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertIn("cron: '20 9 * * *'", workflow)
        self.assertIn("18:20 KST", workflow)
        self.assertIn("cron: '0 21 * * *'", workflow)
        self.assertIn("06:00 KST", workflow)
        self.assertIn('elif [ "$SCHEDULE" = "0 21 * * *" ]; then', workflow)
        self.assertIn("args+=(--require-daily-date yesterday)", workflow)
        self.assertIn("args+=(--require-daily-date today)", workflow)

    def test_update_workflow_has_explicit_completeness_post_check(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertIn("--minimum-daily-spot-rows 2", workflow)
        self.assertIn("Verify requested daily data after collection", workflow)
        self.assertIn('--require-daily-date "${{ steps.freshness.outputs.target_date }}"', workflow)
        self.assertIn("--fail-if-collect-needed", workflow)
        self.assertLess(workflow.index("Verify requested daily data after collection"), workflow.index("Run tests"))
        self.assertLess(workflow.index("Verify requested daily data after collection"), workflow.index("Commit data changes"))

    def test_update_workflow_marks_self_deployed_commits_explicitly(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertIn(SKIP_MARKER, workflow)
        self.assertIn("git config user.email", workflow)

    def test_deploy_workflow_uses_explicit_skip_marker_not_bot_identity(self) -> None:
        workflow = _read(DEPLOY_WORKFLOW)
        self.assertIn(SKIP_MARKER, workflow)
        self.assertIn("github.event.head_commit.message", workflow)
        self.assertNotIn("github-actions[bot]", workflow)
        self.assertNotIn("41898282+github-actions[bot]@users.noreply.github.com", workflow)


if __name__ == "__main__":
    unittest.main()
