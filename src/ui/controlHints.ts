/** When the twelve-line control-hints block should stop taking up the corner of the screen.
 *
 *  Two things are true at once and neither can be dropped. It is the only place a new player learns
 *  that E steps out of the ship, that M opens the atlas, or that 1/2/3 pick a fire mode — there is no
 *  other tutorial. And it fills the bottom-right of every screenshot anyone would want to post.
 *
 *  Not a timer. A timer punishes someone reading the list and rewards someone who alt-tabbed; it also
 *  says nothing about whether they learned anything. The signal used instead is how many DIFFERENT
 *  hinted controls the player has actually driven, which is as close to "they have found the controls"
 *  as an input stream gets. Ten of them cannot be reached by holding W: it takes thrust, strafe,
 *  vertical, boost, brake, and at least a few of the discrete ones.
 *
 *  Not "after first use" either, which was the other option on the table: the first control anyone
 *  touches is W, twenty of the twenty-one hints are still unknown at that point, and collapsing there
 *  would delete the tutorial for exactly the player it exists for.
 *
 *  Collapsing is sticky and persisted, so a returning player is not taught twice, and H toggles it
 *  either way — a player who wants the list back keeps it.
 */

/** Codes named in the hints block. Anything outside this set (typing in chat, a stray modifier) must
 *  not count toward mastery, or the block collapses on a player who has learned nothing. */
export const HINTED_CONTROL_CODES: readonly string[] = [
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyR', 'KeyF', 'KeyQ', 'KeyE',
  'ShiftLeft', 'ShiftRight', 'KeyX', 'KeyV', 'KeyC', 'Space',
  'KeyB', 'KeyN', 'KeyJ', 'Digit1', 'Digit2', 'Digit3',
  'KeyM', 'KeyL', 'KeyI', 'KeyO',
]

/** How many distinct hinted controls count as "has found the controls".
 *
 *  Ten of twenty-four. Flying at all uses W/S, A/D, R/F and Shift — that is seven, and reaching ten
 *  means also going near the discrete keys, i.e. having looked at the list rather than guessed WASD.
 *  Deliberately below the full set: nobody should have to press O for settings to clear their frame. */
export const HINT_MASTERY_THRESHOLD = 10

const hintedSet = new Set(HINTED_CONTROL_CODES)

/** Both Shift keys are ONE control in the hints ("SHIFT boost"), so counting them separately would
 *  hand out a free point to anyone who uses whichever one is nearer. */
function canonicalControl(code: string): string {
  return code === 'ShiftRight' ? 'ShiftLeft' : code
}

export interface ControlHintState {
  /** Distinct canonical controls used this session. */
  used: Set<string>
  collapsed: boolean
}

export function createControlHintState(collapsed: boolean): ControlHintState {
  return { used: new Set(), collapsed }
}

/** Record a keypress. Returns true when this press is what collapsed the block, so the caller can
 *  persist and re-render once rather than on every key. */
export function noteControlUsed(state: ControlHintState, code: string): boolean {
  if (state.collapsed) return false
  if (!hintedSet.has(code)) return false
  state.used.add(canonicalControl(code))
  if (state.used.size < HINT_MASTERY_THRESHOLD) return false
  state.collapsed = true
  return true
}

/** Explicit H press. Returns the new collapsed state. */
export function toggleControlHints(state: ControlHintState): boolean {
  state.collapsed = !state.collapsed
  return state.collapsed
}
