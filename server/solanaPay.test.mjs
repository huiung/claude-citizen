import { describe, expect, it } from 'vitest'
import { parseSettlement } from './solanaPay.mjs'

const MINT = 'MintAAAA'
const SELLER = 'SellerAAAA'
const TREASURY = 'TreasuryAAAA'

function tx({ err = null, pre = [], post = [], memos = [] } = {}) {
  return {
    meta: {
      err,
      preTokenBalances: pre,
      postTokenBalances: post,
    },
    transaction: {
      message: {
        instructions: memos.map((m) => ({ program: 'spl-memo', programId: 'Memo', parsed: m })),
      },
    },
  }
}
const bal = (owner, amount, mint = MINT) => ({ mint, owner, uiTokenAmount: { amount: String(amount) } })

describe('parseSettlement', () => {
  it('computes seller and treasury deltas for the mint, plus the memo', () => {
    const r = parseSettlement(
      tx({
        pre: [bal(SELLER, 0), bal(TREASURY, 0)],
        post: [bal(SELLER, 950_000), bal(TREASURY, 50_000)],
        memos: ['nonce-xyz'],
      }),
      { mint: MINT, seller: SELLER, treasury: TREASURY },
    )
    expect(r).toEqual({ sellerRaw: 950_000n, treasuryRaw: 50_000n, memo: 'nonce-xyz' })
  })

  it('ignores balances for other mints', () => {
    const r = parseSettlement(
      tx({ post: [bal(SELLER, 999, 'OtherMint')] }),
      { mint: MINT, seller: SELLER, treasury: TREASURY },
    )
    expect(r.sellerRaw).toBe(0n)
  })

  it('returns zeros and empty memo when the tx errored', () => {
    const r = parseSettlement(tx({ err: { foo: 1 }, post: [bal(SELLER, 950_000)] }), { mint: MINT, seller: SELLER, treasury: TREASURY })
    expect(r).toEqual({ sellerRaw: 0n, treasuryRaw: 0n, memo: '' })
  })

  it('never throws on garbage input', () => {
    expect(parseSettlement(null, { mint: MINT, seller: SELLER, treasury: TREASURY })).toEqual({ sellerRaw: 0n, treasuryRaw: 0n, memo: '' })
  })
})
