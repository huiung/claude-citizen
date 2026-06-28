import { describe, expect, it } from 'vitest'
import { buildBrainContext, parseBrainOutput, MAX_SAY_LEN } from './brainContext.mjs'

describe('buildBrainContext', () => {
  it('summarizes location, current activity, nearby pilots, and recent chat (capped)', () => {
    const chat = Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, text: `msg ${i}` }))
    const ctx = buildBrainContext({
      location: 'near Earth', currentActivity: 'cruise -> Jupiter',
      nearbyPilots: ['ACE', 'NOVA'], recentChat: chat,
    })
    expect(ctx.location).toBe('near Earth')
    expect(ctx.currentActivity).toBe('cruise -> Jupiter')
    expect(ctx.nearbyPilots).toEqual(['ACE', 'NOVA'])
    expect(ctx.recentChat.length).toBeLessThanOrEqual(6)
    expect(ctx.recentChat.at(-1)).toEqual({ name: 'P9', text: 'msg 9' })
  })

  it('includes the current activity when provided', () => {
    const ctx = buildBrainContext({ location: 'near Meridian Refinery', currentActivity: 'cruise -> Mars', recentChat: [] })
    expect(ctx.currentActivity).toBe('cruise -> Mars')
  })
  it('defaults current activity to idle', () => {
    expect(buildBrainContext({}).currentActivity).toBe('idle')
  })
})

describe('parseBrainOutput', () => {
  const valid = new Set(['planet-earth', 'planet-jupiter'])

  it('parses a clean JSON object', () => {
    expect(parseBrainOutput('{"say":"hello pilots","goto":"planet-jupiter"}', valid))
      .toEqual({ say: 'hello pilots', goto: 'planet-jupiter' })
  })

  it('extracts JSON embedded in surrounding prose', () => {
    expect(parseBrainOutput('Sure! {"say":"on my way"} heading out', valid))
      .toEqual({ say: 'on my way' })
  })

  it('drops an unknown goto and clamps an over-long say', () => {
    const long = 'x'.repeat(MAX_SAY_LEN + 50)
    const out = parseBrainOutput(`{"say":"${long}","goto":"nowhere"}`, valid)
    expect(out.goto).toBeUndefined()
    expect(out.say.length).toBe(MAX_SAY_LEN)
  })

  it('returns an empty object for non-JSON / garbage', () => {
    expect(parseBrainOutput('no json here', valid)).toEqual({})
    expect(parseBrainOutput('', valid)).toEqual({})
  })
})
