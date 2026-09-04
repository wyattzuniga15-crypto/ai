# Jarvis

A persistent, voice-first personal assistant for iPhone, with real long-term
memory. Native iOS app + a small private server + Claude.

**Status:** design complete, Milestone 1 not yet started. See
[`CHANGELOG.md`](CHANGELOG.md) for exactly what exists today.

- **Architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Plan:** [`docs/MILESTONES.md`](docs/MILESTONES.md)

---

## What Jarvis is meant to be

You start a session from your phone and simply talk. Jarvis listens, works out
when you have finished a sentence, answers out loud in a natural voice, and lets
you cut it off mid-word when you want to say something. It remembers what
matters — across days, months and years — without ever being fed its entire
history. It has a personality you can edit in a text file. Later it reads your
calendar, and later still it tells you things before you ask.

---

## What you need

### Hardware

| Thing | Why | Notes |
| --- | --- | --- |
| A Mac | Xcode only runs on macOS. There is no way around this. | Any Apple-silicon Mac; an Intel Mac on macOS 13+ works too |
| An iPhone | Testing voice on the Simulator is unreliable — the Simulator's mic and echo cancellation don't behave like the real thing | iOS 17 or later |
| A USB-C/Lightning cable | To install the app on the phone the first time | after that, over Wi-Fi |

### Software (all free)

| Software | What it is | How to get it |
| --- | --- | --- |
| **Xcode** | Apple's app-building program | Mac App Store, free, ~10 GB, takes a while |
| **Homebrew** | Installs developer tools on a Mac with one command | [brew.sh](https://brew.sh) — one line pasted into Terminal |
| **Python 3.11+** | Runs the server | `brew install python@3.11` |
| **Git** | Version history | Comes with Xcode |

### Accounts

| Account | Cost | When you need it |
| --- | --- | --- |
| **Anthropic API** ([console.anthropic.com](https://console.anthropic.com)) | pay per use, see below | Milestone 1 |
| **Apple ID** | free | Milestone 1 — installs the app for 7 days at a time |
| **Apple Developer Program** | **$99/year** | Milestone 7 (push notifications), or earlier if reinstalling weekly annoys you |
| **A voice (TTS) service** | $0–22/month | Milestone 1, only if you want a genuinely human voice — Apple's built-in voice is free |

> **A Claude subscription is not API access.** Claude Pro/Max lets *you* use
> claude.ai. An app calling Claude needs a separate API key from
> console.anthropic.com, billed separately by usage. They are different products.

---

## What it costs to run

Assuming roughly **30 spoken exchanges a day**, every day.

### Claude

Each exchange sends about 3,000 tokens in (personality + retrieved memories +
recent turns + your sentence) and gets ~120 tokens back — spoken answers are
short. Prompt caching means the unchanging part is billed at a fraction.

| Model | Price in / out per million tokens | Estimated monthly |
| --- | --- | --- |
| **Claude Opus 5** (most capable) | $5 / $25 | **~$12–16** |
| Claude Sonnet 5 (cheaper, still strong) | $2 / $10 | ~$6 |
| Opus 5 *fast mode* (up to 2.5× faster speech onset) | $10 / $50 | ~$30 |

Plus a few cents a month for Claude Haiku, which does the background job of
deciding what is worth remembering.

Recommendation: **start on Opus 5.** It is the difference between an assistant
that understands "anything before that?" and one that doesn't. Switching model
is one line in a config file, so this is easy to revisit once you've used it.

### Voice

| Option | Sounds like | Monthly |
| --- | --- | --- |
| Apple built-in voices | Clearly synthetic, but instant and private | **$0** |
| A dedicated voice service | Genuinely human, streams as it generates | **$5–22** |

### Everything else

| Item | Monthly |
| --- | --- |
| Speech-to-text (Apple, on-device) | $0 |
| Embeddings for memory (local, open-source) | $0 |
| Database (SQLite file) | $0 |
| Server on your own Mac | $0 |
| Server on a small cloud host (optional) | $5–7 |

### Bottom line

| | Monthly | Yearly |
| --- | --- | --- |
| **Frugal** — Sonnet 5, Apple voice, server on your Mac | **~$6** | ~$75 |
| **Recommended** — Opus 5, real voice, server on your Mac | **~$30** | ~$460 (incl. Apple's $99) |
| **Maximum** — Opus 5 fast mode, real voice, cloud server | **~$60** | ~$820 |

No commitments and no minimums — Anthropic and the voice services bill by use,
and you can set a hard spending cap in the Anthropic console. The one fixed
cost is Apple's $99/year, and only from Milestone 7.

---

## Setup

Not yet written — this section fills in during Milestone 1, as click-by-click
instructions rather than assumed knowledge.

## Environment variables

Secrets live in `server/.env`, which is git-ignored and never committed. A
template with names but no values will be at `server/.env.example`.

## Current capabilities

None yet. Design and planning only.

## Known limitations

Design-level, and permanent (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §8):

- **No wake word.** iOS gives third-party apps no background microphone access,
  so Jarvis cannot listen for "Hey Jarvis" from your pocket. You start a
  session deliberately; after that it is fully hands-free.
- Running with the screen locked is best-effort, not guaranteed by iOS.
- What you say is sent to Anthropic as text to be answered. Your memory
  database, your audio and your credentials stay on hardware you control.
- One user. Your phone, your Jarvis.
