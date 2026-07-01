# Conversion Funnel — Browse Live Follow-Cam — Design

**Date:** 2026-06-30
**Status:** Design approved (pending written-spec review)
**Context:** Holder-gated relaunch: non-holders get a free **Browse** (둘러보기) spectator mode. Today Browse orbits the empty refinery hub — if the followed action is elsewhere, the viewer sees nothing, so there's no pull to buy $CITIZEN and fly. This makes Browse **always show a live pilot doing something**: a follow-camera that locks onto a live peer (the always-on showcase bot, or a real player), labels who/what they're doing, and ties it to a sharpened Buy CTA. This is the first piece of the conversion funnel (the landing-page pitch and buy mechanics are separate efforts).

---

## 1. Why

Browse is the only thing a non-holder experiences, and it's the conversion surface. Orbiting an empty hub converts no one. A follow-cam over the always-on showcase bot (which tours mining → roulette → arena → black hole → planets) guarantees there's always compelling activity to watch, and the overlay turns "this looks fun" into "Buy $CITIZEN to do this." Presence is already handled: the headless bot (`bot/index.mjs`, callsign **CLAUDE**) runs 24/7 on Railway against the production relay, so it's a visible peer in Browse.

---

## 2. Scope

### In scope
- A pure module `src/sim/spectate.ts`: `pickFollowTarget`, `cycleFollowTarget`, `describePilotActivity` — all framework-light and unit-tested.
- `src/main.ts` Browse wiring: the spectate camera follows the picked peer (smoothed), re-picks when it despawns / periodically, and `Tab` cycles targets. Falls back to the current hub orbit when no peer is present.
- `index.html` + `main.ts`: the `#browse-banner` becomes a live card — "Watching `CALLSIGN` · `<activity>`" + "Hold ≥1 $CITIZEN to fly" + existing Buy / Back actions.

### Out of scope
- The showcase bot itself (already always-on via Railway) and its behavior.
- Landing-page pitch / social proof (a separate funnel piece).
- Buy/redemption mechanics and the wallet-connect flow (unchanged).
- Any change to flight, economy, gating, or peer networking.

---

## 3. Pure module `src/sim/spectate.ts`

All functions are pure (no DOM, no THREE side effects beyond reading `Vector3`-like `{x,y,z}` or `[x,y,z]`), so they unit-test cleanly.

```ts
export interface FollowPeer {
  id: string
  name: string
  position: [number, number, number] // interpolated world position
  lastActiveAt: number               // ms timestamp of the most recent movement/update
}

/** Pick whom to follow. Priority: the showcase bot (name === botName) → else the most
 *  recently active peer → else null (caller falls back to the hub orbit). Stable: if the
 *  current target still qualifies as the top pick it is kept (no thrashing between equals). */
export function pickFollowTarget(peers: FollowPeer[], currentId: string | null, botName?: string): string | null

/** Step to the next/prev peer id for manual cycling (wraps). Returns currentId unchanged
 *  if there are no peers; picks the first peer if currentId is absent from the list. */
export function cycleFollowTarget(peers: FollowPeer[], currentId: string | null, dir: 1 | -1): string | null

export interface ActivityZone { label: string; center: [number, number, number]; radius: number }

/** Describe what a pilot at `position` is doing, by fixed-zone proximity. Returns the label of
 *  the first zone whose center is within its radius (caller passes zones in priority order), else
 *  the `fallback` (e.g. 'cruising deep space'). Mining isn't position-inferable (the ore belt
 *  streams around each pilot, no fixed locus) — the bot's own chat ("Mining run…") carries that
 *  play-by-play in the chat log, so this label only covers the fixed landmarks. */
export function describePilotActivity(position: [number, number, number], zones: ActivityZone[], fallback?: string): string
```

- `pickFollowTarget` default `botName = 'CLAUDE'`.
- "most recently active" = max `lastActiveAt`. The caller stamps `lastActiveAt` when a peer's position changes (peers already carry `receivedAt`; reuse/derive it).
- `describePilotActivity` uses squared-distance vs `radius` for each zone.

---

## 4. `main.ts` Browse wiring

**Follow state:** `let followId: string | null = null` and a re-pick timer.

**Camera (in `updateCamera`'s `spectating` branch, replacing the fixed-anchor orbit):**
- Each frame, resolve the followed peer's live mesh position from `remotes.get(followId)`.
- If found: **lerp** `SPECTATE_ANCHOR` toward that position (smooth, e.g. `SPECTATE_ANCHOR.lerp(targetPos, 1 - exp(-k·dt))`) and keep the existing orbit offset around it. This frames the moving pilot without snapping/jitter from interpolated peer updates.
- If not found / `followId` null: keep the current hub orbit (`station.position`) exactly as today.

**Target selection:** build `FollowPeer[]` from `remotes` (id, `peer.name`, mesh position, a `lastActiveAt` derived from `peer.receivedAt`). Call `pickFollowTarget(...)` on Browse entry, every ~3 s, and whenever `followId`'s remote despawns (the existing `peer-leave`/remove path). `Tab` (Browse only) → `followId = cycleFollowTarget(peers, followId, 1)`; `Shift+Tab` → dir `-1`. `preventDefault` so Tab doesn't move DOM focus.

**Activity label + banner:** assemble the `ActivityZone[]` once from existing constants —
`BLACK_HOLE_CENTER`/`INFLUENCE_RADIUS` → "diving the black hole"; `TRAINING_RANGE_CENTER`/`TRAINING_RANGE_RADIUS` → "in the training arena"; `PVP_PRACTICE_ZONE_CENTER`/radius → "at the practice arena"; `CITIZEN_SEASON_HUB_DESTINATION.position` (r≈1800) → "at the Season Hub"; each planet in `PLANETS` (r≈ a few thousand) → "near <planet>"; `REFINERY_POS`/`COLONY_POS` (r≈ hub size) → "docked at the hub". Fallback "cruising deep space". Throttle the label/banner DOM update (~3/s) — call `describePilotActivity(targetPos, zones)` and set the banner text to `Watching ${name} · ${activity}`. When following nobody, banner reads the current generic "Browsing — …".

**Browse exit / Back:** unchanged; clear `followId`.

---

## 5. `index.html` — banner card

Restructure `#browse-banner` to hold a dynamic line plus the existing actions:

```html
<div id="browse-banner" hidden>
  <span id="browse-watching">Browsing live</span>
  <span id="browse-pitch">— hold ≥1 $CITIZEN to fly.</span>
  <a id="browse-buy" href="https://pump.fun/coin/6FCeoWmjurxX7EsH7zdWRMDn4HGTBhJXLryKTqkepump" target="_blank" rel="noopener">Buy $CITIZEN</a>
  · <button id="browse-back" type="button">Back</button>
</div>
```

`#browse-watching` is updated by the wiring to `Watching CALLSIGN · activity` (or `Browsing live` when following nobody). Styling reuses the existing banner CSS; keep it a single unobtrusive bottom strip (no layout overhaul).

---

## 6. Edge cases / risks

- **Nobody online (not even the bot):** `pickFollowTarget` returns null → graceful fall back to the hub orbit + generic banner. No regression vs today.
- **Followed peer despawns mid-watch:** re-pick on the existing remove path; camera lerps to the new target (or hub).
- **Peer jitter:** the camera follows the already-interpolated `remotes` mesh position and lerps the anchor, so it stays smooth.
- **Tab focus:** `preventDefault` in the Browse-only Tab branch so it never moves DOM focus or leaves Browse.
- **Real player followed:** activity label is fixed-zone only (no chat tour like the bot), which is fine; the camera still shows them flying.
- **Performance:** label/banner work is throttled (~3/s); per-frame cost is one lerp + a map lookup. Negligible.

---

## 7. Testing

- `src/sim/spectate.test.ts`:
  - `pickFollowTarget`: bot preferred over a more-active non-bot; most-active non-bot when no bot; stable on the current target among equals; null on empty.
  - `cycleFollowTarget`: wraps both directions; first peer when currentId absent; unchanged on empty.
  - `describePilotActivity`: returns the in-range zone's label; first match wins on overlap (priority order); fallback when no zone matches; squared-distance boundary correct.
- Browse wiring (camera/banner/Tab) is DOM/loop wiring — verified with the headless harness: load `/?bot=1` (the CLAUDE bot connects) in one context and `/` → Browse in another against the same local relay; confirm Browse locks onto CLAUDE, the camera tracks it across the map, and `#browse-watching` updates with the activity as the bot moves through zones. `tsc` + full `vitest` + `build` stay green.

---

## 8. Success criteria

A non-holder who picks Browse sees a live pilot (the CLAUDE bot by default, or a real player) flying real content, with an overlay naming who and what they're doing and a clear "Hold ≥1 $CITIZEN to fly · Buy $CITIZEN" call to action — instead of an empty orbiting hub. `Tab` cycles targets. With nobody online, it degrades to today's hub orbit. No effect on flight, economy, gating, or networking.
