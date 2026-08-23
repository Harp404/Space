# AstroMesh — shot list

*What to click, when, and what should be on screen. Pairs with `NARRATION.md`,
which is the spoken half. Times are cumulative; treat them as pacing, not law.*

---

## Before you press record

| | Check |
|---|---|
| 1 | Gateway running (`node dev/mock-gateway.js`) and frontend up |
| 2 | Browser at **1600×900**, zoom **100%**, bookmarks bar hidden |
| 3 | **Open the `HOW` tab once, then close it** — this warms the corridor and ground layers so nothing stalls on camera |
| 4 | **Open `FILTERS` → tick "Show all tracked objects"**, wait for the catalogue, then untick — warms the GPU screen |
| 5 | Reload the page for a clean boot animation |
| 6 | Do one full dry run **with wifi off** — if it survives that, it survives the venue |

---

## Scene 1 · Cold open — 0:00 to 0:15

| | |
|---|---|
| **Do** | Nothing. Let the boot animation and globe fly-in play. |
| **On screen** | Globe fills the right. Sidebar shows `BLOCKED 44%`. |
| **Narration** | *"This is AstroMesh…"* through *"…complete, partial, blocked, or unresolved."* |
| **Watch for** | Don't start talking over the boot bar. Let it land, then speak. |

---

## Scene 2 · The gate refuses — 0:15 to 0:50

| | |
|---|---|
| **Do** | Click **RISK** in the rail. Wait for cards. Click **VOTE** on the top card. |
| **On screen** | Red toast: `OPERATOR VOTE REFUSED`. The rulebook fills the panel — red ✕ rows, grey ○ rows. |
| **Narration** | *"Here is a real conjunction…"* through *"…is how accidents happen."* |
| **Point at** | The `FR-07` row and its **NO OVERRIDE** tag. Then sweep the grey ○ rows. |
| **Watch for** | If the top card's objects are commandable, the refusal reason differs — **read the reason on screen** rather than the script's. The point survives either way. |

> **This is the thesis scene.** Slow down. Everything after is evidence.

---

## Scene 3 · One event, every layer — 0:50 to 1:35

| | |
|---|---|
| **Do** | Click **HOW** in the rail. The globe flies to the corridor and paints it. Scroll the panel slowly as you talk. |
| **On screen** | Red dispersion ribbon Spain → India, dashed centreline, DINOv3 ground strip, 12 numbered steps. |
| **Narration** | *"Now let me show you where a verdict comes from…"* through *"…ninety-four percent of the time."* |
| **Pause on** | Step 3 (Kp / density), step 5 (DINOv3), step 8 (Ec 19.7×), **step 9 (the DAS comparison)**. |
| **Watch for** | Scroll at reading speed. If you cut anything in the whole film, do **not** cut step 9. |

---

## Scene 4 · Ride it down — 1:35 to 2:00

| | |
|---|---|
| **Do** | Click **⏵ FOLLOW DESCENT** (top-centre of the globe). Let it run ~12 s. Optionally hit **¼×** as it crosses land. |
| **On screen** | Camera falls with the stage. HUD: altitude, flight-path angle, downrange, progress bar. Ground scrolls beneath. |
| **Narration** | *"This is the same descent, from the vehicle…"* through *"…says exactly that."* |
| **Then** | Click **✕ STOP FOLLOWING**. |
| **Watch for** | Say the "kinematic replay" line **while the caption is visible**. Volunteering the limit is the point. |

---

## Scene 5 · The storm — 2:00 to 2:25

| | |
|---|---|
| **Do** | Click **STORMS** in the rail. Click **⚡ REPLAY GANNON — 10 MAY 2024**. |
| **On screen** | Camera pulls back. Three bands paint: red polar caps, green auroral ovals, amber equatorial belt. Header flips to `Kp 9 · G5`. Panel: `3/8 ground stations reachable`. Map key bottom-left. |
| **Narration** | *"May 2024. The Gannon storm…"* through *"…while you are deciding."* |
| **Point at** | The station count dropping, then the map key. |
| **Then** | Click **LIVE** to restore — the bands vanish. That before/after is worth the two seconds. |

---

## Scene 6 · Three domains — 2:25 to 2:45

| | |
|---|---|
| **Do** | Still in **STORMS**, scroll to **THEME INDEPENDENCE** → click **PROVE IT**. |
| **On screen** | Five release-gate scenarios with all four state badges, and `engine changes required: 0`. |
| **Narration** | *"This challenge asked for a capability…"* through *"…where we needed this first."* |
| **Watch for** | The aircraft-dispatch rulebook is API-side (`/api/portability/dispatch`). **Say it, don't hunt for it** — if a judge asks, open the endpoint. |

---

## Scene 7 · GPU screen and close — 2:45 to 3:05

| | |
|---|---|
| **Do** | Click **FILTERS** (bottom right) → **⚡ GPU SCREEN**. Numbers land in about a second. Close FILTERS. Click **HOW** to end on the signal. |
| **On screen** | `31,551 objects · ~497M pairs · N ms · B pair-checks/s on your GPU`, then candidate lines flash on the globe. |
| **Narration** | *"One last thing…"* through *"…what we cannot do. Thank you."* |
| **Watch for** | If WebGPU is unavailable it says so plainly — that's a graceful degrade, not a failure. Skip to the close. |

---

## If you have 60 seconds spare

In priority order — the first is the best drama available:

1. **Kill quorum live.** `FLEET` → **STOP** on two nodes. The whole gate slams to
   BLOCKED and the signal bar goes red.
   > *"Flight Rule eight — operator quorum — is non-negotiable. I have just
   > removed this system's authority to act, in four seconds. Restart them, and
   > it recovers."*

2. **Recourse.** In the **HOW** panel, an unresolved step has acquisition buttons
   with costs.
   > *"The gate doesn't just report what's missing. It computes the cheapest set
   > of measurements that would clear it — and verifies no smaller set works."*

3. **The autonomous agent.** `MISSION` → **ACTIVATE**, then watch the feed.
   > *"It plans a real manoeuvre, then submits itself to the same gate a human
   > faces — and stands down when it's refused."*

4. **Decision receipts.** Bottom of the **HOW** panel.
   > *"Every decision emits a hash-chained receipt that replays byte-for-byte.
   > Change one input and the hash changes."*

---

## Round 1 — name it, don't demo it

One breath, anywhere convenient. It's all visible behind everything anyway:

> *"Everything from Round 1 is still here — the thirty-one thousand object
> catalogue, the screening, the avoidance planner that checks a new orbit against
> the whole catalogue, the launch-window planner, multi-operator consensus, and
> the mission-control chat. Round 2 put a gate in front of every irreversible
> thing it can do."*

---

## Recording notes

- **One take per scene** beats one take overall. Cut between scenes; nobody minds.
- **Don't narrate the clicking.** "Now I'll click on…" is dead air. Click, then speak to what appeared.
- **When the gate refuses, do not apologise.** That is the product working. Slow down there.
- **Never say "formally verified" unqualified.** Say what was checked and to what bounds.
- **Have the recorded fallback cued** — `demo/astromesh-round2.mp4`. Every judging
  post-mortem says the same thing: a stalled live demo is the top killer.
