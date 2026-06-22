import { describe, expect, it } from 'vitest'
import {
  defaultRearDistance,
  nextCameraMode,
  orbitCameraOffset,
  queueOrbitZoomDelta,
  rearCameraOffset,
  zoomOrbitDistance,
  zoomRearDistance,
} from './cameraView'

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

  it('uses a wider rear combat camera and clamps rear wheel zoom', () => {
    expect(defaultRearDistance()).toBe(14)
    expect(rearCameraOffset(0).z).toBe(14)
    expect(rearCameraOffset(1, 20).z).toBe(24)
    expect(zoomRearDistance(14, -1000)).toBe(10)
    expect(zoomRearDistance(14, 1000)).toBe(20)
    expect(zoomRearDistance(25, 1000)).toBe(26)
  })

  it('caps queued wheel bursts so zoom is consumed once per frame', () => {
    expect(queueOrbitZoomDelta(0, 200)).toBe(200)
    expect(queueOrbitZoomDelta(800, 800)).toBe(900)
    expect(queueOrbitZoomDelta(-800, -800)).toBe(-900)
  })
})
