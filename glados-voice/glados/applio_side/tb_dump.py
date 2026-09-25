"""Runs inside Applio's venv. Dumps TensorBoard scalars from training to CSV.

usage: tb_dump.py <event_dir> <out.csv>
"""

import csv
import sys

from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

ea = EventAccumulator(sys.argv[1], size_guidance={"scalars": 0})
ea.Reload()
rows = 0
with open(sys.argv[2], "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["tag", "step", "value"])
    for tag in ea.Tags().get("scalars", []):
        for ev in ea.Scalars(tag):
            w.writerow([tag, ev.step, ev.value])
            rows += 1
print(f"TB_ROWS {rows}")
