// server/tokenTx.mjs
// Builds the UNSIGNED token-payment transaction the buyer's wallet will sign + submit.
// Helius stays server-side; the client only ever receives this serialized unsigned tx.
import { PublicKey, Transaction } from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { createMemoInstruction } from '@solana/spl-memo'

/** Builds the unsigned payment tx. `tokenProgram` (base58) selects the owning token program so
 *  Token-2022 mints derive the right ATAs / target the right program; defaults to the classic
 *  SPL Token program. @returns base64 of the unsigned transaction (fee payer = buyer). */
export async function buildTokenPaymentTx(connection, { buyer, seller, treasury, mint, decimals, sellerRaw, feeRaw, nonce, tokenProgram }) {
  const programId = tokenProgram ? new PublicKey(tokenProgram) : TOKEN_PROGRAM_ID
  const buyerPk = new PublicKey(buyer)
  const sellerPk = new PublicKey(seller)
  const treasuryPk = new PublicKey(treasury)
  const mintPk = new PublicKey(mint)

  const buyerAta = getAssociatedTokenAddressSync(mintPk, buyerPk, false, programId)
  const sellerAta = getAssociatedTokenAddressSync(mintPk, sellerPk, false, programId)
  const treasuryAta = getAssociatedTokenAddressSync(mintPk, treasuryPk, false, programId)

  const tx = new Transaction()
  // Idempotent: no-op if the recipient ATA already exists; buyer pays rent only when it must create.
  tx.add(createAssociatedTokenAccountIdempotentInstruction(buyerPk, sellerAta, sellerPk, mintPk, programId))
  tx.add(createAssociatedTokenAccountIdempotentInstruction(buyerPk, treasuryAta, treasuryPk, mintPk, programId))
  tx.add(createTransferCheckedInstruction(buyerAta, mintPk, sellerAta, buyerPk, BigInt(sellerRaw), decimals, [], programId))
  tx.add(createTransferCheckedInstruction(buyerAta, mintPk, treasuryAta, buyerPk, BigInt(feeRaw), decimals, [], programId))
  tx.add(createMemoInstruction(nonce, [buyerPk]))

  const { blockhash } = await connection.getLatestBlockhash('finalized')
  tx.recentBlockhash = blockhash
  tx.feePayer = buyerPk
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
}
