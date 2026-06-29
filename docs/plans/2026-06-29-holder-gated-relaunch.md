# Holder-Gated Relaunch + Browse Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate flying to wallet holders of ≥1 $CITIZEN (server-authoritative at `join`), give non-holders a free Browse spectator mode, and make the wallet the player identity — without a credit→token faucet.

**Architecture:** Extract the access decision into a pure, unit-tested `launchGate(client, minBalance)` helper, then restructure the `server/index.mjs` `join` handler to resolve auth + on-chain balance (reusing `refreshHolder`/Helius) and run the gate BEFORE activating a pilot. The client handles a new `join-error` message and renders three landing states; a Browse button enters the existing viewer-presence path with a spectator camera. The operator showcase bot is gate-exempt. New anonymous progress/leaderboard rows stop being created (the gate already blocks anon flight); existing anon data and the anon→wallet claim flow are preserved.

**Tech Stack:** Node ESM (`.mjs`) + Vitest (server); TypeScript + Three.js (client). Spec: `docs/specs/2026-06-29-holder-gated-relaunch-design.md`. Reuses existing SIWS auth, `refreshHolder`/`fetchHolderStatus` (Helius), holder tiers, and the viewer (`hello`) presence path.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `server/accessGate.mjs` | Pure `launchGate(client, minBalance)` → `{ ok, reason }` | Create |
| `server/accessGate.test.mjs` | Unit tests for the gate | Create |
| `server/index.mjs` | `LAUNCH_MIN_TOKEN_BALANCE`; restructure `join` to gate before activating; stop creating new anon store rows | Modify |
| `src/net/client.ts` | `onJoinError` callback + `case 'join-error'` | Modify |
| `src/main.ts` | Wire `onJoinError`; landing states (no-wallet / zero-balance / ≥1); Browse button → spectator | Modify |
| `index.html` | Landing: `[Browse]` + `[Buy $CITIZEN]` elements | Modify |

**Anchor line numbers** reflect HEAD at plan-writing time; locate by the quoted code if they drift.

---

## Task 1: Pure launch-gate helper

**Files:**
- Create: `server/accessGate.mjs`
- Test: `server/accessGate.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `server/accessGate.test.mjs`:

```js
import { describe, it, expect } from 'vitest'
import { launchGate, LAUNCH_MIN_TOKEN_BALANCE } from './accessGate.mjs'

describe('launchGate', () => {
  it('exempts the operator showcase bot regardless of balance', () => {
    expect(launchGate({ isBot: true, authed: false, holderBalance: 0 }, LAUNCH_MIN_TOKEN_BALANCE)).toEqual({ ok: true, reason: null })
  })
  it('rejects an unauthenticated (no wallet) connection', () => {
    expect(launchGate({ isBot: false, authed: false, holderBalance: 0 }, LAUNCH_MIN_TOKEN_BALANCE)).toEqual({ ok: false, reason: 'wallet-required' })
  })
  it('rejects a verified wallet below the threshold (incl. a failed fetch that resolves 0)', () => {
    expect(launchGate({ isBot: false, authed: true, holderBalance: 0 }, LAUNCH_MIN_TOKEN_BALANCE)).toEqual({ ok: false, reason: 'insufficient-tokens' })
  })
  it('admits a verified wallet at exactly the threshold and above', () => {
    expect(launchGate({ isBot: false, authed: true, holderBalance: 1 }, LAUNCH_MIN_TOKEN_BALANCE)).toEqual({ ok: true, reason: null })
    expect(launchGate({ isBot: false, authed: true, holderBalance: 5000 }, LAUNCH_MIN_TOKEN_BALANCE)).toEqual({ ok: true, reason: null })
  })
  it('LAUNCH_MIN_TOKEN_BALANCE is 1 and distinct from the 1000 ranked gate', () => {
    expect(LAUNCH_MIN_TOKEN_BALANCE).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/accessGate.test.mjs`
Expected: FAIL — `launchGate`/`LAUNCH_MIN_TOKEN_BALANCE` not exported.

- [ ] **Step 3: Implement**

Create `server/accessGate.mjs`:

```js
// Server-authoritative play-access gate. Flying requires a verified wallet holding >= the threshold.
// Fail-closed: a failed Helius balance fetch resolves holderBalance to 0 (see holders.mjs), which is
// below the threshold, so an unverifiable connection is rejected here. The operator showcase bot
// (isBot, granted via BOT_COSMETIC_SECRET) is exempt so it can produce footage. Separate from the
// ranked gate (PVP_RANKED_MIN_TOKEN_BALANCE = 1000).
export const LAUNCH_MIN_TOKEN_BALANCE = 1

export function launchGate(client, minBalance) {
  if (client?.isBot) return { ok: true, reason: null }
  if (!client?.authed) return { ok: false, reason: 'wallet-required' }
  if ((Number(client.holderBalance) || 0) < minBalance) return { ok: false, reason: 'insufficient-tokens' }
  return { ok: true, reason: null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/accessGate.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/accessGate.mjs server/accessGate.test.mjs
git commit -m "feat(relaunch): pure launch-gate helper (wallet + >=1 token, bot-exempt, fail-closed)"
```

---

## Task 2: Enforce the gate in the join handler

**Files:**
- Modify: `server/index.mjs`

No new unit test (the gate logic is unit-tested in Task 1; this wires it into the ws handler). Verify by `node --check` + full suite.

- [ ] **Step 1: Import the gate**

In `server/index.mjs`, add to the imports (near the other `./*.mjs` imports, e.g. by the `./pvp.mjs` import):
```js
import { launchGate, LAUNCH_MIN_TOKEN_BALANCE } from './accessGate.mjs'
```

- [ ] **Step 2: Restructure the `join` handler to gate before activating**

The current handler (around `server/index.mjs:395-442`) promotes/creates an ACTIVE client immediately, then later resolves auth (`applySession` at ~line 422) and holder balance (`void refreshHolder` at ~line 439, fire-and-forget). The gate must run AFTER auth + balance are resolved but BEFORE activation/broadcast. Rewrite the handler body as:

```js
    if (msg.t === 'join') {
      const token = typeof msg.token === 'string' ? msg.token.slice(0, 64) : null
      let client = clients.get(ws)
      const isBot = !!(BOT_COSMETIC_SECRET && msg.botSecret === BOT_COSMETIC_SECRET)
      // Build/fetch the client WITHOUT activating yet, then resolve identity + holder balance so the
      // access gate can decide on verified data.
      if (!client) {
        client = {
          id: Math.random().toString(36).slice(2, 10),
          name: String(msg.name ?? 'PILOT').slice(0, 16),
          color: -1, p: [0, 0, 0], q: [0, 0, 0, 1], token,
          active: false, authed: false, pubkey: null, tier: 0, holderBalance: 0, lastPvpCombatAt: null,
          visual: normalizeHolderShipVisual(msg.visual), cosmetics: normalizeCosmetics(msg.cosmetics),
          invisible: msg.invisible === true, isBot: false,
        }
        resetPvpHull(client, normalizeShip(msg.ship))
        clients.set(ws, client)
      }
      if (isBot) { client.tier = 3; client.isBot = true }
      if (!client.authed) applySession(client, msg.sessionId)
      // Resolve a verified holder balance (cached) BEFORE gating, so the decision uses on-chain truth.
      await refreshHolder(ws, client)
      if (!clients.has(ws)) return // disconnected during the async balance lookup
      const gate = launchGate(client, LAUNCH_MIN_TOKEN_BALANCE)
      if (!gate.ok) { send(ws, { t: 'join-error', reason: gate.reason }); return } // stays a viewer (Browse)
      // --- Gate passed: activate the pilot (this is the original activation path) ---
      client.active = true
      client.name = String(msg.name ?? 'PILOT').slice(0, 16)
      if (client.color < 0) client.color = nextColor++
      if (token) client.token = token
      client.visual = normalizeHolderShipVisual(msg.visual)
      client.cosmetics = normalizeCosmetics(msg.cosmetics)
      client.invisible = msg.invisible === true
      resetPvpHull(client, normalizeShip(msg.ship))
      client.name = resolveCallsign({ authed: client.authed, storedName: store[identityKey(client)]?.name, requestedName: client.name })
      if (client.authed && client.name && client.name.toLowerCase() !== 'pilot') send(ws, { t: 'callsign', name: client.name })
      const key = identityKey(client)
      kickDuplicatePeers(ws, client)
      const peers = [...clients.values()].filter((c) => c.active && !c.invisible && c !== client).map(({ token: _t, active: _a, authed: _au, pubkey: _pk, holderBalance: _hb, invisible: _iv, ...rest }) => rest)
      ws.send(JSON.stringify({ t: 'welcome', id: client.id, peers }))
      if (key && anonymousProgressAllowed(client)) {
        ws.send(JSON.stringify({ t: 'progress', data: store[key] ?? null }))
        if (!(key in store)) { store[key] = null; flush() }
      }
      if (!client.invisible) broadcast(ws, { t: 'peer-join', id: client.id, name: client.name, color: client.color, p: client.p, q: client.q, tier: client.tier ?? 0, ship: client.ship, visual: client.visual, cosmetics: client.cosmetics, hull: client.hull, maxHull: client.maxHull })
      console.log(`[join] ${client.name} (${client.id})${client.token ? ' +token' : ''} — ${clients.size} online`)
      return
    }
```

KEY CHANGES vs the original:
- The new client is created with `active: false` and `color: -1` (activated only after the gate passes; `color` assigned then).
- `isBot`/`applySession`/`await refreshHolder` run BEFORE the gate so `authed` + `holderBalance` are resolved (previously `refreshHolder` was a fire-and-forget AFTER join).
- `launchGate` decides; on failure the connection stays a viewer (Browse) and gets `join-error`.
- The post-gate block is the original activation logic (peer broadcast, progress, callsign), unchanged in behavior for a passing holder.
- VERIFY `send` exists as a helper (used elsewhere, e.g. line 389/424); if the codebase uses `ws.send(JSON.stringify(...))` instead of a `send(ws, obj)` helper at this site, match the surrounding convention.

- [ ] **Step 3: Verify**

Run: `node --check server/index.mjs` → no syntax error.
Run: `npx vitest run` → all pass (server + client; existing suite unaffected).
Run: `npx tsc --noEmit` → exit 0 (no client regression).

Manually reason and report: an unauthed `join` now gets `join-error: wallet-required` and is NOT broadcast as a peer; an authed wallet with balance 0 gets `insufficient-tokens`; a bot (botSecret) still activates; a holder ≥1 activates exactly as before.

- [ ] **Step 4: Commit**

```bash
git add server/index.mjs
git commit -m "feat(relaunch): gate join on wallet + >=1 token before activating (bot-exempt)"
```

---

## Task 3: Client — handle join-error + landing states

**Files:**
- Modify: `src/net/client.ts`
- Modify: `src/main.ts`
- Modify: `index.html`

- [ ] **Step 1: Add `onJoinError` to NetClient**

In `src/net/client.ts`, add a public callback field alongside the other `on*` callbacks (e.g. near `onProgress`/`onHolder`):
```ts
  onJoinError: (reason: string) => void = () => {}
```
In the `handle(msg)` switch, add a case (mirror the style of the existing cases like `case 'holder':`):
```ts
      case 'join-error':
        this.active = false // we were refused activation — fall back to viewer/Browse
        this.onJoinError(String(msg.reason ?? 'wallet-required'))
        break
```
(Setting `active = false` ensures a later reconnect doesn't auto-resend `join`; confirm `this.active` is the flag the onopen path checks — it is, per the `enterGame`/onopen logic that sends `join` when `active`.)

- [ ] **Step 2: Track holder balance on the client**

The server already sends `{ t: 'holder', tier, balance }` (case `'holder'` at ~`client.ts:240`). Ensure the client exposes the latest balance for the landing UI. If `onHolder` already surfaces `{tier, balance}` to main.ts, reuse it; otherwise add a callback:
```ts
  onHolder: (tier: number, balance: number) => void = () => {}
```
and in `case 'holder':` call `this.onHolder(Number(msg.tier) || 0, Number(msg.balance) || 0)`. (Check the existing `case 'holder':` body first and extend it rather than duplicating.)

- [ ] **Step 3: Landing UX in main.ts + index.html**

In `index.html`, in the landing panel near the existing Connect/Launch controls, add a Browse button and a buy link + a gate message element (match existing landing button markup/classes):
```html
      <button id="browse-btn" type="button">BROWSE</button>
      <a id="buy-citizen" href="https://pump.fun/coin/6FCeoWmjurxX7EsH7zdWRMDn4HGTBhJXLryKTqkepump" target="_blank" rel="noopener" hidden>BUY $CITIZEN</a>
      <div id="gate-msg" hidden></div>
```
(Confirm the real $CITIZEN buy URL; the CA `6FCeoWmjurxX7EsH7zdWRMDn4HGTBhJXLryKTqkepump` is in README/wiki. If a canonical buy link exists elsewhere in the repo, use that.)

In `src/main.ts`, add refs and wire the gate logic near the existing wallet/launch UI code (grep `enterGame(` at ~`src/main.ts:3917` and the connect-wallet button refs ~`345`):
```ts
const browseBtnEl = document.getElementById('browse-btn')!
const buyCitizenEl = document.getElementById('buy-citizen')!
const gateMsgEl = document.getElementById('gate-msg')!
let holderBalance = 0

function refreshLaunchGateUI(): void {
  const connected = walletConnected() // use the existing "is a wallet linked" check
  const canFly = connected && holderBalance >= 1
  launchBtnEl.disabled = !canFly
  buyCitizenEl.hidden = !(connected && holderBalance < 1)
  gateMsgEl.hidden = canFly
  gateMsgEl.textContent = !connected
    ? 'Connect a wallet holding ≥1 $CITIZEN to fly — or Browse.'
    : holderBalance < 1 ? 'Hold ≥1 $CITIZEN to fly. You can still Browse.' : ''
}

net.onHolder = (_tier, balance) => { holderBalance = balance; refreshLaunchGateUI() }
net.onJoinError = (reason) => {
  gateMsgEl.hidden = false
  gateMsgEl.textContent = reason === 'wallet-required'
    ? 'Connect a wallet to fly.'
    : reason === 'insufficient-tokens'
      ? "Couldn't confirm ≥1 $CITIZEN — make sure you hold the token and retry."
      : 'Unable to launch right now — retry.'
  // remain on the landing / Browse; do NOT enter the game
}
browseBtnEl.addEventListener('click', () => enterBrowseMode()) // Task 4
```
Adapt `walletConnected()`/`launchBtnEl` to the real symbols (grep for the launch button ref and the wallet-session check, e.g. `loadWalletSession`/`activeIdentity`). Call `refreshLaunchGateUI()` after wallet connect/disconnect and on initial landing render. Disable the LAUNCH button until `canFly`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run build` → succeeds.
Run: `npx vitest run` → all pass.
Static check: the three landing states (no-wallet / connected-zero / connected-≥1) drive button visibility correctly; `join-error` shows a message and does not enter the game; ids match between index.html and main.ts.

- [ ] **Step 5: Commit**

```bash
git add src/net/client.ts src/main.ts index.html
git commit -m "feat(relaunch): join-error handling + holder-gated landing states + buy link"
```

---

## Task 4: Browse (spectator) mode

**Files:**
- Modify: `src/main.ts`

This is the task with the most discovery — read the existing camera + viewer code before implementing.

- [ ] **Step 1: Understand the viewer + camera code**

Read in `src/main.ts`: how the landing transitions into the game (the `enterGame`/launch flow that hides the landing and starts rendering), the camera rig (chase camera, the orbit camera toggled by `C`), and how a "viewer" currently differs from an active pilot (the client sends `hello` viewer-presence by default and only `join`s on launch — so a non-launched connection is already a viewer that receives peer state). Identify: (a) the function that hides the landing overlay and reveals the 3D scene, (b) the camera update each frame, (c) the input handlers that drive flight (to disable them in Browse).

- [ ] **Step 2: Implement `enterBrowseMode()`**

Add a `browsing` flag and an `enterBrowseMode()` that:
- hides the landing overlay and reveals the live 3D sector (reuse whatever the launch path calls to show the scene), WITHOUT calling `net.enterGame(...)` (so no `join`, no ship, stays a viewer).
- does NOT spawn/show the player ship; sets a spectator camera — reuse the existing orbit/free camera rig pointed at the spawn region or a slow auto-orbit. Live peers render via the existing peer path.
- gates all flight/weapon/mining input behind `if (browsing) return` (or only runs the input handlers when `!browsing`), so Browse cannot control a ship, fire, mine, save, or chat-as-player.
- shows a persistent "Connect a wallet holding ≥1 $CITIZEN to fly" banner + the buy link, and a way back to the landing / a Connect action that upgrades Browse → Fly (call the existing connect-wallet flow; on success + balance ≥1, allow LAUNCH).

Keep it MINIMAL: an observer camera over the live world + read-only HUD (leaderboard `[L]`, marketplace) is sufficient for v1. Do NOT build a full free-fly spaceship-less flight model.

- [ ] **Step 3: Ensure no progress/leaderboard side effects in Browse**

Confirm that while `browsing`, none of the progress-save / daily / campaign / XP hooks run (they are gated by the game-running state — verify Browse does NOT set that state, or explicitly guard the frame-loop gameplay updates with `!browsing`). Browse is render-only.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run build` → succeeds.
Run: `npx vitest run` → all pass.
Static check + report: Browse shows the live sector with no controllable ship; flight/fire/mine inputs are inert; no `join` is sent; no progress is saved; the Connect→Fly upgrade path works.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(relaunch): free Browse spectator mode for non-holders"
```

---

## Task 5: Stop creating new anonymous progress rows (preserve past)

**Files:**
- Modify: `server/index.mjs`

The Task 2 gate already prevents anonymous (non-wallet) connections from flying, so they cannot accrue NEW gameplay progress. This task removes the now-pointless creation of empty anon store rows so no NEW anonymous leaderboard/identity rows appear, while leaving existing rows and the anon→wallet claim flow intact.

- [ ] **Step 1: Stop seeding anon store rows on `hello`**

In the `hello` handler (~`server/index.mjs:385`):
```js
      if (key && anonymousProgressAllowed(client) && !(key in store)) { store[key] = null; flush() } // seen → counts as registered
```
Change it to only seed a row for AUTHED (wallet) clients (preserve existing rows; just stop creating NEW anon ones):
```js
      if (key && client.authed && anonymousProgressAllowed(client) && !(key in store)) { store[key] = null; flush() }
```

- [ ] **Step 2: Same guard in the `join` progress block**

In the activated-pilot progress block (the `if (key && anonymousProgressAllowed(client))` added/kept in Task 2, ~line 431-436), the only way to reach it is past the gate — which requires `authed` (or bot). So a non-authed identity can't reach it. Leave it as-is, but add `client.authed` to the row-creation guard for symmetry and to avoid a bot (non-authed but gate-exempt) creating an anon row:
```js
      if (key && anonymousProgressAllowed(client)) {
        ws.send(JSON.stringify({ t: 'progress', data: store[key] ?? null }))
        if (key && client.authed && !(key in store)) { store[key] = null; flush() }
      }
```
(The bot is gate-exempt but should not create a persisted progress row; gating row-creation on `client.authed` ensures only real wallet players get stored rows. Confirm the bot path still works — it flies, just doesn't persist progress, which is correct for a showcase bot.)

- [ ] **Step 3: Verify**

Run: `node --check server/index.mjs` → ok.
Run: `npx vitest run` → all pass.
Report: existing store rows are untouched (no deletion); new anon viewers no longer create rows; wallet players still get/create their row; the bot flies without creating a row.

- [ ] **Step 4: Commit**

```bash
git add server/index.mjs
git commit -m "fix(relaunch): stop creating new anonymous progress rows (preserve existing + claim flow)"
```

---

## Task 6: Manual verification (whole feature)

Run `npm run dev` + the server, open the game:
- [ ] No wallet → landing shows [Connect Wallet] + [Browse]; LAUNCH disabled; gate message present.
- [ ] [Browse] → live sector renders, no controllable ship, flight/fire/mine inert, leaderboards/marketplace viewable, "hold ≥1 to fly" + buy link shown.
- [ ] Connect a wallet with 0 $CITIZEN → "Hold ≥1 $CITIZEN to fly" + [Buy $CITIZEN]; LAUNCH still disabled; a forced `join` is refused with `insufficient-tokens`.
- [ ] Connect a wallet with ≥1 $CITIZEN → LAUNCH enabled; flying works; progress tied to the wallet.
- [ ] Ranked still requires ≥1000 (unchanged); marketplace + holder cosmetics unaffected.
- [ ] Reload as a holder → still flies; no new anon rows created during Browse.

No commit (verification only).

---

## Self-Review Notes (coverage map)

- Spec §3/§4 (3-tier access, server gate, threshold, fail-closed, join-time-only, bot exemption) → Task 1 (pure gate, bot-exempt, fail-closed via 0-balance) + Task 2 (await refreshHolder before gate, activate after).
- Spec §5 (Browse mode) → Task 4.
- Spec §6 (identity: wallet = player; anon viewer-only; preserve past, block new) → Task 2 gate (anon can't fly) + Task 5 (stop seeding anon rows; keep existing + claim).
- Spec §7 (landing UX, three states, buy link, join-error copy) → Task 3.
- Spec §8 (testing) → Task 1 unit tests; Tasks 2-5 node --check/tsc/build + manual; Task 6 manual.
- Spec §2 out-of-scope (roulette, redemption, weapons, token gambling) → no task touches them.
- Type/name consistency: `launchGate`, `LAUNCH_MIN_TOKEN_BALANCE`, `onJoinError`, `onHolder`, `enterBrowseMode`, `browsing`, `refreshLaunchGateUI` used consistently across tasks.
- Known discovery risk: Task 4 (Browse camera) depends on the existing camera/landing code; it is specified behaviorally with reuse intent and a "read first" step rather than exact line edits, because the camera rig API must be read at implementation time. Ranked gate (1000) and marketplace are explicitly untouched.
