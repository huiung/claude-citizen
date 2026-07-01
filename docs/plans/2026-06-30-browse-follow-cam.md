# Browse Live Follow-Cam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Browse (둘러보기) follow a live pilot (the always-on CLAUDE bot, or a real player) with a "who + what they're doing" overlay and a Buy CTA, instead of orbiting the empty hub.

**Architecture:** A new pure module `src/sim/spectate.ts` (target selection + activity labeling, unit-tested). `src/main.ts` wires it into the spectate camera (lerp the orbit anchor onto the followed peer's interpolated mesh, auto-pick when none/despawned, `Tab` to cycle) and updates a restructured `#browse-banner` card. Nobody online → graceful fallback to today's hub orbit.

**Tech Stack:** TypeScript, Three.js, Vite, Vitest. No server/relay changes.

**Spec:** `docs/specs/2026-06-30-browse-follow-cam-design.md`

---

## File Structure

- **Create** `src/sim/spectate.ts` — pure: `pickFollowTarget`, `cycleFollowTarget`, `describePilotActivity` + types. No DOM/THREE side effects (positions as `[x,y,z]`).
- **Create** `src/sim/spectate.test.ts` — unit tests.
- **Modify** `src/main.ts` — import the module; add follow state; follow-cam in `updateCamera`'s `spectating` branch; `Tab` cycle in the keydown handler; a throttled banner-text update; reset `followId` on Browse enter/exit; build the activity-zone list from existing constants.
- **Modify** `index.html` — restructure `#browse-banner` into a live card (`#browse-watching` + `#browse-pitch` + existing Buy/Back).

**Codebase facts to rely on:**
- `remotes: Map<string, RemoteShip>` (main.ts). `RemoteShip.mesh: THREE.Group` (interpolated, rendered position) and `RemoteShip.peer: PeerState`. `PeerState = { id, name, p:[x,y,z], receivedAt, ... }` (src/net/client.ts).
- Spectate camera lives in `updateCamera` (main.ts): `if (spectating) { cameraOrbitElapsed += dt; camera.position.copy(SPECTATE_ANCHOR).add(orbitCameraOffset(cameraOrbitElapsed, 0, SPECTATE_ORBIT_DISTANCE)); camera.lookAt(SPECTATE_ANCHOR); return }`.
- `enterBrowseMode()` sets `SPECTATE_ANCHOR.copy(station.position)`. `browseBackEl` click exits Browse. `browseBannerEl`/`browseBackEl` grabbed near main.ts:189.
- Peer removal: `remotes.delete(id)` (the `peer-leave` path). The CLAUDE bot joins with `name: 'CLAUDE'` (bot/index.mjs).
- Zone constants already exist: `BLACK_HOLE_CENTER`, `INFLUENCE_RADIUS` (sim/blackHole, imported); `TRAINING_RANGE_CENTER`, `TRAINING_RANGE_RADIUS`, `PVP_PRACTICE_ZONE_CENTER`, `PVP_PRACTICE_ZONE_RADIUS`, `CITIZEN_SEASON_HUB_DESTINATION` (sim/pvp); `REFINERY_POS`, `COLONY_POS` (imported).
- Vitest for `.ts`; run one file `npx vitest run src/sim/spectate.test.ts`. Full gate: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

---

## Task 1: Pure module — `pickFollowTarget` + `cycleFollowTarget`

**Files:**
- Create: `src/sim/spectate.ts`
- Test: `src/sim/spectate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/sim/spectate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickFollowTarget, cycleFollowTarget, type FollowPeer } from './spectate'

const peer = (id: string, name: string, lastActiveAt: number): FollowPeer => ({ id, name, position: [0, 0, 0], lastActiveAt })

describe('pickFollowTarget', () => {
  it('returns null when no peers', () => {
    expect(pickFollowTarget([], null)).toBeNull()
  })
  it('prefers the showcase bot (CLAUDE) even over a more-active player', () => {
    const peers = [peer('a', 'Ace', 100), peer('b', 'CLAUDE', 1)]
    expect(pickFollowTarget(peers, null)).toBe('b')
  })
  it('picks the most recently active peer when no bot is present', () => {
    const peers = [peer('a', 'Ace', 100), peer('c', 'Nova', 250)]
    expect(pickFollowTarget(peers, null)).toBe('c')
  })
  it('honors a custom bot name', () => {
    const peers = [peer('a', 'Ace', 100), peer('z', 'ZBOT', 1)]
    expect(pickFollowTarget(peers, null, 'ZBOT')).toBe('z')
  })
})

describe('cycleFollowTarget', () => {
  const peers = [peer('a', 'A', 1), peer('b', 'B', 1), peer('c', 'C', 1)]
  it('advances forward with wrap', () => {
    expect(cycleFollowTarget(peers, 'a', 1)).toBe('b')
    expect(cycleFollowTarget(peers, 'c', 1)).toBe('a')
  })
  it('advances backward with wrap', () => {
    expect(cycleFollowTarget(peers, 'a', -1)).toBe('c')
  })
  it('starts at the first peer when current is absent/null', () => {
    expect(cycleFollowTarget(peers, null, 1)).toBe('a')
    expect(cycleFollowTarget(peers, 'gone', 1)).toBe('a')
  })
  it('returns currentId unchanged when there are no peers', () => {
    expect(cycleFollowTarget([], 'a', 1)).toBe('a')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/spectate.test.ts`
Expected: FAIL — `Cannot find module './spectate'`.

- [ ] **Step 3: Implement the module**

Create `src/sim/spectate.ts`:

```ts
// Pure helpers for Browse (spectator) mode: who to follow and what they're doing. No DOM/THREE
// side effects — positions are plain [x,y,z] tuples so this unit-tests cleanly.

export interface FollowPeer {
  id: string
  name: string
  position: [number, number, number] // interpolated world position
  lastActiveAt: number               // ms timestamp of the peer's most recent update
}

/** Pick whom Browse should follow. Priority: the showcase bot (name === botName) → else the most
 *  recently active peer → else null (caller falls back to the hub orbit). */
export function pickFollowTarget(peers: FollowPeer[], currentId: string | null, botName = 'CLAUDE'): string | null {
  if (peers.length === 0) return null
  const bot = peers.find((p) => p.name === botName)
  if (bot) return bot.id
  let best = peers[0]
  for (const p of peers) if (p.lastActiveAt > best.lastActiveAt) best = p
  return best.id
}

/** Step to the next/prev peer id for manual cycling (wraps). currentId unchanged if no peers;
 *  first peer if currentId is null or not in the list. */
export function cycleFollowTarget(peers: FollowPeer[], currentId: string | null, dir: 1 | -1): string | null {
  if (peers.length === 0) return currentId
  const ids = peers.map((p) => p.id)
  const i = currentId ? ids.indexOf(currentId) : -1
  if (i < 0) return ids[0]
  return ids[(i + dir + ids.length) % ids.length]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sim/spectate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/spectate.ts src/sim/spectate.test.ts
git commit -m "feat(browse): pure follow-target picker + cycler (spectate)"
```

---

## Task 2: Pure `describePilotActivity`

**Files:**
- Modify: `src/sim/spectate.ts`
- Test: `src/sim/spectate.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `src/sim/spectate.test.ts`:

```ts
import { describePilotActivity, type ActivityZone } from './spectate'

describe('describePilotActivity', () => {
  const zones: ActivityZone[] = [
    { label: 'diving the black hole', center: [1000, 0, 0], radius: 100 },
    { label: 'in the training arena', center: [0, 0, 0], radius: 50 },
  ]
  it('returns the label of the zone the position sits inside', () => {
    expect(describePilotActivity([1000, 0, 40], zones)).toBe('diving the black hole') // 40 < 100
    expect(describePilotActivity([0, 30, 0], zones)).toBe('in the training arena')      // 30 < 50
  })
  it('first matching zone wins on overlap (priority order)', () => {
    const overlap: ActivityZone[] = [
      { label: 'first', center: [0, 0, 0], radius: 100 },
      { label: 'second', center: [0, 0, 0], radius: 100 },
    ]
    expect(describePilotActivity([0, 0, 0], overlap)).toBe('first')
  })
  it('uses the fallback when no zone matches', () => {
    expect(describePilotActivity([9999, 9999, 9999], zones)).toBe('cruising deep space')
    expect(describePilotActivity([9999, 0, 0], zones, 'idle')).toBe('idle')
  })
  it('treats the radius as an inclusive boundary', () => {
    expect(describePilotActivity([50, 0, 0], [{ label: 'edge', center: [0, 0, 0], radius: 50 }])).toBe('edge')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/spectate.test.ts`
Expected: FAIL — `describePilotActivity`/`ActivityZone` not exported.

- [ ] **Step 3: Implement**

Append to `src/sim/spectate.ts`:

```ts
export interface ActivityZone { label: string; center: [number, number, number]; radius: number }

/** Describe a pilot's activity by fixed-zone proximity: the label of the first zone whose center is
 *  within its radius (pass zones in priority order), else `fallback`. Mining isn't position-inferable
 *  (the ore belt streams around each pilot), so the bot's own chat carries that play-by-play. */
export function describePilotActivity(
  position: [number, number, number],
  zones: ActivityZone[],
  fallback = 'cruising deep space',
): string {
  const [x, y, z] = position
  for (const zone of zones) {
    const dx = x - zone.center[0], dy = y - zone.center[1], dz = z - zone.center[2]
    if (dx * dx + dy * dy + dz * dz <= zone.radius * zone.radius) return zone.label
  }
  return fallback
}
```

- [ ] **Step 4: Run the tests + full suite + tsc**

Run: `npx vitest run src/sim/spectate.test.ts && npx vitest run && npx tsc --noEmit`
Expected: spectate tests pass; full suite passes; tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/sim/spectate.ts src/sim/spectate.test.ts
git commit -m "feat(browse): pure describePilotActivity (fixed-zone label)"
```

---

## Task 3: Follow-cam wiring in `main.ts` (camera + target pick + Tab cycle)

**Files:**
- Modify: `src/main.ts` (imports; follow state; `updateCamera` spectating branch; keydown Tab; `enterBrowseMode`/browse-back reset)

No banner yet — verify the camera tracks the bot.

- [ ] **Step 1: Add imports**

Add near the other `./sim/*` imports:

```ts
import { pickFollowTarget, cycleFollowTarget, type FollowPeer } from './sim/spectate'
```

- [ ] **Step 2: Add follow state**

Near the other spectate constants (search for `const SPECTATE_ANCHOR`), add above `updateCamera`:

```ts
let followId: string | null = null
function browseFollowPeers(): FollowPeer[] {
  return [...remotes.values()].map((r) => ({
    id: r.peer.id,
    name: r.peer.name,
    position: [r.mesh.position.x, r.mesh.position.y, r.mesh.position.z],
    lastActiveAt: r.peer.receivedAt,
  }))
}
```

- [ ] **Step 3: Replace the spectate camera branch**

Find in `updateCamera`:

```ts
  if (spectating) {
    cameraOrbitElapsed += dt
    camera.position.copy(SPECTATE_ANCHOR).add(orbitCameraOffset(cameraOrbitElapsed, 0, SPECTATE_ORBIT_DISTANCE))
    camera.lookAt(SPECTATE_ANCHOR)
    return
  }
```

Replace with:

```ts
  if (spectating) {
    // Auto-pick a live pilot to follow when we have none or the current one left (a manual Tab pick
    // sticks until that peer despawns). The CLAUDE bot is the reliable default; a real player else.
    if (followId === null || !remotes.has(followId)) followId = pickFollowTarget(browseFollowPeers(), followId)
    const followed = followId ? remotes.get(followId) : null
    const anchorTarget = followed ? followed.mesh.position : station.position // no one online → ease back to the hub
    SPECTATE_ANCHOR.lerp(anchorTarget, 1 - Math.exp(-3 * dt)) // smooth: absorbs interpolated-peer jitter
    cameraOrbitElapsed += dt
    camera.position.copy(SPECTATE_ANCHOR).add(orbitCameraOffset(cameraOrbitElapsed, 0, SPECTATE_ORBIT_DISTANCE))
    camera.lookAt(SPECTATE_ANCHOR)
    return
  }
```

- [ ] **Step 4: Add Tab-cycle in the keydown handler**

In the `keydown` handler, after `keys.add(e.code)` (alongside the other single-key branches), add:

```ts
  if (e.code === 'Tab' && running && spectating) {
    e.preventDefault() // don't let Tab move DOM focus out of the canvas
    followId = cycleFollowTarget(browseFollowPeers(), followId, e.shiftKey ? -1 : 1)
    return
  }
```

- [ ] **Step 5: Reset `followId` on Browse enter/exit**

In `enterBrowseMode()`, after `SPECTATE_ANCHOR.copy(station.position)`, add:

```ts
  followId = null // fresh Browse: re-pick a target next frame
```

In the `browseBackEl` click handler (after `spectating = false`), add:

```ts
  followId = null
```

- [ ] **Step 6: Typecheck + build + full suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 0; all tests pass; build ok.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(browse): follow-cam tracks a live pilot (bot/player), Tab to cycle"
```

---

## Task 4: Live banner card (`index.html` + activity label update)

**Files:**
- Modify: `index.html` (`#browse-banner`)
- Modify: `src/main.ts` (grab `#browse-watching`; build zone list; throttled update in the frame loop)

- [ ] **Step 1: Restructure the banner in `index.html`**

Replace the current `#browse-banner` element:

```html
  <div id="browse-banner" hidden>Browsing — connect a wallet holding ≥1 $CITIZEN to fly. <a id="browse-buy" href="https://pump.fun/coin/6FCeoWmjurxX7EsH7zdWRMDn4HGTBhJXLryKTqkepump" target="_blank" rel="noopener">Buy $CITIZEN</a> · <button id="browse-back" type="button">Back</button></div>
```

with:

```html
  <div id="browse-banner" hidden><span id="browse-watching">Browsing live</span> <span id="browse-pitch">— hold ≥1 $CITIZEN to fly.</span> <a id="browse-buy" href="https://pump.fun/coin/6FCeoWmjurxX7EsH7zdWRMDn4HGTBhJXLryKTqkepump" target="_blank" rel="noopener">Buy $CITIZEN</a> · <button id="browse-back" type="button">Back</button></div>
```

(No CSS change — the existing `#browse-banner` rules and `#browse-banner a`/`button` styling still apply.)

- [ ] **Step 2: Add imports + element grab + zone list in `main.ts`**

Add to the `./sim/pvp` import the zone constants (extend the existing import — it already brings `isInTrainingRange`, `pvpZoneAt`, `CITIZEN_SEASON_HUB_DESTINATION`):

```ts
  TRAINING_RANGE_CENTER, TRAINING_RANGE_RADIUS, PVP_PRACTICE_ZONE_CENTER, PVP_PRACTICE_ZONE_RADIUS,
```

Add `describePilotActivity` + `ActivityZone` to the spectate import from Task 3:

```ts
import { pickFollowTarget, cycleFollowTarget, describePilotActivity, type ActivityZone, type FollowPeer } from './sim/spectate'
```

Near `browseBannerEl` (main.ts:189), add:

```ts
const browseWatchingEl = document.getElementById('browse-watching')!
```

Near the follow state (Task 3 Step 2), add the zone list + a throttle stamp:

```ts
const BROWSE_ZONES: ActivityZone[] = [
  { label: 'diving the black hole', center: [BLACK_HOLE_CENTER.x, BLACK_HOLE_CENTER.y, BLACK_HOLE_CENTER.z], radius: INFLUENCE_RADIUS },
  { label: 'in the training arena', center: [TRAINING_RANGE_CENTER.x, TRAINING_RANGE_CENTER.y, TRAINING_RANGE_CENTER.z], radius: TRAINING_RANGE_RADIUS + 800 },
  { label: 'at the practice arena', center: [PVP_PRACTICE_ZONE_CENTER.x, PVP_PRACTICE_ZONE_CENTER.y, PVP_PRACTICE_ZONE_CENTER.z], radius: PVP_PRACTICE_ZONE_RADIUS + 800 },
  { label: 'at the Season Hub', center: [CITIZEN_SEASON_HUB_DESTINATION.position.x, CITIZEN_SEASON_HUB_DESTINATION.position.y, CITIZEN_SEASON_HUB_DESTINATION.position.z], radius: 2500 },
  { label: 'docked at the hub', center: [REFINERY_POS.x, REFINERY_POS.y, REFINERY_POS.z], radius: 1500 },
  { label: 'at the mining colony', center: [COLONY_POS.x, COLONY_POS.y, COLONY_POS.z], radius: 1500 },
]
let browseBannerAt = 0 // throttle the banner-text update
```

- [ ] **Step 3: Update the banner text (throttled) while spectating**

In the frame loop, inside the block that already runs while `spectating` (search for where `updateCamera(dt)` is called in the frame; put this right after it, guarded by `spectating`), add:

```ts
    if (spectating && now - browseBannerAt > 300) {
      browseBannerAt = now
      const followed = followId ? remotes.get(followId) : null
      if (followed) {
        const p = followed.mesh.position
        const activity = describePilotActivity([p.x, p.y, p.z], BROWSE_ZONES)
        browseWatchingEl.textContent = `Watching ${followed.peer.name} · ${activity}`
      } else {
        browseWatchingEl.textContent = 'Browsing live'
      }
    }
```

(`now` is the frame timestamp already in scope, `performance.now()`-based; if the surrounding frame uses a differently-named variable, use that. The frame loop already computes a `now`/`dt` for the sim.)

- [ ] **Step 4: Typecheck + build + full suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 0; all tests pass; build ok.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts index.html
git commit -m "feat(browse): live 'Watching CALLSIGN · activity' banner card"
```

---

## Task 5: Headless verification (Browse follows CLAUDE, label updates)

**Files:** none (verification only)

- [ ] **Step 1: Start a local relay + dev server**

```bash
DEV_SKIP_LAUNCH_GATE=1 BOT_COSMETIC_SECRET=footage-secret npm run server &   # relay on :8080
npm run dev &                                                                 # vite (note the printed port)
```

- [ ] **Step 2: Drive two headless contexts against the same relay**

With Playwright (channel `chrome`, headless, `--use-gl=swiftshader`): open context A at `/?bot=1` with `localStorage['scc.botSecret']='footage-secret'` (the CLAUDE bot connects and flies). Open context B at `/`, click `#browse-btn`, then poll for ~60–120 s:
- `#hud`-less spectate is up (overlay hidden).
- `#browse-watching` text becomes `Watching CLAUDE · <activity>` and the `<activity>` changes as the bot moves through zones (e.g. "in the training arena", "diving the black hole", "cruising deep space").
- The camera anchor tracks CLAUDE (sanity: the bot's ship stays roughly centered; optional — assert `#browse-watching` starts with `Watching CLAUDE`).

Record the observed sequence of `#browse-watching` strings. PASS = it names CLAUDE and the activity label changes at least once.

- [ ] **Step 3: Verify the no-peer fallback**

Open only context B (`/` → Browse) with NO bot running: confirm `#browse-watching` stays `Browsing live` and the camera orbits the hub (no crash, no stuck overlay).

- [ ] **Step 4: Stop the servers**

```bash
kill %1 %2 2>/dev/null || true
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` → exit 0
- [ ] `npx vitest run` → all pass (incl. `spectate.test.ts`)
- [ ] `npm run build` → succeeds
- [ ] Headless (Task 5): Browse follows CLAUDE with a live activity label; empty-sector falls back to the hub orbit.
