"""Shared plumbing: workspace paths, logging, resumable step state, subprocesses."""

from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path

LOG = logging.getLogger("glados")

MODEL_NAME = "GLaDOS"
SAMPLE_RATE = 40000


class Blocked(RuntimeError):
    """Something only the user can fix. The message says exactly what to do."""


class StepFailed(RuntimeError):
    """A step failed in a way a re-run may fix; the message carries the evidence."""


class Workspace:
    """Every path the pipeline touches, rooted at C:\\GLaDOSVoice by default."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.raw = self.root / "raw"
        self.clean = self.root / "clean"
        self.converted = self.clean / "converted"
        self.dataset = self.root / "dataset"
        self.model = self.root / "model"
        self.samples = self.root / "samples"
        self.samples_input = self.samples / "input"
        self.logs = self.root / "logs"
        self.eval = self.root / "eval"
        self.holdout = self.eval / "holdout"
        self.tools = self.root / "tools"
        self.env = self.root / "env"
        self.applio = self.root / "applio"
        self.state_file = self.logs / "state.json"

    def make(self):
        for p in (self.raw, self.clean, self.converted, self.dataset, self.model,
                  self.samples, self.samples_input, self.logs, self.eval, self.tools):
            p.mkdir(parents=True, exist_ok=True)

    # Applio side
    @property
    def applio_python(self) -> Path:
        if os.name == "nt":
            return self.applio / ".venv" / "Scripts" / "python.exe"
        return self.applio / ".venv" / "bin" / "python"

    @property
    def experiment(self) -> Path:
        return self.applio / "logs" / MODEL_NAME


def setup_logging(ws: Workspace, verbose: bool = False):
    ws.logs.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s  %(levelname)-7s %(message)s", "%Y-%m-%d %H:%M:%S")
    LOG.setLevel(logging.DEBUG)
    LOG.handlers.clear()
    fh = logging.FileHandler(ws.logs / "pipeline.log", encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.DEBUG if verbose else logging.INFO)
    ch.setFormatter(fmt)
    LOG.addHandler(fh)
    LOG.addHandler(ch)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


class State:
    """logs/state.json: which steps finished and what they produced.

    Written atomically after every change so a crash or power cut never leaves
    it half written, and a re-run resumes at the first step not marked done.
    """

    def __init__(self, path: Path):
        self.path = path
        self.data = {"steps": {}, "settings": {}}
        if path.exists():
            try:
                self.data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                backup = path.with_suffix(".corrupt.json")
                shutil.copyfile(path, backup)
                LOG.warning("state.json was unreadable; saved it as %s and starting fresh", backup)
        self.data.setdefault("steps", {})
        self.data.setdefault("settings", {})

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2, default=str), encoding="utf-8")
        os.replace(tmp, self.path)

    def step(self, name: str) -> dict:
        return self.data["steps"].setdefault(name, {})

    def is_done(self, name: str) -> bool:
        return self.data["steps"].get(name, {}).get("status") == "done"

    def mark(self, step_name: str, status: str, info: dict | None = None):
        s = self.step(step_name)
        s["status"] = status
        s[f"{status}_at"] = now()
        if info:
            s.setdefault("info", {}).update(info)
        self.save()

    def info(self, name: str) -> dict:
        return self.data["steps"].get(name, {}).get("info", {})

    def reset(self, name: str):
        self.data["steps"].pop(name, None)
        self.save()


def now() -> str:
    return _dt.datetime.now().isoformat(timespec="seconds")


def fmt_minutes(seconds: float) -> str:
    return f"{seconds / 60:.1f} min"


def fmt_duration(seconds: float) -> str:
    seconds = int(max(0, seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h{m:02d}m"
    if m:
        return f"{m}m{s:02d}s"
    return f"{s}s"


def child_env(extra: dict | None = None) -> dict:
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    # Keep Applio's own downloads and caches inside the workspace-installed venv.
    env.pop("PYTHONPATH", None)
    env.pop("PYTHONHOME", None)
    if extra:
        env.update({k: str(v) for k, v in extra.items()})
    return env


def run(cmd, *, cwd=None, env=None, log_name: str | None = None, logs_dir: Path | None = None,
        on_line=None, check: bool = True, quiet: bool = False, timeout: float | None = None):
    """Run a command, stream its output to the console and a log file.

    `on_line(line)` sees every output line (carriage-return progress bars are
    split into lines) and may return "kill" to stop the process early.
    Returns (returncode, tail_lines, killed_by_callback).
    """
    cmd = [str(c) for c in cmd]
    LOG.debug("$ %s  (cwd=%s)", subprocess.list2cmdline(cmd), cwd or os.getcwd())
    log_fh = None
    if log_name and logs_dir:
        logs_dir.mkdir(parents=True, exist_ok=True)
        log_fh = open(logs_dir / log_name, "a", encoding="utf-8", errors="replace")
        log_fh.write(f"\n===== {now()}  {subprocess.list2cmdline(cmd)}\n")
        log_fh.flush()
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP  # lets us stop the whole tree
    proc = subprocess.Popen(cmd, cwd=cwd, env=env or child_env(), stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                            creationflags=creationflags, start_new_session=(os.name != "nt"))
    tail: deque[str] = deque(maxlen=60)
    killed = False
    last_echo = 0.0
    deadline = time.time() + timeout if timeout else None

    def watchdog():
        while proc.poll() is None:
            if deadline and time.time() > deadline:
                LOG.error("Command timed out after %ss; stopping it", timeout)
                kill_tree(proc)
                return
            time.sleep(2)

    if deadline:
        threading.Thread(target=watchdog, daemon=True).start()

    buf = b""
    assert proc.stdout is not None
    while True:
        chunk = proc.stdout.read1(65536) if hasattr(proc.stdout, "read1") else proc.stdout.read(4096)
        if not chunk:
            break
        buf += chunk
        while True:
            cut = min([i for i in (buf.find(b"\n"), buf.find(b"\r")) if i >= 0], default=-1)
            if cut < 0:
                break
            raw, buf = buf[:cut], buf[cut + 1:]
            line = raw.decode("utf-8", errors="replace").rstrip()
            if not line:
                continue
            is_progress = "it/s]" in line or "s/it]" in line or "%|" in line
            if log_fh and not is_progress:
                log_fh.write(line + "\n")
            tail.append(line)
            if not quiet:
                # Progress bars redraw constantly; show at most one every 5 s.
                if is_progress:
                    if time.time() - last_echo > 5:
                        print("    " + line[-160:], flush=True)
                        last_echo = time.time()
                else:
                    print("    " + line, flush=True)
            if on_line and not killed:
                try:
                    if on_line(line) == "kill":
                        killed = True
                        kill_tree(proc)
                except Exception as exc:  # a bad callback must never wedge a long run
                    LOG.debug("on_line callback error: %s", exc)
    if buf.strip():
        line = buf.decode("utf-8", errors="replace").rstrip()
        tail.append(line)
        if log_fh:
            log_fh.write(line + "\n")
        if on_line and not killed:
            try:
                if on_line(line) == "kill":
                    killed = True
            except Exception:
                pass
    rc = proc.wait()
    if log_fh:
        log_fh.write(f"===== exit code {rc}\n")
        log_fh.close()
    if check and rc != 0 and not killed:
        raise StepFailed(f"Command failed with exit code {rc}: {subprocess.list2cmdline(cmd)}\n"
                         + "\n".join(list(tail)[-25:]))
    return rc, list(tail), killed


def kill_tree(proc: subprocess.Popen):
    """Stop a process and everything it spawned (Applio trains in child processes)."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            import signal
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            proc.kill()
    try:
        proc.wait(timeout=30)
    except Exception:
        pass


def keep_awake():
    """Stop Windows sleeping during a multi-hour run (released when the process exits)."""
    if os.name != "nt":
        return
    try:
        import ctypes
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
        LOG.info("Sleep is blocked while the pipeline runs (the display may still turn off).")
    except Exception as exc:
        LOG.warning("Could not block sleep: %s. Set Windows power options to never sleep "
                    "while training.", exc)


def download(url: str, dest: Path, *, min_bytes: int = 1, attempts: int = 4, timeout: int = 60) -> Path:
    """Download with retries and a size sanity check (an HTML error page is not a model)."""
    import urllib.request

    dest.parent.mkdir(parents=True, exist_ok=True)
    last = None
    for attempt in range(1, attempts + 1):
        tmp = dest.with_suffix(dest.suffix + ".part")
        try:
            LOG.info("Downloading %s (attempt %d/%d)", url, attempt, attempts)
            req = urllib.request.Request(url, headers={"User-Agent": "glados-voice-pipeline"})
            with urllib.request.urlopen(req, timeout=timeout) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f, length=1 << 20)
            size = tmp.stat().st_size
            if size < min_bytes:
                raise StepFailed(f"{url} returned only {size} bytes")
            os.replace(tmp, dest)
            return dest
        except Exception as exc:
            last = exc
            LOG.warning("Download failed: %s", exc)
            tmp.unlink(missing_ok=True)
            time.sleep(2 ** attempt)
    raise StepFailed(f"Could not download {url}: {last}")


def disk_free_gb(path: Path) -> float:
    p = Path(path)
    while not p.exists() and p.parent != p:
        p = p.parent
    return shutil.disk_usage(p).free / 1e9


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default
