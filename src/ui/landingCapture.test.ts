import { describe, expect, it } from 'vitest'
import { holderCaptureLaunchConfig } from './landingCapture'

describe('holderCaptureLaunchConfig', () => {
  it('auto-launches holder showcase with the pilot callsign', () => {
    expect(holderCaptureLaunchConfig(new URLSearchParams('showcase=holder'))).toEqual({
      autoLaunch: true,
      callsign: 'PILOT',
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
