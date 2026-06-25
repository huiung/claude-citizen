import { describe, expect, it } from 'vitest'
import { recordBlackHoleRun, blackHoleLeaderboardPage, mergeBlackHoleStats } from './blackHoleLeaderboard.mjs'

describe('blackHoleLeaderboard', () => {
  it('records a first dive and improves only on a smaller distance', () => {
    const store = {}
    expect(recordBlackHoleRun(store, { key: 'k1', name: 'ACE', distance: 9000, now: 1 })).toBe(true)
    expect(store.k1.blackHole.bestDistance).toBe(9000)
    expect(store.k1.blackHole.dives).toBe(1)
    recordBlackHoleRun(store, { key: 'k1', name: 'ACE', distance: 12000, now: 2 }) // worse — no improve
    expect(store.k1.blackHole.bestDistance).toBe(9000)
    expect(store.k1.blackHole.dives).toBe(2)
    recordBlackHoleRun(store, { key: 'k1', name: 'ACE', distance: 7000, now: 3 }) // better
    expect(store.k1.blackHole.bestDistance).toBe(7000)
  })

  it('ignores non-positive / NaN distances and missing keys', () => {
    const store = {}
    expect(recordBlackHoleRun(store, { key: 'k1', name: 'X', distance: 0, now: 1 })).toBe(false)
    expect(recordBlackHoleRun(store, { key: 'k1', name: 'X', distance: -5, now: 1 })).toBe(false)
    expect(recordBlackHoleRun(store, { key: '', name: 'X', distance: 9000, now: 1 })).toBe(false)
    expect(store.k1).toBeUndefined()
  })

  it('pages ascending by bestDistance with documented tie-breaks', () => {
    const store = {}
    recordBlackHoleRun(store, { key: 'a', name: 'A', distance: 9000, now: 1 })
    recordBlackHoleRun(store, { key: 'b', name: 'B', distance: 6000, now: 2 })
    recordBlackHoleRun(store, { key: 'c', name: 'C', distance: 12000, now: 3 })
    const page = blackHoleLeaderboardPage(store, { offset: 0 })
    expect(page.rows.map((r) => r.distance)).toEqual([6000, 9000, 12000])
    expect(page.rows[0].rank).toBe(1)
    expect(page.total).toBe(3)
  })

  it('merge preserves prior blackHole stats onto a fresh progress object', () => {
    const store = {}
    recordBlackHoleRun(store, { key: 'k1', name: 'ACE', distance: 8000, now: 1 })
    const merged = mergeBlackHoleStats({ credits: 5 }, store.k1)
    expect(merged.blackHole.bestDistance).toBe(8000)
    expect(merged.credits).toBe(5)
  })
})
