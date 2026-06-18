// Active identity = verified wallet pubkey if present, else the anonymous token.
const WALLET_KEY = 'scc.wallet'

export interface WalletSession {
  pubkey: string
  sessionId: string
  connectedAt: number
}

export function activeIdentity(anonToken: string, wallet: WalletSession | null): string {
  return wallet?.pubkey ?? anonToken
}

export function loadWalletSession(ls: Storage): WalletSession | null {
  try {
    const raw = ls.getItem(WALLET_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (v && typeof v.pubkey === 'string' && typeof v.sessionId === 'string') return v
    return null
  } catch {
    return null
  }
}

export function saveWalletSession(ls: Storage, w: WalletSession | null): void {
  try {
    if (w) ls.setItem(WALLET_KEY, JSON.stringify(w))
    else ls.removeItem(WALLET_KEY)
  } catch {
    /* storage blocked */
  }
}
