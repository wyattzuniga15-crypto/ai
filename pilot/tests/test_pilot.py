"""Headless test suite. Runs anywhere -- no display, no API key, no Windows.

    python tests/test_pilot.py

Fake screen + recording controller + scripted API responses let the real agent
loop run end to end, so the things most likely to be wrong (coordinate scaling,
batch semantics, the safety gate, history trimming) are actually exercised.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import agent as agent_mod  # noqa: E402
import screen as screen_mod  # noqa: E402
from config import Settings, load_apps  # noqa: E402
import controller as controller_mod  # noqa: E402
from controller import (INPUT_SIZE_X64, WHEEL_DELTA, RecordingController,  # noqa: E402
                        _INPUT, parse_combo, send_unicode, unicode_key_events,
                        utf16_units)
from safety import (ALLOW, BLOCK, CONFIRM, AutoApprover, KillSwitch,  # noqa: E402
                    RiskEngine, SessionLog, Stopped)
from screen import (Frame, current_dpi_awareness, dpi_awareness_is_usable,  # noqa: E402
                    enable_dpi_awareness, fit_within)
from tools import ToolRunner, best_match  # noqa: E402


# --- doubles ---------------------------------------------------------------

class FakeScreen(screen_mod.ScreenSource):
    def __init__(self, capture=(2560, 1440), shot=(1280, 720)):
        from PIL import Image
        self._Image = Image
        self.capture_size = capture
        self.shot_size = shot
        self.captures = 0
        self.zooms: list = []

    def _frame(self):
        return Frame(self.capture_size[0], self.capture_size[1],
                     self.shot_size[0], self.shot_size[1])

    def capture(self):
        self.captures += 1
        image = self._Image.new("RGB", self.shot_size, (20, 30, 40))
        return screen_mod.encode_png(image), self._frame()

    def zoom(self, region, max_width, max_height):
        self.zooms.append(list(region))
        image = self._Image.new("RGB", (320, 200), (90, 10, 10))
        return screen_mod.encode_png(image), self._frame()


class FakeOpener:
    def __init__(self):
        self.started: list[str] = []
        self.browsed: list[str] = []

    def start(self, target): self.started.append(target)
    def browse(self, url): self.browsed.append(url)


def use(name, payload, toolset="computer", block_id=None):
    return SimpleNamespace(type="tool_use", id=block_id or f"toolu_{name}_{len(payload)}",
                           name=name, input=payload, toolset_name=toolset)


def text(body):
    return SimpleNamespace(type="text", text=body)


def reply(blocks, stop_reason="tool_use", tokens=(1000, 50)):
    return SimpleNamespace(
        content=blocks, stop_reason=stop_reason,
        usage=SimpleNamespace(input_tokens=tokens[0], output_tokens=tokens[1],
                              cache_read_input_tokens=0, cache_creation_input_tokens=0))


class FakeClient:
    """Replays a script of responses and records what it was sent."""

    def __init__(self, script):
        self.script = list(script)
        self.requests: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.requests.append(kwargs)
        if not self.script:
            return reply([text("All done.")], stop_reason="end_turn")
        return self.script.pop(0)


def build_agent(script, settings=None, approver=None, apps=None, kill=None):
    settings = settings or Settings(model="claude-sonnet-5", action_delay=0.0, max_steps=10)
    kill = kill or KillSwitch("f12")
    log = SessionLog(Path(tempfile.gettempdir()) / "pilot-test.log")
    risk = RiskEngine(confirm_risky=True)
    approver = approver or AutoApprover(True)
    screen = FakeScreen()
    controller = RecordingController()
    opener = FakeOpener()
    runner = ToolRunner(settings, screen, controller, risk, approver, log,
                        opener=opener, apps=apps or {})
    console = agent_mod.Console(colour=False)
    a = agent_mod.Agent(settings, runner, kill, risk, approver, log,
                        client=FakeClient(script), console=console)
    return a, controller, screen, opener


# --- tests -----------------------------------------------------------------

class TestScaling(unittest.TestCase):
    def test_fit_within_preserves_aspect_and_never_upscales(self):
        self.assertEqual(fit_within(2560, 1440, 1280, 800), (1280, 720))
        self.assertEqual(fit_within(3840, 2160, 1280, 800), (1280, 720))
        self.assertEqual(fit_within(1920, 1200, 1280, 800), (1280, 800))
        self.assertEqual(fit_within(800, 600, 1280, 800), (800, 600))  # no upscale
        self.assertEqual(fit_within(1080, 2400, 1280, 800), (360, 800))  # portrait

    def test_centre_maps_to_centre(self):
        frame = Frame(2560, 1440, 1280, 720)
        self.assertEqual(frame.to_desktop(640, 360), (1281, 721))
        self.assertEqual(frame.to_shot(1280, 720), (640, 360))

    def test_round_trip_is_lossless_within_a_pixel(self):
        frame = Frame(3840, 2160, 1280, 720)
        for x in range(0, 1280, 37):
            for y in range(0, 720, 23):
                bx, by = frame.to_shot(*frame.to_desktop(x, y))
                self.assertEqual((bx, by), (x, y))

    def test_coordinates_clamp_to_the_screen(self):
        frame = Frame(2560, 1440, 1280, 720)
        self.assertEqual(frame.to_desktop(5000, 5000), (2559, 1439))
        self.assertEqual(frame.to_desktop(-10, -10), (0, 0))

    def test_multi_monitor_origin_offset(self):
        # A second display to the left of the primary has a negative origin, and
        # pyautogui expects those absolute desktop coordinates.
        frame = Frame(1920, 1080, 960, 540, origin_x=-1920, origin_y=0)
        self.assertEqual(frame.scale_x, 2.0)
        # Pixel-centre sampling: screenshot pixel 0 covers capture pixels 0-1,
        # and we aim at its middle rather than its top-left corner.
        self.assertEqual(frame.to_desktop(0, 0), (-1919, 1))
        self.assertEqual(frame.to_desktop(480, 270), (-959, 541))
        self.assertEqual(frame.to_shot(-959, 541), (480, 270))
        # Clamping stays inside that monitor, not inside the primary.
        self.assertEqual(frame.to_desktop(9999, 9999), (-1, 1079))

    def test_zoom_region_maps_into_capture_space(self):
        frame = Frame(2560, 1440, 1280, 720)
        self.assertEqual(frame.region_to_desktop([100, 200, 300, 400]), (200, 400, 600, 800))
        # inverted input is normalised rather than producing a negative box
        self.assertEqual(frame.region_to_desktop([300, 400, 100, 200]), (200, 400, 600, 800))


class FakePyAutoGui:
    """Enough of pyautogui to drive PyAutoGuiController without a display."""

    KEYBOARD_KEYS = ["a", "s", "enter", "tab", "ctrl", "shift", "win", "esc", "f5"]
    FAILSAFE = True
    FAILSAFE_POINTS = [(0, 0), (0, 767), (1023, 0), (1023, 767)]
    PAUSE = 0

    def __init__(self):
        self.calls: list[tuple] = []
        self._pos = (5, 5)

    def size(self): return (1024, 768)
    def position(self): return self._pos
    def moveTo(self, x, y, duration=0): self._pos = (x, y); self.calls.append(("moveTo", x, y))
    def click(self, button="left", clicks=1, interval=0.0): self.calls.append(("click", button, clicks))
    def mouseDown(self, button="left"): self.calls.append(("down", button))
    def mouseUp(self, button="left"): self.calls.append(("up", button))
    def scroll(self, amount): self.calls.append(("scroll", amount))
    def hscroll(self, amount): self.calls.append(("hscroll", amount))
    def typewrite(self, text, interval=0.0): self.calls.append(("typewrite", text))
    def write(self, text): self.calls.append(("write", text))
    def press(self, key): self.calls.append(("press", key))
    def hotkey(self, *keys): self.calls.append(("hotkey", keys))
    def keyDown(self, key): self.calls.append(("keyDown", key))
    def keyUp(self, key): self.calls.append(("keyUp", key))


def windows_controller(fake=None, failsafe=True):
    """A PyAutoGuiController wired to a fake pyautogui, pretending to be Windows."""
    fake = fake or FakePyAutoGui()
    sys.modules["pyautogui"] = fake
    from controller import PyAutoGuiController
    # __init__ writes FAILSAFE onto the module from its own argument, so the
    # flag has to be set here rather than on the fake.
    controller = PyAutoGuiController(failsafe=failsafe)
    controller._windows = True
    return controller, fake


class TestScrollSemantics(unittest.TestCase):
    """pyautogui's Windows wheel handling is wrong in two ways; both are fixed.

    Its _scroll passes the argument straight through as mouse_event's dwData,
    which Windows counts in WHEEL_DELTA units, and its _hscroll just calls
    _scroll -- so unscaled values barely move and "scroll right" scrolls down.
    """

    def tearDown(self):
        sys.modules.pop("pyautogui", None)

    def test_vertical_scroll_is_scaled_to_wheel_delta_on_windows(self):
        controller, fake = windows_controller()
        controller.scroll(3)
        self.assertIn(("scroll", 3 * WHEEL_DELTA), fake.calls)
        self.assertEqual(WHEEL_DELTA, 120)

    def test_horizontal_scroll_does_not_go_through_pyautogui_on_windows(self):
        controller, fake = windows_controller()
        sent = []
        original = controller_mod.send_hwheel
        controller_mod.send_hwheel = lambda amount: sent.append(amount)
        try:
            controller.scroll(2, horizontal=True)
            controller.scroll(-2, horizontal=True)
        finally:
            controller_mod.send_hwheel = original
        self.assertEqual(sent, [2 * WHEEL_DELTA, -2 * WHEEL_DELTA])
        # The broken pyautogui path must not be used at all.
        self.assertNotIn("hscroll", [c[0] for c in fake.calls])

    def test_off_windows_notches_pass_through_unscaled(self):
        controller, fake = windows_controller()
        controller._windows = False
        controller.scroll(3)
        controller.scroll(3, horizontal=True)
        self.assertIn(("scroll", 3), fake.calls)
        self.assertIn(("hscroll", 3), fake.calls)

    def test_hwheel_is_guarded_off_windows(self):
        with self.assertRaises(OSError):
            controller_mod.send_hwheel(120)


class TestFailsafeCorners(unittest.TestCase):
    """FAILSAFE_POINTS is every screen corner, so a real corner click would abort."""

    def tearDown(self):
        sys.modules.pop("pyautogui", None)

    def test_corner_targets_are_nudged_one_pixel_inward(self):
        controller, fake = windows_controller()
        for corner in FakePyAutoGui.FAILSAFE_POINTS:
            controller.move(*corner)
            self.assertNotIn(tuple(fake._pos), [tuple(p) for p in FakePyAutoGui.FAILSAFE_POINTS])
            self.assertLessEqual(max(abs(fake._pos[0] - corner[0]),
                                     abs(fake._pos[1] - corner[1])), 1)

    def test_ordinary_points_are_untouched(self):
        controller, fake = windows_controller()
        controller.move(400, 300)
        self.assertEqual(fake._pos, (400, 300))

    def test_nudging_is_skipped_when_failsafe_is_off(self):
        controller, fake = windows_controller(failsafe=False)
        controller.move(0, 0)
        self.assertEqual(fake._pos, (0, 0))


class TestUnicodeTyping(unittest.TestCase):
    """pyautogui drops any character outside KEYBOARD_KEYS without an error."""

    def tearDown(self):
        sys.modules.pop("pyautogui", None)

    def test_input_struct_matches_the_windows_x64_abi(self):
        # Fixed-width fields keep this 40 bytes on every platform; c_ulong
        # would make it 56 on Linux and SendInput rejects a wrong cbSize.
        import ctypes
        self.assertEqual(ctypes.sizeof(_INPUT), INPUT_SIZE_X64)
        self.assertEqual(INPUT_SIZE_X64, 40)

    def test_astral_characters_become_surrogate_pairs(self):
        self.assertEqual(utf16_units("a"), [0x0061])
        self.assertEqual(utf16_units("\u2014"), [0x2014])          # em dash
        self.assertEqual(len(utf16_units("\U0001F600")), 2)        # emoji
        # one press and one release per code unit
        self.assertEqual(len(unicode_key_events("a")), 2)
        self.assertEqual(len(unicode_key_events("\U0001F600")), 4)

    def test_unicode_injection_is_guarded_off_windows(self):
        with self.assertRaises(OSError):
            send_unicode("x")

    def test_ascii_stays_on_pyautogui_and_unicode_is_injected(self):
        controller, fake = windows_controller()
        injected = []
        original = controller_mod.send_unicode
        controller_mod.send_unicode = lambda text: injected.append(text) or len(text)
        try:
            controller.type_text("caf\u00e9 ok")
        finally:
            controller_mod.send_unicode = original
        # ASCII runs keep real scan codes; only the accented run is injected.
        self.assertEqual(injected, ["\u00e9"])
        self.assertIn(("typewrite", "caf"), fake.calls)
        self.assertIn(("typewrite", " ok"), fake.calls)

    def test_newlines_and_tabs_become_key_presses(self):
        controller, fake = windows_controller()
        controller.type_text("a\nb\tc")
        self.assertIn(("press", "enter"), fake.calls)
        self.assertIn(("press", "tab"), fake.calls)


class TestKeyValidation(unittest.TestCase):
    """_keyDown returns silently for an unknown name, which looks like success."""

    def tearDown(self):
        sys.modules.pop("pyautogui", None)

    def test_unknown_key_raises_instead_of_doing_nothing(self):
        controller, fake = windows_controller()
        with self.assertRaises(ValueError) as caught:
            controller.press(parse_combo("Nonexistent_Key"))
        self.assertIn("nonexistent_key", str(caught.exception))
        self.assertEqual(fake.calls, [])

    def test_known_keys_and_combos_are_accepted(self):
        controller, fake = windows_controller()
        controller.press(parse_combo("ctrl+s"))
        controller.press(parse_combo("Return"))
        self.assertIn(("hotkey", ("ctrl", "s")), fake.calls)
        self.assertIn(("press", "enter"), fake.calls)

    def test_hold_and_key_down_validate_too(self):
        controller, _ = windows_controller()
        for call in (lambda: controller.hold(["bogus"], 0.0),
                     lambda: controller.key_down("bogus"),
                     lambda: controller.key_up("bogus")):
            with self.assertRaises(ValueError):
                call()


class TestDpi(unittest.TestCase):
    def test_reports_a_mode_without_raising_on_any_platform(self):
        for mode in (enable_dpi_awareness(), current_dpi_awareness()):
            self.assertIsInstance(mode, str)
            self.assertTrue(mode)

    def test_only_untrustworthy_modes_are_rejected(self):
        self.assertTrue(dpi_awareness_is_usable("per-monitor-v2"))
        self.assertTrue(dpi_awareness_is_usable("system-dpi"))
        self.assertTrue(dpi_awareness_is_usable("not windows; no DPI call needed"))
        self.assertFalse(dpi_awareness_is_usable("unaware - clicks WILL be offset"))
        self.assertFalse(dpi_awareness_is_usable("unknown - run test_scaling.py first"))


class TestKeys(unittest.TestCase):
    def test_x11_names_become_pyautogui_names(self):
        self.assertEqual(parse_combo("Return"), ["enter"])
        self.assertEqual(parse_combo("ctrl+s"), ["ctrl", "s"])
        self.assertEqual(parse_combo("super"), ["win"])
        self.assertEqual(parse_combo("Page_Down"), ["pagedown"])
        self.assertEqual(parse_combo("ctrl+shift+Escape"), ["ctrl", "shift", "esc"])
        self.assertEqual(parse_combo("ctrl++"), ["ctrl", "+"])
        self.assertEqual(parse_combo(""), [])


class TestSafety(unittest.TestCase):
    def setUp(self):
        self.risk = RiskEngine()

    def test_secrets_are_blocked_outright(self):
        for secret in ["4111 1111 1111 1111", "sk-ant-api03-abc12345678",
                       "my password is hunter2", "123-45-6789"]:
            self.assertEqual(self.risk.gate("type", {"text": secret}).level, BLOCK, secret)

    def test_ordinary_typing_is_allowed(self):
        self.assertEqual(self.risk.gate("type", {"text": "hello world"}).level, ALLOW)
        self.assertEqual(self.risk.gate("type", {"text": "youtube.com"}).level, ALLOW)

    def test_destructive_shell_text_asks_first(self):
        self.assertEqual(self.risk.gate("type", {"text": "rm -rf ~/stuff"}).level, CONFIRM)
        self.assertEqual(self.risk.gate("type", {"text": "DROP TABLE users"}).level, CONFIRM)

    def test_enter_is_only_risky_when_intent_is_committal(self):
        self.assertEqual(self.risk.gate("key", {"text": "Return"}).level, ALLOW)
        self.risk.set_narration("Now I'll click Send to send the email.")
        self.assertEqual(self.risk.gate("key", {"text": "Return"}).level, CONFIRM)
        self.assertEqual(self.risk.gate("left_click", {}).level, CONFIRM)

    def test_task_text_alone_can_make_clicks_committal(self):
        risk = RiskEngine()
        risk.set_task("delete every screenshot in my downloads folder")
        self.assertEqual(risk.gate("left_click", {}).level, CONFIRM)

    def test_confirmations_can_be_turned_off_but_blocks_cannot(self):
        risk = RiskEngine(confirm_risky=False)
        risk.set_narration("I'll send it now")
        self.assertEqual(risk.gate("left_click", {}).level, ALLOW)
        self.assertEqual(risk.gate("type", {"text": "4111111111111111"}).level, BLOCK)

    def test_kill_switch_interrupts_sleep(self):
        kill = KillSwitch("f12")
        kill.trip("F12 pressed")
        with self.assertRaises(Stopped):
            kill.sleep(5.0)
        kill.clear()
        kill.sleep(0.0)  # no longer raises


class TestAppLaunching(unittest.TestCase):
    def test_apps_json_shipped_with_pilot_parses(self):
        apps = load_apps(Path(__file__).resolve().parent.parent / "apps.json")
        self.assertIn("bonelab", apps)
        self.assertEqual(apps["bonelab"], "steam://rungameid/1592190")
        self.assertNotIn("_comment", apps)  # underscore keys are metadata

    def test_registry_hit_uses_the_uri(self):
        a, _, _, opener = build_agent([], apps={"bonelab": "steam://rungameid/1592190"})
        message = a.runner.launch_app("Bonelab")
        self.assertEqual(opener.started, ["steam://rungameid/1592190"])
        self.assertIn("steam://rungameid/1592190", message)

    def test_partial_names_resolve(self):
        a, _, _, opener = build_agent([], apps={"spotify": "spotify:"})
        a.runner.launch_app("open spotify")
        self.assertEqual(opener.started, ["spotify:"])

    def test_unknown_app_reports_rather_than_crashing(self):
        a, _, _, opener = build_agent([], apps={})
        message = a.runner.launch_app("nonexistent thing")
        self.assertEqual(opener.started, [])
        self.assertIn("nonexistent thing", message)

    def test_open_url_adds_scheme_and_rejects_others(self):
        a, _, _, opener = build_agent([], apps={})
        a.runner.open_url("youtube.com")
        self.assertEqual(opener.browsed, ["https://youtube.com"])
        message = a.runner.open_url("file:///C:/Windows/System32")
        self.assertIn("Refusing", message)
        self.assertEqual(len(opener.browsed), 1)

    def test_start_menu_matching_prefers_the_shorter_name(self):
        candidates = {"google chrome": "A", "chrome remote desktop": "B"}
        self.assertEqual(best_match("chrome", candidates), "A")


class TestAgentLoop(unittest.TestCase):
    def test_full_task_scales_coordinates_to_the_real_screen(self):
        script = [
            reply([text("I'll open Notepad."), use("launch_app", {"name": "notepad"}, toolset=None)]),
            reply([text("Notepad is open; typing."),
                   use("left_click", {"coordinate": [640, 360]}),
                   use("type", {"text": "hello"}),
                   use("screenshot", {})]),
            reply([text("Done - Notepad has 'hello' in it.")], stop_reason="end_turn"),
        ]
        a, controller, screen, opener = build_agent(script, apps={"notepad": "notepad.exe"})
        result = a.run("open notepad and type hello")

        self.assertEqual(result.stop_reason, "done")
        self.assertEqual(result.steps, 3)
        self.assertIn("Done", result.final_text)
        self.assertEqual(opener.started, ["notepad.exe"])
        # 640,360 in a 1280x720 screenshot of a 2560x1440 screen -> 1281,721
        self.assertIn(("click", "left", 1, 1281, 721), controller.calls)
        self.assertIn(("type", "hello"), controller.calls)

    def test_member_results_echo_toolset_name_and_custom_ones_do_not(self):
        script = [reply([use("screenshot", {}), use("open_url", {"url": "https://x.com"}, toolset=None)]),
                  reply([text("done")], stop_reason="end_turn")]
        a, _, _, _ = build_agent(script)
        a.run("open a url")
        tool_results = a.client.requests[-1]["messages"][-1]["content"]
        self.assertEqual(tool_results[0]["toolset_name"], "computer")
        self.assertNotIn("toolset_name", tool_results[1])

    def test_batch_stops_at_the_first_failure_and_marks_the_rest(self):
        script = [reply([text("clicking"),
                         use("zoom", {}, block_id="bad"),          # missing region -> fails
                         use("type", {"text": "never"}, block_id="skipped1"),
                         use("screenshot", {}, block_id="skipped2")]),
                  reply([text("recovering")], stop_reason="end_turn")]
        a, controller, _, _ = build_agent(script)
        a.run("do a batch")

        results = a.client.requests[-1]["messages"][-1]["content"]
        self.assertTrue(results[0]["is_error"])
        for skipped in results[1:]:
            self.assertTrue(skipped["is_error"])
            self.assertEqual(skipped["content"], agent_mod.SKIPPED_IN_BATCH)
        self.assertNotIn(("type", "never"), controller.calls)

    def test_declining_a_confirmation_halts_the_batch(self):
        script = [reply([text("I'll click Send to send the message."),
                         use("left_click", {"coordinate": [10, 10]}),
                         use("type", {"text": "after"})]),
                  reply([text("understood")], stop_reason="end_turn")]
        a, controller, _, _ = build_agent(script, approver=AutoApprover(False))
        a.run("send a message to bob")

        results = a.client.requests[-1]["messages"][-1]["content"]
        self.assertTrue(results[0]["is_error"])
        self.assertIn("declined", results[0]["content"])
        self.assertEqual(results[1]["content"], agent_mod.SKIPPED_IN_BATCH)
        self.assertEqual([c for c in controller.calls if c[0] == "click"], [])

    def test_blocked_secret_never_reaches_the_keyboard(self):
        script = [reply([use("type", {"text": "4111 1111 1111 1111"})]),
                  reply([text("I won't do that")], stop_reason="end_turn")]
        a, controller, _, _ = build_agent(script)
        a.run("pay for the thing")
        results = a.client.requests[-1]["messages"][-1]["content"]
        self.assertTrue(results[0]["is_error"])
        self.assertIn("safety policy", results[0]["content"])
        self.assertEqual([c for c in controller.calls if c[0] == "type"], [])

    def test_history_keeps_only_the_configured_number_of_screenshots(self):
        settings = Settings(action_delay=0.0, max_steps=12, screenshots_in_context=3)
        script = [reply([use("screenshot", {})]) for _ in range(6)]
        script.append(reply([text("done")], stop_reason="end_turn"))
        a, _, _, _ = build_agent(script, settings=settings)
        a.run("look around repeatedly")

        sent = a.client.requests[-1]["messages"]
        images = sum(1 for m in sent if isinstance(m.get("content"), list)
                     for b in m["content"] if isinstance(b, dict)
                     for sub in ([b] if b.get("type") == "image" else b.get("content") or [])
                     if isinstance(sub, dict) and sub.get("type") == "image")
        self.assertLessEqual(images, settings.screenshots_in_context + 1)  # +1 for the opening shot
        placeholders = json.dumps(sent, default=str).count("removed to save tokens")
        self.assertGreater(placeholders, 0)

    def test_kill_switch_stops_mid_run(self):
        kill = KillSwitch("f12")

        class TrippingApprover(AutoApprover):
            def ask(self, summary, reason):
                kill.trip("F12 pressed")
                return True

        script = [reply([text("I'll delete the files now."),
                         use("left_click", {"coordinate": [5, 5]}),
                         use("type", {"text": "more"})])]
        a, controller, _, _ = build_agent(script, approver=TrippingApprover(True), kill=kill)
        result = a.run("delete the files")
        self.assertTrue(result.stopped)
        self.assertIn("F12", result.stop_reason)

    def test_step_limit_is_respected(self):
        settings = Settings(action_delay=0.0, max_steps=3)
        a, _, _, _ = build_agent([reply([use("screenshot", {})]) for _ in range(10)],
                                 settings=settings)
        result = a.run("loop forever")
        self.assertEqual(result.steps, 3)
        self.assertIn("3-step limit", result.stop_reason)

    def test_request_shape_matches_the_documented_toolset(self):
        a, _, _, _ = build_agent([reply([text("hi")], stop_reason="end_turn")])
        a.run("say hi")
        request = a.client.requests[0]
        types = [t.get("type") for t in request["tools"]]
        self.assertIn("computer_toolset_20260801", types)
        # The toolset entry must not carry display dimensions; the API rejects them.
        toolset = next(t for t in request["tools"] if t.get("type") == "computer_toolset_20260801")
        for forbidden in ("display_width_px", "display_height_px", "display_number", "name"):
            self.assertNotIn(forbidden, toolset)
        self.assertEqual(request["output_config"], {"effort": "high"})
        # The cache breakpoint must sit at the end of the static prefix
        # (tools -> system -> messages) so both tools and prompt are cached.
        self.assertEqual(request["system"][0]["cache_control"], {"type": "ephemeral"})
        self.assertEqual(request["thinking"]["type"], "adaptive")

    def test_zoom_uses_screenshot_space_region(self):
        script = [reply([use("zoom", {"region": [100, 200, 300, 400]})]),
                  reply([text("read it")], stop_reason="end_turn")]
        a, _, screen, _ = build_agent(script)
        a.run("read the small text")
        self.assertEqual(screen.zooms, [[100, 200, 300, 400]])

    def test_cursor_position_is_reported_in_screenshot_space(self):
        a, controller, _, _ = build_agent([])
        controller._cursor = (1280, 720)
        a.runner.capture()
        self.assertEqual(a.runner.execute_member("cursor_position", {}), "X=640,Y=360")


class TestCost(unittest.TestCase):
    def test_cost_uses_published_rates(self):
        usage = agent_mod.Usage(input=1_000_000, output=1_000_000,
                                cache_read=1_000_000, cache_write=1_000_000)
        sonnet = usage.cost({"input": 2.0, "output": 10.0})
        # 2 + 10 + 0.2 + 2.5
        self.assertAlmostEqual(sonnet, 14.7, places=4)

    def test_usage_accumulates_across_steps(self):
        script = [reply([use("screenshot", {})], tokens=(1000, 100)),
                  reply([text("done")], stop_reason="end_turn", tokens=(2000, 200))]
        a, _, _, _ = build_agent(script)
        result = a.run("look")
        self.assertEqual(result.usage.input, 3000)
        self.assertEqual(result.usage.output, 300)
        self.assertGreater(result.usage.cost(a.settings.prices), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
