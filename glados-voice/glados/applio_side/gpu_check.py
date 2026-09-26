"""Runs inside Applio's venv. Prints one JSON line describing what CUDA sees.

usage: gpu_check.py "<name substring>"
"""

import json
import sys
import time

import torch

want = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
out = {
    "torch": torch.__version__,
    "cuda_build": torch.version.cuda,
    "cuda_available": torch.cuda.is_available(),
    "devices": [],
}
if torch.cuda.is_available():
    for i in range(torch.cuda.device_count()):
        p = torch.cuda.get_device_properties(i)
        out["devices"].append({"index": i, "name": p.name,
                               "vram_gb": round(p.total_memory / 1024 ** 3, 2),
                               "capability": f"{p.major}.{p.minor}"})
    match = [d for d in out["devices"] if want and want in d["name"].lower()]
    if match:
        i = match[0]["index"]
        dev = torch.device("cuda", i)
        a = torch.randn(4096, 4096, device=dev)
        b = torch.randn(4096, 4096, device=dev)
        (a @ b).sum().item()  # warm-up
        torch.cuda.synchronize(dev)
        t = time.time()
        for _ in range(10):
            c = a @ b
        torch.cuda.synchronize(dev)
        dt = time.time() - t
        free, total = torch.cuda.mem_get_info(i)
        out.update({
            "chosen": i,
            "chosen_name": match[0]["name"],
            "matmul_tflops": round(10 * 2 * 4096 ** 3 / dt / 1e12, 2),
            "result_on_device": str(c.device),
            "vram_free_gb": round(free / 1024 ** 3, 2),
            "bf16": torch.cuda.is_bf16_supported(),
        })
print("GPU_CHECK_JSON " + json.dumps(out))
