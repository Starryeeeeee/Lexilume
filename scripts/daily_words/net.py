"""HTTP 小工具：统一 UA、超时、按主机限速、指数退避重试。

只用标准库，CI 与本地行为一致，也不引入供应链风险。所有 4xx 都原样返回给
调用方判断（404 在发布环节是有意义的状态），只有传输层失败与连续 5xx 才抛异常。
"""

from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from . import config


class NetworkError(RuntimeError):
    """网络层彻底失败（重试耗尽）。"""


@dataclass
class Response:
    status: int
    body: bytes
    url: str
    headers: dict

    @property
    def text(self) -> str:
        charset = "utf-8"
        ctype = self.headers.get("content-type", "") or ""
        if "charset=" in ctype.lower():
            charset = ctype.lower().split("charset=")[-1].split(";")[0].strip() or "utf-8"
        try:
            return self.body.decode(charset, "replace")
        except LookupError:
            return self.body.decode("utf-8", "replace")

    def json(self):
        return json.loads(self.text)


# 每个主机的上次请求时间，保证 >= REQUEST_INTERVAL 秒
_last_hit: dict[str, float] = {}


def _throttle(url: str) -> None:
    host = urllib.parse.urlsplit(url).netloc.lower()
    last = _last_hit.get(host)
    if last is not None:
        wait = config.REQUEST_INTERVAL - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
    _last_hit[host] = time.monotonic()


def _backoff(attempt: int) -> float:
    # 1s, 3s, 7s + 抖动，避免多实例同时撞车
    return min(30.0, 2 ** attempt - 1) + random.uniform(0, 0.8)


def request(
    url: str,
    *,
    method: str = "GET",
    headers: dict | None = None,
    data: bytes | None = None,
    timeout: int | None = None,
    retries: int | None = None,
) -> Response:
    """发一个请求。传输失败或 5xx 会重试；4xx 直接返回。"""
    retries = config.REQUEST_RETRIES if retries is None else retries
    timeout = config.REQUEST_TIMEOUT if timeout is None else timeout

    base_headers = {
        "User-Agent": config.UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    }
    if headers:
        base_headers.update(headers)

    last_error: Exception | None = None
    for attempt in range(retries):
        _throttle(url)
        req = urllib.request.Request(url, data=data, headers=base_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
                return Response(
                    status=resp.status,
                    body=body,
                    url=resp.geturl(),
                    headers={k.lower(): v for k, v in resp.headers.items()},
                )
        except urllib.error.HTTPError as exc:  # 4xx/5xx 都走这里
            body = b""
            try:
                body = exc.read() or b""
            except Exception:  # pragma: no cover - 极端情况
                pass
            resp = Response(
                status=exc.code,
                body=body,
                url=url,
                headers={k.lower(): v for k, v in (exc.headers or {}).items()},
            )
            # 429/5xx 值得重试，其余 4xx 立刻返回
            if exc.code == 429 or 500 <= exc.code < 600:
                last_error = NetworkError(f"HTTP {exc.code} for {url}")
                if attempt < retries - 1:
                    time.sleep(_backoff(attempt))
                    continue
            return resp
        except Exception as exc:  # 超时、DNS、连接被重置、SSL
            last_error = exc
            if attempt < retries - 1:
                time.sleep(_backoff(attempt))
                continue

    raise NetworkError(f"请求失败（已重试 {retries} 次）：{url} -> {last_error}")


def get(url: str, **kwargs) -> Response:
    return request(url, method="GET", **kwargs)


def github_api(
    method: str,
    path: str,
    *,
    payload: dict | None = None,
    token: str | None = None,
    retries: int = 3,
) -> Response:
    """调 GitHub REST API。path 以 / 开头，例如 /repos/o/r/contents/x。"""
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    tok = token if token is not None else config.GITHUB_TOKEN
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    return request(
        config.GITHUB_API + path,
        method=method,
        headers=headers,
        data=data,
        timeout=30,
        retries=retries,
    )
