"""A small always-on-top window: type a task, watch it work, hit Stop.

The agent runs on a worker thread so the window stays responsive; every update
is marshalled back to the Tk thread with `after`, and confirmations become a
modal dialog instead of a terminal prompt.
"""
from __future__ import annotations

import threading
import tkinter as tk
from tkinter import messagebox, scrolledtext

BG = "#14161a"
FG = "#e6e6e6"
DIM = "#8a919b"
STYLES = {
    "say": "#6cb6ff", "think": "#7d8590", "do": "#7ee787", "warn": "#f0b429",
    "err": "#ff7b72", "done": "#56d364", "dim": DIM, "you": "#e6e6e6",
}


class GuiConsole:
    """Same interface as agent.Console, but writes into the text pane."""

    def __init__(self, widget: scrolledtext.ScrolledText):
        self.widget = widget
        for kind, colour in STYLES.items():
            widget.tag_configure(kind, foreground=colour)
        widget.tag_configure("you", font=("Consolas", 9, "bold"))

    def line(self, kind: str, text: str) -> None:
        self.widget.after(0, self._append, kind, text)

    def _append(self, kind: str, text: str) -> None:
        self.widget.configure(state="normal")
        self.widget.insert("end", text.rstrip() + "\n", kind if kind in STYLES else "dim")
        self.widget.see("end")
        self.widget.configure(state="disabled")


class GuiApprover:
    """Blocks the worker thread on a dialog shown by the Tk thread."""

    def __init__(self, root: tk.Tk):
        self.root = root

    def ask(self, summary: str, reason: str) -> bool:
        answer: dict[str, bool] = {}
        done = threading.Event()

        def prompt() -> None:
            try:
                answer["ok"] = messagebox.askyesno(
                    "Pilot wants to confirm",
                    f"{summary}\n\nWhy this needs confirming:\n{reason}\n\nGo ahead?",
                    icon="warning", parent=self.root)
            finally:
                done.set()

        self.root.after(0, prompt)
        done.wait()
        return answer.get("ok", False)


def run_window(agent, kill, settings) -> None:
    root = tk.Tk()
    root.title("Pilot")
    root.configure(bg=BG)
    root.geometry("560x420+80+80")
    root.minsize(420, 300)
    root.attributes("-topmost", True)

    header = tk.Frame(root, bg=BG)
    header.pack(fill="x", padx=10, pady=(10, 4))
    status = tk.Label(header, text="ready", bg=BG, fg=DIM, anchor="w", font=("Segoe UI", 9))
    status.pack(side="left")
    cost = tk.Label(header, text="$0.0000", bg=BG, fg=DIM, anchor="e", font=("Consolas", 9))
    cost.pack(side="right")

    output = scrolledtext.ScrolledText(root, bg="#0e1013", fg=FG, insertbackground=FG,
                                       font=("Consolas", 9), wrap="word", relief="flat",
                                       state="disabled", padx=8, pady=6)
    output.pack(fill="both", expand=True, padx=10, pady=4)

    row = tk.Frame(root, bg=BG)
    row.pack(fill="x", padx=10, pady=(4, 10))
    entry = tk.Entry(row, bg="#1c1f26", fg=FG, insertbackground=FG, relief="flat",
                     font=("Segoe UI", 10))
    entry.pack(side="left", fill="x", expand=True, ipady=6, padx=(0, 6))
    run_button = tk.Button(row, text="Run", bg="#2ea043", fg="white", relief="flat",
                           font=("Segoe UI", 9, "bold"), width=7, cursor="hand2")
    run_button.pack(side="left", padx=(0, 4))
    stop_button = tk.Button(row, text="Stop", bg="#3d1d1d", fg="#ff7b72", relief="flat",
                            font=("Segoe UI", 9, "bold"), width=7, state="disabled", cursor="hand2")
    stop_button.pack(side="left")

    console = GuiConsole(output)
    agent.console = console
    agent.approver = GuiApprover(root)
    agent.runner.approver = agent.approver
    agent.runner.on_event = lambda kind, message: None  # the console already shows these

    busy = threading.Event()

    def set_status(text: str, colour: str = DIM) -> None:
        status.after(0, lambda: status.configure(text=text, fg=colour))

    def finish(result) -> None:
        busy.clear()
        run_button.configure(state="normal")
        stop_button.configure(state="disabled")
        entry.configure(state="normal")
        if result is None:
            set_status("error", STYLES["err"])
        elif result.stopped:
            set_status(f"stopped - {result.stop_reason}", STYLES["err"])
        elif result.stop_reason == "done":
            set_status(f"done in {result.steps} steps", STYLES["done"])
        else:
            set_status(result.stop_reason, STYLES["warn"])
        cost.configure(text=f"${agent.total.cost(settings.prices):.4f}")

    def worker(task: str) -> None:
        result = None
        try:
            result = agent.run(task)
        except Exception as exc:
            console.line("err", f"  error: {type(exc).__name__}: {exc}")
        finally:
            kill.clear()
            root.after(0, finish, result)

    def start(_event=None) -> None:
        task = entry.get().strip()
        if not task or busy.is_set():
            return
        entry.delete(0, "end")
        console.line("you", f"\n> {task}")
        busy.set()
        run_button.configure(state="disabled")
        stop_button.configure(state="normal")
        entry.configure(state="disabled")
        set_status("working...", STYLES["say"])
        threading.Thread(target=worker, args=(task,), daemon=True).start()

    def stop() -> None:
        kill.trip("Stop button")
        set_status("stopping...", STYLES["warn"])

    run_button.configure(command=start)
    stop_button.configure(command=stop)
    entry.bind("<Return>", start)
    root.bind("<Escape>", lambda _e: stop())

    console.line("dim", f"  model {settings.model} | {settings.kill_key.upper()} or Esc stops everything")
    console.line("dim", f"  log: {agent.log.path}")
    console.line("dim", "  type a task below, e.g. \"open chrome and go to youtube\"")
    entry.focus_set()

    # Poll the kill switch so an F12 press updates the window too.
    def watch_kill() -> None:
        if kill.tripped and busy.is_set():
            set_status("stopping...", STYLES["warn"])
        root.after(200, watch_kill)

    watch_kill()
    root.mainloop()
