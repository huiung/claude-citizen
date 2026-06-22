import { describe, expect, it } from 'vitest'
import { shouldRenderWorldFrame, shouldRunBackgroundWorldWork } from './renderCadence'

describe('background world work cadence', () => {
  it('pauses streaming and planet upgrades while docked in a station menu', () => {
    expect(shouldRunBackgroundWorldWork({ running: true, docked: true })).toBe(false)
  })

  it('runs streaming and planet upgrades during active flight', () => {
    expect(shouldRunBackgroundWorldWork({ running: true, docked: false })).toBe(true)
  })

  it('pauses the WebGL world frame while docked because the station covers the screen', () => {
    expect(shouldRenderWorldFrame({ running: true, docked: true, solarMapOpen: false })).toBe(false)
  })

  it('keeps rendering the launch backdrop before the player launches', () => {
    expect(shouldRenderWorldFrame({ running: false, docked: false, solarMapOpen: false })).toBe(true)
  })
})
