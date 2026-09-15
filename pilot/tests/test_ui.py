"""Structural test for the Tkinter window, using a stub tk so it runs headless.

This cannot prove the window looks right, but it does prove the wiring: that the
widgets exist, Run starts the agent on a worker thread, Stop trips the kill
switch, and the confirmation dialog is routed to the Tk thread.
"""
from __future__ import annotations

import sys
import threading
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class FakeWidget:
    def __init__(self, *args, **kwargs):
        self.kwargs = dict(kwargs)
        self.packed: dict = {}
        self.children: list = []
        self.bindings: dict = {}
        self.text: list[tuple[str, str]] = []
        self.value = ""

    # layout and config are no-ops that just record
    def pack(self, *a, **k): self.packed = dict(k); return self
    def grid(self, *a, **k): return self
    def configure(self, **k): self.kwargs.update(k); return self
    config = configure
    def title(self, *a): pass
    def geometry(self, *a): pass
    def minsize(self, *a): pass
    def attributes(self, *a): pass
    def focus_set(self): pass
    def see(self, *a): pass
    def tag_configure(self, *a, **k): pass
    def bind(self, sequence, func): self.bindings[sequence] = func
    def insert(self, _index, text, *tags): self.text.append((text, tags[0] if tags else ""))
    def delete(self, *a): self.value = ""
    def get(self): return self.value
    def mainloop(self): self.looped = True

    def after(self, delay, func=None, *args):
        # Immediate callbacks run inline; delayed ones (the kill-switch poll)
        # are dropped so the stub does not recurse forever.
        if func is not None and delay == 0:
            func(*args)
        return "after#1"


class FakeMessagebox:
    def __init__(self): self.answer = True; self.asked = []
    def askyesno(self, title, message, **kwargs):
        self.asked.append((title, message))
        return self.answer


def install_stub_tk():
    tk = types.ModuleType("tkinter")
    for name in ("Tk", "Frame", "Label", "Entry", "Button", "Text"):
        setattr(tk, name, FakeWidget)
    tk.messagebox = FakeMessagebox()
    scrolled = types.ModuleType("tkinter.scrolledtext")
    scrolled.ScrolledText = FakeWidget
    tk.scrolledtext = scrolled
    sys.modules["tkinter"] = tk
    sys.modules["tkinter.scrolledtext"] = scrolled
    sys.modules["tkinter.messagebox"] = tk.messagebox
    return tk


STUB_TK = install_stub_tk()

import test_pilot as harness  # noqa: E402  (reuses the doubles)
import ui  # noqa: E402



class TestWindow(unittest.TestCase):
    def _window(self, script):
        agent, controller, screen, opener = harness.build_agent(script)
        kill = agent.kill
        ui.run_window(agent, kill, agent.settings)
        return agent, controller, kill

    def test_run_button_executes_the_task(self):
        script = [harness.reply([harness.text("Opening it."),
                                 harness.use("left_click", {"coordinate": [640, 360]})]),
                  harness.reply([harness.text("Done.")], stop_reason="end_turn")]
        agent, controller, _ = self._window(script)

        # Drive the UI the way a person would: type a task, then hit Return.
        entry = self._entry
        entry.value = "open notepad"
        entry.bindings["<Return>"](None)
        self._join_workers()

        self.assertIn(("click", "left", 1, 1281, 721), controller.calls)
        rendered = "".join(t for t, _ in agent.console.widget.text)
        self.assertIn("open notepad", rendered)
        self.assertIn("Done.", rendered)

    def test_stop_button_trips_the_kill_switch(self):
        agent, _, kill = self._window([])
        self.assertFalse(kill.tripped)
        self._stop_button.kwargs["command"]()
        self.assertTrue(kill.tripped)
        self.assertIn("Stop", kill.reason)

    def test_escape_also_stops(self):
        agent, _, kill = self._window([])
        self._root.bindings["<Escape>"](None)
        self.assertTrue(kill.tripped)

    def test_input_row_is_reserved_to_the_bottom_edge(self):
        """Regression: the input row used to be clipped out of the window.

        pack() hands out space in the order widgets are added, and the last
        widget gets squeezed when the window is smaller than the total
        request. The output pane has expand=True and a Text widget asks for a
        large natural size, so packing the row last left a window with no
        visible entry box and no Run or Stop button at all.
        """
        self._window([])
        entry_row = next(w for w in self._created if w.packed.get("side") == "bottom")
        self.assertEqual(entry_row.packed.get("fill"), "x")
        # The scrolling output pane is the one that expands, and it must ask
        # for a modest natural size so it cannot crowd the row out.
        output = next(w for w in self._created if w.packed.get("expand") is True)
        self.assertEqual(output.packed.get("side"), "top")
        self.assertLessEqual(output.kwargs.get("height", 99), 12)

    def test_approver_routes_through_the_dialog(self):
        agent, _, _ = self._window([])
        STUB_TK.messagebox.answer = False
        self.assertFalse(agent.approver.ask("click Send", "this commits the action"))
        STUB_TK.messagebox.answer = True
        self.assertTrue(agent.approver.ask("click Send", "this commits the action"))
        self.assertEqual(len(STUB_TK.messagebox.asked), 2)

    # -- helpers to reach into the stub widget tree -------------------------

    def setUp(self):
        self._created: list[FakeWidget] = []
        original_init = FakeWidget.__init__

        def tracking_init(widget, *args, **kwargs):
            original_init(widget, *args, **kwargs)
            self._created.append(widget)

        FakeWidget.__init__ = tracking_init
        self.addCleanup(setattr, FakeWidget, "__init__", original_init)

    @property
    def _root(self):
        return self._created[0]

    @property
    def _entry(self):
        return next(w for w in self._created if "<Return>" in w.bindings)

    @property
    def _stop_button(self):
        return next(w for w in self._created if w.kwargs.get("text") == "Stop")

    def _join_workers(self):
        for thread in threading.enumerate():
            if thread is not threading.current_thread() and thread.daemon:
                thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
