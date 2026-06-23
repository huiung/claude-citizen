import { describe, expect, it } from 'vitest'
import { createSeasonHubLifeRig, updateSeasonHubLifeRig } from './seasonHub'

describe('season hub life rig', () => {
  it('builds animated rings, shuttles, and beacon lights for the hub', () => {
    const rig = createSeasonHubLifeRig()

    expect(rig.root.name).toBe('Citizen Season 1 Hub Life Rig')
    expect(rig.transitRings.length).toBeGreaterThanOrEqual(2)
    expect(rig.shuttles.length).toBeGreaterThanOrEqual(6)
    expect(rig.beacons.length).toBeGreaterThanOrEqual(12)
  })

  it('moves traffic and pulses hub lights over time', () => {
    const rig = createSeasonHubLifeRig()
    const initialRingRotation = rig.transitRings[0].rotation.z
    const initialShuttleX = rig.shuttles[0].position.x
    const initialBeaconScale = rig.beacons[0].scale.x

    updateSeasonHubLifeRig(rig, 2.4, 0.5)

    expect(rig.transitRings[0].rotation.z).not.toBe(initialRingRotation)
    expect(rig.shuttles[0].position.x).not.toBe(initialShuttleX)
    expect(rig.beacons[0].scale.x).not.toBe(initialBeaconScale)
  })
})
