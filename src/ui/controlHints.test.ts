import { describe, expect, it } from 'vitest'
import {
  createControlHintState, HINT_MASTERY_THRESHOLD, HINTED_CONTROL_CODES, noteControlUsed,
  toggleControlHints,
} from './controlHints'

/** Press a list of codes, returning how many presses reported a collapse. */
function press(state: ReturnType<typeof createControlHintState>, codes: string[]): number {
  let collapses = 0
  for (const c of codes) if (noteControlUsed(state, c)) collapses++
  return collapses
}

/** `n` codes that are DISTINCT controls. Slicing the list is not the same thing: it starts with both
 *  Shift keys, which are deliberately one control, so `slice(0, 10)` is only nine of them. */
function distinctCodes(n: number): string[] {
  const out: string[] = []
  for (const code of HINTED_CONTROL_CODES) {
    if (code === 'ShiftRight') continue
    if (out.length >= n) break
    out.push(code)
  }
  return out
}

describe('noteControlUsed', () => {
  it('collapses exactly once, on the press that reaches the threshold', () => {
    const state = createControlHintState(false)
    expect(press(state, distinctCodes(HINT_MASTERY_THRESHOLD + 4))).toBe(1) // persist once, not per key
    expect(state.collapsed).toBe(true)
  })

  it('does not collapse before the threshold', () => {
    const state = createControlHintState(false)
    press(state, distinctCodes(HINT_MASTERY_THRESHOLD - 1))
    expect(state.collapsed).toBe(false)
  })

  it('counts DISTINCT controls, so holding one key never collapses it', () => {
    // The failure mode of a naive counter: a player flying in a straight line for a minute has
    // learned nothing and must keep the tutorial.
    const state = createControlHintState(false)
    press(state, Array(500).fill('KeyW'))
    expect(state.collapsed).toBe(false)
    expect(state.used.size).toBe(1)
  })

  it('ignores keys the hints do not mention', () => {
    // Typing in chat reaches a lot of keys. None of them teach a control.
    const state = createControlHintState(false)
    press(state, ['KeyG', 'KeyH', 'KeyP', 'KeyZ', 'Escape', 'Tab', 'Enter', 'KeyY', 'KeyU', 'Digit9', 'Digit0', 'KeyT'])
    expect(state.used.size).toBe(0)
    expect(state.collapsed).toBe(false)
  })

  it('treats the two Shift keys as the one control the hints name', () => {
    const state = createControlHintState(false)
    press(state, ['ShiftLeft', 'ShiftRight'])
    expect(state.used.size).toBe(1)
  })

  it('stops counting once collapsed, so a re-expand is not instantly undone', () => {
    const state = createControlHintState(true)
    press(state, [...HINTED_CONTROL_CODES])
    expect(state.used.size).toBe(0)
  })

  it('needs more than the four movement keys, which is the whole point', () => {
    // "After first use" was the alternative: W is the first key anyone presses and twenty of the
    // twenty-one hints are still unknown at that moment.
    const state = createControlHintState(false)
    press(state, ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'])
    expect(state.collapsed).toBe(false)
  })
})

describe('toggleControlHints', () => {
  it('flips, and a player who re-expands keeps the block', () => {
    const state = createControlHintState(true)
    expect(toggleControlHints(state)).toBe(false)
    expect(state.collapsed).toBe(false)
    expect(toggleControlHints(state)).toBe(true)
  })

  it('lets a re-expanded block collapse again by mastery', () => {
    const state = createControlHintState(true)
    toggleControlHints(state)
    expect(press(state, distinctCodes(HINT_MASTERY_THRESHOLD))).toBe(1)
    expect(state.collapsed).toBe(true)
  })
})

describe('HINTED_CONTROL_CODES', () => {
  it('has no duplicates and comfortably exceeds the threshold', () => {
    expect(new Set(HINTED_CONTROL_CODES).size).toBe(HINTED_CONTROL_CODES.length)
    expect(HINTED_CONTROL_CODES.length).toBeGreaterThan(HINT_MASTERY_THRESHOLD)
  })

  it('does not claim H, which is the toggle', () => {
    expect(HINTED_CONTROL_CODES).not.toContain('KeyH')
  })
})

describe('the Shift pair', () => {
  it('means ten distinct controls needs eleven of the listed codes', () => {
    // Caught by a test that sliced the first ten codes and did not collapse. Worth pinning down: the
    // list is not a count of controls, and anything reading it as one is off by one.
    const state = createControlHintState(false)
    press(state, HINTED_CONTROL_CODES.slice(0, HINT_MASTERY_THRESHOLD) as string[])
    expect(state.collapsed).toBe(false)
    expect(noteControlUsed(state, HINTED_CONTROL_CODES[HINT_MASTERY_THRESHOLD])).toBe(true)
  })
})
