export type FlightPlanId = 'race' | 'mine' | 'pvp' | 'explore'

export interface FlightPlanOption {
  id: FlightPlanId
  title: string
  kicker: string
  destinationId: string | null
  objective: string
}

export const FLIGHT_PLAN_OPTIONS: readonly FlightPlanOption[] = [
  {
    id: 'race',
    title: 'Race',
    kicker: 'Time trial',
    destinationId: 'landmark.citizen-season-1',
    objective: 'Press J to jump to Citizen Season 1 Hub, then enter the golden ring.',
  },
  {
    id: 'mine',
    title: 'Mine',
    kicker: 'Credits run',
    destinationId: null,
    objective: 'Find a cyan-veined asteroid and hold Left-click to mine ORE.',
  },
  {
    id: 'pvp',
    title: 'PvP',
    kicker: 'Practice first',
    destinationId: 'pvp.practice',
    objective: 'Press J to jump to Practice Arena. Ranked Arena requires 1,000+ tokens.',
  },
  {
    id: 'explore',
    title: 'Explore',
    kicker: 'Free flight',
    destinationId: null,
    objective: 'Use B/N to browse destinations, or open the atlas with M.',
  },
]

export function flightPlanById(id: FlightPlanId): FlightPlanOption | undefined {
  return FLIGHT_PLAN_OPTIONS.find((plan) => plan.id === id)
}

export function flightPlansForDevice(isMobileCivilian: boolean): readonly FlightPlanOption[] {
  if (!isMobileCivilian) return FLIGHT_PLAN_OPTIONS
  return FLIGHT_PLAN_OPTIONS.filter((plan) => plan.id !== 'pvp')
}
