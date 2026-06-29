# Pilot Level Combat Power — Design

**Date:** 2026-06-29
**Status:** Design approved (pending written-spec review)
**Builds on:** `docs/specs/2026-06-29-pilot-progression-vertical-slice-design.md` (the Pilot Level spine, campaign, enemy tiers, and the new PILOT leaderboard already shipped).

---

## 1. Why

The pilot-progression slice shipped the *spine* (XP, levels 1–20, a level-up banner) but deliberately
deferred making levels **do** anything: `unlocksForLevel` computes a `hullBonus` that is never applied,
and nothing scales with level. So leveling currently changes only a number and a bar — and the new
PILOT leaderboard ranks "who hunted most," not "who is stronger."

This milestone makes **each level grant combat power**, so leveling is *felt*, the leaderboard means
something, and the hunt→level→stronger loop closes.

**Decided direction (from brainstorming):** per-level **stat increases**, specifically **hull + weapon
damage** — the two combat axes that are NOT already sold by the credit upgrade tracks
(cargo/speed/boost/mining). This keeps a clean split: **Level = combat power; Credits = economy/mobility.**

**Explicitly out of scope (tracked for a later milestone):** changing the right-click weapon itself —
the user noted it feels monotonous and wants combat *variety* (new fire modes / weapons) eventually.
That needs its own design and is NOT part of this change.

---

## 2. Scope

### In scope
- Extend `unlocksForLevel(level)` (pure module `src/sim/pilotLevel.ts`) with a `weaponDamageBonus`,
  alongside the existing `hullBonus`. Unit-tested.
- Apply `hullBonus` to the player's effective max hull, via a new `effMaxHull()` helper mirroring the
  existing `effSpeed()` / `effBoost()` / effective-cargo pattern in `main.ts`.
- Apply `weaponDamageBonus` to the player's **PvE** projectile damage only.
- On level-up: raise max hull and **heal the gained amount** so the power bump is immediate and felt.
- Recompute hull on every relevant entry point (launch, ship change, respawn, server restore) so the
  bonus is never stale.
- **Fix a persistence bug discovered during the leaderboard work:** the server's `sanitizeProgress`
  drops `campaign` on save (it only keeps credits/cargo/upgrades/hangar/crafting/daily). `pilot` was
  patched during the leaderboard task via `mergePilotStats`; `campaign` still has the same bug, so
  campaign cross-device sync is broken. Mirror the `pilot` fix for `campaign`.
- Unit tests for the new pure logic; typecheck/build/manual for the wiring (matching the codebase's
  existing testing posture for DOM/loop code).

### Out of scope (later milestones)
- Right-click weapon variety / new fire modes / new weapons (the monotony fix).
- Applying `unlockUpgradeTier` to the station upgrade ceiling (still deferred; this design touches only
  hull + damage).
- Server-authoritative validation of client-reported level/XP (see §6).
- Levels 6–20 *content* and sectors 2–3 (unchanged from the prior slice).

---

## 3. Components

### 3.1 Pure module change — `src/sim/pilotLevel.ts`

Extend `LevelUnlock` and `unlocksForLevel` with a weapon-damage bonus. Starting values (tuned live),
consistent with the codebase's "starting values, tuned live" convention:

```ts
export interface LevelUnlock {
  hullBonus: number            // flat hull added at this level (EXISTING: (level-1)*5)
  weaponDamageBonus: number    // NEW: flat projectile damage added at this level: (level-1)*1
  unlockSector: number | null
  unlockUpgradeTier: number | null
}
```

- **Hull:** `(level - 1) * 5` — unchanged. Lv5 → +20, Lv20 → +95 (on a base hull of 60–160).
- **Weapon damage:** `(level - 1) * 1` — NEW. Base `PROJECTILE_DAMAGE` is 12. Lv5 → +4 (~+33%),
  Lv20 → +19. Felt, and balanced against deeper enemies that already scale with depth + the new
  elite/named tiers.

Both are flat, monotonic, and start at 0 at level 1 (no bonus at the starting level). Pure +
deterministic; covered by unit tests.

### 3.2 Hull application — `src/main.ts`

Add an `effMaxHull()` helper next to `effSpeed()` / `effBoost()` (currently ~`main.ts:2158`):

```ts
function effMaxHull(): number {
  return SHIP_STATS[selectedShipType].hull + unlocksForLevel(pilot.level).hullBonus
}
```

- `setPlayerCraft(type)` (~`main.ts:2164`) currently does `playerHealth.max = SHIP_STATS[type].hull;
  playerHealth.hull = playerHealth.max`. Change the max to `effMaxHull()`. Because `setPlayerCraft` is
  already called on launch, ship change, and respawn, the bonus applies at all those points for free.
- **Server restore:** where the server snapshot sets `playerHealth.max = maxHull` (~`main.ts:3288` /
  `3312`), the existing flow already calls `setPlayerCraft(selectedShipType)` (~`main.ts:3254`) after
  applying progress; confirm pilot state is applied *before* that call so the recompute includes the
  level bonus. If ordering is wrong, reorder so pilot.level is set first.

### 3.3 Level-up heal — `src/main.ts` kill hook

The kill hook already detects level-ups (`if (killXp.leveledUp.length) showPromotion(...)`, and again
for step XP). On any level-up, raise the cap and heal the delta so the bump is immediate:

```ts
// on level-up (both the kill-XP and step-XP branches), after pilot.level is updated:
const prevMax = playerHealth.max
playerHealth.max = effMaxHull()
playerHealth.hull += Math.max(0, playerHealth.max - prevMax) // heal exactly the gained hull
```

Factor this into a small local helper (e.g. `applyLevelHull()`) so both branches call one thing and
there is no duplicated write — mirroring how the prior slice extracted `awardPilotXp`.

### 3.4 Weapon-damage application — `src/main.ts` firing

The player fire call (~`main.ts:4475`) passes
`combatWeaponActive ? pvpWeapon.damage : undefined` as the projectile damage (the `undefined` falls
through to the `PROJECTILE_DAMAGE` default). Change ONLY the PvE branch:

```ts
combatWeaponActive ? pvpWeapon.damage : PROJECTILE_DAMAGE + unlocksForLevel(pilot.level).weaponDamageBonus,
```

**PvP / ranked / training (`combatWeaponActive`) keeps `pvpWeapon.damage` untouched** — level is a PvE
progression axis and must not unbalance ranked PvP. This is a deliberate boundary.

### 3.5 Persistence fix — `server/progress.mjs` + `server/index.mjs`

`campaign` is stripped by `sanitizeProgress` and never re-merged, so it does not round-trip through the
server (localStorage still works, but cross-device / server-authoritative sync silently loses it).
Mirror the `pilot` fix shipped with the leaderboard: add a `mergeCampaignStats(progress, source)` that
reattaches the client-reported `campaign` from the raw save, and call it in the save handler beside
`mergePilotStats`. Clamp on merge the same way `loadCampaign` does (step within
`[0, SECTOR1_CAMPAIGN.length]`, progress ≥ 0, sectorUnlocked ≥ 1).

(Note: this also means the PILOT leaderboard and any future campaign-gated features see correct
server-side state — it is a correctness fix, not new behavior.)

---

## 4. Data flow

```
level-up (kill hook)        load / ship change / respawn / server restore
        |                                   |
   pilot.level↑                       pilot.level set
        |                                   |
   applyLevelHull():                   setPlayerCraft():
     max = effMaxHull()                  playerHealth.max = effMaxHull()
     heal the delta                      playerHealth.hull = max

firing (PvE):  damage = PROJECTILE_DAMAGE + weaponDamageBonus(level)
firing (PvP):  damage = pvpWeapon.damage   (unchanged — level does not apply)

save → currentProgress() includes pilot + campaign
     → server: mergePilotStats + mergeCampaignStats (client-reported, clamped)
     → restore: applyServerProgress sets pilot/campaign, then setPlayerCraft recomputes hull
```

No new persistence keys: `pilot`/`campaign` already exist in `PlayerProgress` and localStorage.

---

## 5. UI / HUD

Light touch. Surface the current bonuses near the XP bar so the level reward is visible — e.g. a small
secondary label or tooltip reading `+20 HULL · +4 DMG` derived from `unlocksForLevel(pilot.level)`.
Optional and cosmetic; the XP bar and level number already exist. No new input modes.

---

## 6. Risks / decisions

- **PvP balance:** level damage is PvE-only by construction (§3.4). Ranked PvP uses `pvpWeapon.damage`
  and is unaffected. The hull bonus DOES carry into PvP via max hull — acceptable for now (PvP already
  reads peer `maxHull`), but noted; if it skews ranked, gate hull to PvE later.
- **No server validation of level/XP:** level/XP are client-reported (like the rest of single-player
  progress) and not yet server-authoritative. With level now granting power, a tampered client could
  self-buff in PvE and inflate the PILOT board. Accepted for this milestone (matches the existing trust
  model for credits before economy guards existed); a follow-up may add an XP-growth guard mirroring
  `guardEconomyGrowth`. Flagged, not built.
- **Tuning:** all magnitudes are starting values. The `(level-1)*1` damage curve at Lv20 (+19 on 12) is
  the most likely to need tuning against deep-space enemy hull — revisit after playtest.

---

## 7. Testing

- `pilotLevel.test.ts`: `weaponDamageBonus` is 0 at level 1, monotonic, and matches the formula at a
  couple of sample levels; `hullBonus` likewise asserted (the prior slice left it untested).
- Server: extend the existing save/progress tests (or add one) to prove `campaign` now round-trips
  through `sanitizeProgress` + the save merge, and that `mergeCampaignStats` clamps bad input.
- Wiring (`effMaxHull`, level-up heal, PvE damage): typecheck + build + manual play — confirm hull max
  rises and heals on level-up, PvE shots hit harder as you level, and PvP damage is unchanged.

---

## 8. Success criteria

A player who levels up *feels* it: their hull jumps and tops off on the banner, their shots kill grunts
faster, and by the time they reach the named captain they are measurably stronger than at level 1 —
without trivializing deep-space enemies. The PILOT leaderboard now ranks genuinely stronger pilots, and
level/campaign state survives a cross-device reload.
