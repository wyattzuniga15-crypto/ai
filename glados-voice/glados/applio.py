"""Applio (RVC v2) install, GPU verification, preprocessing, training and index.

Applio is pinned to one release and driven through its own scripts with
explicit arguments, because its CLI reports success even when a step fails.
Every step here checks the files it should have produced instead.
"""

from __future__ import annotations

import csv
import json
import os
import re
import shutil
import subprocess
import threading
import time
import zipfile
from pathlib import Path

from .common import (LOG, MODEL_NAME, SAMPLE_RATE, Blocked, StepFailed, Workspace, child_env,
                     disk_free_gb, download, fmt_duration, now, read_json, run, write_json)

APPLIO_VERSION = "3.6.5"
APPLIO_ZIP = f"https://github.com/IAHispano/Applio/archive/refs/tags/{APPLIO_VERSION}.zip"
APPLIO_GIT = "https://github.com/IAHispano/Applio"
TORCH_VERSION = "2.11.0"  # what Applio 3.6.5 pins
CUDA_INDEXES = ("cu128", "cu126", "cu130")
PRETRAINS_JSON = "https://huggingface.co/IAHispano/Applio/raw/main/pretrains.json"
HELPERS = Path(__file__).parent / "applio_side"


def helper(name: str) -> str:
    return str(HELPERS / name)


def applio_run(ws: Workspace, args, *, env=None, log_name="applio.log", **kw):
    return run([ws.applio_python, *args], cwd=ws.applio, env=env or child_env(),
               log_name=log_name, logs_dir=ws.logs, **kw)


def json_line(tail: list[str], prefix: str):
    for line in reversed(tail):
        if line.startswith(prefix):
            return json.loads(line[len(prefix):])
    return None


# ----------------------------------------------------------------------------- nvidia-smi

def nvidia_smi_exe():
    exe = shutil.which("nvidia-smi")
    if not exe and os.name == "nt":
        for cand in (r"C:\Windows\System32\nvidia-smi.exe",
                     r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"):
            if os.path.exists(cand):
                exe = cand
    return exe


def nvidia_smi() -> list[dict] | None:
    exe = nvidia_smi_exe()
    if not exe:
        return None
    fields = ["index", "name", "driver_version", "memory.total", "memory.used",
              "utilization.gpu", "temperature.gpu", "pci.bus_id"]
    try:
        out = subprocess.run([exe, f"--query-gpu={','.join(fields)}", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=30)
    except Exception:
        return None
    if out.returncode != 0:
        return None
    gpus = []
    for line in out.stdout.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == len(fields):
            gpus.append(dict(zip(fields, parts)))
    return gpus


# ----------------------------------------------------------------------------- install

def _install_source(ws: Workspace):
    marker = ws.applio / ".glados_applio_version"
    if (ws.applio / "core.py").exists() and marker.exists() and marker.read_text().strip() == APPLIO_VERSION:
        return
    LOG.info("Installing Applio %s into %s", APPLIO_VERSION, ws.applio)
    tmp = ws.tools / "applio_src"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    src = None
    try:
        zpath = download(APPLIO_ZIP, ws.tools / f"Applio-{APPLIO_VERSION}.zip", min_bytes=1_000_000)
        with zipfile.ZipFile(zpath) as z:
            z.extractall(tmp)
        src = next(p for p in tmp.iterdir() if p.is_dir())
    except Exception as exc:
        LOG.warning("Zip download failed (%s); trying git", exc)
        if not shutil.which("git"):
            raise Blocked(f"Could not download Applio from {APPLIO_ZIP} and git is not installed. "
                          "Check the internet connection and re-run.")
        run(["git", "clone", "--depth", "1", "--branch", APPLIO_VERSION, APPLIO_GIT, tmp / "Applio"],
            log_name="setup.log", logs_dir=ws.logs)
        src = tmp / "Applio"
    ws.applio.mkdir(parents=True, exist_ok=True)
    # Merge so an existing .venv, downloaded models and training logs survive.
    shutil.copytree(src, ws.applio, dirs_exist_ok=True)
    shutil.rmtree(tmp, ignore_errors=True)
    marker.write_text(APPLIO_VERSION)


def _torch_info(ws: Workspace) -> dict | None:
    if not ws.applio_python.exists():
        return None
    code = ("import json,torch;print('TORCH_JSON '+json.dumps({'version':torch.__version__,"
            "'cuda_build':torch.version.cuda,'cuda_available':torch.cuda.is_available()}))")
    rc, tail, _ = run([ws.applio_python, "-c", code], cwd=ws.applio, check=False, quiet=True)
    return json_line(tail, "TORCH_JSON ") if rc == 0 else None


def _install_torch(ws: Workspace, uv: str, reinstall: bool) -> str:
    last = None
    for idx in CUDA_INDEXES:
        LOG.info("Installing PyTorch %s with CUDA (%s build)", TORCH_VERSION, idx)
        cmd = [uv, "pip", "install", "--python", ws.applio_python,
               f"torch=={TORCH_VERSION}", f"torchaudio=={TORCH_VERSION}",
               "--index-url", f"https://download.pytorch.org/whl/{idx}"]
        if reinstall:
            cmd += ["--reinstall-package", "torch", "--reinstall-package", "torchaudio"]
        rc, tail, _ = run(cmd, log_name="setup.log", logs_dir=ws.logs, check=False)
        info = _torch_info(ws)
        if rc == 0 and info and info["cuda_build"] and info["cuda_available"]:
            LOG.info("PyTorch %s (CUDA %s) can see the GPU", info["version"], info["cuda_build"])
            return idx
        last = info or tail[-5:]
        LOG.warning("The %s build did not work here (%s); trying the next one", idx, last)
        reinstall = True
    raise Blocked("PyTorch could not use the NVIDIA GPU with any CUDA build "
                  f"({', '.join(CUDA_INDEXES)}). Update the NVIDIA GeForce driver "
                  "(nvidia.com/drivers, choose RTX 3060 Ti), restart, then re-run. "
                  f"Last result: {last}")


def _write_config(ws: Workspace):
    cfg_path = ws.applio / "assets" / "config.json"
    data = read_json(cfg_path) or read_json(ws.applio / "assets" / "config_template.json") or {}
    # Applio's GUI creates this file on first launch; its CLI scripts need it too
    # (without it, weight files are silently never written after training).
    data["discord_presence"] = False
    data["model_author"] = "GLaDOSVoice pipeline (personal use)"
    data.setdefault("precision", "fp16")
    write_json(cfg_path, data)


def _verify(ws: Workspace, *args) -> dict:
    rc, tail, _ = applio_run(ws, [helper("verify_models.py"), *args], log_name="setup.log",
                             check=False, quiet=True)
    res = json_line(tail, "VERIFY_JSON ")
    if res is None:
        raise StepFailed("Model check crashed:\n" + "\n".join(tail[-15:]))
    return res


def _prerequisites(ws: Workspace):
    for attempt in range(1, 4):
        res = _verify(ws, "prereq", ws.applio)
        if res["ok"]:
            LOG.info("Applio models present: RMVPE, ContentVec, RVC v2 40k pretrained G/D")
            return
        LOG.info("Downloading Applio's models (attempt %d/3): %s", attempt, "; ".join(res["problems"]))
        for problem in res["problems"]:
            m = re.match(r"(rvc/\S+)", problem)
            if m and "missing" not in problem:
                (ws.applio / m.group(1)).unlink(missing_ok=True)
        applio_run(ws, ["core.py", "prerequisites"], log_name="setup.log", check=False)
    res = _verify(ws, "prereq", ws.applio)
    if not res["ok"]:
        raise Blocked("Applio's model downloads from huggingface.co keep failing: "
                      + "; ".join(res["problems"]) + ". Check that huggingface.co is reachable "
                      "from this PC (VPN/firewall), then re-run.")


def _choose_pretrain(ws: Workspace, choice: str) -> dict:
    stock = {"name": "Applio stock RVC v2 40k",
             "G": str(ws.applio / "rvc/models/pretraineds/hifi-gan/f0G40k.pth"),
             "D": str(ws.applio / "rvc/models/pretraineds/hifi-gan/f0D40k.pth")}
    if choice == "stock":
        return stock
    try:
        custom = ws.applio / "rvc/models/pretraineds/custom"
        listing = download(PRETRAINS_JSON, custom / "pretrains.json", min_bytes=20, attempts=2)
        data = json.loads(listing.read_text(encoding="utf-8"))
        key = next((k for k in data if k.lower().startswith(choice.lower())), None)
        if not key or "40k" not in data[key]:
            raise StepFailed(f"no 40k entry for '{choice}' in pretrains.json (have: {list(data)})")
        entry = data[key]["40k"]
        g = custom / Path(entry["G"]).name
        d = custom / Path(entry["D"]).name
        for rel, dest in ((entry["G"], g), (entry["D"], d)):
            if not dest.exists():
                download(f"https://huggingface.co/{rel}", dest, min_bytes=20_000_000)
        res = _verify(ws, "pretrain", g, d, stock["G"], stock["D"])
        if not res["ok"]:
            raise StepFailed("; ".join(res["problems"]))
        LOG.info("Using the %s 40k pretrained base (usually cleaner than the stock one)", key)
        return {"name": f"{key} 40k", "G": str(g), "D": str(d)}
    except Exception as exc:
        LOG.warning("Could not use the '%s' pretrained base (%s); using Applio's stock v2 40k base",
                    choice, exc)
        return stock


def setup_applio(ws: Workspace, cfg) -> dict:
    free = disk_free_gb(ws.root)
    if free < 20:
        raise Blocked(f"Only {free:.0f} GB free on the drive holding {ws.root}. The Applio install, "
                      "models and training checkpoints need about 20 GB. Free some space and re-run.")
    gpus = None if cfg.allow_cpu else nvidia_smi()
    if not cfg.allow_cpu:
        if not gpus:
            raise Blocked("nvidia-smi was not found or failed, so the NVIDIA driver is missing or "
                          "broken. Install the current GeForce driver for the RTX 3060 Ti from "
                          "nvidia.com/drivers, restart, and re-run.")
        LOG.info("NVIDIA driver sees: %s", "; ".join(f"[{g['index']}] {g['name']} (driver "
                                                     f"{g['driver_version']}, {g['memory.total']} MiB)"
                                                     for g in gpus))
        major = int(gpus[0]["driver_version"].split(".")[0])
        if major < 528:
            raise Blocked(f"NVIDIA driver {gpus[0]['driver_version']} is too old for CUDA 12 "
                          "PyTorch. Update it from nvidia.com/drivers and re-run.")

    _install_source(ws)
    uv = cfg.uv
    if not ws.applio_python.exists():
        LOG.info("Creating Applio's Python 3.12 venv")
        run([uv, "venv", ws.applio / ".venv", "--python", "3.12"], log_name="setup.log", logs_dir=ws.logs)

    marker = ws.applio / ".glados_requirements_ok"
    torch_index = None
    if cfg.allow_cpu:
        if not marker.exists():
            run([uv, "pip", "install", "--python", ws.applio_python, "-r", ws.applio / "requirements.txt"],
                log_name="setup.log", logs_dir=ws.logs)
    else:
        info = _torch_info(ws)
        if not (info and info["cuda_build"] and info["cuda_available"]):
            torch_index = _install_torch(ws, uv, reinstall=bool(info))
        else:
            torch_index = "cu" + info["cuda_build"].replace(".", "")
        if not marker.exists():
            LOG.info("Installing Applio's other requirements")
            run([uv, "pip", "install", "--python", ws.applio_python, "-r", ws.applio / "requirements.txt",
                 "--extra-index-url", f"https://download.pytorch.org/whl/{torch_index}",
                 "--index-strategy", "unsafe-best-match"], log_name="setup.log", logs_dir=ws.logs)
        info = _torch_info(ws)
        if not (info and info["cuda_build"] and info["cuda_available"]):
            LOG.warning("The requirements install replaced CUDA PyTorch; putting it back")
            torch_index = _install_torch(ws, uv, reinstall=True)
    marker.write_text(now())
    _write_config(ws)
    _prerequisites(ws)
    pretrain = _choose_pretrain(ws, cfg.pretrain)
    info = _torch_info(ws) or {}
    return {"applio_version": APPLIO_VERSION, "torch": info.get("version"),
            "cuda_build": info.get("cuda_build"), "pretrain": pretrain}


# ----------------------------------------------------------------------------- GPU check

def gpu_env(gpu: dict) -> dict:
    """Environment for every Applio process: only the chosen NVIDIA card is visible."""
    if gpu.get("device") == "cpu":
        return child_env({"CUDA_VISIBLE_DEVICES": ""})
    return child_env({"CUDA_DEVICE_ORDER": "PCI_BUS_ID", "CUDA_VISIBLE_DEVICES": gpu["cuda_visible_devices"]})


def gpu_check(ws: Workspace, cfg) -> dict:
    if cfg.allow_cpu:
        LOG.warning("--allow-cpu: skipping the GPU requirement (test mode only)")
        return {"device": "cpu", "gpu_arg": "-", "cuda_visible_devices": ""}
    env = child_env({"CUDA_DEVICE_ORDER": "PCI_BUS_ID"})
    env.pop("CUDA_VISIBLE_DEVICES", None)
    rc, tail, _ = run([ws.applio_python, helper("gpu_check.py"), cfg.gpu_name], cwd=ws.applio, env=env,
                      log_name="gpu_check.log", logs_dir=ws.logs, check=False)
    res = json_line(tail, "GPU_CHECK_JSON ")
    if not res or not res["cuda_available"]:
        raise Blocked("PyTorch in Applio's venv cannot use CUDA at all "
                      f"(torch {res and res.get('torch')}, CUDA build {res and res.get('cuda_build')}). "
                      "Update the NVIDIA driver and re-run; if it persists, delete "
                      f"{ws.applio / '.venv'} and re-run to reinstall PyTorch.")
    names = ", ".join(f"[{d['index']}] {d['name']} ({d['vram_gb']} GB)" for d in res["devices"])
    if "chosen" not in res:
        raise Blocked(f"No CUDA GPU with '{cfg.gpu_name}' in its name. CUDA sees: {names}. "
                      "(AMD integrated graphics cannot run CUDA, so it never appears here.) "
                      "If your card reports a different name, re-run with -GpuName \"<part of that name>\".")
    idx = res["chosen"]
    # Re-check through exactly the environment Applio will run with.
    env2 = child_env({"CUDA_DEVICE_ORDER": "PCI_BUS_ID", "CUDA_VISIBLE_DEVICES": str(idx)})
    rc, tail, _ = run([ws.applio_python, helper("gpu_check.py"), cfg.gpu_name], cwd=ws.applio, env=env2,
                      log_name="gpu_check.log", logs_dir=ws.logs, check=False, quiet=True)
    res2 = json_line(tail, "GPU_CHECK_JSON ") or {}
    if res2.get("chosen") != 0 or len(res2.get("devices", [])) != 1:
        raise StepFailed(f"Restricting CUDA to device {idx} did not leave exactly the "
                         f"{cfg.gpu_name} visible: {res2}")
    LOG.info("GPU verified: %s, %.1f GB VRAM (%.1f GB free), compute %s, %.1f TFLOPS matmul test on %s. "
             "Every Applio step runs with CUDA_VISIBLE_DEVICES=%d, so neither the CPU nor the AMD "
             "integrated graphics can be picked.", res["chosen_name"], res["devices"][idx]["vram_gb"],
             res["vram_free_gb"], res["devices"][idx]["capability"], res["matmul_tflops"],
             res["result_on_device"], idx)
    if res["vram_free_gb"] < 6:
        LOG.warning("Only %.1f GB of VRAM is free; close games/browsers using the GPU before training.",
                    res["vram_free_gb"])
    return {"device": "cuda", "gpu_arg": "0", "cuda_visible_devices": str(idx),
            "name": res["chosen_name"], "vram_gb": res["devices"][idx]["vram_gb"],
            "matmul_tflops": res["matmul_tflops"], "torch": res["torch"], "cuda_build": res["cuda_build"]}


# ----------------------------------------------------------------------------- preprocess/extract

def cpu_workers() -> int:
    return max(1, min((os.cpu_count() or 4) - 1, 12))


def preprocess(ws: Workspace, gpu: dict) -> dict:
    exp = ws.experiment
    if exp.exists():
        LOG.info("Removing the previous Applio experiment folder (dataset changed or step re-run)")
        shutil.rmtree(exp)
    exp.mkdir(parents=True)
    n = len(list(ws.dataset.glob("*.wav")))
    if n == 0:
        raise StepFailed(f"No training WAVs in {ws.dataset}; run the clean step first")
    applio_run(ws, ["rvc/train/preprocess/preprocess.py", exp, ws.dataset, SAMPLE_RATE, cpu_workers(),
                    "Automatic", False, False, 0.7, 3.0, 0.3, "none"],
               env=gpu_env(gpu), log_name="applio_preprocess.log")
    slices = len(list((exp / "sliced_audios").glob("*.wav")))
    if slices == 0:
        raise StepFailed("Applio preprocessing produced no slices; see logs/applio_preprocess.log")
    LOG.info("Applio sliced %d lines into %d training segments", n, slices)
    return {"lines": n, "slices": slices}


def extract_features(ws: Workspace, gpu: dict) -> dict:
    exp = ws.experiment
    slices = len(list((exp / "sliced_audios").glob("*.wav")))
    for attempt in (1, 2):
        applio_run(ws, ["rvc/train/extract/extract.py", exp, "rmvpe", cpu_workers(), gpu["gpu_arg"],
                        SAMPLE_RATE, "contentvec", "None", 2],
                   env=gpu_env(gpu), log_name="applio_extract.log")
        f0 = len(list((exp / "f0").glob("*.npy")))
        feats = len(list((exp / "extracted").glob("*.npy")))
        if f0 >= slices and feats >= slices and (exp / "filelist.txt").exists():
            LOG.info("RMVPE pitch + ContentVec features extracted for %d segments", slices)
            return {"segments": slices}
        LOG.warning("Feature extraction incomplete (%d pitch, %d feature files for %d segments); "
                    "retrying", f0, feats, slices)
    raise StepFailed("Feature extraction did not cover every segment; see logs/applio_extract.log")


# ----------------------------------------------------------------------------- training

EPOCH_RE = re.compile(r"\| epoch=(\d+) \| step=(\d+) \|")
OOM_MARKERS = ("CUDA out of memory", "OutOfMemoryError", "CUBLAS_STATUS_ALLOC_FAILED",
               "cudaErrorMemoryAllocation", "CUDA error: out of memory")


def weight_files(exp: Path) -> list[tuple[int, int, Path]]:
    out = []
    for p in exp.glob(f"{MODEL_NAME}_*e_*s.pth"):
        m = re.fullmatch(rf"{re.escape(MODEL_NAME)}_(\d+)e_(\d+)s\.pth", p.name)
        if m:
            out.append((int(m.group(1)), int(m.group(2)), p))
    return sorted(out)


def _stop_stale_training(exp: Path):
    """A closed window can leave Applio's training processes holding the GPU."""
    data = read_json(exp / "config.json", {}) or {}
    for pid in data.get("process_pids", []):
        try:
            if os.name == "nt":
                q = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                                   capture_output=True, text=True)
                if "python" in q.stdout.lower():
                    LOG.warning("Stopping a leftover training process (PID %s)", pid)
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
            else:
                os.kill(pid, 0)
                LOG.warning("Stopping a leftover training process (PID %s)", pid)
                os.kill(pid, 9)
        except (OSError, ValueError):
            pass


class _GpuSampler(threading.Thread):
    def __init__(self, ws: Workspace, index: str):
        super().__init__(daemon=True)
        self.ws, self.index, self.stop = ws, index, threading.Event()
        self.samples: list[dict] = []

    def run(self):
        path = self.ws.logs / "gpu_usage.csv"
        first = True
        while not self.stop.wait(90 if first else 300):
            gpus = nvidia_smi() or []
            g = next((g for g in gpus if g["index"] == self.index), None)
            if not g:
                continue
            new = not path.exists()
            with open(path, "a", newline="", encoding="utf-8") as fh:
                w = csv.writer(fh)
                if new:
                    w.writerow(["time", "gpu", "util_pct", "mem_used_mib", "mem_total_mib", "temp_c"])
                w.writerow([now(), g["name"], g["utilization.gpu"], g["memory.used"],
                            g["memory.total"], g["temperature.gpu"]])
            self.samples.append(g)
            level = LOG.info if first else LOG.debug
            level("GPU during training: %s at %s%% utilisation, %s/%s MiB VRAM, %s C", g["name"],
                  g["utilization.gpu"], g["memory.used"], g["memory.total"], g["temperature.gpu"])
            first = False


def train(ws: Workspace, cfg, gpu: dict, pretrain: dict, state_info: dict, save_state) -> dict:
    exp = ws.experiment
    total = cfg.epochs
    batch = int(state_info.get("batch_size", cfg.batch_size))
    checkpointing = bool(state_info.get("checkpointing", False))
    pg, pd = pretrain["G"], pretrain["D"]
    pretrain_name = pretrain["name"]
    restarts = 0
    slices = len(list((exp / "sliced_audios").glob("*.wav")))
    _stop_stale_training(exp)

    while True:
        done = [w for w in weight_files(exp) if w[0] >= total]
        if done:
            break
        last_epoch = max([w[0] for w in weight_files(exp)], default=0)
        LOG.info("Training %s: epochs %d-%d of %d, batch size %d, pretrained base: %s%s", MODEL_NAME,
                 last_epoch + 1 if last_epoch else 1, total, total, batch, pretrain_name,
                 " (gradient checkpointing on)" if checkpointing else "")
        mon = {"oom": False, "cpu": False, "mismatch": False, "nodata": False, "epoch": None,
               "t_last": time.time(), "durations": [], "first_epoch_seen": None}

        def on_line(line: str):
            if any(m in line for m in OOM_MARKERS):
                mon["oom"] = True
                return "kill"
            if "Training with CPU" in line and gpu.get("device") != "cpu":
                mon["cpu"] = True
                return "kill"
            if "do not match the selected model" in line:
                mon["mismatch"] = True
            if "Not enough data present" in line:
                mon["nodata"] = True
            m = EPOCH_RE.search(line)
            if m:
                ep = int(m.group(1))
                t = time.time()
                if mon["epoch"] is not None:
                    mon["durations"].append(t - mon["t_last"])
                mon["t_last"], mon["epoch"] = t, ep
                if mon["first_epoch_seen"] is None:
                    mon["first_epoch_seen"] = ep
                recent = mon["durations"][-10:]
                per = sum(recent) / len(recent) if recent else None
                eta = f", about {fmt_duration(per * (total - ep))} left ({per:.0f} s/epoch)" if per else ""
                write_json(ws.logs / "train_progress.json",
                           {"epoch": ep, "total": total, "batch_size": batch, "seconds_per_epoch": per,
                            "eta_seconds": per * (total - ep) if per else None, "updated": now()})
                if ep % 5 == 0 or ep == mon["first_epoch_seen"]:
                    LOG.info("Epoch %d/%d%s", ep, total, eta)
            return None

        sampler = _GpuSampler(ws, gpu.get("cuda_visible_devices", "")) if gpu.get("device") == "cuda" else None
        if sampler:
            sampler.start()
        # train.py args: name, save_every, epochs, G, D, gpu, batch, sr, save_only_latest,
        # save_every_weights, cache_in_gpu, cleanup, vocoder, checkpointing
        args = ["rvc/train/train.py", MODEL_NAME, cfg.save_every, total, pg, pd, "0",
                batch, SAMPLE_RATE, True, True, False, False, "HiFi-GAN", checkpointing]
        rc, tail, killed = applio_run(ws, args, env=gpu_env(gpu), log_name="applio_train.log",
                                      on_line=on_line, check=False)
        if sampler:
            sampler.stop.set()
        if mon["durations"]:
            state_info["seconds_per_epoch"] = sum(mon["durations"][-20:]) / len(mon["durations"][-20:])
        if mon["cpu"]:
            raise Blocked("Applio started training on the CPU even though the GPU check passed. "
                          "Restart the PC (to reset the NVIDIA driver) and re-run.")
        if mon["nodata"]:
            raise StepFailed("Applio says there is not enough training data; check the clean step output")
        if mon["mismatch"] and not pretrain_name.startswith("Applio stock"):
            LOG.warning("The %s base does not fit this model; switching to the stock base", pretrain_name)
            pg = str(ws.applio / "rvc/models/pretraineds/hifi-gan/f0G40k.pth")
            pd = str(ws.applio / "rvc/models/pretraineds/hifi-gan/f0D40k.pth")
            pretrain_name = "Applio stock RVC v2 40k"
            state_info["pretrain_fallback"] = pretrain_name
            save_state()
            continue
        if mon["oom"]:
            if batch > 4:
                batch = 6 if batch > 6 else 4
            elif not checkpointing:
                checkpointing = True
            elif batch > 2:
                batch = 2
            else:
                raise Blocked("The GPU runs out of memory even at batch size 2 with gradient "
                              "checkpointing. Close everything else using the GPU and re-run.")
            LOG.warning("Out of GPU memory; retrying with batch size %d%s", batch,
                        " and gradient checkpointing" if checkpointing else "")
            state_info.update(batch_size=batch, checkpointing=checkpointing)
            save_state()
            time.sleep(5)
            continue
        if [w for w in weight_files(exp) if w[0] >= total]:
            break
        progressed = mon["epoch"] is not None and mon["epoch"] > last_epoch
        restarts = 0 if progressed else restarts + 1
        if restarts >= 3:
            raise StepFailed("Training keeps stopping without progress; last output:\n" + "\n".join(tail[-30:]))
        LOG.warning("Training stopped at epoch %s without finishing (exit %s); resuming from the last "
                    "checkpoint in 10 s", mon["epoch"], rc)
        time.sleep(10)

    weights = weight_files(exp)
    final = max(w[0] for w in weights)
    info = {"epochs": final, "batch_size": batch, "checkpointing": checkpointing,
            "pretrain": pretrain_name, "weights_saved": len(weights), "segments": slices,
            "seconds_per_epoch": state_info.get("seconds_per_epoch")}
    LOG.info("Training finished: %d epochs, %d weight snapshots saved", final, len(weights))
    return info


def build_index(ws: Workspace, gpu: dict, compact_over_mb: float = 300.0) -> dict:
    exp = ws.experiment
    idx = exp / f"{MODEL_NAME}.index"
    if not idx.exists():
        applio_run(ws, ["rvc/train/process/extract_index.py", exp, "Auto"], env=gpu_env(gpu),
                   log_name="applio_index.log")
    if not idx.exists() or idx.stat().st_size == 0:
        raise StepFailed("Index file was not created; see logs/applio_index.log")
    mb = idx.stat().st_size / 1e6
    info = {"index": str(idx), "megabytes": round(mb, 1), "compact_index": None}
    if mb > compact_over_mb:
        small = exp / f"{MODEL_NAME}_compact.index"
        if not small.exists():
            applio_run(ws, [helper("small_index.py"), exp, small], env=gpu_env(gpu), log_name="applio_index.log")
        info["compact_index"] = str(small)
        info["compact_megabytes"] = round(small.stat().st_size / 1e6, 1)
    LOG.info("Index built: %s (%.0f MB)", idx.name, mb)
    return info


def tensorboard_scalars(ws: Workspace, out_csv: Path) -> Path | None:
    ev = ws.experiment / "eval"
    if not ev.exists():
        return None
    rc, tail, _ = applio_run(ws, [helper("tb_dump.py"), ev, out_csv], log_name="applio_eval.log",
                             check=False, quiet=True)
    return out_csv if rc == 0 and out_csv.exists() else None


def convert(ws: Workspace, gpu: dict, jobs: list[dict], jobs_file: Path, log_name="applio_convert.log"):
    """Voice-convert many files, possibly with many models, in one Applio process."""
    write_json(jobs_file, {"jobs": jobs})
    rc, tail, _ = applio_run(ws, [helper("convert.py"), jobs_file], env=gpu_env(gpu), log_name=log_name,
                             check=False, quiet=True)
    failed = [l for l in tail if l.startswith("CONVERT_FAILED")]
    if rc != 0:
        raise StepFailed("Voice conversion failed:\n" + "\n".join((failed or tail)[-15:]))
    return tail
