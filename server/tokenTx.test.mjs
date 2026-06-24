// server/tokenTx.test.mjs
import { describe, expect, it } from 'vitest'
import { Keypair, Transaction } from '@solana/web3.js'
import { buildTokenPaymentTx } from './tokenTx.mjs'

const fakeConn = {
  getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }),
}

describe('buildTokenPaymentTx', () => {
  it('builds an unsigned tx with ATA-create, two transfers, and a memo', async () => {
    const buyer = Keypair.generate().publicKey.toBase58()
    const seller = Keypair.generate().publicKey.toBase58()
    const treasury = Keypair.generate().publicKey.toBase58()
    const mint = Keypair.generate().publicKey.toBase58()

    const b64 = await buildTokenPaymentTx(fakeConn, {
      buyer, seller, treasury, mint, decimals: 6,
      sellerRaw: 950_000n, feeRaw: 50_000n, nonce: 'nonce-xyz',
    })
    const tx = Transaction.from(Buffer.from(b64, 'base64'))
    // 2 ATA-create + 2 transferChecked + 1 memo = 5 instructions
    expect(tx.instructions.length).toBe(5)
    expect(tx.feePayer.toBase58()).toBe(buyer)
    expect(tx.recentBlockhash).toBe('11111111111111111111111111111111')
    // memo program instruction carries the nonce bytes
    const memoIx = tx.instructions.find((i) => i.data && Buffer.from(i.data).toString('utf8') === 'nonce-xyz')
    expect(memoIx).toBeTruthy()
  })
})
