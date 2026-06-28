export type LandingCaptureLaunchConfig = {
  autoLaunch: boolean
  callsign: string | null
}

export function holderCaptureLaunchConfig(params: URLSearchParams): LandingCaptureLaunchConfig {
  if (params.get('capture') === 'og') return { autoLaunch: true, callsign: 'test' }
  if (params.get('showcase') === 'holder') return { autoLaunch: true, callsign: 'PILOT' }
  if (params.get('cam')) return { autoLaunch: true, callsign: 'CAM' }
  return { autoLaunch: false, callsign: null }
}
