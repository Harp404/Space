# Recording guide — click by click

*Companion to `SCRIPT.md`. This is the operating half: what to click, when, and
what should appear before you speak the next line.*

---

## Setup (5 minutes, before you record)

| # | Action | Why |
|---|---|---|
| 1 | Start gateway + frontend | — |
| 2 | Browser 1600×900, zoom 100%, hide bookmarks | matches the tuned layout |
| 3 | Click **HOW**, wait for the corridor to draw, then close it | warms corridor + ground layers so they appear instantly on camera |
| 4 | **FILTERS** → tick *Show all tracked objects* → wait → untick | warms the catalogue for the GPU screen |
| 5 | **STORMS** → **REPLAY GANNON** → **LIVE** | warms the storm zones |
| 6 | Reload the page | clean boot animation |
| 7 | Dry run once with wifi off | proves it survives the venue |

---

## The sequence

### 0:00 — Open
**Click:** nothing.
**Screen:** boot bar, globe flies in, `BLOCKED 44%` appears left.
**Say:** section 1 of the script (what it is, Round 1 recap).
**Cue for next:** finish the sentence *"…refuse to act on risk it cannot justify."*

---

### 0:25 — The signal
**Click:** nothing — just point at the card.
**Screen:** the compact signal row: state word, %, four-colour bar.
**Say:** section 2 (four states, two invariants).

---

### 0:45 — The refusal
**Click:** **RISK** in the rail → **VOTE** on the first card.
**Wait for:** red toast `OPERATOR VOTE REFUSED`, and the rulebook filling the panel.
**Screen:** red ✕ rows at the top, grey ○ rows below.
**Say:** section 3.
**Point at:** the `FR-07` row, then its **NO OVERRIDE** tag, then sweep the grey rows.
**If different:** the top card may hold a commandable object, so the refusal
reason changes. **Read what is on screen** — the point is identical.

---

### 1:15 — The chain
**Click:** **HOW** in the rail.
**Wait for:** globe flies to the corridor; red ribbon and ground strip paint.
**Scroll:** slowly, at reading speed, as you talk.
**Stop on these four steps:**

| Step | What you say |
|---|---|
| 3 — *Why the corridor is that wide* | density uncertainty, measured |
| 5 — *What is underneath, from orbit* | DINOv3, 18 M cells, refusal above 60° N |
| 8 — *The regulated number* | Ec, twenty times the limit |
| **9 — *What the regulator's own method would say*** | **the 94% finding — do not cut this** |

---

### 1:50 — Ride it down
**Click:** **⏵ FOLLOW DESCENT** (top-centre of the globe).
**Let run:** about 10 seconds. Optionally **¼×** while it crosses land.
**Screen:** camera falls with the stage; HUD shows altitude, flight-path angle, downrange.
**Say:** the descent paragraph — including the "motion is a replay" line **while
that caption is visible**.
**Click:** **✕ STOP FOLLOWING**.

---

### 2:00 — The storm
**Click:** **STORMS** in the rail → **⚡ REPLAY GANNON — 10 MAY 2024**.
**Wait for:** camera pulls back; three bands paint; header flips to `Kp 9 · G5`.
**Screen:** `3/8 ground stations reachable`; map key bottom-left.
**Say:** section 5.
**Point at:** the station count, then the map key.
**Click:** **LIVE** — the bands vanish. Worth the two seconds; the contrast sells it.

---

### 2:25 — Theme independence
**Click:** still in **STORMS**, scroll down → **PROVE IT**.
**Screen:** five release-gate scenarios, all four state badges, `engine changes required: 0`.
**Say:** section 6.
**Note:** the FAA dispatch rulebook is API-side. Mention it in the sentence;
don't go looking for it on camera.

---

### 2:45 — GPU and close
**Click:** **FILTERS** (bottom right) → **⚡ GPU SCREEN**.
**Wait for:** the numbers — objects, pairs, milliseconds, pair-checks per second.
**Click:** close FILTERS → **HOW** to end on the signal.
**Say:** section 7.
**If WebGPU is missing:** the panel says so plainly. Skip to the close — a
graceful degrade is not a failure.

---

## Spare 60 seconds — best first

1. **Kill quorum.** **FLEET** → **STOP** on two nodes.
   Gate slams to BLOCKED; signal bar goes red.
   *"Flight Rule eight is non-negotiable. I have just removed this system's
   authority to act, in four seconds."* Restart them and it recovers.
2. **Recourse.** In **HOW**, an unresolved step's acquisition buttons.
   *"It computes the cheapest set of measurements that would clear this, and
   verifies that no smaller set works."*
3. **Autonomous agent.** **MISSION** → **ACTIVATE**, then watch the feed.
   *"It plans a real manoeuvre and submits itself to the same gate a human
   faces — and stands down when refused."*
4. **Receipts.** Bottom of **HOW**.
   *"Hash-chained and replayable byte-for-byte."*

---

## Recording notes

- **One take per scene.** Cut between them; nobody minds a cut.
- **Never narrate the click.** Click, wait for the screen to settle, then speak.
- **Let animations finish** before talking over them — the corridor draw and the
  storm bands both take about three seconds.
- **When the gate refuses, slow down.** That is the product working.
- Keep `demo/astromesh-round2.mp4` cued as a fallback.
