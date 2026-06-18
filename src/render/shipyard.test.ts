import { describe, expect, it } from 'vitest'
import { capitalModelUrl, pirateModelUrl } from './shipyard'

describe('pirate model asset', () => {
  it('points pirates at their dedicated raider GLB', () => {
    expect(pirateModelUrl()).toBe('/assets/ships/pirate-raider.glb')
  })

  it('points the capital ship at its dedicated dreadnought GLB', () => {
    expect(capitalModelUrl()).toBe('/assets/ships/capital-dreadnought.glb')
  })
})
