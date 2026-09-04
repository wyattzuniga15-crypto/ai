# Jarvis — Architecture

Version 0.1 (design, pre-Milestone-1). Written to be read by a non-specialist.
Every jargon term is explained the first time it appears.

---

## 1. The one-paragraph version

Jarvis is three pieces. Your **iPhone app** is the ears, the mouth and the
face — it hears you, shows you what is happening, and speaks. A small
**server** you own is the brain stem — it holds the secret keys, decides what
Jarvis remembers, talks to Claude, and enforces what Jarvis is allowed to do.
A **database file** on that server is the memory. The phone never holds a
secret and never talks to Claude directly.

```
┌─────────────────────────┐         ┌──────────────────────────────────┐
│      iPhone (Swift)     │         │   Jarvis server (Python)          │
│                         │  HTTPS  │                                   │
│  mic → VAD → speech-to- │◄───────►│  auth → memory retrieval →        │
│  text → [text]          │ (token) │  Claude → tool gate → memory     │
│  [text] → TTS → speaker │         │  write                            │
│                         │         │            │                      │
│  no API keys, ever      │         │      ┌─────▼──────┐               │
└─────────────────────────┘         │      │ jarvis.db  │  ← the memory │
                                    │      │  (SQLite)  │               │
                                    │      └────────────┘               │
                                    └──────────┬───────────────────────┘
                                               │ (only what is needed)
                                          ┌────▼─────┐
                                          │  Claude  │
                                          └──────────┘
```

**Why a server at all, instead of the app calling Claude directly?** Five
reasons, each of which you asked for:

1. **The API key.** A key shipped inside an iPhone app can be extracted by
   anyone with the app file. You said never hard-code keys. A server is the
   only real fix.
2. **Memory has to outlive the phone.** Reinstall the app, drop the phone in a
   lake, buy an iPhone 20 — the memory is a file on the server, backed up.
3. **Integrations need long-lived credentials.** Email and web services hand
   out tokens that must be stored and refreshed somewhere safe.
4. **Proactive notifications.** "You need to leave in 20 minutes" requires
   something awake and watching when your phone is in your pocket. An app that
   isn't running can't do that; a server can, and pushes a notification.
5. **You can change Jarvis's personality without shipping a new app.** Edit a
   text file on the server, restart, done. Otherwise every tweak is an Xcode
   rebuild.

---

## 2. The pieces, concretely

### 2.1 iPhone app — Swift + SwiftUI

Native, as you asked. SwiftUI is Apple's modern way to build screens.

What lives here, and nothing else:

| Responsibility | How |
| --- | --- |
| Capture microphone audio | `AVAudioEngine` |
| Cancel Jarvis's own voice out of the mic feed | `AVAudioSession` voice-processing mode (hardware echo cancellation) |
| Detect that you started/stopped speaking (VAD) | on-device, see §4 |
| Turn speech into text | `SFSpeechRecognizer`, on-device |
| Show listening / thinking / speaking | SwiftUI state machine |
| Speak the reply | TTS engine (see §4.4) |
| Store the device's login token | iOS **Keychain** (encrypted OS credential store) |

**VAD** = Voice Activity Detection: deciding "is a human talking right now?"
from the raw audio, without sending anything anywhere.

### 2.2 Server — Python 3.11 + FastAPI

FastAPI is a small, fast, well-documented Python web framework. Python because
the memory system leans on text search and embeddings, where Python's
ecosystem is strongest, and because I can write and test the entire server in
this environment before you ever run it — I cannot compile Swift here, so
every line of Swift is code you run first. Getting the server airtight on my
side shortens your debugging on the Mac side.

Responsibilities:

- Authenticate the phone.
- Retrieve the relevant memories for what you just said.
- Assemble the prompt: personality + retrieved memory + recent turns + your words.
- Stream Claude's answer back sentence by sentence, so speech starts before
  Claude has finished thinking.
- Gate every tool call through the permission tiers (§6).
- Afterwards, in the background, decide what (if anything) is worth remembering.

### 2.3 Memory store — SQLite

SQLite is a complete database that lives in a single file. No server process,
no passwords, no cloud. For one user it is the right answer and stays the right
answer at a million memories. If Jarvis ever outgrows it, the same schema moves
to PostgreSQL unchanged.

---

## 3. The memory architecture

This is the part you were most specific about, so it gets the most detail.

**The rule:** never put the whole history into Claude's context window. Instead,
store everything durably, and retrieve only the handful of things that matter
for the sentence you just said. Context stays small, cheap and fast forever,
whether Jarvis is one week or ten years old.

### 3.1 The five stores

**1. Conversation memory** — every turn, verbatim, timestamped.
Tables `sessions` and `turns`. This is the raw log. It is *not* fed to Claude
wholesale; it is the source of truth everything else is derived from.

**2. Episodic memory** — what happened, and when.
Table `episodes`. When a conversation session ends, a cheap background job
writes a short summary of it: what was discussed, what was decided, who was
involved, dated. This is what lets Jarvis say *"we talked about this in
June — you decided to wait until after the school year."* Retrieval searches
episodes as well as facts.

**3. Semantic memory** — durable facts, one statement each.
Table `memories`. Each row is a single self-contained sentence: *"Wyatt's sons
have fencing on Tuesdays at 5:30pm at the Denver Fencing Center."* Every row
carries metadata:

| Field | Meaning |
| --- | --- |
| `category` | people, family, preference, schedule, school, activity, travel, date, project, home, document, decision, health, work |
| `subject` | which entity this is about (links to §3.2) |
| `source` | `user_explicit` (you said "remember this"), `inferred` (Jarvis worked it out), `tool` (came from your calendar) |
| `source_turn_id` | the exact sentence it came from — full provenance, always |
| `importance` | 1–5 |
| `confidence` | 0.0–1.0 |
| `status` | `active`, `superseded`, `forgotten` |
| `created_at`, `last_used_at`, `use_count` | for decay and consolidation |
| `valid_from`, `valid_to` | facts expire. Fencing on Tuesdays is true *this season* |
| `superseded_by` | corrections point here |

**4. Structured memory** — the records, not the sentences.
Tables `entities` and `entity_attributes`. An entity is a person, place,
school, activity, project, document, trip or recurring event. Attributes are
typed key/values, each with its own source, confidence and timestamp. So
"Ben" is one entity with a birthday, a school, a shoe size and a fencing club,
each independently sourced and independently correctable — rather than nine
loose sentences that might contradict each other.

**5. Working memory** — the current conversation, in RAM, last ~10 turns.
Small, bounded, thrown away when the session ends (after being written to
stores 1 and 2).

### 3.2 How retrieval works (the part that keeps context small)

Every time you speak, before Claude sees anything:

1. **Resolve references.** "the boys", "her", "that trip" → actual entity IDs,
   using the conversation's recent entity mentions.
2. **Keyword search** over memory text (SQLite FTS5 — full-text search built
   into SQLite, catches names and numbers that meaning-search misses).
3. **Meaning search** — every memory is stored alongside an *embedding*: a list
   of numbers representing its meaning, so "what time do the kids do sword
   stuff" finds the fencing memory without sharing a single word with it.
4. **Entity expansion.** If an entity was resolved, pull its structured record.
5. **Episode search** for "we discussed this before" questions.
6. **Fuse and rank.** Combine the ranked lists, then boost by importance,
   recency, and how often a memory has actually proved useful.
7. **Budget.** Take the top results up to a hard ceiling (~1,200 tokens). The
   ceiling is the whole point: context size is constant, not growing.
8. Mark the winners' `last_used_at` — memories that keep earning their place
   rise; memories that never do decay out.

**Embeddings run locally on the server**, using a small open-source model
(~90 MB, ONNX). Free, private, no third party ever sees your memories. Good
enough is genuinely good enough here — this is one person's life, not a
search engine.

### 3.3 How memories get written (the part that avoids junk)

After each exchange, *asynchronously* — never blocking your conversation:

1. A cheap fast model (Claude Haiku) reads just the last exchange and proposes
   candidate facts with category, importance and confidence.
2. **Rules gate, not vibes:**
   - You said "remember this" → stored, `source=user_explicit`, confidence 1.0.
   - Inferred → must clear an importance threshold to be stored at all. "I'm
     tired today" is not a fact about you. "I don't drink coffee after 2pm" is.
   - Anything genuinely uncertain is stored as a **pending** item, not a fact,
     and Jarvis will confirm it in conversation before promoting it. This is
     your "never silently treat uncertain information as permanent fact" rule,
     implemented as a table, not as a hope.
3. **Deduplicate** against existing memories by meaning-similarity. A near
   duplicate bumps the original's confidence instead of adding a second row.
4. **Detect contradiction.** New fact conflicts with an old one → old row is
   marked `superseded`, new row points back at it. Nothing is ever destroyed;
   Jarvis can always say *what* it used to think and *when* that changed.

### 3.4 Your commands

| You say | What happens |
| --- | --- |
| "Remember that…" | `source=user_explicit`, confidence 1.0, high importance |
| "What do you remember about Ben?" | entity record + top memories, read back grouped |
| "Forget that" | last-written memory → `status=forgotten` (soft; recoverable for 30 days, then purged) |
| "That's wrong, it's actually…" | new row, old row `superseded`, provenance preserved |
| "Where did you get that?" | reads back source + date + the sentence you originally said |

### 3.5 Nightly consolidation

A job runs each night: summarize finished sessions into episodes, merge
duplicate memories, decay unused low-importance ones, expire memories past
`valid_to`, purge things forgotten over 30 days ago. This is what stops the
database becoming a landfill after three years.

---

## 4. The voice pipeline

This is the difference between a demo and something you use daily, so it is
specified in detail before any of it is written.

### 4.1 The loop

```
mic ─► echo cancellation ─► VAD ─► speech-to-text ─► end-of-speech?
                                                          │ yes
                                    ┌─────────────────────▼──────────┐
                                    │  send text to server            │
                                    │  server streams Claude's reply  │
                                    └─────────────────────┬──────────┘
                                                          │ first sentence ready
       speaker ◄─── TTS ◄─── sentence chunker ◄───────────┘
          │
          └──► mic is STILL LIVE ──► you speak ──► stop playback instantly (barge-in)
```

### 4.2 Echo cancellation — why barge-in works at all

The hard part of interrupting Jarvis is that the microphone hears Jarvis. Without
help, Jarvis interrupts itself constantly. iOS solves this in hardware: setting
the audio session to voice-processing mode subtracts the speaker output from the
mic input, the same way a phone call does. This one setting is what makes
barge-in feasible, and it is why the audio session is configured once, correctly,
at the start rather than tuned later.

### 4.3 End-of-speech detection

Naive silence detection either cuts you off mid-thought or leaves long gaps.
The approach: energy-based VAD with hysteresis (different thresholds to start
and stop, so it doesn't flicker), plus an adaptive silence window — shorter
after a complete-sounding sentence, longer after a trailing "and…". Tunable in
config, because the right value is personal. If it proves not good enough,
the upgrade path is Silero VAD (a small neural VAD) via CoreML, and the
interface is designed so that swap touches one file.

### 4.4 Speech-to-text and text-to-speech

**Speech-to-text: Apple's on-device recognizer.** Free, private, no network
round trip, low latency. Its accuracy on unusual proper nouns is weaker than
cloud recognizers; the mitigation is feeding it your contact and entity names
as hints, which Apple supports. Swappable behind an interface if you ever want
a cloud recognizer.

**Text-to-speech: this is your call — see the questions at the end.** It is the
single largest factor in whether Jarvis sounds human, and the main recurring
cost. Apple's built-in voices are free and instant but audibly synthetic.
Dedicated voice services sound genuinely human and stream audio as it is
generated, for roughly $5–22/month. The code treats TTS as a plug-in either
way, so this is reversible.

### 4.5 Latency budget

Target: **under 1.5 seconds** from you finishing a sentence to hearing the first
word back. Budget:

| Stage | Target |
| --- | --- |
| End-of-speech detection | 400–600 ms |
| Network + memory retrieval | 80–150 ms |
| Claude first token (streaming, cached prompt) | 350–700 ms |
| TTS first audio | 150–400 ms |

Three things buy most of this: **streaming** (speak sentence one while Claude
writes sentence two), **prompt caching** (the unchanging part of the prompt is
billed at a fraction and processed faster), and **a small retrieved context**
(the whole point of §3).

---

## 5. Personality

`config/personality.yaml` — a plain text file, no code:

```yaml
name: Jarvis
address_user_as: null          # or "sir", or your name
traits: [intelligent, warm, calm, polished, perceptive, concise]
spoken_response:
  default_sentences: 2          # short unless detail is asked for
  max_sentences_before_asking: 4
humor: subtle                   # none | subtle | dry | playful
disagreement: direct_and_polite # says so when you're wrong
banned_phrases:
  - "Certainly!"
  - "Great question!"
  - "I'd be happy to help"
  - "As an AI"
```

The server renders this into the system prompt. Change the file, restart, done —
no Xcode, no App Store, no code. Later this becomes a settings screen in the app
writing to the same file.

---

## 6. Action safety

Jarvis will eventually do things, not just say things. The rule that makes this
safe: **the permission check is code, not prompt.** Claude never executes
anything. Claude can only *request* a tool; the server's dispatcher decides.

```
Claude: "I'd like to call send_email(...)"
             │
             ▼
   ┌──────────────────────┐
   │ Dispatcher looks up  │  config/permissions.yaml
   │ the tool's tier      │  (Claude cannot read or change this)
   └─────┬──────┬─────┬───┘
         │      │     │
    READ_ONLY LOW  HIGH_IMPACT
         │      │     │
       run    run    ── ask you out loud ── you say yes ──► run
                          │
                          └── the app returns a one-time token tied to this
                              exact pending action. Claude cannot mint it.
```

| Tier | Examples | Behaviour |
| --- | --- | --- |
| READ_ONLY | read calendar, read weather, search memory | runs automatically |
| LOW_RISK | create a reminder, add a draft note | runs, per approved category |
| HIGH_IMPACT | send email/message, delete anything, purchase, change or cancel an existing calendar event, share private info, anything financial, grant a new permission | **always** asks first |

Anything not explicitly listed defaults to HIGH_IMPACT. Every tool call, allowed
or refused, is logged with what was asked, what was decided and why.

---

## 7. Privacy and security

| Concern | Design |
| --- | --- |
| API keys | Only ever on the server, in a `.env` file that is git-ignored. Never in the app, never in this repository. |
| Phone → server auth | A device token generated at first launch, stored in the iOS **Keychain** (hardware-backed, encrypted by the OS), sent over HTTPS only. |
| Ambient audio | Never uploaded. Audio is processed on the phone and discarded; only *text* leaves the device, and only after you have finished a sentence during an active session. |
| What Claude sees | Only: the personality prompt, the retrieved memories relevant to this question, the recent turns, and what you just said. Never the whole database. |
| Data at rest | The database lives on hardware you control. Full-disk encryption on the host; optional SQLCipher (an encrypted build of SQLite) if the server is not physically yours. |
| Deletion | Real. "Forget that" soft-deletes, and a purge job removes it permanently after 30 days. There is also a wipe-everything command. |
| The mic indicator | iOS shows an orange dot whenever the mic is live. We do not try to hide it. That is a feature. |

**One honest statement, so it is never a surprise:** what you say to Jarvis is
sent to Anthropic to be answered, as text. That is the trade for Claude's
intelligence. Everything else — your memory database, your audio, your
credentials — stays on hardware you control.

---

## 8. iOS limits that shape the design

These are Apple's rules. We design around them; we do not fight them.

1. **There is no always-on wake word for third-party apps.** iOS gives no
   background microphone access. Only Siri has it. So Jarvis cannot listen for
   "Hey Jarvis" from your pocket — you start a session deliberately. This is
   the one thing you asked for that iOS genuinely forbids, and you already
   anticipated it.
2. **Once a session is running, it is fully hands-free**, exactly as you
   described — continuous listening, automatic turn-taking, no button, no wake
   word between questions.
3. **Screen-locked continuation is best-effort.** With the audio background
   mode a session can survive the screen locking, but iOS may still suspend it
   and Apple is strict about using this to keep a mic open. Design: sessions
   run reliably with the app open; locked operation is a bonus, not a promise.
4. **Apple's recognizer stops after about a minute** of continuous audio, so
   the app restarts recognition transparently between turns.
5. **Entry points that do work:** app icon, Lock Screen widget, the Action
   Button, and a Siri Shortcut / App Intent — all four can *launch* Jarvis and
   start a session. Audio can't stream through Siri itself; Siri hands off.
6. **Installing on your own phone:** a free Apple ID works but the app expires
   after 7 days and must be reinstalled. The $99/year Developer Program gives a
   year, and is required for push notifications (Milestone 7).

---

## 9. Folder structure

```
jarvis/
├── README.md                setup, how to run, current state
├── CHANGELOG.md             what has been built, for future sessions
├── docs/
│   ├── ARCHITECTURE.md      this file
│   └── MILESTONES.md        the plan, milestone by milestone
├── config/
│   ├── personality.yaml     editable personality
│   ├── permissions.yaml     tool risk tiers
│   └── settings.example.yaml
├── server/
│   ├── app/
│   │   ├── main.py          FastAPI entry point
│   │   ├── auth.py          device tokens
│   │   ├── claude.py        Claude client, streaming
│   │   ├── prompt.py        assembles the prompt
│   │   ├── memory/          the memory system (§3)
│   │   │   ├── schema.sql
│   │   │   ├── store.py     reads and writes
│   │   │   ├── retrieve.py  hybrid retrieval
│   │   │   ├── extract.py   what is worth remembering
│   │   │   ├── embed.py     local embeddings
│   │   │   └── consolidate.py  the nightly job
│   │   ├── tools/           integrations (Milestone 6)
│   │   └── safety/          the permission dispatcher (§6)
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example         names of secrets, never values
├── ios/
│   └── Jarvis/              the Xcode project
│       ├── JarvisApp.swift
│       ├── Views/           the screens
│       ├── Audio/           capture, VAD, playback, barge-in
│       ├── Speech/          speech-to-text, text-to-speech
│       ├── Network/         talks to the server
│       └── Storage/         Keychain
└── scripts/                 run, backup, health-check
```

---

## 10. What is deliberately *not* being built yet

Named here so scope stays honest:

- No wake word (iOS forbids it in the background; see §8.1).
- No multi-user support. Jarvis is yours.
- No web or Android client.
- No self-hosted language model. Claude is the brain.
- No App Store release. This is a personal app on your own phone.
