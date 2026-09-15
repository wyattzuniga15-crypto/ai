"""Pilot - a desktop agent that sees your screen and works your mouse and keyboard.

    python main.py                       interactive prompt
    python main.py "open notepad"        run one task and exit
    python main.py --gui                 small always-on-top window
"""
from __future__ import annotations

import argparse
import sys

# DPI awareness has to be set before anything queries the display, otherwise
# Windows hands this process virtualised coordinates for the rest of its life.
from screen import enable_dpi_awareness

DPI_MODE = enable_dpi_awareness()

from agent import Agent, Console  # noqa: E402
from config import load_apps, load_settings, session_log_path  # noqa: E402
from safety import AutoApprover, KillSwitch, RiskEngine, SessionLog, TerminalApprover  # noqa: E402
from tools import ToolRunner  # noqa: E402

BANNER = r"""
  ___ _ _     _
 | _ (_) |___| |_
 |  _/ | / _ \  _|
 |_| |_|_\___/\__|   desktop agent
"""

HELP = """commands:
  <anything else>   run it as a task
  /apps             list the apps Pilot can launch directly
  /cost             total spend this session
  /model <name>     switch model (claude-sonnet-5, claude-opus-5)
  /steps <n>        change the max-steps limit
  /quit             exit
"""


def build(settings, dry_run: bool, yolo: bool, gui: bool = False):
    """Wire up the pieces. Returns (agent, kill_switch, log, runner)."""
    from screen import MssScreen

    log = SessionLog(session_log_path(settings.log_dir))
    kill = KillSwitch(settings.kill_key)

    screen_source = MssScreen(settings.max_width, settings.max_height, settings.monitor)
    if dry_run:
        # Nothing may reach the real machine: not the mouse, not the launcher.
        from controller import RecordingController
        from tools import RecordingOpener
        controller, opener = RecordingController(), RecordingOpener()
    else:
        from controller import PyAutoGuiController
        controller, opener = PyAutoGuiController(failsafe=settings.failsafe), None

    risk = RiskEngine(settings.confirm_risky and not yolo, settings.confirm_every_action)
    approver = AutoApprover(True) if yolo else TerminalApprover(kill)
    runner = ToolRunner(settings, screen_source, controller, risk, approver, log,
                        opener=opener, apps=load_apps(settings.apps_file))
    agent = Agent(settings, runner, kill, risk, approver, log, console=Console(colour=not gui))
    return agent, kill, log, runner


def run_task(agent, task: str) -> None:
    print()
    result = agent.run(task)
    print()
    if result.stopped:
        agent.console.line("err", f"  stopped after {result.steps} steps - {result.stop_reason}")
    elif result.stop_reason == "done":
        agent.console.line("done", f"  done in {result.steps} steps")
    else:
        agent.console.line("warn", f"  finished: {result.stop_reason}")
    agent.console.line("dim", f"  {result.usage.summary(agent.settings.prices)}")


def repl(agent, kill, settings) -> None:
    print(BANNER)
    print(f"  model {settings.model} | max {settings.max_steps} steps | "
          f"{settings.kill_key.upper()} stops everything")
    print(f"  dpi: {DPI_MODE}")
    print(f"  log: {agent.log.path}")
    print("  type a task, or /help\n")

    while True:
        try:
            raw = input("pilot> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not raw:
            continue

        if raw.startswith("/"):
            command, _, argument = raw[1:].partition(" ")
            command = command.lower()
            if command in {"quit", "exit", "q"}:
                return
            if command in {"help", "h", "?"}:
                print(HELP)
            elif command == "apps":
                apps = agent.runner.apps
                if not apps:
                    print("  apps.json is empty")
                for name, target in sorted(apps.items()):
                    print(f"  {name:<18} {target}")
            elif command == "cost":
                print(f"  session total: {agent.total.summary(settings.prices)}")
            elif command == "model":
                if argument.strip():
                    settings.model = argument.strip()
                    print(f"  model is now {settings.model}")
                else:
                    print(f"  model is {settings.model}")
            elif command == "steps":
                try:
                    settings.max_steps = max(1, int(argument))
                    print(f"  max steps is now {settings.max_steps}")
                except ValueError:
                    print("  usage: /steps 40")
            else:
                print(f"  unknown command {command!r}; try /help")
            continue

        try:
            run_task(agent, raw)
        except Exception as exc:
            agent.console.line("err", f"  error: {type(exc).__name__}: {exc}")
            agent.log.write("error", f"{type(exc).__name__}: {exc}")
        finally:
            kill.clear()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="pilot", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("task", nargs="*", help="task to run; omit for an interactive prompt")
    parser.add_argument("--gui", action="store_true", help="small always-on-top window instead")
    parser.add_argument("--model", help="override PILOT_MODEL")
    parser.add_argument("--max-steps", type=int, dest="max_steps")
    parser.add_argument("--delay", type=float, dest="action_delay", help="seconds between actions")
    parser.add_argument("--dry-run", action="store_true",
                        help="log every action but do not touch the mouse or keyboard")
    parser.add_argument("--yolo", action="store_true",
                        help="skip confirmation prompts (hard blocks still apply)")
    args = parser.parse_args(argv)

    settings = load_settings({"model": args.model, "max_steps": args.max_steps,
                              "action_delay": args.action_delay})
    if not settings.api_key:
        print("ANTHROPIC_API_KEY is not set.\n"
              "Copy .env.example to .env and put your key in it, then run again.", file=sys.stderr)
        return 2

    agent, kill, log, _ = build(settings, args.dry_run, args.yolo, gui=args.gui)

    if not kill.start():
        print(f"  note: global {settings.kill_key.upper()} hotkey unavailable "
              "(pynput missing or blocked) - Ctrl-C and the mouse failsafe still work")
    if args.dry_run:
        print("  DRY RUN - actions are logged, not performed")

    try:
        if args.gui:
            from ui import run_window
            run_window(agent, kill, settings)
        elif args.task:
            run_task(agent, " ".join(args.task))
        else:
            repl(agent, kill, settings)
    finally:
        kill.stop()
        log.write("session", f"total {agent.total.summary(settings.prices)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
