import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'

describe('flight plan launch layout', () => {
  it('renders post-launch flight plan choices', () => {
    expect(html).toContain('id="flight-plan"')
    expect(html).toContain('data-plan="race"')
    expect(html).toContain('data-plan="mine"')
    expect(html).toContain('data-plan="pvp"')
    expect(html).toContain('data-plan="explore"')
  })
})
