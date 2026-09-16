"""The agent loop: talk to Claude, execute what it asks for, feed back the screen."""
from __future__ import annotations

import ctypes
import os
import random
import sys
from dataclasses import dataclass, field

import anthropic

import screen as screen_mod
from config import CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER, TOOLSET_NAME
from safety import BLOCK, CONFIRM, Stopped
from tools import ToolRunner, tool_definitions

SKIPPED_IN_BATCH = "Not executed: an earlier computer action in this turn failed."

SYSTEM_PROMPT = """You are Pilot, driving a real Windows 10/11 desktop on behalf of the person \
who typed the task. You act through the computer toolset plus two shortcuts, and everything you \
do happens on their actual machine.

How to work:
* Start from the screenshot you are given. Look before you act.
* To open an application, call launch_app first. It checks the user's own app registry, then the \
Start Menu, and it is far more reliable than hunting for desktop icons. To open a web page, call \
open_url. Only fall back to clicking and typing when those fail.
* Coordinates you give are in the pixel space of the screenshots you receive. Click the centre of \
what you are aiming at.
* After an action that changes the screen, take a screenshot before deciding the next move. \
Batch actions that obviously belong together (click a field, type into it, screenshot).
* Apps take time to appear. If a window has not shown up, use wait a few seconds and look again \
rather than clicking where you expect it to be. Games can take 30 seconds or more.
* If small text matters, use zoom rather than guessing.
* Say what you see and why you are doing the next thing, in one short sentence, before acting.

Rules you must not break:
* Never type passwords, card numbers, or security codes. If a task needs a login, stop and tell \
the person to sign in themselves, then continue once they say they have.
* Anything that sends, posts, buys, submits, or deletes gets announced plainly before you do it. \
The user's machine will ask them to confirm, and they may refuse; that is expected, not an error.
* If an action is refused or the screen does not match what you expected, re-read the screen \
instead of repeating the same click.

When the task is done, say so plainly and stop calling tools. If you cannot do it, say what \
blocked you."""


@dataclass
class Usage:
    input: int = 0
    output: int = 0
    cache_read: int = 0
    cache_write: int = 0

    def add(self, raw) -> None:
        self.input += getattr(raw, "input_tokens", 0) or 0
        self.output += getattr(raw, "output_tokens", 0) or 0
        self.cache_read += getattr(raw, "cache_read_input_tokens", 0) or 0
        self.cache_write += getattr(raw, "cache_creation_input_tokens", 0) or 0

    def cost(self, prices: dict[str, float]) -> float:
        return (
            self.input / 1e6 * prices["input"]
            + self.output / 1e6 * prices["output"]
            + self.cache_read / 1e6 * prices["input"] * CACHE_READ_MULTIPLIER
            + self.cache_write / 1e6 * prices["input"] * CACHE_WRITE_MULTIPLIER
        )

    def summary(self, prices: dict[str, float]) -> str:
        return (f"{self.input + self.cache_read + self.cache_write:,} in / {self.output:,} out"
                f" (cache hit {self.cache_read:,}) ~ ${self.cost(prices):.4f}")


@dataclass
class Result:
    task: str
    steps: int = 0
    stopped: bool = False
    stop_reason: str = ""
    final_text: str = ""
    usage: Usage = field(default_factory=Usage)


def enable_ansi_colours() -> bool:
    """Turn on ANSI escape handling, and say whether colour is safe to emit.

    Windows consoles understand these codes but do not process them until the
    mode is set, so classic cmd.exe would print the step log as a wall of
    literal escape sequences. Windows Terminal enables it already; conhost
    often does not.
    """
    if not sys.stdout.isatty() or os.environ.get("NO_COLOR"):
        return False
    if sys.platform != "win32":
        return True
    try:
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        mode = ctypes.c_uint32()
        if not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        enable_vt = 0x0004  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
        if mode.value & enable_vt:
            return True
        return bool(kernel32.SetConsoleMode(handle, mode.value | enable_vt))
    except (AttributeError, OSError):
        return False


class Console:
    """Terminal output. The GUI passes its own object with the same methods."""

    COLOURS = {"say": "\033[36m", "think": "\033[90m", "do": "\033[32m",
               "warn": "\033[33m", "err": "\033[31m", "done": "\033[1;32m", "dim": "\033[90m"}

    def __init__(self, colour: bool | None = None):
        # None means decide for this terminal; False is the GUI forcing it off.
        self.colour = enable_ansi_colours() if colour is None else colour

    def line(self, kind: str, text: str) -> None:
        if self.colour and kind in self.COLOURS:
            print(f"{self.COLOURS[kind]}{text}\033[0m")
        else:
            print(text)


class Agent:
    def __init__(self, settings, runner: ToolRunner, kill_switch, risk, approver, log,
                 client=None, console: Console | None = None):
        self.settings = settings
        self.runner = runner
        self.kill = kill_switch
        self.risk = risk
        self.approver = approver
        self.log = log
        self.console = console or Console()
        self.client = client or anthropic.Anthropic(api_key=settings.api_key or None)
        self.total = Usage()
        self._thinking_enabled = settings.thinking == "adaptive"
        # Long waits must remain interruptible by the kill switch.
        self.runner.sleep = self.kill.sleep
        self.runner.controller.sleep = self.kill.sleep

    # -- API ----------------------------------------------------------------

    def _request_kwargs(self, messages: list) -> dict:
        kwargs = {
            "model": self.settings.model,
            "max_tokens": self.settings.max_tokens,
            "system": [{"type": "text", "text": SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"}}],
            "tools": tool_definitions(),
            "messages": messages,
            "output_config": {"effort": self.settings.effort},
        }
        if self._thinking_enabled:
            # display="summarized" is what gives the user a readable "why" line;
            # the default on Sonnet 5 / Opus 5 is "omitted".
            kwargs["thinking"] = {"type": "adaptive", "display": "summarized"}
        return kwargs

    def _call(self, messages: list):
        """One API call, with backoff for the failures that are worth retrying."""
        delay = 2.0
        last_error = None
        for attempt in range(5):
            self.kill.check()
            try:
                return self.client.messages.create(**self._request_kwargs(messages))
            except anthropic.BadRequestError as exc:
                text = str(exc).lower()
                if self._thinking_enabled and "thinking" in text:
                    # Some model/history combinations reject replayed thinking
                    # blocks. Drop thinking rather than losing the whole run.
                    self._thinking_enabled = False
                    self.console.line("warn", "  api rejected thinking blocks; continuing without them")
                    self.log.write("api", f"disabled thinking after 400: {exc}")
                    continue
                raise
            except (anthropic.RateLimitError, anthropic.InternalServerError,
                    anthropic.APIConnectionError, anthropic.APITimeoutError) as exc:
                last_error = exc
                wait = delay + random.uniform(0, 0.5)
                self.console.line("warn", f"  {type(exc).__name__}; retrying in {wait:.1f}s")
                self.log.write("api", f"{type(exc).__name__}: {exc} - retry in {wait:.1f}s")
                self.kill.sleep(wait)
                delay = min(delay * 2, 30.0)
        raise RuntimeError(f"gave up after repeated API failures: {last_error}")

    # -- history ------------------------------------------------------------

    def trim_history(self, messages: list) -> int:
        """Keep only the newest N screenshots; replace older ones with a note.

        Screenshots dominate the token bill in a loop like this, and an image
        from eight steps ago is no longer describing the screen.
        """
        keep = self.settings.screenshots_in_context
        seen = 0
        removed = 0
        for message in reversed(messages):
            content = message.get("content")
            if not isinstance(content, list):
                continue
            for block in reversed(content):
                if not isinstance(block, dict) or block.get("type") != "tool_result":
                    continue
                blocks = block.get("content")
                if not isinstance(blocks, list):
                    continue
                for index in range(len(blocks) - 1, -1, -1):
                    if not (isinstance(blocks[index], dict) and blocks[index].get("type") == "image"):
                        continue
                    seen += 1
                    if seen > keep:
                        blocks[index] = {"type": "text",
                                         "text": "[earlier screenshot removed to save tokens]"}
                        removed += 1
        return removed

    # -- tool execution -----------------------------------------------------

    def _result_block(self, block, content, is_error: bool = False) -> dict:
        result = {"type": "tool_result", "tool_use_id": block.id, "content": content}
        if getattr(block, "toolset_name", None):
            # Member results must echo the toolset name back.
            result["toolset_name"] = block.toolset_name
        if is_error:
            result["is_error"] = True
        return result

    def _run_tool_blocks(self, blocks: list, narration: str) -> list[dict]:
        """Execute a batch in order, stopping at the first failure."""
        self.risk.set_narration(narration)
        results: list[dict] = []
        failed = False

        for block in blocks:
            if failed:
                results.append(self._result_block(block, SKIPPED_IN_BATCH, is_error=True))
                continue

            self.kill.check()
            name = block.name
            payload = dict(block.input or {})
            is_member = getattr(block, "toolset_name", None) == TOOLSET_NAME

            if is_member:
                summary = self.runner._summarise(name, payload)
                verdict = self.risk.gate(name, payload)
                if verdict.level == BLOCK:
                    self.console.line("err", f"  blocked: {summary} - {verdict.reason}")
                    self.log.write("blocked", f"{summary} - {verdict.reason}")
                    results.append(self._result_block(
                        block,
                        f"Refused by the user's safety policy: {verdict.reason}. "
                        "Do not retry this; tell the user they need to do it themselves.",
                        is_error=True))
                    failed = True
                    continue
                if verdict.level == CONFIRM:
                    self.log.write("confirm", f"asked about {summary} - {verdict.reason}")
                    if not self.approver.ask(summary, verdict.reason):
                        self.console.line("warn", f"  declined: {summary}")
                        self.log.write("declined", summary)
                        results.append(self._result_block(
                            block,
                            "The user declined this action. Stop and ask them what to do instead.",
                            is_error=True))
                        failed = True
                        continue
                    self.log.write("approved", summary)
            else:
                summary = f"{name}({', '.join(f'{k}={v!r}' for k, v in payload.items())})"

            self.console.line("do", f"  > {summary}")
            self.log.write("action", summary)

            try:
                if is_member:
                    content = self.runner.execute_member(name, payload)
                elif name == "launch_app":
                    content = self.runner.launch_app(payload.get("name", ""))
                elif name == "open_url":
                    content = self.runner.open_url(payload.get("url", ""))
                else:
                    raise ValueError(f"unknown tool {name!r}")
            except Stopped:
                raise
            except Exception as exc:  # a failed action is information, not a crash
                message = f"{type(exc).__name__}: {exc}"
                self.console.line("err", f"    failed - {message}")
                self.log.write("error", f"{summary} - {message}")
                results.append(self._result_block(block, f"Action failed. {message}", is_error=True))
                failed = True
                continue

            if isinstance(content, str) and not content.startswith("Launched") and len(content) < 80:
                self.log.write("result", content)
            results.append(self._result_block(block, content))
            self.kill.sleep(self.settings.action_delay)

        return results

    # -- the loop -----------------------------------------------------------

    def run(self, task: str) -> Result:
        result = Result(task=task)
        self.kill.clear()
        self.risk.set_task(task)
        self.risk.set_narration("")
        self.log.banner(task, self.settings.model)

        opening_shot = self.runner.capture()
        self.console.line("dim", f"  screen: {self.runner.describe_screen()}")
        messages: list = [{
            "role": "user",
            "content": [
                {"type": "text", "text": f"Task: {task}\n\nHere is the screen right now."},
                screen_mod.image_block(opening_shot),
            ],
        }]

        try:
            for step in range(1, self.settings.max_steps + 1):
                result.steps = step
                self.kill.check()
                self.trim_history(messages)

                response = self._call(messages)
                result.usage.add(response.usage)
                self.total.add(response.usage)

                narration_parts: list[str] = []
                for block in response.content:
                    if block.type == "thinking" and getattr(block, "thinking", ""):
                        for line in str(block.thinking).strip().splitlines():
                            if line.strip():
                                self.console.line("think", f"  ~ {line.strip()}")
                    elif block.type == "text" and block.text.strip():
                        narration_parts.append(block.text.strip())
                        self.console.line("say", f"  {block.text.strip()}")

                narration = "\n".join(narration_parts)
                if narration:
                    self.log.write("claude", narration.replace("\n", " ")[:400])

                if response.stop_reason == "refusal":
                    result.stop_reason = "the model declined this request"
                    result.final_text = narration
                    break

                tool_blocks = [b for b in response.content if b.type == "tool_use"]
                if not tool_blocks:
                    result.final_text = narration
                    result.stop_reason = "done"
                    break

                messages.append({"role": "assistant", "content": response.content})
                tool_results = self._run_tool_blocks(tool_blocks, narration)
                messages.append({"role": "user", "content": tool_results})

                self.console.line("dim",
                                  f"  step {step}/{self.settings.max_steps} - "
                                  f"{result.usage.summary(self.settings.prices)}")
            else:
                result.stop_reason = f"hit the {self.settings.max_steps}-step limit"

        except Stopped as exc:
            result.stopped = True
            result.stop_reason = str(exc) or "stopped"
            self.console.line("err", f"\n  STOPPED - {result.stop_reason}")
            self.log.write("stopped", result.stop_reason)
        except KeyboardInterrupt:
            result.stopped = True
            result.stop_reason = "interrupted with Ctrl-C"
            self.log.write("stopped", result.stop_reason)

        self.log.write("summary",
                       f"{result.steps} steps, {result.stop_reason}, "
                       f"{result.usage.summary(self.settings.prices)}")
        return result
