import '@fontsource/share-tech-mono/400.css'
import '@fontsource/orbitron/700.css'
import { rankForCredits } from './sim/ranks'
import { NetClient } from './net/client'
import { activeIdentity, loadWalletSession, saveWalletSession, type WalletSession } from './net/identity'
import { connectWallet, signMessage, hasWallet, isMobileBrowser, phantomBrowseUrl, WalletError, NO_WALLET } from './net/wallet'
import { LandingMusic } from './audio/landingMusic'
import { holderCaptureLaunchConfig } from './ui/landingCapture'
import {
  canPageLeaderboard,
  defaultLandingLeaderboardMode,
  leaderboardEndpointUrl,
  leaderboardMetricText,
  leaderboardRangeText,
  leaderboardUrl,
  nextLeaderboardOffset,
  normalizeLeaderboardPage,
  pvpSeasonCopy,
  type LeaderboardMode,
  type LeaderboardRow,
} from './ui/leaderboard'

const CAPTURE_LAUNCH = holderCaptureLaunchConfig(new URLSearchParams(location.search))
const MOBILE_COMPANION = document.documentElement.classList.contains('is-mobile')

const nicknameEl = document.getElementById('nickname') as HTMLInputElement
const launchEl = document.getElementById('launch') as HTMLButtonElement
const launchLoadingEl = document.getElementById('launch-loading')!
const launchLoadingTextEl = document.getElementById('launch-loading-text')!
const statOnlineEl = document.getElementById('stat-online')!
const statRegisteredEl = document.getElementById('stat-registered')!
const lbListLandingEl = document.getElementById('lb-list-landing')!
const lbTitleLandingEl = document.getElementById('lb-title-landing')!
const lbModeCareerLandingEl = document.getElementById('lb-mode-career-landing') as HTMLButtonElement
const lbModePvpLandingEl = document.getElementById('lb-mode-pvp-landing') as HTMLButtonElement
const lbModeRaceLandingEl = document.getElementById('lb-mode-race-landing') as HTMLButtonElement
const lbModeBlackholeLandingEl = document.getElementById('lb-mode-blackhole-landing') as HTMLButtonElement
const lbSeasonLandingEl = document.getElementById('lb-season-landing')!
const lbPrevLandingEl = document.getElementById('lb-prev-landing') as HTMLButtonElement
const lbNextLandingEl = document.getElementById('lb-next-landing') as HTMLButtonElement
const lbPageLandingEl = document.getElementById('lb-page-landing')!
const myCodeEl = document.getElementById('my-code')!
const copyCodeBtn = document.getElementById('copy-code')!
const restoreCodeEl = document.getElementById('restore-code') as HTMLInputElement
const restoreBtn = document.getElementById('restore-btn')!
const pcStatusEl = document.getElementById('pc-status')!
const connectWalletBtn = document.getElementById('connect-wallet') as HTMLButtonElement
const disconnectWalletBtn = document.getElementById('disconnect-wallet') as HTMLButtonElement
const walletStatusEl = document.getElementById('wallet-status')!
const landingMusicToggleEl = document.getElementById('landing-music-toggle') as HTMLButtonElement

const WS_URL = import.meta.env.VITE_WS_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8080`
const STATS_URL = WS_URL.replace(/^ws/, 'http') + '/stats'
const LEADERBOARD_URLS: Record<LeaderboardMode, string> = {
  career: leaderboardEndpointUrl(WS_URL, 'career'),
  pvp: leaderboardEndpointUrl(WS_URL, 'pvp'),
  race: leaderboardEndpointUrl(WS_URL, 'race'),
  blackhole: leaderboardEndpointUrl(WS_URL, 'blackhole'),
}

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
let leaderboardOffset = 0
let leaderboardMode: LeaderboardMode = defaultLandingLeaderboardMode(MOBILE_COMPANION)
const landingMusic = new LandingMusic()
const LANDING_MUSIC_MUTED_KEY = 'scc.landingMusicMuted'
let landingMusicMuted = localStorage.getItem(LANDING_MUSIC_MUTED_KEY) === '1'
landingMusic.setMuted(landingMusicMuted, 0)

myCodeEl.textContent = playerToken

function renderLandingMusicToggle(): void {
  landingMusicToggleEl.textContent = landingMusicMuted ? 'Sound Off' : 'Sound On'
  landingMusicToggleEl.setAttribute('aria-pressed', String(!landingMusicMuted))
}

function saveLandingMusicPreference(): void {
  try { localStorage.setItem(LANDING_MUSIC_MUTED_KEY, landingMusicMuted ? '1' : '0') } catch { /* storage blocked */ }
}

function startLandingMusic(): void {
  if (landingMusicMuted) return
  landingMusic.start()
}

landingMusicToggleEl.addEventListener('click', () => {
  landingMusicMuted = !landingMusicMuted
  saveLandingMusicPreference()
  landingMusic.setMuted(landingMusicMuted)
  if (!landingMusicMuted) landingMusic.start()
  renderLandingMusicToggle()
})
renderLandingMusicToggle()

window.addEventListener('pointerdown', startLandingMusic, { once: true })
window.addEventListener('keydown', startLandingMusic, { once: true })

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

function leaderboardMetric(row: LeaderboardRow): string {
  if (leaderboardMode === 'pvp') return leaderboardMetricText(row, 'pvp')
  if (leaderboardMode === 'race') return leaderboardMetricText(row, 'race')
  if (leaderboardMode === 'blackhole') return leaderboardMetricText(row, 'blackhole')
  const cr = Number(row.earned) || 0
  return `[${rankForCredits(cr).name}] ${leaderboardMetricText(row, 'career')}`
}

function renderPvpSeasonPanel(): void {
  lbSeasonLandingEl.hidden = leaderboardMode !== 'pvp'
  if (leaderboardMode !== 'pvp') return
  const season = pvpSeasonCopy()
  lbSeasonLandingEl.innerHTML = `<b>${escapeHtml(season.title)}</b><span>${escapeHtml(season.ends)}</span><span>${escapeHtml(season.prizes)}</span><span>${escapeHtml(season.rules)}</span>`
}

function syncLeaderboardModeButtons(): void {
  lbTitleLandingEl.textContent = leaderboardMode === 'pvp'
    ? 'RANKED PVP'
    : leaderboardMode === 'race'
      ? 'RANKED RACE'
      : leaderboardMode === 'blackhole'
        ? 'CLOSEST APPROACH'
        : 'TOP PILOTS'
  renderPvpSeasonPanel()
  lbModeCareerLandingEl.classList.toggle('active', leaderboardMode === 'career')
  lbModePvpLandingEl.classList.toggle('active', leaderboardMode === 'pvp')
  lbModeRaceLandingEl.classList.toggle('active', leaderboardMode === 'race')
  lbModeBlackholeLandingEl.classList.toggle('active', leaderboardMode === 'blackhole')
  lbModeCareerLandingEl.setAttribute('aria-pressed', String(leaderboardMode === 'career'))
  lbModePvpLandingEl.setAttribute('aria-pressed', String(leaderboardMode === 'pvp'))
  lbModeRaceLandingEl.setAttribute('aria-pressed', String(leaderboardMode === 'race'))
  lbModeBlackholeLandingEl.setAttribute('aria-pressed', String(leaderboardMode === 'blackhole'))
}

function setLeaderboardMode(mode: LeaderboardMode): void {
  if (leaderboardMode === mode) return
  leaderboardMode = mode
  leaderboardOffset = 0
  syncLeaderboardModeButtons()
  fetchLeaderboard()
}

function renderLeaderboard(rows: LeaderboardRow[], offset: number): void {
  if (!rows.length) {
    lbListLandingEl.innerHTML = leaderboardMode === 'pvp'
      ? '<li class="lb-empty">no ranked kills yet</li>'
      : leaderboardMode === 'race'
        ? '<li class="lb-empty">no race times yet</li>'
        : leaderboardMode === 'blackhole'
          ? '<li class="lb-empty">no survived approaches yet</li>'
          : '<li class="lb-empty">no pilots yet - be the first</li>'
    return
  }
  lbListLandingEl.innerHTML = rows.map((r, i) => {
    return `<li><span class="rank">${r.rank ?? offset + i + 1}</span><span class="nm">${escapeHtml(String(r.name))}</span>`
      + `<span class="cr">${escapeHtml(leaderboardMetric(r))}</span></li>`
  }).join('')
}

function fetchLeaderboard(): void {
  fetch(leaderboardUrl(LEADERBOARD_URLS[leaderboardMode], leaderboardOffset))
    .then((r) => r.json())
    .then((payload) => {
      const page = normalizeLeaderboardPage(payload, leaderboardOffset)
      renderLeaderboard(page.rows, page.offset)
      lbPageLandingEl.textContent = leaderboardRangeText(page)
      const canPage = canPageLeaderboard(page)
      lbPrevLandingEl.disabled = !canPage.prev
      lbNextLandingEl.disabled = !canPage.next
    })
    .catch(() => { /* relay offline */ })
}

function changeLeaderboardPage(dir: -1 | 1): void {
  leaderboardOffset = nextLeaderboardOffset(leaderboardOffset, dir)
  fetchLeaderboard()
}

lbPrevLandingEl.addEventListener('click', () => changeLeaderboardPage(-1))
lbNextLandingEl.addEventListener('click', () => changeLeaderboardPage(1))
lbModeCareerLandingEl.addEventListener('click', () => setLeaderboardMode('career'))
lbModePvpLandingEl.addEventListener('click', () => setLeaderboardMode('pvp'))
lbModeRaceLandingEl.addEventListener('click', () => setLeaderboardMode('race'))
lbModeBlackholeLandingEl.addEventListener('click', () => setLeaderboardMode('blackhole'))
syncLeaderboardModeButtons()

function refreshLandingStats(): void {
  fetch(STATS_URL)
    .then((r) => r.json())
    .then((d) => {
      statOnlineEl.textContent = String(d.online ?? '-')
      statRegisteredEl.textContent = String(d.registered ?? '-')
    })
    .catch(() => { /* relay offline - leave placeholders */ })

  fetchLeaderboard()
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

function applyLockedCallsign(name: string): void {
  if (!name || name.toLowerCase() === 'pilot') return
  nicknameEl.value = name
  localStorage.setItem('callsign', name)
  nicknameEl.readOnly = true
  nicknameEl.title = 'Callsign locked to your wallet'
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
  onAuthOk(pubkey, sessionId, name) {
    walletSession = { pubkey, sessionId, connectedAt: Date.now() }
    saveWalletSession(localStorage, walletSession)
    pendingPubkey = null
    lockWalletButton(pubkey)
    setWalletStatus(`Connected ${pubkey.slice(0, 4)}...${pubkey.slice(-4)} - press LAUNCH to play`)
    if (name) applyLockedCallsign(name)
  },
  onCallsign(name) {
    applyLockedCallsign(name)
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
  if (!hasWallet()) {
    if (isMobileBrowser()) { setWalletStatus('Opening in Phantom — tap Connect there…'); location.href = phantomBrowseUrl(); return }
    setWalletStatus('No Solana wallet found - install the Phantom extension.'); return
  }
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
  landingMusic.start()
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
    landingMusic.stop()
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

if (CAPTURE_LAUNCH.autoLaunch) {
  nicknameEl.value = CAPTURE_LAUNCH.callsign ?? 'PILOT'
  requestAnimationFrame(() => { void beginLaunch() })
}
