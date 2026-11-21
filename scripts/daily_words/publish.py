"""把生成好的词表发布到仓库 data/daily/。

用 Contents API 单文件提交，而不是 git commit/push：网站自己每二十多秒就会
往 progress.json 推一次提交，本地 git push 极易撞车；API 提交天然基于最新
HEAD，不存在 rebase 冲突。

幂等：文件已存在则直接跳过（除非 --force）。若并发两次同时写，第二次会拿到
422/409，重取 sha 后按 force 处理或判定「已存在」返回成功。
"""

from __future__ import annotations

import base64
import json
import urllib.parse

from . import config, net


class PublishError(RuntimeError):
    pass


def repo_parts(repo: str | None = None) -> tuple[str, str]:
    full = (repo or config.GITHUB_REPOSITORY or "").strip()
    if "/" not in full:
        raise PublishError("没有拿到仓库名（GITHUB_REPOSITORY 为空）")
    owner, name = full.split("/", 1)
    return owner.strip(), name.strip()


def _contents_path(path: str, branch: str) -> str:
    owner, name = repo_parts()
    return (
        f"/repos/{owner}/{name}/contents/{urllib.parse.quote(path)}"
        f"?ref={urllib.parse.quote(branch)}"
    )


def get_file_sha(path: str, branch: str | None = None, token: str | None = None) -> str | None:
    branch = branch or config.GITHUB_BRANCH
    resp = net.github_api("GET", _contents_path(path, branch), token=token)
    if resp.status == 404:
        return None
    if resp.status != 200:
        raise PublishError(f"查询 {path} 失败：HTTP {resp.status} {resp.text[:200]}")
    try:
        return (resp.json() or {}).get("sha")
    except json.JSONDecodeError as exc:
        raise PublishError(f"查询 {path} 返回非 JSON：{exc}") from exc


def put_file(
    path: str,
    content: bytes,
    message: str,
    *,
    branch: str | None = None,
    token: str | None = None,
    force: bool = False,
) -> dict:
    """写入一个文件。返回 {status: created|updated|exists, commit, sha}。"""
    branch = branch or config.GITHUB_BRANCH
    payload = {
        "message": message,
        "content": base64.b64encode(content).decode("ascii"),
        "branch": branch,
    }

    sha = get_file_sha(path, branch, token)
    if sha:
        if not force:
            return {"status": "exists", "sha": sha}
        payload["sha"] = sha

    last: net.Response | None = None
    for attempt in range(3):
        resp = net.github_api("PUT", _contents_path(path, branch), payload=payload, token=token)
        last = resp
        if resp.status in (200, 201):
            data = resp.json()
            return {
                "status": "updated" if sha else "created",
                "commit": (data.get("commit") or {}).get("sha", ""),
                "sha": (data.get("content") or {}).get("sha", ""),
            }
        if resp.status in (409, 422) and attempt < 2:
            # 并发写入或 sha 过期：重取 sha 再来
            fresh = get_file_sha(path, branch, token)
            if fresh:
                if not force:
                    return {"status": "exists", "sha": fresh}
                payload["sha"] = fresh
            else:
                payload.pop("sha", None)
            continue
        break

    detail = last.text[:300] if last is not None else "未知错误"
    raise PublishError(f"写入 {path} 失败：HTTP {getattr(last, 'status', '?')} {detail}")


# ------------------------------------------------------------------ 失败告警


def _ensure_label(token: str | None) -> None:
    owner, name = repo_parts()
    resp = net.github_api(
        "POST",
        f"/repos/{owner}/{name}/labels",
        payload={"name": "daily-words", "color": "B60205", "description": "每日时文词生成异常"},
        token=token,
    )
    # 已存在会返回 422，属正常
    _ = resp


def open_failure_issue(title: str, body: str, token: str | None = None) -> str:
    """失败时开一个 issue；已存在同名未关闭 issue 就追加评论。返回结果描述。"""
    owner, name = repo_parts()
    try:
        _ensure_label(token)
        resp = net.github_api(
            "GET",
            f"/repos/{owner}/{name}/issues?state=open&labels=daily-words&per_page=50",
            token=token,
        )
        existing = None
        if resp.status == 200:
            for issue in resp.json() or []:
                if (issue.get("title") or "").strip() == title:
                    existing = issue
                    break
        if existing:
            net.github_api(
                "POST",
                f"/repos/{owner}/{name}/issues/{existing['number']}/comments",
                payload={"body": body},
                token=token,
            )
            return f"已在 issue #{existing['number']} 追加说明"
        resp = net.github_api(
            "POST",
            f"/repos/{owner}/{name}/issues",
            payload={"title": title, "body": body, "labels": ["daily-words"]},
            token=token,
        )
        if resp.status in (200, 201):
            return f"已创建 issue #{resp.json().get('number')}"
        return f"创建 issue 失败：HTTP {resp.status}"
    except (PublishError, net.NetworkError, json.JSONDecodeError) as exc:
        return f"创建 issue 失败：{exc}"
