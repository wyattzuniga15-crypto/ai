# Jarvis — Milestone plan

Each milestone ends with something that works and is tested before the next one
starts. Nothing is built twice.

---

## Milestone 1 — It talks back  ← next

**Goal:** press a button, speak, hear Claude answer in Jarvis's voice.

- Server: FastAPI, one `/chat` endpoint, Claude streaming, device-token auth.
- Server: personality file loaded into the system prompt.
- iOS: record on button press, Apple speech-to-text, POST to server, speak reply.
- iOS: Keychain for the device token, server URL in settings.
- Tests: server tested end-to-end here before you touch Xcode.

**Deliberately still missing:** hands-free turn-taking, memory, interruption.
Press-and-hold is fine for one milestone — it proves the whole chain works
before we add the hard parts on top.

**Done when:** you speak to your phone and hear a sensible spoken answer.

---

## Milestone 2 — It converses

**Goal:** the interaction in your example — no button between questions, no
"Jarvis" before the second sentence.

- Continuous audio session, echo cancellation configured for barge-in.
- VAD, adaptive end-of-speech detection.
- Server streams sentence by sentence; speech starts before Claude finishes.
- Barge-in: you start speaking, Jarvis stops mid-word and listens.
- Listening / thinking / speaking shown on screen.
- Working memory: the last ~10 turns carry context within the session.

**Done when:** you can have the fencing conversation from your brief, verbatim,
without touching the phone.

---

## Milestone 3 — It keeps a record

- SQLite storage; every session and turn persisted with timestamps.
- Conversation history browsable in the app.
- Session summaries written when a conversation ends.
- Backup script.

**Done when:** Jarvis remembers this morning's conversation this evening, and
you can read back any past conversation.

---

## Milestone 4 — It remembers

The big one. Everything in ARCHITECTURE §3:

- Full memory schema: semantic, structured, episodic, with all metadata.
- Local embeddings; hybrid retrieval (keyword + meaning + entity + episode).
- Background extraction with the importance/confidence gate and pending facts.
- Deduplication, contradiction detection, supersession.
- "Remember this" / "what do you remember about…" / "forget that" / "correct that".
- Nightly consolidation and decay.
- Memory browser in the app: see, edit and delete anything Jarvis knows.

**Done when:** Jarvis correctly answers something you told it weeks earlier,
correctly says "we discussed that in June", correctly forgets on request, and
correctly declines to state an uncertain thing as fact.

---

## Milestone 5 — It sounds like itself

- Personality settings screen writing to `personality.yaml`.
- Tone tuning, response-length control, banned-phrase enforcement.
- Optional: time-of-day and context-aware register.

---

## Milestone 6 — It knows your life

Calendar, Reminders, Contacts (on-device, via EventKit — these need no cloud
service and no extra cost), then weather, then email and web services.
Every tool ships with its permission tier from day one (ARCHITECTURE §6).

**Done when:** "What's on the boys' schedule tomorrow?" is answered from your
actual calendar.

---

## Milestone 7 — It speaks first

- Push notifications (requires the paid Apple Developer Program).
- A rules engine: leave-by alerts, schedule conflicts, weather at pickup,
  watched-item reminders.
- Explicit per-rule permission and quiet hours. Jarvis does not interrupt you
  because it felt like it.

---

## Milestone 8 — It is dependable

Latency, battery, offline behaviour, error recovery, reconnect, a security
review, and the boring reliability work that decides whether you actually use
this every day.
