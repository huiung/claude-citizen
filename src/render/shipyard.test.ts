import { describe, expect, it } from 'vitest'
import { pirateModelUrl } from './shipyard'

describe('pirate model asset', () => {
  it('points pirates at their dedicated raider GLB', () => {
    expect(pirateModelUrl()).toBe('/assets/ships/pirate-raider.glb')
  })
})
