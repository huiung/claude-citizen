// Callsign uniqueness — WALLET IDENTITIES ONLY.
//
// The asymmetry here is deliberate and load-bearing. This project once had a server-enforced
// wallet+token gate on play; it was removed because it contradicted the README's "no account,
// click → fly" promise and nobody played. So the anonymous path stays completely unrestricted:
// no wallet means no lookup, no reservation, no refusal — pick any name, including one a wallet
// already holds. What this module guarantees is narrower than "no two pilots share a name":
//
//   no two WALLETS hold the same callsign.
//
// That is the space where a name is an identity worth protecting — the leaderboards, the
// marketplace seller column, the permanent lock index.html's #wallet-hint promises. A live
// nameplate is not that space, and making it exclusive would mean gating anonymous play again.
//
// Consequence worth stating plainly rather than hiding: an anonymous pilot CAN fly under a name
// a wallet has locked. Uniqueness is enforced at the identity layer, not the nameplate layer.
import bs58 from 'bs58'
import { resolveCallsign } from './sessionPeers.mjs'

const MAX_LEN = 16 // matches resolveCallsign's slice — the wire/display limit

/**
 * The stored/displayed form of a callsign: trimmed, internal whitespace runs collapsed, capped at
 * MAX_LEN. Casing is preserved exactly as the first claimant typed it — `Ace` stays `Ace`.
 *
 * The trailing trim matters: slicing a 20-char name to 16 can leave a dangling space, and a stored
 * `"ACE "` would be a display form that no longer round-trips through this function.
 */
export function canonicalCallsign(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LEN).trim()
}

/**
 * The comparison key. `Ace`, `ACE` and `ace ` all normalize to `ace` and therefore collide —
 * chosen because the point of the lock is that players can tell each other apart in chat and on
 * the leaderboard, and a case-only difference is invisible at a glance (i.e. a free impersonation
 * vector). Applied to BOTH sides: canonicalCallsign decides what gets stored, this decides what
 * gets compared, so there is no gap for a variant to slip through.
 *
 * Returns '' for anything unreservable — empty, whitespace-only, or the `PILOT` placeholder.
 * PILOT is every pilot's default; reserving it for the first wallet that flew would lock every
 * later wallet out of the default name.
 */
export function normalizeCallsign(name) {
  const lower = canonicalCallsign(name).toLowerCase()
  return !lower || lower === 'pilot' ? '' : lower
}

/**
 * Is this progress-store key a wallet pubkey rather than an anonymous Pilot Code?
 *
 * Used only to backfill reservations for wallets that locked a name before this module existed.
 * A Solana pubkey is exactly 32 bytes of base58; the default Pilot Code is a UUID, whose hyphens
 * aren't in the base58 alphabet, so it can never decode. A player CAN paste an arbitrary string
 * as their Pilot Code (see the restore-code field), so a hand-crafted 32-byte base58 code would
 * be misread as a wallet — the only cost is one extra reserved name, and it is the same string
 * the player is flying under anyway.
 */
export function looksLikeWalletKey(key) {
  try {
    return bs58.decode(String(key ?? '')).length === 32
  } catch {
    return false
  }
}

/**
 * In-memory callsign → owning pubkey index, seeded from a persisted snapshot.
 *
 * There is no release(): a wallet's callsign is sticky for life (resolveCallsign ignores a
 * different requested name once one is stored) and #wallet-hint promises exactly that, so a
 * reservation never needs to be handed back. One wallet therefore holds at most one entry.
 */
export function createCallsignRegistry(initial = {}) {
  const owners = new Map() // normalized callsign -> pubkey
  for (const [name, pubkey] of Object.entries(initial ?? {})) {
    const norm = normalizeCallsign(name)
    const owner = typeof pubkey === 'string' ? pubkey.slice(0, 64) : ''
    if (norm && owner && !owners.has(norm)) owners.set(norm, owner)
  }
  return {
    /** The pubkey holding this callsign, or null when it's free (or unreservable). */
    ownerOf(name) {
      const norm = normalizeCallsign(name)
      return norm ? owners.get(norm) ?? null : null
    },
    /**
     * Record `pubkey` as the holder. Returns true only when the registry actually changed, so
     * callers can skip a disk flush. Never steals: a name already held by a different wallet is
     * left alone and false is returned (the caller decides what to tell the player).
     */
    reserve(name, pubkey) {
      const norm = normalizeCallsign(name)
      const owner = typeof pubkey === 'string' ? pubkey.slice(0, 64) : ''
      if (!norm || !owner || owners.has(norm)) return false
      owners.set(norm, owner)
      return true
    },
    snapshot() {
      return Object.fromEntries(owners)
    },
    get size() {
      return owners.size
    },
  }
}

/**
 * Backfill seed: every non-placeholder name already sitting on a wallet-keyed progress row.
 *
 * Without this, a wallet that locked `ACE` months ago would find `ACE` free for the next wallet
 * that asked — the exact collision this module exists to prevent. First row in key order wins;
 * pre-existing duplicates (possible, since nothing enforced uniqueness before) leave the later
 * wallet grandfathered on its own row (see resolveUniqueCallsign) rather than renamed.
 */
export function callsignSeedFromStore(store, isWalletKey = looksLikeWalletKey) {
  const seed = {}
  for (const [key, row] of Object.entries(store ?? {})) {
    if (!row || typeof row !== 'object' || !isWalletKey(key)) continue
    const norm = normalizeCallsign(row.name)
    if (norm && !(norm in seed)) seed[norm] = key
  }
  return seed
}

/**
 * Decide the callsign a connection flies under, and reserve it when it's a fresh wallet grant.
 *
 * Returns { name, reserved, conflict }:
 *   name     — the callsign to use (already canonical for wallet grants)
 *   reserved — the registry changed; persist the snapshot
 *   conflict — { requested } when a DIFFERENT wallet holds the requested name, else null
 *
 * Rules, in order:
 *   - Not authed → delegate straight to resolveCallsign. No lookup, no reservation, no refusal.
 *     Anonymous play is untouched by this module, and that is the point.
 *   - A wallet with a stored name keeps it, unconditionally. It is already flying under that
 *     name; renaming a real returning player to settle a legacy duplicate would be worse than
 *     the duplicate. reserve() backfills the index if the seed missed it, and silently no-ops
 *     when another wallet already holds it (grandfathered).
 *   - A wallet asking for a name it ALREADY holds in the registry succeeds. This is not just
 *     politeness: the reservation lands at auth/hello time but `name` only reaches the store on
 *     the next save, so a join in between legitimately sees an empty storedName.
 *   - A wallet asking for another wallet's name is refused and flies as PILOT. It is NOT
 *     disconnected and LAUNCH is not blocked — the refusal costs a name, never a flight.
 */
export function resolveUniqueCallsign({ registry, authed, pubkey, storedName, requestedName }) {
  if (!authed || !pubkey || !registry) {
    return { name: resolveCallsign({ authed, storedName, requestedName }), reserved: false, conflict: null }
  }
  const stored = canonicalCallsign(storedName)
  if (normalizeCallsign(stored)) {
    return { name: stored, reserved: registry.reserve(stored, pubkey), conflict: null }
  }
  const requested = canonicalCallsign(requestedName) || 'PILOT'
  const norm = normalizeCallsign(requested)
  if (!norm) return { name: requested, reserved: false, conflict: null } // PILOT / empty — nothing to reserve
  const owner = registry.ownerOf(requested)
  if (owner === pubkey) return { name: requested, reserved: false, conflict: null }
  if (owner) return { name: 'PILOT', reserved: false, conflict: { requested } }
  return { name: requested, reserved: registry.reserve(requested, pubkey), conflict: null }
}

/** The player-facing refusal. Says what happened, and what to do about it. */
export function callsignTakenMessage(requested) {
  return `Callsign "${requested}" is already locked to another wallet. Pick a different one — your progress is safe, and you can fly as PILOT until you do.`
}
