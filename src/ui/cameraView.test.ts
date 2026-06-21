import { describe, expect, it } from 'vitest'
import { nextCameraMode, orbitCameraOffset, queueOrbitZoomDelta, zoomOrbitDistance } from './cameraView'

describe('camera view controls', () => {
  it('toggles between rear flight and orbit showcase camera', () => {
    expect(nextCameraMode('rear')).toBe('orbit')
    expect(nextCameraMode('orbit')).toBe('rear')
  })

  it('moves the orbit camera around the ship far enough to see the nose', () => {
    const rear = orbitCameraOffset(0, 0)
    const front = orbitCameraOffset(Math.PI / 0.45, 0)

    expect(rear.z).toBeGreaterThan(0)
    expect(front.z).toBeLessThan(0)
    expect(Math.abs(front.x)).toBeLessThan(0.001)
  })

  it('zooms orbit distance with clamped mouse wheel steps', () => {
    expect(zoomOrbitDistance(8.3, -600)).toBe(6.5)
    expect(zoomOrbitDistance(8.3, 600)).toBe(10.1)
    expect(zoomOrbitDistance(5, -600)).toBe(4.5)
    expect(zoomOrbitDistance(13.8, 600)).toBe(14)
  })

  it('caps queued wheel bursts so zoom is consumed once per frame', () => {
    expect(queueOrbitZoomDelta(0, 200)).toBe(200)
    expect(queueOrbitZoomDelta(800, 800)).toBe(900)
    expect(queueOrbitZoomDelta(-800, -800)).toBe(-900)
  })
})
