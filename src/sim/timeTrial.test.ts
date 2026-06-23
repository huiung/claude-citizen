import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  createTimeTrial,
  timeTrialStatusText,
  updateTimeTrial,
  type TimeTrialGate,
} from './timeTrial'

const gates: TimeTrialGate[] = [
  { id: 'start', position: new Vector3(0, 0, 0), radius: 100 },
  { id: 'mid', position: new Vector3(500, 0, 0), radius: 100 },
  { id: 'finish', position: new Vector3(1000, 0, 0), radius: 100 },
]

describe('time trial route state', () => {
  it('starts on the first gate and completes after gates are crossed in order', () => {
    const trial = createTimeTrial(gates)

    expect(trial.active).toBe(false)
    expect(updateTimeTrial(trial, new Vector3(0, 0, 0), 10).event).toBe('start')
    expect(trial.active).toBe(true)
    expect(trial.nextGateIndex).toBe(1)

    expect(updateTimeTrial(trial, new Vector3(1000, 0, 0), 14).event).toBe('none')
    expect(trial.nextGateIndex).toBe(1)

    expect(updateTimeTrial(trial, new Vector3(500, 0, 0), 18).event).toBe('gate')
    const finish = updateTimeTrial(trial, new Vector3(1000, 0, 0), 30)

    expect(finish.event).toBe('finish')
    expect(finish.time).toBe(20)
    expect(trial.bestTime).toBe(20)
    expect(trial.active).toBe(false)
  })

  it('keeps the faster best time and exposes compact HUD copy', () => {
    const trial = createTimeTrial(gates, 25)

    updateTimeTrial(trial, gates[0].position, 0)
    updateTimeTrial(trial, gates[1].position, 9)
    updateTimeTrial(trial, gates[2].position, 21)

    expect(trial.bestTime).toBe(21)
    expect(timeTrialStatusText(trial, 21)).toBe('HUB TIME TRIAL - BEST 00:21.00')

    updateTimeTrial(trial, new Vector3(1000, 0, 0), 29)
    updateTimeTrial(trial, gates[0].position, 30)
    expect(timeTrialStatusText(trial, 34)).toBe('HUB TIME TRIAL - GATE 2/3 - 00:04.00 - BEST 00:21.00')
  })

  it('does not immediately restart while the ship remains inside the start gate after finishing', () => {
    const overlappingFinish = [
      { id: 'start', position: new Vector3(0, 0, 0), radius: 120 },
      { id: 'mid', position: new Vector3(500, 0, 0), radius: 120 },
      { id: 'finish', position: new Vector3(40, 0, 0), radius: 120 },
    ]
    const trial = createTimeTrial(overlappingFinish)

    updateTimeTrial(trial, overlappingFinish[0].position, 0)
    updateTimeTrial(trial, overlappingFinish[1].position, 5)
    expect(updateTimeTrial(trial, overlappingFinish[2].position, 10).event).toBe('finish')
    expect(updateTimeTrial(trial, overlappingFinish[2].position, 10.1).event).toBe('none')

    updateTimeTrial(trial, new Vector3(1000, 0, 0), 11)
    expect(updateTimeTrial(trial, overlappingFinish[0].position, 12).event).toBe('start')
  })
})
