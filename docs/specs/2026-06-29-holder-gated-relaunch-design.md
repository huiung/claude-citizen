# Holder-Gated Relaunch + "Browse" Mode — Design

**Date:** 2026-06-29
**Status:** Design approved (pending written-spec review)
**Strategic context:** The token (~5k mcap, down from ~50k) and active-user base have effectively collapsed. This is a deliberate relaunch as a **holder community**: flying requires a connected wallet holding ≥1 $CITIZEN, making the token the entry ticket; non-holders get a free **Browse** mode to preserve the funnel (watch → buy → fly). Sustainability comes from the existing on-chain marketplace fee + access demand — **NOT** a credit→token payout (no faucet). A credits-only roulette and the weapon rework are SEPARATE, later specs.

---

## 1. Why

With no users and a dead token, free anonymous play produces neither revenue nor token demand. Gating *flight* to holders makes holding the token a requirement to play (utility = access), while a free Browse mode keeps a top-of-funnel for conversion. The redemption faucet (credits→token) is explicitly rejected as unsustainable; the marketplace (treasury is a net fee *receiver*, non-custodial) plus access demand is the healthy token model. This milestone builds the **access gate + Browse mode + identity changes** only.

---

## 2. Scope

### In scope
- A 3-tier access model enforced **server-side** at the `join` step: Browse (no wallet) → Fly (wallet + ≥1 token) → Ranked (≥1000, unchanged).
- A configurable `LAUNCH_MIN_TOKEN_BALANCE = 1`, reusing the existing SIWS auth + Helius on-chain balance verification (already powering the Ranked 1000-token gate).
- `join-error` responses (`wallet-required`, `insufficient-tokens`, `balance-unverified`) and landing UX that reflects the three states.
- A free **Browse** ("둘러보기") spectator mode for non-holders: enter as a viewer, roam/observe the live sector, read leaderboards + marketplace, but no ship control / weapons / progress / leaderboard entry.
- Identity change: a flying player's identity is their **wallet pubkey**. The anonymous token is demoted to a **viewer-only** id (no saved progress, no leaderboard). **Existing anon data is preserved; only NEW anon progress + NEW anon leaderboard entries are blocked.** The existing anon→wallet claim flow is kept.
- Unit tests for the server gate + the threshold/fail-closed logic.

### Out of scope (separate work)
- Credits roulette (separate credits-only spec — legally safe; not the token).
- Right-click weapon rework / alt-fire (on hold).
- credit→token redemption / P2E faucet (rejected).
- Token-denominated gambling (rejected — regulatory).
- Marketing/community relaunch (distribution, not code).

---

## 3. Access model

| Tier | Requirement | Can do | Cannot do |
|---|---|---|---|
| **Browse** | none (no wallet) | watch the live sector (camera), read leaderboards + marketplace | fly, fire, mine, trade, save progress, appear on leaderboards |
| **Fly** | wallet (SIWS-verified) + on-chain balance ≥ `LAUNCH_MIN_TOKEN_BALANCE` (1) | full game; progress + leaderboards keyed to the wallet pubkey | ranked PvP (needs ≥1000) |
| **Ranked** | wallet + ≥1000 $CITIZEN | ranked arena (unchanged) | — |

`LAUNCH_MIN_TOKEN_BALANCE` is a server constant, separate from `PVP_RANKED_MIN_TOKEN_BALANCE` (1000).

---

## 4. Server enforcement (the authority)

Today `server/index.mjs`'s `join` handler activates **any** connection. Add the gate there (the `hello`/viewer-presence path stays ungated — Browse is open):

- On `join`:
  - if not `client.authed` (no verified wallet) → reply `{ t: 'join-error', reason: 'wallet-required' }`, do **not** activate.
  - else ensure a fresh-enough holder balance (reuse `refreshHolder` / `client.holderBalance`, 5-min cache). If `client.holderBalance < LAUNCH_MIN_TOKEN_BALANCE` → `{ t: 'join-error', reason: 'insufficient-tokens' }`, do not activate.
  - **Fail closed on verification failure.** The existing `holderStatus` resolves a balance of **0 on any fetch failure** (Helius down / rate-limited / missing key), so a failed verification already falls below the threshold and is rejected — the gate never opens on an unverifiable connection. Distinguishing a true `balance-unverified` (fetch failed) from a genuine `insufficient-tokens` (real 0) requires a fetch-success signal the current code does not surface; v1 may either add that signal cheaply or **fold both into `insufficient-tokens` with retry-friendly copy** ("couldn't confirm your $CITIZEN balance — make sure you hold ≥1 and retry"). Either way the security property (no fly without a verified ≥1) holds.
  - otherwise activate as today.
- Enforcement is **join-time only** for v1: a wallet that drops below 1 mid-flight is not force-kicked (balance is cached; avoids rugging an in-flight player). It is re-checked on the next join. (A periodic re-check is a later option.)
- Wallet disconnect mid-session → client returns to Browse.

The balance verification is **server-authoritative and on-chain** (Helius), never trusted from the client — same as the Ranked gate.

---

## 5. Browse ("둘러보기") mode

Minimal viable spectator, reusing existing machinery:
- Entry: the landing **[Browse]** button enters as a **viewer** (the existing `hello` presence path — viewers already see peers), without sending `join`.
- Camera: a roaming/observer camera over the live sector (reuse the existing camera rig / orbit; a slow free-look over the spawn region is sufficient for v1). Live pilots are visible (existing peer rendering).
- Read-only panels: leaderboards and the marketplace are viewable.
- Hard blocks: no ship spawned, no input-driven flight/weapons/mining, no progress saved, no leaderboard entry, no chat-as-player (viewer-only).
- Conversion: a persistent prompt — "Connect a wallet holding ≥1 $CITIZEN to fly" + the token buy link (CA already in README/wiki) — and a one-click path from Browse → connect → Fly.

If a true free-roam spectator camera does not already exist, that camera mode is the main NEW client work here; keep it minimal (observer vantage + existing world render), not a full free-fly.

---

## 6. Identity / anonymous path changes

- **Flying identity = wallet pubkey.** Progress and all leaderboards accrue to the pubkey (`identityKey(client)` already returns pubkey when authed).
- **Anonymous token → viewer-only id.** It identifies a Browse session's presence but stores **no progress** and earns **no leaderboard entry**.
- **Preserve past, block new:** existing stored anon rows and historical anon leaderboard entries are left intact (non-destructive); the server simply stops creating/saving NEW anon progress and stops admitting NEW anon leaderboard entries (since only wallet players can now fly/earn, this largely follows naturally). The existing **anon→wallet claim** flow is retained so a returning player can absorb past anon progress into their wallet once.
- Pilot Code device-transfer becomes unnecessary for wallet players (the wallet is the portable identity); it is not removed, just no longer the primary path.

This (Section 6) is the largest behavioral change and the main regression risk — call it out in the plan's verification.

---

## 7. Client UX (landing)

- No wallet connected → **[Connect Wallet]** + **[Browse]**.
- Connected, balance 0 → message "Hold ≥1 $CITIZEN to fly" + **[Buy $CITIZEN]** link + **[Browse]**; LAUNCH disabled.
- Connected, balance ≥1 → **[LAUNCH]** enabled (+ callsign/ship as today).
- A `join-error` from the server maps to a clear inline message (wallet-required / insufficient-tokens / balance-unverified → retry).

---

## 8. Testing

- **Server (unit):** `join` rejects when unauthed (`wallet-required`); rejects when `holderBalance < LAUNCH_MIN_TOKEN_BALANCE` (`insufficient-tokens`); rejects (fail-closed) when the balance fetch fails — i.e. a `holderStatus` of 0 from a failure is treated identically to a real 0 and never admitted; accepts at exactly the threshold (≥1) and above; `hello` (Browse) is admitted with no wallet. Threshold constant is honored and distinct from the 1000 ranked gate.
- **Client:** the three landing states render correctly (no-wallet / zero-balance / ≥1); a `join-error` shows the right message; Browse never spawns a controllable ship or saves progress.
- **No regression:** existing wallet players still fly; Ranked gate (1000) still works; marketplace + holder cosmetics unaffected; full suite + tsc + build green.

---

## 9. Success criteria

A non-holder lands, clicks **Browse**, watches the live sector and leaderboards, sees a clear "hold ≥1 $CITIZEN to fly" prompt with a buy link; a holder connects, is server-verified to hold ≥1, and flies with progress tied to their wallet; a connected zero-balance wallet is cleanly told to acquire the token; and the server never lets an unverified/non-holder connection control a ship. Past anonymous data is untouched, but no new anonymous progress or leaderboard rows are created.
