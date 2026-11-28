"""发布环节测试：幂等、并发冲突重试、失败不误报成功。全部 mock，不碰真仓库。"""

import base64
import unittest
from unittest import mock

from scripts.daily_words import publish


class FakeResponse:
    def __init__(self, status, payload=None, text=""):
        self.status = status
        self._payload = payload
        self.text = text or (str(payload) if payload is not None else "")

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class PublishTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(publish.config, "GITHUB_REPOSITORY", "o/r")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_get_sha_404(self):
        with mock.patch.object(publish.net, "github_api", return_value=FakeResponse(404)):
            self.assertIsNone(publish.get_file_sha("data/daily/x.json"))

    def test_get_sha_ok(self):
        with mock.patch.object(publish.net, "github_api", return_value=FakeResponse(200, {"sha": "abc"})):
            self.assertEqual(publish.get_file_sha("data/daily/x.json"), "abc")

    def test_put_skips_when_exists(self):
        calls = []

        def fake(method, path, payload=None, token=None, retries=3):
            calls.append((method, payload))
            if method == "GET":
                return FakeResponse(200, {"sha": "abc"})
            return FakeResponse(201, {"commit": {"sha": "c1"}})

        with mock.patch.object(publish.net, "github_api", side_effect=fake):
            result = publish.put_file("data/daily/x.json", b"{}", "msg")
        self.assertEqual(result["status"], "exists")
        self.assertFalse(any(m == "PUT" for m, _ in calls))

    def test_put_creates_when_absent(self):
        captured = {}

        def fake(method, path, payload=None, token=None, retries=3):
            if method == "GET":
                return FakeResponse(404)
            captured.update(payload)
            return FakeResponse(201, {"commit": {"sha": "c1"}, "content": {"sha": "s2"}})

        with mock.patch.object(publish.net, "github_api", side_effect=fake):
            result = publish.put_file("data/daily/x.json", b'{"a":1}', "daily: x")
        self.assertEqual(result["status"], "created")
        self.assertEqual(base64.b64decode(captured["content"]), b'{"a":1}')
        self.assertNotIn("sha", captured)

    def test_put_retries_on_conflict(self):
        seq = [FakeResponse(409), FakeResponse(201, {"commit": {"sha": "c9"}})]
        state = {"n": 0}

        def fake(method, path, payload=None, token=None, retries=3):
            if method == "GET":
                return FakeResponse(404)
            state["n"] += 1
            return seq[min(state["n"] - 1, 1)]

        with mock.patch.object(publish.net, "github_api", side_effect=fake):
            result = publish.put_file("data/daily/x.json", b"{}", "msg")
        self.assertEqual(result["status"], "created")
        self.assertEqual(state["n"], 2)

    def test_put_raises_on_hard_failure(self):
        with mock.patch.object(publish.net, "github_api", return_value=FakeResponse(500, text="boom")):
            with self.assertRaises(publish.PublishError):
                publish.put_file("data/daily/x.json", b"{}", "msg")

    def test_repo_parts(self):
        self.assertEqual(publish.repo_parts("o/r"), ("o", "r"))
        with mock.patch.object(publish.config, "GITHUB_REPOSITORY", ""):
            with self.assertRaises(publish.PublishError):
                publish.repo_parts("")


class FailureIssueTest(unittest.TestCase):
    """失败告警只维护一个滚动 issue：不按日期开新、成功后自动关。"""

    def setUp(self):
        patcher = mock.patch.object(publish.config, "GITHUB_REPOSITORY", "o/r")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.calls = []

    def _fake(self, open_issues):
        def handler(method, path, payload=None, token=None, retries=3):
            self.calls.append((method, path, payload))
            if method == "GET" and "/issues?" in path:
                return FakeResponse(200, open_issues)
            if method == "POST" and path.endswith("/labels"):
                return FakeResponse(201, {})
            if method == "POST" and path.endswith("/issues"):
                return FakeResponse(201, {"number": 42})
            return FakeResponse(201, {})
        return handler

    def test_creates_single_issue_with_fixed_title(self):
        with mock.patch.object(publish.net, "github_api", side_effect=self._fake([])):
            msg = publish.report_failure("2026-11-28", "日志")
        self.assertIn("42", msg)
        created = [c for c in self.calls if c[0] == "POST" and c[1].endswith("/issues")]
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0][2]["title"], publish.FAILURE_TITLE)
        self.assertNotIn("2026-11-28", created[0][2]["title"])

    def test_appends_comment_when_issue_open(self):
        issue = {"number": 7, "title": publish.FAILURE_TITLE}
        with mock.patch.object(publish.net, "github_api", side_effect=self._fake([issue])):
            msg = publish.report_failure("2026-11-29", "日志")
        self.assertIn("#7", msg)
        self.assertFalse([c for c in self.calls if c[0] == "POST" and c[1].endswith("/issues")])
        comments = [c for c in self.calls if c[1].endswith("/issues/7/comments")]
        self.assertEqual(len(comments), 1)

    def test_recovery_closes_issue(self):
        issue = {"number": 7, "title": publish.FAILURE_TITLE}
        with mock.patch.object(publish.net, "github_api", side_effect=self._fake([issue])):
            msg = publish.report_recovery("2026-11-29", 12)
        self.assertIn("#7", msg)
        patch_calls = [c for c in self.calls if c[0] == "PATCH"]
        self.assertEqual(len(patch_calls), 1)
        self.assertEqual(patch_calls[0][2]["state"], "closed")

    def test_recovery_noop_without_issue(self):
        with mock.patch.object(publish.net, "github_api", side_effect=self._fake([])):
            msg = publish.report_recovery("2026-11-29", 12)
        self.assertEqual(msg, "")
        self.assertFalse([c for c in self.calls if c[0] == "PATCH"])


if __name__ == "__main__":
    unittest.main()
