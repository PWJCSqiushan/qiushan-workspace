#!/usr/bin/env python3
"""Read-only Garmin China sleep sync. Secrets and pending receipts remain local."""
from __future__ import annotations
import argparse
import datetime as dt
import importlib
import json
import logging
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import contextlib

logging.disable(logging.CRITICAL)
TZ = dt.timezone(dt.timedelta(hours=8))
_INSTALLED = Path(__file__).resolve().parent
ROOT = (Path(os.environ["QIUSHAN_GARMIN_ROOT"]) if os.environ.get("QIUSHAN_GARMIN_ROOT") else
        _INSTALLED if _INSTALLED.name == "garmin-cn" else
        Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "QiushanWorkspace" / "garmin-cn")

def now():
    return dt.datetime.now(dt.timezone.utc)

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".pending")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)

def load(path, default):
    return json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else default

def timestamp(value):
    try:
        if value is None or value == "":
            return None
        if isinstance(value, (float, int)):
            return dt.datetime.fromtimestamp(value / (1000 if value > 1e11 else 1), dt.timezone.utc)
        result = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00").replace(" ", "T"))
        return result if result.tzinfo else result.replace(tzinfo=dt.timezone.utc)
    except (ValueError, OverflowError, OSError):
        return None

def iso(value):
    return value.astimezone(TZ).isoformat(timespec="seconds")

def extract_sleep(payload, day):
    """Only dailySleepDTO + sleepLevels, never recursively treat other metrics as sleep.
    Numeric mapping follows abrander/garmin-connect SleepState.go, additionally
    verified against all four device aggregate totals before it is trusted.
    """
    dto = payload.get("dailySleepDTO") or {}
    first = timestamp(dto.get("sleepStartTimestampGMT"))
    last = timestamp(dto.get("sleepEndTimestampGMT"))
    issues = []
    if dto.get("napTimeSeconds", 0):
        issues.append("nap_total_without_window")
    if not first or not last or last <= first or last > now():
        return [], issues + ["missing_or_invalid_sleep_window"]
    levels = []
    totals = {0: 0, 1: 0, 2: 0, 3: 0}
    valid = True
    for stage in payload.get("sleepLevels") or []:
        begin, end = timestamp(stage.get("startGMT")), timestamp(stage.get("endGMT"))
        code = stage.get("activityLevel")
        if not begin or not end or end <= begin or code not in totals:
            valid = False
            continue
        begin, end = max(begin, first), min(end, last)
        if end <= begin:
            continue
        totals[code] += (end - begin).total_seconds()
        levels.append((begin, end, code))
    fields = ["deepSleepSeconds", "lightSleepSeconds", "remSleepSeconds", "awakeSleepSeconds"]
    valid = valid and bool(levels) and all(
        isinstance(dto.get(field), (int, float)) and abs(totals[code] - dto[field]) <= 1
        for code, field in enumerate(fields)
    )
    levels.sort()
    cursor = first
    for begin, end, code in levels:
        if abs((begin - cursor).total_seconds()) > 1:
            valid = False
        cursor = end
    valid = valid and abs((last - cursor).total_seconds()) <= 1
    if valid:
        spans = []
        for begin, end, code in levels:
            if code == 3:
                continue
            if spans and spans[-1][1] == begin:
                spans[-1] = (spans[-1][0], end)
            else:
                spans.append((begin, end))
        estimated = False
    else:
        # Known endpoints, unknown awake positions. Preserve device window as
        # explicitly estimated; never invent placement of aggregate minutes.
        spans = [(first, last)]
        estimated = True
        issues.append("sleep_window_estimate_awake_positions_unverified")
    items = [{
        "kind": "actual", "categoryId": "sleep", "start": iso(begin), "end": iso(end),
        "sourceKey": f"garmin:cn:{day}:sleep:{index}",
        "note": "Garmin 睡眠窗口估计（清醒位置未核实）" if estimated else "Garmin 睡眠（已排除清醒）",
        "estimated": estimated,
    } for index, (begin, end) in enumerate(spans)]
    return items, issues

def login(config):
    token_store = Path(config.get("tokenStore") or ROOT / "tokenstore").expanduser()
    if not token_store.exists():
        raise RuntimeError("reauth_required")
    Garmin = importlib.import_module("garminconnect").Garmin
    client = Garmin(is_cn=True, verify_login=True)
    with auth_lock():
        try:
            # The supported SDK refreshes expiring DI tokens on this path.
            status, _ = client.login(str(token_store))
        except Exception as exc:
            raise RuntimeError(auth_error(exc)) from None
        if status is not None:
            raise RuntimeError("reauth_required")
        try:
            client.client.dump(str(token_store))
        except Exception:
            raise RuntimeError("token_store_unavailable") from None
    return client

def auth_error(exc):
    name = type(exc).__name__
    if "Authentication" in name or isinstance(exc, (FileNotFoundError, json.JSONDecodeError)):
        return "reauth_required"
    if "TooManyRequests" in name:
        return "garmin_rate_limited"
    return "garmin_connection_unavailable"

@contextlib.contextmanager
def auth_lock():
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / "auth.lock").open("a+b") as handle:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            if not handle.read(1):
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise RuntimeError("auth_in_progress") from None
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)

def authenticate(config, username, password, prompt_mfa):
    """Interactive local credentials only; no password is persisted or printed."""
    Garmin = importlib.import_module("garminconnect").Garmin
    token_store = Path(config.get("tokenStore") or ROOT / "tokenstore").expanduser()
    with auth_lock():
        client = Garmin(username=username, password=password, is_cn=True,
                        verify_login=True, prompt_mfa=prompt_mfa)
        try:
            status, _ = client.login()
            if status is not None:
                raise RuntimeError("reauth_required")
        except RuntimeError as exc:
            if str(exc) == "reauth_required":
                raise
            raise RuntimeError(auth_error(exc)) from None
        except Exception as exc:
            raise RuntimeError(auth_error(exc)) from None
        finally:
            client.password = None
        try:
            if not token_store.exists():
                (token_store.parent if token_store.suffix else token_store).mkdir(parents=True, exist_ok=True)
            client.client.dump(str(token_store))
        except Exception:
            raise RuntimeError("token_store_unavailable") from None
    # The runner notices this timestamp and resumes without another credential prompt.
    save(ROOT / "auth-status.json", {"status": "authenticated", "updatedAt": now().isoformat()})
    return client

_heartbeats = {}

def heartbeat(config, state, error_code=None, request_id=None):
    if not config.get("_syncEnabled", False):
        return
    key = (config.get("baseUrl"), config.get("connectionId"))
    previous = _heartbeats.get(key)
    clock = time.monotonic()
    if previous and previous[1:] == (state, error_code, request_id) and clock - previous[0] < 60:
        return
    extra = {"state": state}
    if error_code:
        extra["errorCode"] = error_code if not error_code.startswith('website_http_') else 'unexpected_error'
    if request_id:
        extra["requestId"] = request_id
    try:
        api(config, "heartbeat", extra)
        _heartbeats[key] = (clock, state, error_code, request_id)
    except RuntimeError:
        # A status delivery failure must never discard a pending commit.
        pass

def report_error(config, code):
    state = ("reauth_required" if code == "reauth_required" else
             "garmin_unavailable" if code in ("garmin_connection_unavailable", "garmin_rate_limited") else
             "website_offline" if code == "website_offline" else "error")
    heartbeat(config, state, code)

def read_config(args):
    config = load(Path(args.config), {})
    config["_syncEnabled"] = bool(args.sync)
    if getattr(args, "base_url", None):
        config["baseUrl"] = args.base_url
    return config

def api(config, action, extra=None):
    base = config.get("baseUrl", "").rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
        raise RuntimeError("invalid_target")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise RuntimeError("invalid_target")
    handlers = []
    # Optional local proxy affects only website requests, never Garmin login.
    proxy = config.get("websiteProxy")
    if proxy:
        proxy_url = urllib.parse.urlsplit(proxy)
        if (proxy_url.scheme != "http" or proxy_url.hostname not in ("127.0.0.1", "localhost", "::1")
                or proxy_url.username or proxy_url.password or proxy_url.path not in ("", "/")
                or proxy_url.query or proxy_url.fragment or not proxy_url.port):
            raise RuntimeError("invalid_target")
        handlers.append(urllib.request.ProxyHandler({"https": proxy, "http": proxy}))
    body = {"space": config.get("space", "personal"), "connectionId": config.get("connectionId"), "token": config.get("websiteToken"), **(extra or {})}
    request = urllib.request.Request(base + "/api/time/garmin/" + action,
        data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "User-Agent": "QiushanWorkspace-GarminSync/1.0"}, method="POST")
    # Never forward private token or sleep records across redirects.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    try:
        with urllib.request.build_opener(NoRedirect, *handlers).open(request, timeout=45) as response:
            return json.loads(response.read(200000))
    except urllib.error.HTTPError as exc:
        raise RuntimeError("website_conflict" if exc.code == 409 else
            "website_token_revoked" if exc.code == 401 else f"website_http_{exc.code}") from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError("website_offline") from None

def fetch(config, first, last):
    heartbeat(config, "reading")
    client = login(config)
    items, days = [], []
    for offset in range((last - first).days + 1):
        day = (first + dt.timedelta(days=offset)).isoformat()
        try:
            raw = client.get_sleep_data(day)
        except Exception as exc:
            raise RuntimeError(auth_error(exc)) from None
        heartbeat(config, "reading")
        # Health payload only in user's private local runtime directory.
        save(ROOT / "sleep-days" / (day + ".json"), raw)
        batch, issues = extract_sleep(raw, day)
        items.extend(batch)
        days.append({"day": day, "intervals": len(batch), "estimated": any(x["estimated"] for x in batch), "issues": issues})
        save(ROOT / "sync-status.json", {"status": "fetching", "processedDays": len(days),
             "totalDays": (last-first).days+1, "updatedAt": now().isoformat()})
        time.sleep(0.2)
    preview = {"from": first.isoformat(), "to": last.isoformat(), "items": items, "days": days}
    save(ROOT / "sleep-preview-private.json", preview)
    return preview

def sync_once(args, force=False):
    config = read_config(args)
    state_path = Path(args.state_file)
    state = load(state_path, {})
    if (ROOT / "paused").exists():
        return {"status": "paused"}
    pull = api(config, "pull") if args.sync else {}
    if pull.get("requestId"):
        heartbeat(config, "reading", request_id=pull["requestId"])
    if args.watch and not force and not state.get("pendingCommit") and pull.get("status") != "queued":
        last_run = timestamp(state.get("lastSuccessAt"))
        if last_run and (now() - last_run).total_seconds() < args.watch * 60:
            heartbeat(config, "idle")
            return {"status": "idle", "lastSuccessAt": state.get("lastSuccessAt")}
    pending = state.get("pendingCommit")
    if state.get("conflict") and not args.retry_conflict:
        raise RuntimeError("website_conflict_review_required")
    if pending and args.retry_conflict:
        save(ROOT / ("conflict-archive-" + uuid.uuid4().hex + ".json"), pending)
        pending["operationId"] = "garmin-" + uuid.uuid4().hex
        pending["baseVersion"] = pull["baseVersion"]
        state.pop("conflict", None)
        save(state_path, state)
    if not pending:
        today = dt.datetime.now(TZ).date()
        last = dt.date.fromisoformat(args.history_to) if args.history_to else today
        first = dt.date.fromisoformat(args.history_from) if args.history_from else (
            dt.date.fromisoformat(state["lastSyncedDate"]) - dt.timedelta(days=7)
            if state.get("lastSyncedDate") else today - dt.timedelta(days=29))
        # Large offline gaps are processed in small catch-up windows.
        last = min(last, first + dt.timedelta(days=30)) if state.get("lastSyncedDate") and not args.history_from else last
        if first > last or (last-first).days > 366:
            raise RuntimeError("invalid_date_range")
        preview = fetch(config, first, last)
        if not args.sync:
            return {"status": "local_preview", "from": preview["from"], "to": preview["to"],
                    "days": len(preview["days"]), "items": len(preview["items"]),
                    "estimatedDays": sum(x["estimated"] for x in preview["days"]),
                    "reviewDays": sum(bool(x["issues"]) for x in preview["days"])}
        pending = {"operationId": "garmin-" + uuid.uuid4().hex, "baseVersion": pull["baseVersion"],
                   "requestId": pull.get("requestId"), "items": preview["items"]}
        state.update({"pendingCommit": pending, "pendingThrough": last.isoformat()})
        save(state_path, state)
    try:
        heartbeat(config, "syncing")
        result = api(config, "commit", pending)
    except RuntimeError as exc:
        if str(exc) == "website_conflict":
            state["conflict"] = True
            save(state_path, state)
        raise
    state.update({"lastSyncedDate": state.pop("pendingThrough", state.get("lastSyncedDate")),
                  "lastSuccessAt": now().isoformat(), "lastResult": result})
    state.pop("pendingCommit", None)
    state.pop("conflict", None)
    save(state_path, state)
    heartbeat(config, "idle")
    return {"status": "synced", "through": state["lastSyncedDate"], **result}

def parser():
    p = argparse.ArgumentParser(description="Garmin 中国区只读睡眠同步")
    p.add_argument("--config", default=str(ROOT / "config.json"))
    p.add_argument("--state-file", default=str(ROOT / "state.json"))
    p.add_argument("--base-url", default="", help="覆盖目标站点；不写入配置")
    p.add_argument("--history-from", default="")
    p.add_argument("--history-to", default="")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--sync", action="store_true")
    p.add_argument("--watch", type=int, default=0, metavar="MINUTES")
    p.add_argument("--retry-conflict", action="store_true", help="已核对冲突后显式更新版本再提交；仍不覆盖人工记录")
    return p

def main():
    args = parser().parse_args()
    if args.sync == args.dry_run:
        raise SystemExit("请只选择 --dry-run 或 --sync")
    ROOT.mkdir(parents=True, exist_ok=True)
    lock = (ROOT / "sync.lock").open("a+b")
    if os.name == "nt":
        import msvcrt
        lock.seek(0)
        if not lock.read(1):
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise SystemExit("同步器已在运行")
    (ROOT / "watch.pid").write_text(str(os.getpid()), encoding="ascii")
    first = True
    failures = 0
    while True:
        try:
            result = sync_once(args, first)
            failures = 0
        except Exception as exc:
            allowed = {"reauth_required", "invalid_target", "website_conflict", "website_conflict_review_required",
                       "website_token_revoked", "website_offline", "invalid_date_range", "garmin_connection_unavailable",
                       "auth_in_progress", "garmin_rate_limited", "token_store_unavailable"}
            code = str(exc) if str(exc) in allowed or str(exc).startswith("website_http_") else "local_sync_error"
            result = {"status": "error", "code": code}
            failures += 1
            with contextlib.suppress(Exception):
                report_error(read_config(args), code)
        save(ROOT / "sync-status.json", {**result, "updatedAt": now().isoformat()})
        print(json.dumps(result, ensure_ascii=False), flush=True)
        if not args.watch:
            return 1 if result["status"] == "error" else 0
        first = False
        # Keep request pickup fast when healthy; bound retries during outages.
        time.sleep(min(300, 30 * (2 ** min(max(failures - 1, 0), 4))))

if __name__ == "__main__":
    raise SystemExit(main())
