import '@fontsource/share-tech-mono/400.css'
import '@fontsource/orbitron/700.css'
import { rankForCredits } from './sim/ranks'
import { NetClient } from './net/client'
import { activeIdentity, loadWalletSession, saveWalletSession, type WalletSession } from './net/identity'
import { connectWallet, signMessage, hasWallet, WalletError, NO_WALLET } from './net/wallet'

const CAPTURE_OG = new URLSearchParams(location.search).get('capture') === 'og'

const nicknameEl = document.getElementById('nickname') as HTMLInputElement
const launchEl = document.getElementById('launch') as HTMLButtonElement
const launchLoadingEl = document.getElementById('launch-loading')!
const launchLoadingTextEl = document.getElementById('launch-loading-text')!
const statOnlineEl = document.getElementById('stat-online')!
const statRegisteredEl = document.getElementById('stat-registered')!
const lbListLandingEl = document.getElementById('lb-list-landing')!
const myCodeEl = document.getElementById('my-code')!
const copyCodeBtn = document.getElementById('copy-code')!
const restoreCodeEl = document.getElementById('restore-code') as HTMLInputElement
const restoreBtn = document.getElementById('restore-btn')!
const pcStatusEl = document.getElementById('pc-status')!
const connectWalletBtn = document.getElementById('connect-wallet') as HTMLButtonElement
const disconnectWalletBtn = document.getElementById('disconnect-wallet') as HTMLButtonElement
const walletStatusEl = document.getElementById('wallet-status')!

const WS_URL = import.meta.env.VITE_WS_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8080`
const STATS_URL = WS_URL.replace(/^ws/, 'http') + '/stats'
const LEADERBOARD_URL = WS_URL.replace(/^ws/, 'http') + '/leaderboard'

nicknameEl.value = localStorage.getItem('callsign') ?? ''

function loadToken(): string {
  let t = localStorage.getItem('scc.token')
  if (!t) {
    t = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    localStorage.setItem('scc.token', t)
  }
  return t
}

const playerToken = loadToken()
let walletSession: WalletSession | null = loadWalletSession(localStorage)
let pendingPubkey: string | null = null
let netConnected = false
let launchStarted = false

myCodeEl.textContent = playerToken

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

function renderLeaderboard(rows: Array<{ name: string; earned: number }>): void {
  if (!rows.length) {
    lbListLandingEl.innerHTML = '<li class="lb-empty">no pilots yet - be the first</li>'
    return
  }
  lbListLandingEl.innerHTML = rows.map((r, i) => {
    const cr = Number(r.earned) || 0
    return `<li><span class="rank">${i + 1}</span><span class="nm">${escapeHtml(String(r.name))}</span>`
      + `<span class="cr">[${rankForCredits(cr).name}] ${cr.toLocaleString()} cr</span></li>`
  }).join('')
}

function refreshLandingStats(): void {
  fetch(STATS_URL)
    .then((r) => r.json())
    .then((d) => {
      statOnlineEl.textContent = String(d.online ?? '-')
      statRegisteredEl.textContent = String(d.registered ?? '-')
    })
    .catch(() => { /* relay offline - leave placeholders */ })

  fetch(LEADERBOARD_URL)
    .then((r) => r.json())
    .then((rows) => renderLeaderboard(Array.isArray(rows) ? rows : []))
    .catch(() => { /* relay offline */ })
}

refreshLandingStats()
const statsTimer = setInterval(refreshLandingStats, 6000)

copyCodeBtn.addEventListener('click', () => {
  navigator.clipboard?.writeText(playerToken).then(
    () => { pcStatusEl.textContent = 'Copied - keep it safe to restore on another device.' },
    () => { pcStatusEl.textContent = 'Copy failed - select the code and copy manually.' },
  )
})

restoreBtn.addEventListener('click', () => {
  const code = restoreCodeEl.value.trim()
  if (!code) { pcStatusEl.textContent = 'Paste a Pilot Code first.'; return }
  if (code === playerToken) { pcStatusEl.textContent = "That's already your current code."; return }
  localStorage.setItem('scc.token', code)
  pcStatusEl.textContent = 'Loaded - reconnecting...'
  setTimeout(() => location.reload(), 400)
})

function setWalletStatus(text: string): void {
  walletStatusEl.textContent = text
}

function lockWalletButton(pubkey: string): void {
  connectWalletBtn.disabled = true
  connectWalletBtn.textContent = `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}`
  disconnectWalletBtn.hidden = false
}

if (walletSession) {
  lockWalletButton(walletSession.pubkey)
  setWalletStatus('Wallet linked.')
}

const net = new NetClient(nicknameEl.value || 'PILOT', activeIdentity(playerToken, walletSession), {
  onChallenge(message) {
    signMessage(message).then((sig) => {
      if (pendingPubkey) net.submitAuth(pendingPubkey, sig)
    }).catch(() => { setWalletStatus('Signature cancelled.'); pendingPubkey = null })
  },
  onAuthOk(pubkey, sessionId) {
    walletSession = { pubkey, sessionId, connectedAt: Date.now() }
    saveWalletSession(localStorage, walletSession)
    pendingPubkey = null
    lockWalletButton(pubkey)
    setWalletStatus(`Connected ${pubkey.slice(0, 4)}...${pubkey.slice(-4)} - press LAUNCH to play`)
  },
  onAuthError() {
    pendingPubkey = null
    setWalletStatus('Wallet not linked - already has a pilot, or signing failed.')
  },
  onStatus(connected) {
    netConnected = connected
    if (connected) setTimeout(refreshLandingStats, 500)
  },
  onPeerJoin() {},
  onPeerState() {},
  onPeerLeave() {},
  onProgress() {},
  onChat() {},
  onKicked() {
    setWalletStatus('This Pilot Code is active elsewhere. Refresh to play here.')
  },
})
net.setSession(walletSession?.sessionId ?? null)
net.connect()

disconnectWalletBtn.addEventListener('click', () => {
  saveWalletSession(localStorage, null)
  setWalletStatus('Disconnecting...')
  setTimeout(() => location.reload(), 200)
})

connectWalletBtn.addEventListener('click', () => {
  if (!hasWallet()) { setWalletStatus('No Solana wallet found - install Phantom.'); return }
  if (!netConnected) { setWalletStatus('Not connected to server - try again in a moment.'); return }
  setWalletStatus('Connecting...')
  connectWallet().then((pubkey) => {
    pendingPubkey = pubkey
    setWalletStatus('Approve the signature in your wallet...')
    net.requestChallenge(pubkey)
  }).catch((e) => {
    setWalletStatus(e instanceof WalletError && e.message === NO_WALLET
      ? 'No Solana wallet found - install Phantom.'
      : 'Connection cancelled.')
  })
})

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

function setLaunchStatus(text: string): void {
  launchLoadingTextEl.textContent = text
}

async function beginLaunch(): Promise<void> {
  if (launchStarted) return
  launchStarted = true
  const callsign = nicknameEl.value.trim() || 'PILOT'
  localStorage.setItem('callsign', callsign)
  launchEl.disabled = true
  launchEl.textContent = 'LAUNCHING'
  launchLoadingEl.hidden = false
  setLaunchStatus('Preparing your sector...')
  clearInterval(statsTimer)
  net.disconnect()

  try {
    await nextPaint()
    setLaunchStatus('Loading flight systems...')
    await nextPaint()
    const game = await import('./main')
    setLaunchStatus('Entering sector...')
    await nextPaint()
    game.launchGame(callsign)
  } catch (e) {
    launchStarted = false
    launchEl.disabled = false
    launchEl.textContent = 'LAUNCH'
    setLaunchStatus('Launch failed - refresh and try again.')
    console.error(e)
  }
}

launchEl.addEventListener('click', () => { void beginLaunch() })
nicknameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') void beginLaunch() })

if (CAPTURE_OG) {
  nicknameEl.value = 'test'
  requestAnimationFrame(() => { void beginLaunch() })
}
