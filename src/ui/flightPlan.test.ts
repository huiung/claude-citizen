import { describe, expect, it } from 'vitest'
import { flightPlanById, flightPlansForDevice, FLIGHT_PLAN_OPTIONS } from './flightPlan'

describe('flight plan options', () => {
  it('routes race pilots to the Citizen Season 1 hub', () => {
    const plan = flightPlanById('race')

    expect(plan?.destinationId).toBe('landmark.citizen-season-1')
    expect(plan?.objective).toContain('golden ring')
  })

  it('routes PvP pilots to the practice arena first', () => {
    const plan = flightPlanById('pvp')

    expect(plan?.destinationId).toBe('pvp.practice')
    expect(plan?.objective).toContain('Practice Arena')
  })

  it('keeps the launch choices focused on the four main activities', () => {
    expect(FLIGHT_PLAN_OPTIONS.map((plan) => plan.id)).toEqual(['race', 'mine', 'pvp', 'explore'])
  })

  it('hides PvP from mobile civilian pilots', () => {
    expect(flightPlansForDevice(true).map((plan) => plan.id)).toEqual(['race', 'mine', 'explore'])
    expect(flightPlansForDevice(false).map((plan) => plan.id)).toEqual(['race', 'mine', 'pvp', 'explore'])
  })
})
