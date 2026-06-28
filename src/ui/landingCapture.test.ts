import { describe, expect, it } from 'vitest'
import { holderCaptureLaunchConfig } from './landingCapture'

describe('holderCaptureLaunchConfig', () => {
  it('auto-launches holder showcase with the pilot callsign', () => {
    expect(holderCaptureLaunchConfig(new URLSearchParams('showcase=holder'))).toEqual({
      autoLaunch: true,
      callsign: 'PILOT',
    })
  })

  it('auto-launches the browser autopilot as CLAUDE for ?bot=1', () => {
    expect(holderCaptureLaunchConfig(new URLSearchParams('bot=1'))).toEqual({
      autoLaunch: true,
      callsign: 'CLAUDE',
    })
  })

  it('keeps OG capture behavior intact', () => {
    expect(holderCaptureLaunchConfig(new URLSearchParams('capture=og'))).toEqual({
      autoLaunch: true,
      callsign: 'test',
    })
  })

  it('does not auto-launch normal visits', () => {
    expect(holderCaptureLaunchConfig(new URLSearchParams(''))).toEqual({
      autoLaunch: false,
      callsign: null,
    })
  })
})
