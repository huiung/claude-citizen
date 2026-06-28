import { describe, expect, it } from 'vitest'
import { GAME_KNOWLEDGE } from './gameKnowledge.mjs'

describe('GAME_KNOWLEDGE', () => {
  it('is a compact digest within a sane token budget', () => {
    expect(GAME_KNOWLEDGE.length).toBeGreaterThan(400)
    expect(GAME_KNOWLEDGE.length).toBeLessThan(2400)
  })
  it('covers the topics players ask about', () => {
    for (const term of ['Refinery', 'ORE', 'Craft Core', '$CITIZEN', 'Admiral', 'Training Arena', 'Black hole']) {
      expect(GAME_KNOWLEDGE).toContain(term)
    }
  })
})
