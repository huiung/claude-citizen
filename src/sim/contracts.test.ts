import { describe, expect, it } from 'vitest'
import { createEconomy, OUTPOSTS } from './economy'
import { abandon, accept, completeContract, generateContracts, type Contract } from './contracts'

describe('contracts', () => {
  it('generation is deterministic: same seed -> identical contracts', () => {
    const a = generateContracts(42, OUTPOSTS)
    const b = generateContracts(42, OUTPOSTS)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })

  it('different seeds generally produce different contracts', () => {
    const a = generateContracts(1, OUTPOSTS)
    const b = generateContracts(2, OUTPOSTS)
    expect(a).not.toEqual(b)
  })

  it('generated contracts are well-formed: distinct route, valid commodity, positive qty/reward', () => {
    for (const c of generateContracts(7, OUTPOSTS)) {
      expect(c.fromId).not.toBe(c.toId)
      expect(OUTPOSTS[c.fromId]).toBeDefined()
      expect(OUTPOSTS[c.toId]).toBeDefined()
      expect(c.qty).toBeGreaterThan(0)
      expect(c.reward).toBeGreaterThan(0)
      expect(['ORE', 'ALLOY']).toContain(c.commodity)
      expect(c.status).toBe('offered')
    }
  })

  it('returns no contracts when fewer than two outposts exist', () => {
    expect(generateContracts(1, { only: OUTPOSTS.colony })).toEqual([])
  })

  it('status transitions: offered -> accepted -> completed', () => {
    const c = generateContracts(99, OUTPOSTS)[0]
    expect(c.status).toBe('offered')
    expect(accept(c)).toEqual({ ok: true })
    expect(c.status).toBe('accepted')

    const econ = createEconomy()
    econ.cargo[c.commodity] = c.qty
    const r = completeContract(c, econ, c.toId)
    expect(r.ok).toBe(true)
    expect(c.status).toBe('completed')
  })

  it('accept fails when contract is not offered', () => {
    const c = generateContracts(99, OUTPOSTS)[0]
    accept(c)
    expect(accept(c)).toEqual({ ok: false, reason: 'not-offered' })
  })

  it('abandon flips an accepted contract and rejects non-accepted ones', () => {
    const c = generateContracts(99, OUTPOSTS)[0]
    expect(abandon(c)).toEqual({ ok: false, reason: 'not-accepted' })
    accept(c)
    expect(abandon(c)).toEqual({ ok: true })
    expect(c.status).toBe('abandoned')
  })

  it("can't complete a contract that hasn't been accepted", () => {
    const c = generateContracts(99, OUTPOSTS)[0]
    const econ = createEconomy()
    econ.cargo[c.commodity] = c.qty
    expect(completeContract(c, econ, c.toId)).toEqual({ ok: false, reason: 'not-accepted' })
  })

  it("can't complete at the wrong outpost", () => {
    const c: Contract = {
      id: 't', commodity: 'ORE', qty: 2, fromId: 'colony', toId: 'refinery', reward: 100, status: 'accepted',
    }
    const econ = createEconomy()
    econ.cargo.ORE = 2
    const r = completeContract(c, econ, 'colony') // wrong: should be refinery
    expect(r).toEqual({ ok: false, reason: 'wrong-outpost' })
    expect(econ.cargo.ORE).toBe(2)
    expect(c.status).toBe('accepted')
  })

  it("can't complete without enough goods", () => {
    const c: Contract = {
      id: 't', commodity: 'ORE', qty: 5, fromId: 'colony', toId: 'refinery', reward: 100, status: 'accepted',
    }
    const econ = createEconomy()
    econ.cargo.ORE = 4 // one short
    const before = econ.credits
    const r = completeContract(c, econ, 'refinery')
    expect(r).toEqual({ ok: false, reason: 'insufficient-cargo' })
    expect(econ.cargo.ORE).toBe(4)
    expect(econ.credits).toBe(before)
    expect(c.status).toBe('accepted')
  })

  it('successful completion pays reward and consumes exactly qty cargo', () => {
    const c: Contract = {
      id: 't', commodity: 'ALLOY', qty: 3, fromId: 'refinery', toId: 'colony', reward: 420, status: 'accepted',
    }
    const econ = createEconomy()
    econ.cargo.ALLOY = 5
    const before = econ.credits
    const r = completeContract(c, econ, 'colony')
    expect(r).toEqual({ ok: true, reward: 420 })
    expect(econ.credits).toBe(before + 420)
    expect(econ.cargo.ALLOY).toBe(2) // 5 - 3
    expect(c.status).toBe('completed')
  })

  it("can't re-complete an already completed contract", () => {
    const c: Contract = {
      id: 't', commodity: 'ORE', qty: 1, fromId: 'colony', toId: 'refinery', reward: 50, status: 'accepted',
    }
    const econ = createEconomy()
    econ.cargo.ORE = 2
    expect(completeContract(c, econ, 'refinery').ok).toBe(true)
    const r = completeContract(c, econ, 'refinery')
    expect(r).toEqual({ ok: false, reason: 'not-accepted' })
    expect(econ.cargo.ORE).toBe(1) // only the first one consumed
  })
})
