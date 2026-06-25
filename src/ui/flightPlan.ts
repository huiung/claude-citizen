export type FlightPlanId = 'race' | 'mine' | 'pvp' | 'blackhole' | 'explore'
export type FlightPlanSpawnMode = 'race-start' | 'mine-field' | 'pvp-practice' | 'black-hole-approach' | 'default'

export interface FlightPlanOption {
  id: FlightPlanId
  title: string
  kicker: string
  destinationId: string | null
  spawnMode: FlightPlanSpawnMode
  objective: string
}

export const FLIGHT_PLAN_OPTIONS: readonly FlightPlanOption[] = [
  {
    id: 'race',
    title: 'Race',
    kicker: 'Time trial',
    destinationId: 'landmark.citizen-season-1',
    spawnMode: 'race-start',
    objective: 'Race start selected — fly through the golden ring to begin.',
  },
  {
    id: 'mine',
    title: 'Mine',
    kicker: 'Credits run',
    destinationId: null,
    spawnMode: 'mine-field',
    objective: 'Mining field selected — look for cyan-veined asteroids nearby and hold Left-click.',
  },
  {
    id: 'pvp',
    title: 'PvP',
    kicker: 'Practice first',
    destinationId: 'pvp.practice',
    spawnMode: 'pvp-practice',
    objective: 'Practice Arena selected — PvP is live inside the ring.',
  },
  {
    id: 'blackhole',
    title: 'Black Hole',
    kicker: 'Closest-approach run',
    destinationId: 'black-hole-approach',
    spawnMode: 'black-hole-approach',
    objective: 'Singularity ahead — dive as close as you dare and pull out alive. Watch the ESCAPE readout.',
  },
  {
    id: 'explore',
    title: 'Explore',
    kicker: 'Free flight',
    destinationId: null,
    spawnMode: 'default',
    objective: 'Use B/N to browse destinations, or open the atlas with M.',
  },
]

export function flightPlanById(id: FlightPlanId): FlightPlanOption | undefined {
  return FLIGHT_PLAN_OPTIONS.find((plan) => plan.id === id)
}

export function flightPlansForDevice(isMobileCivilian: boolean): readonly FlightPlanOption[] {
  if (!isMobileCivilian) return FLIGHT_PLAN_OPTIONS
  // Mobile companion can't set the PvP arena or black-hole quantum destinations, so hide both.
  return FLIGHT_PLAN_OPTIONS.filter((plan) => plan.id !== 'pvp' && plan.id !== 'blackhole')
}
