# Changelog

Kept so that a future session — Claude's or a human's — can tell what exists
without reading every file. Newest first.

## 2026-09-04 — Design

**Built:** nothing runnable yet. Deliberate: architecture agreed before code.

- Inspected the development environment (see below).
- Wrote `docs/ARCHITECTURE.md`: three-tier design (iOS app / private server /
  SQLite memory), the five-store memory model, the voice pipeline with
  barge-in, personality config, the permission dispatcher, privacy posture, and
  the iOS limits that constrain all of it.
- Wrote `docs/MILESTONES.md` (8 milestones) and `README.md` (requirements,
  accounts, measured cost estimates).
- Created the folder skeleton under `jarvis/`.

**Environment as inspected (this cloud container, Ubuntu 24.04):**
Python 3.11.15, Node 22, Git 2.43, Docker, Rust, Go, curl, jq.
**No Swift and no Xcode** — and there cannot be, since this is Linux. All iOS
work happens on the user's Mac. The Python server is written and tested here.

**Open decisions blocking Milestone 1:** text-to-speech provider, where the
server runs, Anthropic API access, and Mac/Xcode status. Asked, not assumed.

**Next:** Milestone 1 — record → Claude → speak.
