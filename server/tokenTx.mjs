// server/tokenTx.mjs
// Builds the UNSIGNED token-payment transaction the buyer's wallet will sign + submit.
// Helius stays server-side; the client only ever receives this serialized unsigned tx.
import { PublicKey, Transaction } from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { createMemoInstruction } from '@solana/spl-memo'

/** @returns base64 of the unsigned transaction (fee payer = buyer, recent blockhash set). */
export async function buildTokenPaymentTx(connection, { buyer, seller, treasury, mint, decimals, sellerRaw, feeRaw, nonce }) {
  const buyerPk = new PublicKey(buyer)
  const sellerPk = new PublicKey(seller)
  const treasuryPk = new PublicKey(treasury)
  const mintPk = new PublicKey(mint)

  const buyerAta = getAssociatedTokenAddressSync(mintPk, buyerPk)
  const sellerAta = getAssociatedTokenAddressSync(mintPk, sellerPk)
  const treasuryAta = getAssociatedTokenAddressSync(mintPk, treasuryPk)

  const tx = new Transaction()
  // Idempotent: no-op if the recipient ATA already exists; buyer pays rent only when it must create.
  tx.add(createAssociatedTokenAccountIdempotentInstruction(buyerPk, sellerAta, sellerPk, mintPk))
  tx.add(createAssociatedTokenAccountIdempotentInstruction(buyerPk, treasuryAta, treasuryPk, mintPk))
  tx.add(createTransferCheckedInstruction(buyerAta, mintPk, sellerAta, buyerPk, BigInt(sellerRaw), decimals))
  tx.add(createTransferCheckedInstruction(buyerAta, mintPk, treasuryAta, buyerPk, BigInt(feeRaw), decimals))
  tx.add(createMemoInstruction(nonce, [buyerPk]))

  const { blockhash } = await connection.getLatestBlockhash('finalized')
  tx.recentBlockhash = blockhash
  tx.feePayer = buyerPk
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
}
