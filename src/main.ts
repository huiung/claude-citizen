import { Buffer } from 'buffer'
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer

import '@fontsource/share-tech-mono/400.css' // HUD / body — self-hosted, OS-consistent
import '@fontsource/orbitron/700.css' // title display — sci-fi
import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { createShipState, resolveSphereCollision, stepShip, TUNING, type ControlInput } from './sim/physics'
import {
  addCraftEngineGlowRig,
  buildCraft,
  collectCraftEngineGlows,
  loadCapitalCarrierModel,
  loadCapitalModel,
  loadSeasonHubModel,
  loadCraftModelForType,
  loadPirateModel,
  type CraftEngineGlow,
} from './render/shipyard'
import { SHIP_STATS, type ShipType } from './sim/shipTypes'
import { nextRank, rankForCredits, rankProgress } from './sim/ranks'
import { shouldRenderWorldFrame, shouldRunBackgroundWorldWork } from './sim/renderCadence'
import {
  buildAsteroids, buildColony, buildLights, buildMineableAsteroid, buildPlanet,
  buildCapitalShip, buildDustField, buildLootCrate, buildNebula, buildSolarPlanet, buildStarfield, buildStation,
  buildMuchLaunchTower, buildRareFrogShrine, buildSun, buildWarpField, COLONY_POS, prewarmHighPlanetTextures, REFINERY_POS, SPAWN_PLANET, updateDustField, updateWarpField,
} from './render/world'
import { PLANETS, planetDockPosition, SUN_COLOR, SUN_POSITION, SUN_RADIUS, type SurfaceKind } from './sim/solarSystem'
import { NetClient, type MarketActionResult, type MarketIntentResult, type MarketListing, type PeerState, type PlayerProgress } from './net/client'
import { dockableTarget, type DockTarget } from './sim/docking'
import { cargoUsed, gainCredits, loadEconomy, OUTPOSTS, saveEconomy } from './sim/economy'
import { createAsteroidField, mineStep } from './sim/mining'
import { loadCraftingState, normalizeCraftingState, saveCraftingState, equipCosmetic, unequipCosmetic } from './sim/crafting'
import { createShipCosmetics, type ShipCosmetics } from './render/craftCosmetics'
import { equippedStyles, encodeEquipped, decodeCosmetics } from './sim/cosmetics'
import { stepMover } from '../bot/mover.mjs'
import { buildActivity, stepActivity } from '../bot/activities.mjs'
import { BOT_WORLD } from '../bot/landmarks.mjs'
import { think } from '../bot/brain.mjs'
import { buildBrainContext } from '../bot/brainContext.mjs'
import { createMarket, step as marketStep } from './sim/market'
import { generateContracts } from './sim/contracts'
import { boostMultiplier, cargoCapacity, loadUpgrades, miningYield, saveUpgrades, topSpeed } from './sim/upgrades'
import { type Celestial, isSolidCelestial, queryCelestials } from './sim/galaxy'
import { generatePlanetTextures, samplePlanetSurface, type PlanetTextureKind } from './render/planetTextures'
import { makeAsteroidMaterial } from './render/asteroidTextures'
import { engineGlowStyle, type EngineGlowStyle } from './render/engineGlow'
import { createSeasonHubLifeRig, updateSeasonHubLifeRig } from './render/seasonHub'
import { buildBlackHole } from './render/blackHole'
import { cancelTravel, catchUpQuantum, createQuantum, cycleQuantumDestinationIndex, QUANTUM_TUNING, startTravel, stepQuantum } from './sim/quantum'
import {
  createTimeTrial,
  formatTrialTime,
  timeTrialEventBannerText,
  timeTrialStatusText,
  updateTimeTrial,
  type TimeTrialGate,
} from './sim/timeTrial'
import {
  applyDamage, canFire, createHealth, createWeapon, fire as fireWeapon, type HitTarget, hullFraction,
  isDead, isEngageable, type Projectile, PROJECTILE_DAMAGE, PROJECTILE_SPEED, repairHull, resolveHits, spawnProjectile,
  stepProjectiles, stepWeapon,
} from './sim/combat'
import {
  allowsPveHostiles,
  CITIZEN_SEASON_HUB_DESTINATION,
  isInRankedPvpZone,
  isInPvpZone,
  PVP_ARENA_CLEAR_RADIUS,
  PVP_ARENA_DESTINATIONS,
  PVP_PRACTICE_ZONE_CENTER,
  PVP_PRACTICE_ZONE_RADIUS,
  PVP_PEER_HIT_RADIUS,
  PVP_RANKED_MIN_TOKEN_BALANCE,
  PVP_RANKED_ZONE_CENTER,
  PVP_RANKED_ZONE_RADIUS,
  PVP_ZONE_CENTER,
  TRAINING_RANGE_DESTINATION,
  isInTrainingRange,
  pvpArenaApproachPoint,
  pvpCombatActive,
  pvpWeaponForShip,
  pvpZoneProximity,
  pvpZoneAt,
  rankedPvpAccess,
  shouldClearPveHostiles,
  trainingDronesActive,
} from './sim/pvp'
import { type Pirate, type PirateTier, PIRATE_REWARD, PIRATE_TIER_HULL_MUL, PIRATE_TIER_REWARD, shouldDespawnPirate, spawnPirate, spawnPositionAround, stepPirate } from './sim/pirates'
import { addXp, loadPilot, MAX_LEVEL, savePilot, unlocksForLevel, xpForKill, xpForLevel } from './sim/pilotLevel'
import { type CampaignAdvance, currentCampaignStep, loadCampaign, recordCampaignEvent, saveCampaign, SECTOR1_CAMPAIGN } from './sim/campaign'
import {
  createTrainingDrones,
  stepTrainingDrone,
  TRAINING_DRONE_COUNT,
  type TrainingDrone,
} from './sim/trainingDrones'
import { BLACK_HOLE_APPROACH_DESTINATION, BLACK_HOLE_CENTER, distanceToCenter, gravityAccel, HORIZON_RADIUS, INFLUENCE_RADIUS, isPastHorizon, tidalDamageRate, TIDAL_RADIUS, withinInfluence } from './sim/blackHole'
import { createBlackHoleRun, enterRun, sampleRun, exitRunAlive, dieRun } from './sim/blackHoleRun'
import { type DailyState, type Objective, type ObjectiveKind, OBJECTIVE_REWARD, SET_BONUS, STREAK_REWARD_CAP, dailyObjectives, dayKey, emptyDaily, rollStreak } from './sim/daily'
import { nextJourneyGoal } from './sim/journey'
import { GameAudio, type RegionalAmbienceKind } from './audio/sound'
import { StationMenu } from './ui/stationMenu'
import { InventoryPanel } from './ui/inventory'
import { SolarSystemMap, type SolarMapDestinationResult, type SolarMapNavigationTarget } from './ui/solarSystemMap'
import { landmarkTargets } from './ui/solarMapLandmarks'
import { holderChatNameClass, holderNameplateClass, holderNameplateText } from './ui/nameplate'
import {
  canPageLeaderboard,
  defaultLandingLeaderboardMode,
  leaderboardEndpointUrl,
  leaderboardMetricText,
  leaderboardPilotDisplayText,
  leaderboardRangeText,
  leaderboardUrl,
  nextLeaderboardOffset,
  normalizeLeaderboardPage,
  pvpSeasonCopy,
  type LeaderboardMode,
  type LeaderboardPage,
  type LeaderboardRow,
} from './ui/leaderboard'
import { flightPlanById, flightPlansForDevice, type FlightPlanId, type FlightPlanSpawnMode } from './ui/flightPlan'
import {
  loadHolderShipVisual,
  resolveHolderShipVisual,
  saveHolderShipVisual,
  type HolderShipVisualId,
} from './ui/holderShipVisual'
import { hudShipIdentity } from './ui/shipIdentity'
import { readLocalDevHolderOverride } from './ui/devHolder'
import {
  defaultOrbitDistance,
  defaultRearDistance,
  nextCameraMode,
  orbitCameraOffset,
  queueOrbitZoomDelta,
  rearCameraOffset,
  zoomOrbitDistance,
  zoomRearDistance,
  type CameraMode,
} from './ui/cameraView'
import {
  DEFAULT_AMBIENT_VOLUME,
  DEFAULT_MOUSE_SENSITIVITY,
  applyMouseSensitivity,
  clampAmbientVolume,
  clampMouseSensitivity,
  formatAmbientVolume,
  formatMouseSensitivity,
  loadGameSettings,
  saveGameSettings,
} from './ui/settings'
import { shouldShowCombatHud } from './ui/combatHudVisibility'
import { mobileFlightInput, type MobileFlightState } from './ui/mobileFlight'
import {
  combatFeedbackAlpha,
  createCombatFeedbackState,
  registerHitMarker,
  registerKillBanner,
} from './ui/combatFeedback'
import { activeIdentity, loadWalletSession, saveWalletSession } from './net/identity'
import { connectWallet, signMessage, signAndSendTransaction, hasWallet, isMobileBrowser, phantomBrowseUrl, WalletError, NO_WALLET } from './net/wallet'
import { inject as injectAnalytics } from '@vercel/analytics'

injectAnalytics() // Vercel Web Analytics (no-op off Vercel / in dev)

const INTERP_DELAY_MS = 120
const URL_PARAMS = new URLSearchParams(location.search)
const CAPTURE_OG = URL_PARAMS.get('capture') === 'og'
const SHOWCASE_HOLDER = URL_PARAMS.get('showcase') === 'holder'
const SHOWCASE_TIME_TRIAL = URL_PARAMS.get('showcase') === 'time-trial'
const MOBILE_COMPANION = document.documentElement.classList.contains('is-mobile')
const BOT = URL_PARAMS.get('bot') === '1' // browser autopilot: this tab IS the CLAUDE pilot
const BOT_COSMETICS = 'comet-wake-kit:legendary,nebula-hull-kit:legendary,void-runner-kit:legendary'

// --- DOM
const appEl = document.getElementById('app')!
const overlayEl = document.getElementById('overlay')!
const nicknameEl = document.getElementById('nickname') as HTMLInputElement
const launchEl = document.getElementById('launch') as HTMLButtonElement
const buyCitizenEl = document.getElementById('buy-citizen') as HTMLAnchorElement
const browseBtnEl = document.getElementById('browse-btn')!
const browseBannerEl = document.getElementById('browse-banner')!
const browseBackEl = document.getElementById('browse-back')!
const gateMsgEl = document.getElementById('gate-msg')!
const hudEl = document.getElementById('hud')!
const statusEl = document.getElementById('status')!
const helpEl = document.getElementById('help')!
const crosshairEl = document.getElementById('crosshair')!
const mobileControlsEl = document.getElementById('mobile-controls')!
const mobileStickEl = document.getElementById('mobile-stick')!
const mobileStickKnobEl = document.getElementById('mobile-stick-knob')!
const mobileThrustEl = document.getElementById('mobile-thrust') as HTMLButtonElement
const mobileBoostEl = document.getElementById('mobile-boost') as HTMLButtonElement
const mobileBrakeEl = document.getElementById('mobile-brake') as HTMLButtonElement
const mobileMineEl = document.getElementById('mobile-mine') as HTMLButtonElement
const mobileDockEl = document.getElementById('mobile-dock') as HTMLButtonElement
const mobileJumpEl = document.getElementById('mobile-jump') as HTMLButtonElement
const mobileNextEl = document.getElementById('mobile-next') as HTMLButtonElement
const mobileCameraEl = document.getElementById('mobile-camera') as HTMLButtonElement
const combatCanvas = document.getElementById('combat-overlay') as HTMLCanvasElement
const cctx = combatCanvas.getContext('2d')!
combatCanvas.width = innerWidth
combatCanvas.height = innerHeight
const speedEl = document.getElementById('speed')!
const assistEl = document.getElementById('assist')!
const boostEl = document.getElementById('boost')!
const netEl = document.getElementById('net')!
const onlineEl = document.getElementById('online')!
const walletEl = document.getElementById('wallet')!
const creditsEl = document.getElementById('credits')!
const cargoEl = document.getElementById('cargo')!
const rankNameEl = document.getElementById('rank-name')!
const rankBarEl = document.getElementById('rank-bar')!
const rankNextEl = document.getElementById('rank-next')!
const pilotLevelEl = document.getElementById('pilot-level')!
const pilotXpBarEl = document.getElementById('pilot-xp-bar')!
const pilotBonusEl = document.getElementById('pilot-bonus')!
const promotionEl = document.getElementById('promotion')!
const depthLabelEl = document.getElementById('depth-label')!
const depthBarEl = document.getElementById('depth-bar')!
const altLineEl = document.getElementById('alt-line')!
const altLabelEl = document.getElementById('alt-label')!
const atmoVeilEl = document.getElementById('atmo-veil')!
let lastRankIndex = -1 // -1 until first HUD update, so we don't announce a "promotion" on load
let promoTimer: ReturnType<typeof setTimeout> | undefined
function showPromotion(name: string): void {
  promotionEl.textContent = `⭐ PROMOTED — ${name}`
  promotionEl.hidden = false
  promotionEl.style.opacity = '1'
  clearTimeout(promoTimer)
  promoTimer = setTimeout(() => {
    promotionEl.style.opacity = '0'
    setTimeout(() => { promotionEl.hidden = true }, 500)
  }, 3200)
}
const dockPromptEl = document.getElementById('dock-prompt')!
const mineEl = document.getElementById('mine-prompt')!
const hullBarEl = document.getElementById('hull-bar')!
const shipClassEl = document.getElementById('ship-class')!
const shipVisualEl = document.getElementById('ship-visual')!
const enemiesEl = document.getElementById('enemies')!
const flashEl = document.getElementById('damage-flash')!
const timeTrialBannerEl = document.getElementById('time-trial-banner')!
const raceFinishGlowEl = document.getElementById('race-finish-glow')!
const quantumEl = document.getElementById('quantum')!
const navHintEl = document.getElementById('nav-hint')!
const objectiveEl = document.getElementById('objective')!
const flightPlanEl = document.getElementById('flight-plan')!
const flightPlanSkipEl = document.getElementById('flight-plan-skip') as HTMLButtonElement
const flightPlanButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-plan]'))
// Onboarding: show a "next objective" only to brand-new pilots. localStorage gate (this device
// hasn't onboarded) is the fast path; a returning token with saved progress also disables it.
let onboardingActive = !CAPTURE_OG && !BOT && !localStorage.getItem('scc.onboarded')
let sessionKicked = false // signed in elsewhere — freeze the objective HUD on the warning
let flightPlanObjective: string | null = null
let flightPlanObjectiveUntil = 0
// Onboarding progress is persisted so a refresh keeps your step (and graduating sticks),
// even without a relay connection.
let minedEver = localStorage.getItem('scc.ob.mined') === '1'
let dockedEver = localStorage.getItem('scc.ob.docked') === '1'
let raceFinishedEver = localStorage.getItem('scc.journey.race') === '1'
let blackHoleRecordedEver = localStorage.getItem('scc.journey.blackhole') === '1'
function markOnboard(key: string, set: (v: true) => void): void {
  set(true)
  try { localStorage.setItem(key, '1') } catch { /* storage blocked */ }
}
function finishOnboarding(): void {
  onboardingActive = false
  try { localStorage.setItem('scc.onboarded', '1') } catch { /* storage blocked */ }
}
/** Career journey: the center HUD always shows the next useful thing to try.
 *  Early steps teach the core loop; later steps point pilots toward daily, craft, race, and void goals. */
function currentObjective(): { text: string; kind: 'flight' | 'campaign' | 'journey' } | null {
  if (flightPlanObjective && performance.now() < flightPlanObjectiveUntil) return { text: flightPlanObjective, kind: 'flight' }
  const camp = currentCampaignStep(campaign)
  if (camp) return { text: `${camp.label} (${Math.floor(campaign.progress)}/${camp.target})`, kind: 'campaign' }
  const goal = nextJourneyGoal({
    minedEver,
    dockedEver,
    pirateDestroyed: !onboardingActive,
    upgradeCount: upgradeTotal(),
    earnedCredits: econ.earned,
    ownedShips: ownedShips.size,
    dailyClaimed: dailyState.claimed.length,
    craftedItems: crafting.items.length,
    raceFinished: raceFinishedEver,
    blackHoleRecorded: blackHoleRecordedEver,
  })
  if (!goal) return null
  return { text: goal.progress ? `${goal.label} - ${goal.progress}` : goal.label, kind: 'journey' }
}
const safeEl = document.getElementById('safe-zone')!
const pvpEl = document.getElementById('pvp-zone')!
const timeTrialEl = document.getElementById('time-trial')!
const chatInputEl = document.getElementById('chat-input') as HTMLInputElement
const chatLogEl = document.getElementById('chat-log')!
const statOnlineEl = document.getElementById('stat-online')!
const statRegisteredEl = document.getElementById('stat-registered')!
const minimapWrapEl = document.getElementById('minimap-wrap')!
const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement
const mctx = minimapCanvas.getContext('2d')!

nicknameEl.value = localStorage.getItem('callsign') ?? ''

// Anonymous progress token — no accounts. The server persists progress keyed by this.
function loadToken(): string {
  let t = localStorage.getItem('scc.token')
  if (!t) {
    t = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    localStorage.setItem('scc.token', t)
  }
  return t
}
const playerToken = loadToken()

// Wallet session — flying now REQUIRES a linked wallet holding ≥1 $CITIZEN; Browse is the only
// no-wallet path. When linked, the verified pubkey becomes the active identity; otherwise the
// anonymous token is used (for Browse/presence).
let walletSession = loadWalletSession(localStorage)
const identity = activeIdentity(playerToken, walletSession)

// Pilot Code = the anonymous token, surfaced so players can back it up / restore on another device.
const myCodeEl = document.getElementById('my-code')!
const copyCodeBtn = document.getElementById('copy-code')!
const restoreCodeEl = document.getElementById('restore-code') as HTMLInputElement
const restoreBtn = document.getElementById('restore-btn')!
const pcStatusEl = document.getElementById('pc-status')!
myCodeEl.textContent = playerToken
copyCodeBtn.addEventListener('click', () => {
  navigator.clipboard?.writeText(playerToken).then(
    () => { pcStatusEl.textContent = 'Copied — keep it safe to restore on another device.' },
    () => { pcStatusEl.textContent = 'Copy failed — select the code and copy manually.' },
  )
})
restoreBtn.addEventListener('click', () => {
  const code = restoreCodeEl.value.trim()
  if (!code) { pcStatusEl.textContent = 'Paste a Pilot Code first.'; return }
  if (code === playerToken) { pcStatusEl.textContent = "That's already your current code."; return }
  localStorage.setItem('scc.token', code)
  pcStatusEl.textContent = 'Loaded — reconnecting…'
  setTimeout(() => location.reload(), 400)
})

// Connect Wallet (SIWS) — link a Solana wallet to fly: a wallet holding ≥1 $CITIZEN is required
// to LAUNCH (Browse is the only no-wallet path).
// Declared here (before NetClient) so the auth callbacks in the events object can see them.
const connectWalletBtn = document.getElementById('connect-wallet') as HTMLButtonElement
const disconnectWalletBtn = document.getElementById('disconnect-wallet') as HTMLButtonElement
const walletStatusEl = document.getElementById('wallet-status')!
let pendingPubkey: string | null = null
let netConnected = false // kept in sync by NetEvents.onStatus — auth needs a live socket

function setWalletStatus(text: string): void { walletStatusEl.textContent = text }

/** Lock the button once a wallet is linked — the server rejects re-auth on a live connection. */
function lockWalletButton(pubkey: string): void {
  connectWalletBtn.disabled = true
  connectWalletBtn.textContent = `✓ ${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`
  disconnectWalletBtn.hidden = false
}

if (walletSession) { lockWalletButton(walletSession.pubkey); setWalletStatus('Wallet linked.') }

// Disconnect: clear the saved session and reload to anonymous — the server's single-identity
// guard means a fresh connection is the clean way to switch wallets.
disconnectWalletBtn.addEventListener('click', () => {
  saveWalletSession(localStorage, null)
  walletSession = null
  holderBalance = 0
  refreshLaunchGateUI() // immediate feedback before the reload re-renders the landing fresh
  setWalletStatus('Disconnecting…')
  setTimeout(() => location.reload(), 200)
})

// Reusable wallet-connect flow. Used by the (now hidden) Connect button AND by smart LAUNCH:
// LAUNCH absorbs Connect, so it calls this when no wallet is linked. Early-returns clear
// pendingLaunch so a failed start never leaves a stuck auto-launch armed.
function startWalletConnect(): void {
  if (!hasWallet()) {
    pendingLaunch = false
    if (isMobileBrowser()) { setWalletStatus('Opening in Phantom — tap Connect there…'); location.href = phantomBrowseUrl(); return }
    setWalletStatus('No Solana wallet found — install the Phantom extension.'); return
  }
  if (!netConnected) { pendingLaunch = false; setWalletStatus('Not connected to server — try again in a moment.'); return }
  setWalletStatus('Connecting…')
  connectWallet().then((pubkey) => {
    pendingPubkey = pubkey
    setWalletStatus('Approve the signature in your wallet…')
    net?.requestChallenge(pubkey)
  }).catch((e) => {
    pendingLaunch = false // cancelled/failed connect must never auto-launch later
    setWalletStatus(e instanceof WalletError && e.message === NO_WALLET
      ? 'No Solana wallet found — install Phantom.'
      : 'Connection cancelled.')
  })
}
connectWalletBtn.hidden = true // LAUNCH absorbs Connect; keep the element for lockWalletButton's ✓ label
connectWalletBtn.addEventListener('click', () => startWalletConnect())

// Holder gate (landing): LAUNCH unlocks only for a connected wallet holding ≥1 $CITIZEN.
// Non-holders can still BROWSE (wired in a later task). Drives launch.disabled + buy link + message.
// Own var (not selfHolderBalance, which is declared far below) so the initial render is TDZ-safe.
let holderBalance = 0
// Set when LAUNCH is pressed without a linked wallet: it kicks off connect and, once the holder
// balance arrives (onHolder), auto-enters the game if ≥1 $CITIZEN. Reset on any connect failure.
let pendingLaunch = false
function walletConnected(): boolean { return Boolean(walletSession) }
function refreshLaunchGateUI(): void {
  const connected = walletConnected()
  const canFly = connected && holderBalance >= 1
  // LAUNCH is always enabled now — it's the single smart entry CTA that routes by wallet state.
  buyCitizenEl.hidden = !(connected && holderBalance < 1)
  gateMsgEl.hidden = canFly
  gateMsgEl.textContent = !connected
    ? 'Press LAUNCH to connect your wallet and fly — or Browse.'
    : holderBalance < 1 ? '⚠ This wallet holds no $CITIZEN. You need ≥1 to fly — grab some, or Browse.' : ''
}
refreshLaunchGateUI() // LAUNCH always clickable; the gate message guides connect/buy

// Landing stats (online / registered pilots) from the relay's /stats endpoint.
const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${location.hostname}:8080`
const STATS_URL = WS_URL.replace(/^ws/, 'http') + '/stats'
const LEADERBOARD_URLS: Record<LeaderboardMode, string> = {
  career: leaderboardEndpointUrl(WS_URL, 'career'),
  pvp: leaderboardEndpointUrl(WS_URL, 'pvp'),
  race: leaderboardEndpointUrl(WS_URL, 'race'),
  blackhole: leaderboardEndpointUrl(WS_URL, 'blackhole'),
  pilotlevel: leaderboardEndpointUrl(WS_URL, 'pilotlevel'),
}
const lbListLandingEl = document.getElementById('lb-list-landing')!
const lbListHudEl = document.getElementById('lb-list-hud')!
const leaderboardPanelEl = document.getElementById('leaderboard-panel')!
const dailyPanelEl = document.getElementById('daily-panel')!
const dailyObjsEl = document.getElementById('daily-objs')!
const dailyStreakEl = document.getElementById('daily-streak')!
const dailyResetEl = document.getElementById('daily-reset')!
const dailyCloseEl = document.getElementById('daily-close')!
// Close the daily panel and hand flight input back (re-locks the pointer if nothing else is open).
function closeDailyPanel(): void {
  dailyPanelEl.hidden = true
  restoreFlightInputAfterPanel()
}
dailyCloseEl.addEventListener('click', closeDailyPanel)
const lbTitleLandingEl = document.getElementById('lb-title-landing')!
const lbTitleHudEl = document.getElementById('lb-title-hud')!
const lbModeCareerLandingEl = document.getElementById('lb-mode-career-landing') as HTMLButtonElement
const lbModePvpLandingEl = document.getElementById('lb-mode-pvp-landing') as HTMLButtonElement
const lbModeRaceLandingEl = document.getElementById('lb-mode-race-landing') as HTMLButtonElement
const lbModeCareerHudEl = document.getElementById('lb-mode-career-hud') as HTMLButtonElement
const lbModePvpHudEl = document.getElementById('lb-mode-pvp-hud') as HTMLButtonElement
const lbModeRaceHudEl = document.getElementById('lb-mode-race-hud') as HTMLButtonElement
const lbModeBlackholeLandingEl = document.getElementById('lb-mode-blackhole-landing') as HTMLButtonElement
const lbModeBlackholeHudEl = document.getElementById('lb-mode-blackhole-hud') as HTMLButtonElement
const lbModePilotlevelLandingEl = document.getElementById('lb-mode-pilotlevel-landing') as HTMLButtonElement
const lbModePilotlevelHudEl = document.getElementById('lb-mode-pilotlevel-hud') as HTMLButtonElement
const lbSeasonLandingEl = document.getElementById('lb-season-landing')!
const lbSeasonHudEl = document.getElementById('lb-season-hud')!
const lbPrevLandingEl = document.getElementById('lb-prev-landing') as HTMLButtonElement
const lbNextLandingEl = document.getElementById('lb-next-landing') as HTMLButtonElement
const lbPageLandingEl = document.getElementById('lb-page-landing')!
const lbPrevHudEl = document.getElementById('lb-prev-hud') as HTMLButtonElement
const lbNextHudEl = document.getElementById('lb-next-hud') as HTMLButtonElement
const lbPageHudEl = document.getElementById('lb-page-hud')!
const settingsPanelEl = document.getElementById('settings-panel')!
const settingsCloseEl = document.getElementById('settings-close') as HTMLButtonElement
const settingsResetEl = document.getElementById('settings-reset') as HTMLButtonElement
const mouseSensitivityEl = document.getElementById('mouse-sensitivity') as HTMLInputElement
const mouseSensitivityValueEl = document.getElementById('mouse-sensitivity-value')!
const ambientVolumeEl = document.getElementById('ambient-volume') as HTMLInputElement
const ambientVolumeValueEl = document.getElementById('ambient-volume-value')!
let statsTimer: ReturnType<typeof setInterval> | undefined
let landingLeaderboardOffset = 0
let hudLeaderboardOffset = 0
let landingLeaderboardMode: LeaderboardMode = defaultLandingLeaderboardMode(MOBILE_COMPANION)
let hudLeaderboardMode: LeaderboardMode = 'career'
let gameSettings = loadGameSettings(localStorage)

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}
function renderLeaderboardRows(listEl: HTMLElement, rows: LeaderboardRow[], offset: number): void {
  if (!rows.length) { listEl.innerHTML = '<li class="lb-empty">no pilots yet — be the first</li>'; return }
  listEl.innerHTML = rows.map((r, i) => {
    const cr = Number(r.earned) || 0
    return `<li><span class="rank">${r.rank ?? offset + i + 1}</span><span class="nm">${escapeHtml(String(r.name))}</span>`
      + `<span class="cr">[${rankForCredits(cr).name}] ${cr.toLocaleString()} cr</span></li>`
  }).join('')
}
function leaderboardMetric(row: LeaderboardRow, mode: LeaderboardMode): string {
  if (mode === 'pvp') return leaderboardMetricText(row, 'pvp')
  if (mode === 'race') return leaderboardMetricText(row, 'race')
  if (mode === 'blackhole') return leaderboardMetricText(row, 'blackhole')
  if (mode === 'pilotlevel') return leaderboardMetricText(row, 'pilotlevel')
  const cr = Number(row.earned) || 0
  return `[${rankForCredits(cr).name}] ${leaderboardMetricText(row, 'career')}`
}
function renderLeaderboardRowsForMode(listEl: HTMLElement, rows: LeaderboardRow[], offset: number, mode: LeaderboardMode): void {
  if (!rows.length) {
    listEl.innerHTML = mode === 'pvp'
      ? '<li class="lb-empty">no ranked kills yet</li>'
      : mode === 'race'
        ? '<li class="lb-empty">no race times yet</li>'
        : mode === 'blackhole'
          ? '<li class="lb-empty">no survived approaches yet</li>'
          : '<li class="lb-empty">no pilots yet - be the first</li>'
    return
  }
  listEl.innerHTML = rows.map((r, i) => {
    return `<li><span class="rank">${r.rank ?? offset + i + 1}</span><span class="nm">${escapeHtml(String(r.name))}</span>`
      + `<span class="cr">${escapeHtml(leaderboardMetric(r, mode))}</span></li>`
  }).join('')
}
function renderPvpSeasonPanel(el: HTMLElement, mode: LeaderboardMode): void {
  el.hidden = mode !== 'pvp'
  if (mode !== 'pvp') return
  const season = pvpSeasonCopy()
  el.innerHTML = `<b>${escapeHtml(season.title)}</b><span>${escapeHtml(season.ends)}</span><span>${escapeHtml(season.prizes)}</span><span>${escapeHtml(season.rules)}</span>`
}
function syncLeaderboardModeButtons(slot: 'landing' | 'hud'): void {
  const mode = slot === 'landing' ? landingLeaderboardMode : hudLeaderboardMode
  const title = slot === 'landing' ? lbTitleLandingEl : lbTitleHudEl
  const careerBtn = slot === 'landing' ? lbModeCareerLandingEl : lbModeCareerHudEl
  const pvpBtn = slot === 'landing' ? lbModePvpLandingEl : lbModePvpHudEl
  const raceBtn = slot === 'landing' ? lbModeRaceLandingEl : lbModeRaceHudEl
  const blackholeBtn = slot === 'landing' ? lbModeBlackholeLandingEl : lbModeBlackholeHudEl
  const pilotlevelBtn = slot === 'landing' ? lbModePilotlevelLandingEl : lbModePilotlevelHudEl
  const seasonEl = slot === 'landing' ? lbSeasonLandingEl : lbSeasonHudEl
  title.textContent = mode === 'pvp'
    ? (slot === 'landing' ? 'RANKED PVP' : 'RANKED PVP - kills')
    : mode === 'race'
      ? (slot === 'landing' ? 'RANKED RACE' : 'RANKED RACE - best time')
      : mode === 'blackhole'
        ? (slot === 'landing' ? 'CLOSEST APPROACH' : 'CLOSEST APPROACH - to the singularity')
        : mode === 'pilotlevel'
          ? (slot === 'landing' ? 'TOP PILOTS' : 'TOP PILOTS - level')
          : (slot === 'landing' ? 'TOP PILOTS' : 'TOP PILOTS - credits')
  renderPvpSeasonPanel(seasonEl, mode)
  careerBtn.classList.toggle('active', mode === 'career')
  pvpBtn.classList.toggle('active', mode === 'pvp')
  raceBtn.classList.toggle('active', mode === 'race')
  blackholeBtn.classList.toggle('active', mode === 'blackhole')
  pilotlevelBtn.classList.toggle('active', mode === 'pilotlevel')
  careerBtn.setAttribute('aria-pressed', String(mode === 'career'))
  pvpBtn.setAttribute('aria-pressed', String(mode === 'pvp'))
  raceBtn.setAttribute('aria-pressed', String(mode === 'race'))
  blackholeBtn.setAttribute('aria-pressed', String(mode === 'blackhole'))
  pilotlevelBtn.setAttribute('aria-pressed', String(mode === 'pilotlevel'))
}
function renderLeaderboardPage(
  listEl: HTMLElement,
  rangeEl: HTMLElement,
  prevEl: HTMLButtonElement,
  nextEl: HTMLButtonElement,
  page: LeaderboardPage,
  mode: LeaderboardMode,
): void {
  if (mode === 'career') renderLeaderboardRows(listEl, page.rows, page.offset)
  else renderLeaderboardRowsForMode(listEl, page.rows, page.offset, mode)
  rangeEl.textContent = leaderboardRangeText(page)
  const canPage = canPageLeaderboard(page)
  prevEl.disabled = !canPage.prev
  nextEl.disabled = !canPage.next
}
function fetchLeaderboard(slot: 'landing' | 'hud'): void {
  const offset = slot === 'landing' ? landingLeaderboardOffset : hudLeaderboardOffset
  const mode = slot === 'landing' ? landingLeaderboardMode : hudLeaderboardMode
  fetch(leaderboardUrl(LEADERBOARD_URLS[mode], offset)).then((r) => r.json())
    .then((payload) => {
      const page = normalizeLeaderboardPage(payload, offset)
      if (slot === 'landing') renderLeaderboardPage(lbListLandingEl, lbPageLandingEl, lbPrevLandingEl, lbNextLandingEl, page, mode)
      else renderLeaderboardPage(lbListHudEl, lbPageHudEl, lbPrevHudEl, lbNextHudEl, page, mode)
    })
    .catch(() => { /* relay offline */ })
}
function setLeaderboardMode(slot: 'landing' | 'hud', mode: LeaderboardMode): void {
  if (slot === 'landing') {
    if (landingLeaderboardMode === mode) return
    landingLeaderboardMode = mode
    landingLeaderboardOffset = 0
  } else {
    if (hudLeaderboardMode === mode) return
    hudLeaderboardMode = mode
    hudLeaderboardOffset = 0
  }
  syncLeaderboardModeButtons(slot)
  fetchLeaderboard(slot)
}
function changeLeaderboardPage(slot: 'landing' | 'hud', dir: -1 | 1): void {
  if (slot === 'landing') landingLeaderboardOffset = nextLeaderboardOffset(landingLeaderboardOffset, dir)
  else hudLeaderboardOffset = nextLeaderboardOffset(hudLeaderboardOffset, dir)
  fetchLeaderboard(slot)
}
lbPrevLandingEl.addEventListener('click', () => changeLeaderboardPage('landing', -1))
lbNextLandingEl.addEventListener('click', () => changeLeaderboardPage('landing', 1))
lbPrevHudEl.addEventListener('click', () => changeLeaderboardPage('hud', -1))
lbNextHudEl.addEventListener('click', () => changeLeaderboardPage('hud', 1))
lbModeCareerLandingEl.addEventListener('click', () => setLeaderboardMode('landing', 'career'))
lbModePvpLandingEl.addEventListener('click', () => setLeaderboardMode('landing', 'pvp'))
lbModeRaceLandingEl.addEventListener('click', () => setLeaderboardMode('landing', 'race'))
lbModeCareerHudEl.addEventListener('click', () => setLeaderboardMode('hud', 'career'))
lbModePvpHudEl.addEventListener('click', () => setLeaderboardMode('hud', 'pvp'))
lbModeRaceHudEl.addEventListener('click', () => setLeaderboardMode('hud', 'race'))
lbModeBlackholeLandingEl.addEventListener('click', () => setLeaderboardMode('landing', 'blackhole'))
lbModeBlackholeHudEl.addEventListener('click', () => setLeaderboardMode('hud', 'blackhole'))
lbModePilotlevelLandingEl.addEventListener('click', () => setLeaderboardMode('landing', 'pilotlevel'))
lbModePilotlevelHudEl.addEventListener('click', () => setLeaderboardMode('hud', 'pilotlevel'))
syncLeaderboardModeButtons('landing')
syncLeaderboardModeButtons('hud')
function refreshLandingStats(): void {
  fetch(STATS_URL)
    .then((r) => r.json())
    .then((d) => {
      statOnlineEl.textContent = String(d.online ?? '—')
      statRegisteredEl.textContent = String(d.registered ?? '—')
    })
    .catch(() => { /* relay offline — leave placeholders */ })
  fetchLeaderboard('landing')
}
refreshLandingStats()
statsTimer = setInterval(refreshLandingStats, 6000)

// --- Renderer / scene
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  logarithmicDepthBuffer: true,
  preserveDrawingBuffer: SHOWCASE_HOLDER || SHOWCASE_TIME_TRIAL,
})
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping // filmic highlights — plays well with bloom
renderer.toneMappingExposure = 1.15
appEl.appendChild(renderer.domElement)

function requestFlightPointerLock(): void {
  if (MOBILE_COMPANION) return
  if (spectating) return // Browse is a cursor-free viewer — never grab flight pointer lock
  if (document.pointerLockElement === renderer.domElement) return
  if (typeof renderer.domElement.requestPointerLock !== 'function') return
  const lockRequest = renderer.domElement.requestPointerLock()
  if (lockRequest instanceof Promise) lockRequest.catch(() => { /* Pointer lock can be denied in inactive tabs or automation. */ })
}

const labelRenderer = new CSS2DRenderer()
labelRenderer.setSize(innerWidth, innerHeight)
labelRenderer.domElement.style.position = 'fixed'
labelRenderer.domElement.style.top = '0'
labelRenderer.domElement.style.pointerEvents = 'none'
appEl.appendChild(labelRenderer.domElement)

type HolderShowcaseStep = {
  tier: number
  callsign: string
  label: string
  color: string
  chat: string
}
const HOLDER_SHOWCASE_STEPS: HolderShowcaseStep[] = [
  { tier: 0, callsign: 'PILOT', label: 'STANDARD', color: '#d9ecff', chat: '#9fffb0' },
  { tier: 1, callsign: 'AURIC', label: 'TIER 1 / NAME COLOR', color: '#ffd24a', chat: '#ffd24a' },
  { tier: 2, callsign: 'ION', label: 'TIER 2 / CHAT COLOR', color: '#4ef0ff', chat: '#4ef0ff' },
  { tier: 3, callsign: 'VOID', label: 'TIER 3 / VOID INTERCEPTOR', color: '#c08aff', chat: '#c08aff' },
]
const HOLDER_SHOWCASE_STEP_MS = 3000
const showcaseCanvas = SHOWCASE_HOLDER ? document.createElement('canvas') : null
const showcaseCtx = showcaseCanvas?.getContext('2d') ?? null
if (showcaseCanvas) {
  showcaseCanvas.width = 1280
  showcaseCanvas.height = 720
}
let showcaseStart = 0
let showcaseStepIdx = -1

function holderShowcaseElapsed(now: number): number {
  if (!showcaseStart) showcaseStart = now
  return Math.max(0, now - showcaseStart)
}

function holderShowcaseStepIndex(now: number): number {
  return Math.min(HOLDER_SHOWCASE_STEPS.length - 1, Math.floor(holderShowcaseElapsed(now) / HOLDER_SHOWCASE_STEP_MS))
}

function activeHolderShowcaseStep(now: number): HolderShowcaseStep {
  return HOLDER_SHOWCASE_STEPS[holderShowcaseStepIndex(now)]
}

function roundRect2d(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function updateHolderShowcase(now: number): void {
  if (!SHOWCASE_HOLDER || !running) return
  const idx = holderShowcaseStepIndex(now)
  const step = HOLDER_SHOWCASE_STEPS[idx]
  selfTier = step.tier
  camThrust = Math.max(camThrust, 0.82)
  camBoost = true
  if (idx !== showcaseStepIdx) {
    showcaseStepIdx = idx
    nicknameEl.value = step.callsign
    setPlayerCraft(selectedShipType)
    addChatLine(step.callsign, 'holder cosmetics online', step.tier)
  }
}

function drawHolderShowcaseComposite(now: number): void {
  if (!SHOWCASE_HOLDER || !showcaseCanvas || !showcaseCtx) return
  const step = activeHolderShowcaseStep(now)
  const w = showcaseCanvas.width
  const h = showcaseCanvas.height
  showcaseCtx.clearRect(0, 0, w, h)
  showcaseCtx.drawImage(renderer.domElement, 0, 0, w, h)
  const vignette = showcaseCtx.createRadialGradient(w / 2, h / 2, 90, w / 2, h / 2, 720)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,.52)')
  showcaseCtx.fillStyle = vignette
  showcaseCtx.fillRect(0, 0, w, h)

  showcaseCtx.save()
  showcaseCtx.fillStyle = '#f2f8ff'
  showcaseCtx.font = '700 28px Orbitron, Segoe UI, sans-serif'
  showcaseCtx.fillText('CLAUDE CITIZEN HOLDER COSMETICS', 42, 54)
  showcaseCtx.fillStyle = '#9bb6d7'
  showcaseCtx.font = '14px Segoe UI, sans-serif'
  showcaseCtx.fillText('Actual gameplay capture: name color, chat nickname, and prestige ship kit by holder tier.', 44, 80)

  showcaseCtx.shadowColor = step.tier > 0 ? step.color : 'rgba(0,0,0,.9)'
  showcaseCtx.shadowBlur = step.tier > 0 ? 16 : 6
  roundRect2d(showcaseCtx, 42, 108, 250, 58, 8)
  showcaseCtx.fillStyle = step.tier > 0 ? 'rgba(20, 16, 28, .72)' : 'rgba(5, 10, 22, .72)'
  showcaseCtx.strokeStyle = step.tier > 0 ? step.color : 'rgba(160, 190, 255, .32)'
  showcaseCtx.lineWidth = 1.2
  showcaseCtx.fill()
  showcaseCtx.stroke()
  showcaseCtx.shadowBlur = 0
  showcaseCtx.fillStyle = step.color
  showcaseCtx.font = '700 12px Orbitron, Segoe UI, sans-serif'
  showcaseCtx.fillText(step.label, 58, 130)
  showcaseCtx.font = '700 22px Orbitron, Segoe UI, sans-serif'
  showcaseCtx.fillText(step.callsign, 58, 156)

  roundRect2d(showcaseCtx, 42, h - 88, 340, 48, 7)
  showcaseCtx.fillStyle = 'rgba(5, 10, 24, .78)'
  showcaseCtx.strokeStyle = 'rgba(120, 160, 255, .22)'
  showcaseCtx.fill()
  showcaseCtx.stroke()
  showcaseCtx.shadowColor = step.tier > 0 ? step.chat : 'transparent'
  showcaseCtx.shadowBlur = step.tier > 0 ? 10 : 0
  showcaseCtx.fillStyle = step.chat
  showcaseCtx.font = '700 14px Segoe UI, sans-serif'
  showcaseCtx.fillText(`${step.callsign}:`, 58, h - 58)
  showcaseCtx.shadowBlur = 0
  showcaseCtx.fillStyle = '#d8ebff'
  showcaseCtx.font = '14px Segoe UI, sans-serif'
  showcaseCtx.fillText('holder cosmetics online', 128, h - 58)
  showcaseCtx.restore()
}

;(window as unknown as { renderGameplayShowcase?: (durationMs?: number) => Promise<string> }).renderGameplayShowcase = (durationMs = 14000) => {
  return new Promise((resolve, reject) => {
    if (!showcaseCanvas) {
      reject(new Error('showcase canvas is only available with ?showcase=holder'))
      return
    }
    showcaseStart = performance.now()
    showcaseStepIdx = -1
    const chunks: BlobPart[] = []
    const stream = showcaseCanvas.captureStream(30)
    const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E')
      ? 'video/mp4;codecs=avc1.42E01E'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6500000 })
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
    recorder.onerror = () => reject(new Error('MediaRecorder failed'))
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType })
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    }
    recorder.start(250)
    setTimeout(() => recorder.stop(), durationMs)
  })
}

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x010206)
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.5, 500000)

function buildPvpArenaMarker(center: THREE.Vector3, radius: number, color: number): THREE.Group {
  const group = new THREE.Group()
  group.position.copy(center)
  const boundaryMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.56,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const bandMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.09,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const beaconMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 28, 8, 192), boundaryMat)
  ring.rotation.x = Math.PI / 2
  group.add(ring)

  const band = new THREE.Mesh(new THREE.RingGeometry(radius - 135, radius + 135, 192), bandMat)
  band.rotation.x = Math.PI / 2
  band.position.y = -3
  group.add(band)

  const pillarGeo = new THREE.CylinderGeometry(10, 10, 280, 8, 1, true)
  const capGeo = new THREE.SphereGeometry(26, 12, 8)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    const x = Math.cos(a) * radius
    const z = Math.sin(a) * radius
    const pillar = new THREE.Mesh(pillarGeo, beaconMat)
    pillar.position.set(x, 140, z)
    const cap = new THREE.Mesh(capGeo, beaconMat)
    cap.position.set(x, 292, z)
    group.add(pillar, cap)
  }

  return group
}

function buildPvpArenaLights(center: THREE.Vector3, radius: number, keyColor: number, fillColor: number): THREE.Group {
  const group = new THREE.Group()
  group.position.copy(center)
  const key = new THREE.PointLight(keyColor, 5.2, radius * 2.4, 1.4)
  key.position.set(-360, 260, 180)
  const fill = new THREE.PointLight(fillColor, 3.6, radius * 2.1, 1.5)
  fill.position.set(420, -120, -260)
  group.add(key, fill)
  return group
}

scene.add(buildPvpArenaMarker(PVP_PRACTICE_ZONE_CENTER, PVP_PRACTICE_ZONE_RADIUS, 0x5df4ff))
scene.add(buildPvpArenaLights(PVP_PRACTICE_ZONE_CENTER, PVP_PRACTICE_ZONE_RADIUS, 0x5df4ff, 0xff5dff))
scene.add(buildPvpArenaMarker(PVP_RANKED_ZONE_CENTER, PVP_RANKED_ZONE_RADIUS, 0xffd24d))
scene.add(buildPvpArenaLights(PVP_RANKED_ZONE_CENTER, PVP_RANKED_ZONE_RADIUS, 0xffd24d, 0xff5dff))
scene.add(buildPvpArenaMarker(TRAINING_RANGE_DESTINATION.position, TRAINING_RANGE_DESTINATION.radius, 0x9fffb0))
scene.add(buildPvpArenaLights(TRAINING_RANGE_DESTINATION.position, TRAINING_RANGE_DESTINATION.radius, 0x9fffb0, 0x58ddff))

// Bloom post-processing: make the sun, engines, lasers and lit windows actually glow.
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.5, 0.85) // strength, radius, threshold
composer.addPass(bloomPass)

const nebula = buildNebula()
scene.add(nebula)
const starfield = buildStarfield()
scene.add(starfield, buildPlanet(), buildAsteroids())

const dustField = buildDustField() // parallax motes — sense of speed in flight
scene.add(dustField)
const warpField = buildWarpField() // quantum hyperspace streaks (camera-local)
camera.add(warpField)
scene.add(camera) // camera must be in the graph for its child (warp) to render

const station = buildStation()
const colony = buildColony()
scene.add(station, colony)

// Capital ship — set-dressing for scale. Parked off the spawn corridor; fly its length for awe.
// Keep a stable parent group so collision/flyby code works before and after the GLB loads.
type CapitalCollider = { p: THREE.Vector3; r: number }
type CapitalSetpiece = { root: THREE.Group; colliders: CapitalCollider[] }
const capitalSetpieces: CapitalSetpiece[] = []
const capital = new THREE.Group()
capital.add(buildCapitalShip())
capital.position.set(1000, 320, -2000)
capital.rotation.y = 0.5
scene.add(capital)
const capitalSetpiece: CapitalSetpiece = { root: capital, colliders: fitCapitalColliders(capital) } // procedural hull bounds until the GLB loads
capitalSetpieces.push(capitalSetpiece)
void loadCapitalModel().then((model) => {
  if (!model) return
  for (const child of [...capital.children]) {
    capital.remove(child)
    disposeObject(child)
  }
  capital.add(model)
  capitalSetpiece.colliders = fitCapitalColliders(capital) // refit to the GLB's actual bounds (any scale/axis)
})
const capitalCarrier = new THREE.Group()
capitalCarrier.add(buildCapitalShip(13))
capitalCarrier.position.set(-1450, 560, -2700)
capitalCarrier.rotation.set(0.08, -0.78, 0.03)
scene.add(capitalCarrier)
const capitalCarrierSetpiece: CapitalSetpiece = { root: capitalCarrier, colliders: fitCapitalColliders(capitalCarrier) }
capitalSetpieces.push(capitalCarrierSetpiece)
void loadCapitalCarrierModel().then((model) => {
  if (!model) return
  for (const child of [...capitalCarrier.children]) {
    capitalCarrier.remove(child)
    disposeObject(child)
  }
  capitalCarrier.add(model)
  capitalCarrierSetpiece.colliders = fitCapitalColliders(capitalCarrier)
})
const muchLaunchTower = new THREE.Group()
muchLaunchTower.add(buildMuchLaunchTower())
muchLaunchTower.position.set(-720, 110, -1280)
muchLaunchTower.rotation.set(0.02, 0.38, -0.04)
muchLaunchTower.scale.setScalar(1.25)
scene.add(muchLaunchTower)
capitalSetpieces.push({ root: muchLaunchTower, colliders: fitCapitalColliders(muchLaunchTower) })
const rareFrogShrine = new THREE.Group()
rareFrogShrine.add(buildRareFrogShrine())
rareFrogShrine.position.set(260, 90, 1180) // behind spawn (+z) — turn around from the refinery to see it
rareFrogShrine.rotation.set(-0.03, Math.PI - 0.15, 0.02) // face back toward spawn
rareFrogShrine.scale.setScalar(1.2)
scene.add(rareFrogShrine)
capitalSetpieces.push({ root: rareFrogShrine, colliders: fitCapitalColliders(rareFrogShrine) })
const seasonHub = new THREE.Group()
seasonHub.name = 'Citizen Season 1 Hub'
seasonHub.position.copy(CITIZEN_SEASON_HUB_DESTINATION.position)
seasonHub.rotation.set(0.02, -0.78, 0.015)
scene.add(seasonHub)
const seasonHubSetpiece: CapitalSetpiece = { root: seasonHub, colliders: [] }
capitalSetpieces.push(seasonHubSetpiece)
const seasonHubLifeRig = createSeasonHubLifeRig()
seasonHub.add(seasonHubLifeRig.root)
void loadSeasonHubModel().then((model) => {
  if (!model) return
  seasonHub.add(model)
  seasonHubSetpiece.colliders = fitCapitalColliders(seasonHub)
})
const seasonHubLight = new THREE.PointLight(0x5df4ff, 7.2, 3200, 1.28)
seasonHubLight.position.copy(CITIZEN_SEASON_HUB_DESTINATION.position).add(new THREE.Vector3(0, 620, 0))
scene.add(seasonHubLight)

const seasonBoardCanvas = document.createElement('canvas')
seasonBoardCanvas.width = 1024
seasonBoardCanvas.height = 512
const seasonBoardCtx = seasonBoardCanvas.getContext('2d')!
const seasonBoardTexture = new THREE.CanvasTexture(seasonBoardCanvas)
seasonBoardTexture.colorSpace = THREE.SRGBColorSpace
const seasonBoard = new THREE.Mesh(
  new THREE.PlaneGeometry(760, 380),
  new THREE.MeshBasicMaterial({ map: seasonBoardTexture, transparent: true }),
)
seasonBoard.name = 'Citizen Season 1 Top Pilots Board'
seasonBoard.position.copy(CITIZEN_SEASON_HUB_DESTINATION.position).add(new THREE.Vector3(0, 385, 940))
seasonBoard.rotation.y = -0.78
scene.add(seasonBoard)

const TIME_TRIAL_BEST_KEY = 'scc.timeTrial.hub.best'
const timeTrialOrigin = CITIZEN_SEASON_HUB_DESTINATION.position
function hubRoutePoint(x: number, y: number, z: number): THREE.Vector3 {
  return timeTrialOrigin.clone().add(new THREE.Vector3(x, y, z))
}

function loadTimeTrialBest(): number | null {
  const raw = localStorage.getItem(TIME_TRIAL_BEST_KEY)
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

function saveTimeTrialBest(value: number): void {
  try { localStorage.setItem(TIME_TRIAL_BEST_KEY, String(value)) } catch { /* storage blocked */ }
}

const hubTimeTrialGates: TimeTrialGate[] = [
  { id: 'hub-gate-1', position: hubRoutePoint(0, 210, 1620), radius: 230 },
  { id: 'hub-gate-2', position: hubRoutePoint(-760, 280, 1240), radius: 230 },
  { id: 'hub-gate-3', position: hubRoutePoint(-1380, 320, 360), radius: 230 },
  { id: 'hub-gate-4', position: hubRoutePoint(-1180, 230, -720), radius: 230 },
  { id: 'hub-gate-5', position: hubRoutePoint(-250, 390, -1450), radius: 230 },
  { id: 'hub-gate-6', position: hubRoutePoint(760, 280, -1220), radius: 230 },
  { id: 'hub-gate-7', position: hubRoutePoint(1440, 250, -240), radius: 230 },
  { id: 'hub-gate-8', position: hubRoutePoint(1120, 340, 850), radius: 230 },
  { id: 'hub-gate-9', position: hubRoutePoint(380, 300, 1450), radius: 230 },
  { id: 'hub-gate-10', position: hubRoutePoint(0, 240, 2120), radius: 230 },
]

function timeTrialShowcaseApproachPoint(distance: number, lift = 0): THREE.Vector3 {
  const startGate = hubTimeTrialGates[0].position
  const nextGate = hubTimeTrialGates[1]?.position ?? timeTrialOrigin
  return startGate.clone()
    .add(startGate.clone().sub(nextGate).normalize().multiplyScalar(distance))
    .add(new THREE.Vector3(0, lift, 0))
}

const hubTimeTrial = createTimeTrial(hubTimeTrialGates, loadTimeTrialBest())
let timeTrialMessageUntil = 0
let timeTrialBannerText = ''
let timeTrialCenterBannerUntil = 0
let raceFinishGlowUntil = 0

function showTimeTrialCenterBanner(text: string, nowSeconds: number, duration = 2.4): void {
  if (!text) return
  timeTrialBannerEl.textContent = text
  timeTrialBannerEl.hidden = false
  timeTrialBannerEl.style.opacity = '1'
  timeTrialCenterBannerUntil = nowSeconds + duration
}

function showRaceFinishGlow(nowSeconds: number): void {
  raceFinishGlowEl.hidden = false
  raceFinishGlowEl.style.opacity = '1'
  raceFinishGlowUntil = nowSeconds + 0.55
}

interface TimeTrialGateVisual {
  root: THREE.Group
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>
  core: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>
}

const hubTimeTrialGateVisuals: TimeTrialGateVisual[] = hubTimeTrialGates.map((gate, index) => {
  const root = new THREE.Group()
  root.name = `Hub Time Trial Gate ${index + 1}`
  root.position.copy(gate.position)
  const next = hubTimeTrialGates[(index + 1) % hubTimeTrialGates.length]?.position ?? timeTrialOrigin
  root.lookAt(next)

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(155, 8, 10, 96),
    new THREE.MeshBasicMaterial({ color: index === 0 ? 0xffd24d : 0x5df4ff, transparent: true, opacity: 0.48, depthWrite: false }),
  )
  ring.name = `${root.name} Ring`
  const core = new THREE.Mesh(
    new THREE.TorusGeometry(118, 3, 8, 80),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }),
  )
  core.name = `${root.name} Core`
  root.add(ring, core)
  scene.add(root)
  return { root, ring, core }
})

function syncHubTimeTrialGates(nowSeconds: number): void {
  const nextIndex = hubTimeTrial.nextGateIndex
  const active = hubTimeTrial.active
  hubTimeTrialGateVisuals.forEach((visual, index) => {
    const current = index === nextIndex
    const complete = active && index < nextIndex
    const pulse = current ? 1 + Math.sin(nowSeconds * 5.5) * 0.08 : 1
    visual.root.scale.setScalar(pulse)
    visual.ring.material.opacity = current ? 0.86 : complete ? 0.18 : 0.36
    visual.core.material.opacity = current ? 0.46 : complete ? 0.08 : 0.18
    visual.ring.material.color.setHex(current ? 0xffd24d : complete ? 0x6fdc8c : 0x5df4ff)
    visual.core.material.color.setHex(current ? 0xffffff : 0x9fefff)
  })
}

function drawSeasonHubTopPilots(rows: LeaderboardRow[]): void {
  const ctx = seasonBoardCtx
  ctx.clearRect(0, 0, seasonBoardCanvas.width, seasonBoardCanvas.height)
  ctx.fillStyle = 'rgba(3, 8, 17, 0.92)'
  ctx.fillRect(0, 0, seasonBoardCanvas.width, seasonBoardCanvas.height)
  ctx.strokeStyle = '#5df4ff'
  ctx.lineWidth = 14
  ctx.strokeRect(18, 18, seasonBoardCanvas.width - 36, seasonBoardCanvas.height - 36)
  ctx.strokeStyle = '#ffd24d'
  ctx.lineWidth = 4
  ctx.strokeRect(42, 42, seasonBoardCanvas.width - 84, seasonBoardCanvas.height - 84)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#e8fbff'
  ctx.font = '700 58px Orbitron, monospace'
  ctx.fillText('CITIZEN SEASON 1', seasonBoardCanvas.width / 2, 104)
  ctx.fillStyle = '#ffd24d'
  ctx.font = '700 31px "Share Tech Mono", monospace'
  ctx.fillText('RANKED PVP // TOP PILOTS', seasonBoardCanvas.width / 2, 154)

  ctx.textAlign = 'left'
  ctx.font = '700 42px "Share Tech Mono", monospace'
  const top = rows.slice(0, 3)
  if (!top.length) {
    ctx.fillStyle = '#86f8ff'
    ctx.fillText('AWAITING RANKED KILLS', 178, 285)
  } else {
    top.forEach((row, index) => {
      const y = 245 + index * 74
      ctx.fillStyle = index === 0 ? '#ffd24d' : index === 1 ? '#d9ecff' : '#c08aff'
      ctx.fillText(`#${index + 1}`, 94, y)
      ctx.fillStyle = '#e8fbff'
      ctx.fillText(leaderboardPilotDisplayText(row).slice(0, 28), 206, y)
      ctx.fillStyle = '#9fffb0'
      ctx.font = '700 30px "Share Tech Mono", monospace'
      ctx.fillText(leaderboardMetricText(row, 'pvp'), 206, y + 34)
      ctx.font = '700 42px "Share Tech Mono", monospace'
    })
  }
  seasonBoardTexture.needsUpdate = true
}

function refreshSeasonHubTopPilots(): void {
  fetch(leaderboardUrl(LEADERBOARD_URLS.pvp, 0)).then((r) => r.json())
    .then((payload) => drawSeasonHubTopPilots(normalizeLeaderboardPage(payload, 0).rows))
    .catch(() => drawSeasonHubTopPilots([]))
}
drawSeasonHubTopPilots([])
refreshSeasonHubTopPilots()
setInterval(refreshSeasonHubTopPilots, 60000)

// Named solar system — giant backdrop + quantum-travel targets. Trade/outposts stay local.
const sun = buildSun(SUN_RADIUS, SUN_COLOR)
sun.position.copy(SUN_POSITION)
scene.add(sun)
const sunLight = new THREE.PointLight(0xfff0be, 2.5, 0, 0) // no falloff — lights the whole system
sunLight.position.copy(SUN_POSITION)
scene.add(sunLight)
const planetLODs: THREE.LOD[] = []
const planetGroups: THREE.Group[] = []
const planetUpgraded = new Set<number>()
const PLANET_UPGRADE_START_DELAY_MS = 6000
const PLANET_UPGRADE_IDLE_MS = 1800
const PLANET_UPGRADE_RETRY_MS = 1500
const PLANET_UPGRADE_BETWEEN_MS = 6000
const PLANET_UPGRADE_MAX_SPEED_SQ = 16
let planetUpgradeInFlight = false
let nextPlanetUpgradeAt = Infinity
let planetUpgradeIdleSince = 0
const planetDockTargets: DockTarget[] = []
for (const [idx, planet] of PLANETS.entries()) {
  const mesh = buildSolarPlanet(planet.radius, planet.color, planet.hasRings, planet.surface, planet.seed, {
    startupTextureSize: planet.name === 'Earth' ? 1024 : 512,
  })
  mesh.position.copy(planet.position)
  mesh.userData.spin = 0.004 + ((planet.seed % 100) / 100) * 0.012 // gentle, per-planet rotation
  mesh.userData.planetIdx = idx
  scene.add(mesh)
  planetGroups.push(mesh)
  mesh.traverse((o) => { if (o instanceof THREE.LOD) planetLODs.push(o) })
  const dockPos = planetDockPosition(planet.position, planet.radius, SUN_POSITION)
  const station = buildStation()
  station.position.copy(dockPos)
  scene.add(station)
  planetDockTargets.push({ id: `planet-${planet.name.toLowerCase()}`, position: dockPos })
}
buildLights(scene)

function updateDeepSpaceVisibility(): void {
  const inPvpDeepSpace = ship.position.distanceToSquared(PVP_ZONE_CENTER) <= PVP_ARENA_CLEAR_RADIUS * PVP_ARENA_CLEAR_RADIUS
  sun.visible = !inPvpDeepSpace
  for (const mesh of planetGroups) mesh.visible = !inPvpDeepSpace
}

function rebuildPlanetLODs(): void {
  planetLODs.length = 0
  for (const mesh of planetGroups) mesh.traverse((o) => { if (o instanceof THREE.LOD) planetLODs.push(o) })
}

function schedulePlanetUpgrades(startDelay = PLANET_UPGRADE_START_DELAY_MS): void {
  planetUpgradeIdleSince = 0
  nextPlanetUpgradeAt = performance.now() + startDelay
}

function canUpgradePlanetNow(now: number): boolean {
  if (!running || planetUpgradeInFlight) return false
  if (docked) return false
  const busy =
    chatOpen ||
    solarMap.isOpen ||
    quantum.phase !== 'idle' ||
    miningActive ||
    weaponActive ||
    keys.size > 0 ||
    ship.velocity.lengthSq() > PLANET_UPGRADE_MAX_SPEED_SQ
  if (busy) {
    planetUpgradeIdleSince = 0
    return false
  }
  if (!planetUpgradeIdleSince) planetUpgradeIdleSince = now
  return now - planetUpgradeIdleSince >= PLANET_UPGRADE_IDLE_MS
}

function upgradeNextPlanet(now: number): void {
  if (planetUpgradeInFlight || now < nextPlanetUpgradeAt || planetUpgraded.size >= PLANETS.length) return
  if (!canUpgradePlanetNow(now)) {
    nextPlanetUpgradeAt = now + PLANET_UPGRADE_RETRY_MS
    return
  }
  const candidates = PLANETS
    .map((planet, idx) => ({ planet, idx, d: planet.position.distanceToSquared(ship.position) }))
    .filter(({ idx }) => !planetUpgraded.has(idx))
    .sort((a, b) => a.d - b.d)
  const next = candidates[0]
  if (!next) return
  planetUpgradeInFlight = true
  nextPlanetUpgradeAt = Infinity
  void (async () => {
    // Compute the heavy 2K texture off the main thread first, so the synchronous build below is all
    // cache hits (a ~20ms geometry pass) instead of a ~2s freeze.
    await prewarmHighPlanetTextures(next.planet.radius, next.planet.surface, next.planet.seed, next.planet.color)
    const old = planetGroups[next.idx]
    const upgraded = buildSolarPlanet(
      next.planet.radius,
      next.planet.color,
      next.planet.hasRings,
      next.planet.surface,
      next.planet.seed,
      { quality: 'high' },
    )
    upgraded.position.copy(next.planet.position)
    upgraded.rotation.copy(old.rotation)
    upgraded.userData.spin = old.userData.spin
    upgraded.userData.planetIdx = next.idx
    scene.remove(old)
    disposeObject(old)
    scene.add(upgraded)
    planetGroups[next.idx] = upgraded
    planetUpgraded.add(next.idx)
    rebuildPlanetLODs()
    planetUpgradeInFlight = false
    planetUpgradeIdleSince = 0
    nextPlanetUpgradeAt = performance.now() + PLANET_UPGRADE_BETWEEN_MS
  })()
}

// Mineable ore — a dynamic pool that follows the player: depleted or distant rocks are
// removed and fresh veins respawn nearby, so no single spot is an infinite mine.
const field = createAsteroidField([])
const rockMeshes = new Map<string, { mesh: THREE.Group; initial: number; rare: boolean }>()
const ORE_TARGET = 7   // rocks kept near the player
const ORE_NEAR = 200   // closest a fresh vein spawns
const ORE_FAR = 850    // farthest
const ORE_CULL = 1200  // remove rocks beyond this from the player
// Deep space: effects (rare veins, danger) ramp with distance from origin, peaking at DEEP_REF.
const DEEP_REF = 60000
const ORE_RARE_BONUS = 150 // bonus credits per unit mined from a rare (gold) vein
function deepFactor(): number { return Math.min(1, ship.position.length() / DEEP_REF) }
let oreSeq = 0
let lastOreStream = 0
const _oreDir = new THREE.Vector3()
function spawnOreSite(): void {
  const a = Math.random() * Math.PI * 2
  const r = ORE_NEAR + Math.random() * (ORE_FAR - ORE_NEAR)
  _oreDir.set(Math.cos(a) * r, (Math.random() - 0.5) * 120, Math.sin(a) * r)
  const id = `ore-${oreSeq++}`
  // Deeper space mixes in rare gold veins — richer reserves + a credit jackpot when mined.
  const rare = Math.random() < deepFactor() * 0.55
  const reserves = rare
    ? 24 + Math.floor(Math.random() * 20) // richer
    : 10 + Math.floor(Math.random() * 13)
  const pos = ship.position.clone().add(_oreDir)
  field.asteroids.push({ id, position: pos, reserves })
  const mesh = buildMineableAsteroid(rare)
  mesh.position.copy(pos)
  scene.add(mesh)
  rockMeshes.set(id, { mesh, initial: reserves, rare })
}
function streamOre(): void {
  for (let i = field.asteroids.length - 1; i >= 0; i--) {
    const ast = field.asteroids[i]
    if (ast.reserves > 0 && ast.position.distanceTo(ship.position) <= ORE_CULL) continue
    const rm = rockMeshes.get(ast.id)
    if (rm) { scene.remove(rm.mesh); disposeObject(rm.mesh); rockMeshes.delete(ast.id) }
    field.asteroids.splice(i, 1)
  }
  while (field.asteroids.length < ORE_TARGET) spawnOreSite()
}

// --- Procedural galaxy: stream celestial bodies in/out around the player.
const STREAM_RADIUS = 55000
const spawnedBodies = new Map<string, THREE.Object3D>()
let lastStream = -Infinity
// Skip the (cell-querying) stream pass when the ship has barely moved — nothing can enter or leave
// the radius, so re-querying just burns a frame. Kills the periodic hitch when parked/rotating.
const STREAM_MOVE_THRESHOLD_SQ = 2000 * 2000
const lastStreamPos = new THREE.Vector3(Infinity, Infinity, Infinity)
// Celestials are built (mesh + 256px procedural textures) at most a few per frame so flying into a
// fresh region doesn't block one frame building a whole batch (was the multi-hundred-ms / >1s hitch).
const pendingBuild = new Map<string, Celestial>()
const CELESTIAL_BUILD_BUDGET = 2
// Collision shells for the solid galaxy bodies (planets + moons). Registered at stream time — before
// the mesh is even built — so you can't slip through a body that hasn't rendered yet.
const solidBodies = new Map<string, { position: THREE.Vector3; radius: number }>()

function celestialRng(seed: number): () => number {
  let a = (seed >>> 0) || 1
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Galaxy bodies are the barren backwater — cratered rock/moon worlds only. The vivid,
// varied surfaces (earth/venus/gas) are reserved for the named solar planets.
const GALAXY_KINDS: PlanetTextureKind[] = ['moon', 'rocky']

function buildCelestial(c: Celestial): THREE.Object3D {
  const rand = celestialRng(c.seed)
  const group = new THREE.Group()
  if (c.type === 'planet' || c.type === 'moon') {
    const isPlanet = c.type === 'planet'
    // Celestials carry no surface kind — derive a stable one from the seed, then texture it.
    const kind: PlanetTextureKind = isPlanet ? GALAXY_KINDS[Math.floor(rand() * GALAXY_KINDS.length)] : 'moon'
    // Low-saturation greys/browns — barren rock, not vivid worlds.
    const baseColor = new THREE.Color().setHSL(0.05 + rand() * 0.07, 0.2, 0.42).getHex()
    const segs = isPlanet ? 48 : 32
    const geo = new THREE.SphereGeometry(c.radius, segs, Math.max(16, segs >> 1))
    const maps = generatePlanetTextures(kind, c.seed, baseColor, 96, c.radius)
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: maps.colorMap, bumpMap: maps.bumpMap, bumpScale: c.radius * 0.025, roughness: 0.96, metalness: 0,
    }))
    group.add(body)
  } else if (c.type === 'asteroid-cluster') {
    const mat = makeAsteroidMaterial(c.seed, 0x6b6258, 96)
    const n = 6 + Math.floor(rand() * 8)
    for (let i = 0; i < n; i++) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(c.radius * (0.1 + rand() * 0.22), 0), mat)
      rock.position.set((rand() - 0.5) * c.radius * 2, (rand() - 0.5) * c.radius * 2, (rand() - 0.5) * c.radius * 2)
      group.add(rock)
    }
  } else if (c.type === 'station') {
    const hull = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, flatShading: true, metalness: 0.6, roughness: 0.4 })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(c.radius, c.radius * 0.12, 8, 18), hull)
    group.add(ring)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(c.radius * 0.22, c.radius * 0.22, c.radius * 0.6, 8), hull)
    hub.rotation.x = Math.PI / 2
    group.add(hub)
  } else {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3530, flatShading: true, roughness: 1, metalness: 0.3 })
    const hull = new THREE.Mesh(new THREE.BoxGeometry(c.radius * 0.6, c.radius * 0.6, c.radius * 2), mat)
    hull.rotation.set(rand() * 3, rand() * 3, rand() * 3)
    group.add(hull)
  }
  group.position.copy(c.position)
  return group
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose()
  })
}

function applyEngineGlowStyle(glows: CraftEngineGlow[], style: EngineGlowStyle): void {
  for (const glow of glows) {
    const mat = glow.mesh.material
    const isCore = glow.role === 'core'
    mat.color.setHex(isCore ? 0xffffff : style.color)
    mat.color.multiplyScalar(isCore ? style.coreIntensity : style.discIntensity)
    mat.opacity = isCore ? style.coreOpacity : style.discOpacity
    glow.mesh.scale.setScalar(style.scale * (isCore ? 0.92 : 1))
  }
}

function streamCelestials(now: number): void {
  if (now - lastStream < 800) return
  lastStream = now
  if (ship.position.distanceToSquared(lastStreamPos) < STREAM_MOVE_THRESHOLD_SQ) return // parked/rotating — no change possible
  lastStreamPos.copy(ship.position)
  const nearby = queryCelestials(ship.position, STREAM_RADIUS)
  const liveIds = new Set(nearby.map((c) => c.id))
  for (const [id, mesh] of spawnedBodies) {
    if (!liveIds.has(id)) {
      scene.remove(mesh)
      disposeObject(mesh)
      spawnedBodies.delete(id)
    }
  }
  // Drop queued builds and collision shells that left the radius before we got to them.
  for (const id of pendingBuild.keys()) {
    if (!liveIds.has(id)) pendingBuild.delete(id)
  }
  for (const id of solidBodies.keys()) {
    if (!liveIds.has(id)) solidBodies.delete(id)
  }
  // Enqueue new bodies; the actual (expensive) build is amortized in processCelestialBuilds().
  // Solid bodies get a collision shell now (build-independent) so they're never pass-through.
  for (const c of nearby) {
    if (!spawnedBodies.has(c.id) && !pendingBuild.has(c.id)) pendingBuild.set(c.id, c)
    if (isSolidCelestial(c.type) && !solidBodies.has(c.id)) solidBodies.set(c.id, { position: c.position, radius: c.radius })
  }
}

// Build a few queued celestials per frame. Spreading the synchronous mesh+texture generation across
// frames keeps a burst of new bodies from freezing a single frame. Called every frame.
function processCelestialBuilds(): void {
  if (pendingBuild.size === 0) return
  let built = 0
  // Build the NEAREST pending bodies first, so what you're flying toward renders before you reach it.
  const queue = [...pendingBuild.values()].sort((a, b) =>
    a.position.distanceToSquared(ship.position) - b.position.distanceToSquared(ship.position))
  for (const c of queue) {
    if (built >= CELESTIAL_BUILD_BUDGET) break
    pendingBuild.delete(c.id)
    if (spawnedBodies.has(c.id)) continue
    const mesh = buildCelestial(c)
    scene.add(mesh)
    spawnedBodies.set(c.id, mesh)
    built++
  }
  // Once the burst is fully built, warm up the new shaders off the main thread so they don't hitch when
  // first rotated into view. compileAsync skips already-compiled programs, so this stays cheap.
  if (built > 0 && pendingBuild.size === 0) void renderer.compileAsync(scene, camera).catch(() => { /* best-effort */ })
}

// --- Player & hangar
const PLAYER_TINT = 0x4f8a5f
const SHIP_PRICES: Record<ShipType, number> = { hauler: 0, fighter: 3000, miner: 4000, interceptor: 6000 }

function loadHangar(): { selected: ShipType; owned: ShipType[] } {
  try {
    const raw = localStorage.getItem('scc.hangar.v1')
    if (raw) {
      const p = JSON.parse(raw)
      const owned: ShipType[] = Array.isArray(p?.owned) ? p.owned.filter((t: string) => t in SHIP_STATS) : ['hauler']
      const selected: ShipType = (p?.selected in SHIP_STATS) ? p.selected : 'hauler'
      if (!owned.includes('hauler')) owned.push('hauler')
      return { selected: owned.includes(selected) ? selected : 'hauler', owned }
    }
  } catch { /* fall through */ }
  return { selected: 'hauler', owned: ['hauler'] }
}
const hangar = loadHangar()
let selectedShipType: ShipType = hangar.selected
const ownedShips = new Set<ShipType>(hangar.owned)
let shipLoadSeq = 0
function saveHangar(): void {
  try {
    localStorage.setItem('scc.hangar.v1', JSON.stringify({ selected: selectedShipType, owned: [...ownedShips] }))
  } catch { /* ignore */ }
}

// Scatter spawns near the origin so pilots don't all stack on the same point (#1).
// Well inside the 1600 safe-zone radius, so you never spawn into pirates.
function randomSpawn(): THREE.Vector3 {
  if (CAPTURE_OG) return new THREE.Vector3(320, -18, 220)
  if (SHOWCASE_TIME_TRIAL) return timeTrialShowcaseApproachPoint(260)
  if (SHOWCASE_HOLDER) return new THREE.Vector3(220, -18, 120)
  const a = Math.random() * Math.PI * 2
  const r = 200 + Math.random() * 400 // 200–600: visibly different, still well inside the 1600 safe zone
  return new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 100, Math.sin(a) * r)
}
const _spawnUp = new THREE.Vector3(0, 1, 0)
const _spawnMat = new THREE.Matrix4()
const _showcaseAway = new THREE.Vector3()
const _flightPlanSpawnDir = new THREE.Vector3()

const ship = createShipState(randomSpawn())
function faceTarget(target: THREE.Vector3): void {
  _spawnMat.lookAt(ship.position, target, _spawnUp)
  ship.quaternion.setFromRotationMatrix(_spawnMat)
}
/** Aim the ship at the refinery on spawn, so new pilots open on somewhere to go. */
function faceRefinery(): void {
  faceTarget(SHOWCASE_HOLDER
    ? _showcaseAway.copy(ship.position).sub(SUN_POSITION).normalize().add(ship.position)
    : SHOWCASE_TIME_TRIAL
      ? hubTimeTrialGates[0].position
      : REFINERY_POS)
}
faceRefinery()
let shipMesh = buildCraft(selectedShipType, PLAYER_TINT)
scene.add(shipMesh)

const blackHoleVisual = buildBlackHole()
scene.add(blackHoleVisual.group)
const blackHoleEl = document.getElementById('black-hole') as HTMLElement
const singularityFlashEl = document.getElementById('singularity-flash') as HTMLElement
let bhShake = 0 // camera-shake trauma (0..1) from black-hole proximity / capture, decays each frame
let bhPressure = 0 // audio rumble intensity (0..1) while within the black hole's influence
const blackHoleRun = createBlackHoleRun()
const pilot = loadPilot(localStorage)
const campaign = loadCampaign(localStorage)
let namedRaiderActive = false // guards against double-spawning the campaign's named miniboss

// Raise the hull cap to the current level's bonus and heal exactly the gained amount, so a level-up
// is felt immediately. Safe to call when nothing changed (delta 0 → no heal).
function applyLevelHull(): void {
  const prevMax = playerHealth.max
  playerHealth.max = effMaxHull()
  if (playerHealth.max > prevMax) playerHealth.hull += playerHealth.max - prevMax
}

// Apply Pilot-Level XP and announce any level-ups. (showPromotion is hoisted, so it's visible here.)
function awardPilotXp(amount: number): void {
  const r = addXp(pilot, amount)
  pilot.level = r.progress.level
  pilot.xp = r.progress.xp
  if (r.leveledUp.length) {
    showPromotion(`Pilot Level ${pilot.level}`)
    applyLevelHull()
  }
}

// Grant a completed campaign step's rewards (XP + credits + the sector-unlock banner). Shared by the
// kill hook AND the mining tick so EVERY step that completes pays out — not just combat steps.
function applyCampaignAdvance(adv: CampaignAdvance, now: number): void {
  if (!adv.completed) return
  awardPilotXp(adv.completed.xpReward)
  gainCredits(econ, adv.completed.creditReward)
  if (adv.completed.unlockSector) {
    registerKillBanner(combatFeedback, `SECTOR ${adv.completed.unlockSector} UNLOCKED`, 'new space charted', now)
  }
}

let playerEngineGlows: CraftEngineGlow[] = collectCraftEngineGlows(shipMesh)
let playerCosmetics: ShipCosmetics = createShipCosmetics(shipMesh, scene)
function applyPlayerCosmetics(): void {
  if (BOT) {
    // BOT mode forces a fixed showcase loadout. Route it through the one apply path so the local ship
    // keeps it across every hull rebuild (setPlayerCraft + the async GLB load both call this).
    playerCosmetics.apply(decodeCosmetics(BOT_COSMETICS))
    net.setCosmetics(BOT_COSMETICS)
    return
  }
  playerCosmetics.apply(equippedStyles(crafting))
  net.setCosmetics(encodeEquipped(crafting))
}

// --- Mining VFX: cyan laser beam + impact glow + floating +ORE text
const beamMat = new THREE.MeshBasicMaterial({
  color: 0x6fe8ff, transparent: true, opacity: 0.55,
  blending: THREE.AdditiveBlending, depthWrite: false,
})
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.7, 1, 6, 1, true), beamMat)
beam.visible = false
const impactMat = new THREE.MeshBasicMaterial({
  color: 0xaef6ff, transparent: true, opacity: 0.8,
  blending: THREE.AdditiveBlending, depthWrite: false,
})
const impact = new THREE.Mesh(new THREE.SphereGeometry(3.5, 10, 10), impactMat)
impact.visible = false
scene.add(beam, impact)
const oreFloats: { obj: CSS2DObject; born: number }[] = []
let oreAccum = 0
let lastFloat = 0
const _beamUp = new THREE.Vector3(0, 1, 0)
const _beamDir = new THREE.Vector3()

// --- Combat state
const playerHealth = createHealth(SHIP_STATS[selectedShipType].hull)
const playerWeapon = createWeapon(0.16)
const projectiles: Projectile[] = []
const projectileMeshes = new Map<Projectile, THREE.Mesh>()
const pirates: Pirate[] = []
const pirateMeshes = new Map<string, THREE.Group>()
// Enemy readouts (hull bar + tier/name) for ELITE & NAMED pirates only — grunts get nothing.
// Keyed by pirate.id and added directly to the scene (NOT as a child of the placeholder mesh),
// so they survive the async placeholder→GLB swap in addPirate. Position is synced each frame.
const pirateLabels = new Map<string, CSS2DObject>()
const trainingDrones: TrainingDrone[] = []
const trainingDroneMeshes = new Map<string, THREE.Group>()
const trainingDroneWrecks: { mesh: THREE.Group; born: number; velocity: THREE.Vector3; spin: THREE.Vector3 }[] = []
const combatFeedback = createCombatFeedbackState()

// --- Loot: glowing crates dropped by pirates / floating in space. Magnet-collect for credits.
interface Loot { mesh: THREE.Group; value: number; rare: boolean }
const lootCrates: Loot[] = []
const LOOT_MAGNET = 70 // crates start drifting toward you within this range
const LOOT_PICKUP = 14 // collected within this range
let lastTreasure = 0
function spawnLoot(pos: THREE.Vector3): void {
  const rare = Math.random() < 0.12
  const value = rare ? 500 : 60 + Math.floor(Math.random() * 140)
  const mesh = buildLootCrate(rare)
  mesh.position.copy(pos)
  scene.add(mesh)
  lootCrates.push({ mesh, value, rare })
}
const explosions: { mesh: THREE.Mesh; born: number }[] = []
const hitSparks: { mesh: THREE.Mesh; born: number }[] = []
let weaponActive = false
let pirateSpawnCount = 0
let nextSpawnAt = Infinity
const MAX_PIRATES = 2
const _fwd = new THREE.Vector3()

// Safe zones — no pirates near the hand-placed outposts. Trade routes between them are risky;
// arriving at a station means you can breathe.
const SAFE_RADIUS = 1600
const SAFE_ANCHORS = [new THREE.Vector3(0, 0, 0), REFINERY_POS, COLONY_POS, CITIZEN_SEASON_HUB_DESTINATION.position]
const SAFE_REPAIR_DELAY_MS = 2000
const SAFE_REPAIR_RATE_PER_SEC = 0.16
let safeRepairEnteredAt: number | null = null
let lastPlayerDamageAt = -Infinity
let lastPvpCombatAt = -Infinity
const PVP_COMBAT_TAG_MS = 10000 // mirror of the server's pursuit window
function inSafeZone(pos: THREE.Vector3): boolean {
  if (SAFE_ANCHORS.some((a) => pos.distanceToSquared(a) < SAFE_RADIUS * SAFE_RADIUS)) return true
  // Near a planet's surface, hostiles break off — descend to fly/admire in peace.
  // Reach scales with the body's radius so big and small worlds both feel safe at the surface.
  for (const p of [...PLANETS, SPAWN_PLANET]) {
    const reach = p.radius * 1.5 + SAFE_RADIUS
    if (pos.distanceToSquared(p.position) < reach * reach) return true
  }
  return false
}

// --- Quantum travel
const quantum = createQuantum()
const _qLook = new THREE.Vector3()
let jumpTargetName = '' // destination of the current jump (for the HUD)
let selectedJumpIdx = 0 // index into PLANETS (named solar system) — the quantum destination, cycled with [N]
interface QuantumDestination {
  id: string
  name: string
  kind: string
  position: THREE.Vector3
  radius?: number
  approachDistance?: number
}
let customJumpDestination: QuantumDestination | null = null

const _navDir = new THREE.Vector3()
function planetDestination(idx: number): QuantumDestination {
  const p = PLANETS[idx] ?? PLANETS[0]
  return {
    id: `planet.${p.name}`,
    name: p.name,
    kind: p.hasRings ? 'Ringed planet' : 'Planet',
    position: p.position.clone(),
    radius: p.radius,
  }
}

function pvpArenaDestination(idx: number): QuantumDestination {
  const dest = PVP_ARENA_DESTINATIONS[idx] ?? PVP_ARENA_DESTINATIONS[0]
  return {
    id: dest.id,
    name: dest.name,
    kind: dest.kind,
    position: dest.position.clone(),
    radius: dest.radius,
    approachDistance: dest.approachDistance,
  }
}

function pvpArenaDestinationIndex(id: string): number {
  return PVP_ARENA_DESTINATIONS.findIndex((dest) => dest.id === id)
}

function setQuantumDestinationById(id: string): boolean {
  const planetIdx = PLANETS.findIndex((p) => id === `planet.${p.name}` || id === p.name)
  if (planetIdx >= 0) {
    selectedJumpIdx = planetIdx
    customJumpDestination = null
    return true
  }
  const arenaIdx = pvpArenaDestinationIndex(id)
  if (arenaIdx >= 0) {
    if (MOBILE_COMPANION && id !== CITIZEN_SEASON_HUB_DESTINATION.id) return false
    selectedJumpIdx = PLANETS.length + arenaIdx
    customJumpDestination = null
    return true
  }
  return false
}

function activeQuantumDestination(): QuantumDestination {
  if (!customJumpDestination && selectedJumpIdx >= PLANETS.length) {
    return pvpArenaDestination(selectedJumpIdx - PLANETS.length)
  }
  return customJumpDestination ?? planetDestination(selectedJumpIdx)
}

function activeDestinationSnapshot(): SolarMapNavigationTarget {
  const dest = activeQuantumDestination()
  return {
    id: dest.id,
    name: dest.name,
    kind: dest.kind,
    worldPosition: dest.position.clone(),
    radius: dest.radius,
  }
}

/** Arrival point just OFF the selected target's surface (never inside it), plus its name + distance. */
function destinationArrival(dest = activeQuantumDestination()): { position: THREE.Vector3; name: string; dist: number } {
  if (pvpArenaDestinationIndex(dest.id) >= 0) {
    const approachDistance = dest.id === TRAINING_RANGE_DESTINATION.id
      ? Math.max((dest.radius ?? 0) * 0.45, 650)
      : dest.approachDistance
    const position = pvpArenaApproachPoint(ship.position, dest.position, approachDistance)
    return { position, name: dest.name, dist: ship.position.distanceTo(position) }
  }
  _navDir.copy(ship.position).sub(dest.position)
  if (_navDir.lengthSq() < 1) _navDir.set(0, 0, 1)
  _navDir.normalize()
  const standoff = dest.radius ? Math.max(dest.radius * 1.5, 650) : 0
  const position = dest.position.clone().addScaledVector(_navDir, standoff)
  return { position, name: dest.name, dist: ship.position.distanceTo(position) }
}

function quantumDestinationCount(): number {
  return PLANETS.length + (MOBILE_COMPANION ? 0 : PVP_ARENA_DESTINATIONS.length)
}

function cycleQuantumDestination(direction: 1 | -1 = 1): void {
  customJumpDestination = null
  selectedJumpIdx = cycleQuantumDestinationIndex(selectedJumpIdx, quantumDestinationCount(), direction)
  audio.blip('nav')
}

function toggleQuantumTravel(): void {
  if (!running || docked) return
  if (quantum.phase === 'idle') {
    const dest = destinationArrival()
    const started = startTravel(quantum, dest.position)
    if (started.ok) {
      jumpTargetName = dest.name
      audio.blip('nav')
    }
  } else {
    cancelTravel(quantum)
  }
}

// --- Browser autopilot (?bot=1): drive the quantum drive like a touring player
// Begin the TRANSIT phase: pick a new kind of stop, set the quantum destination to its region, and
// jump there. PERFORM begins automatically on drop-out (see the BOT branch in the frame loop).
function startBotTransit(): void {
  let kind = botLastStop
  while (BOT_STOP_KINDS.length > 1 && kind === botLastStop) kind = BOT_STOP_KINDS[Math.floor(Math.random() * BOT_STOP_KINDS.length)]
  botLastStop = kind
  botStopKind = kind
  customJumpDestination = null
  if (kind === 'black-hole-dive') {
    customJumpDestination = { id: 'black-hole-approach', name: 'the black hole', kind: 'Singularity', position: BLACK_HOLE_APPROACH_DESTINATION.position.clone() }
  } else if (kind === 'race') {
    customJumpDestination = { id: 'season-hub', name: 'the Season Hub', kind: 'Hub', position: CITIZEN_SEASON_HUB_DESTINATION.position.clone() }
  } else if (kind === 'pvp-training') {
    customJumpDestination = { id: 'practice-arena', name: 'the arena', kind: 'Arena', position: BOT_WORLD.pvpArenaCenter.clone() }
  } else {
    selectedJumpIdx = Math.floor(Math.random() * PLANETS.length) // a planet to fly by
  }
  net.sendChat(`Quantum jump to ${destinationArrival().name}.`)
  toggleQuantumTravel() // spool + warp, exactly as a player pressing J
  if (quantum.phase !== 'idle') {
    botPhase = 'transit' // the jump started; arrival = back to idle
  } else {
    // jump didn't start (e.g. already there) — drop into a short planet-style dwell and retry next tick
    botPhase = 'perform'; botActivity = null; botStopKind = 'planet'; botDwellUntil = 0
  }
}

function setQuantumDestinationFromAtlas(target: SolarMapNavigationTarget): SolarMapDestinationResult {
  if (target.id === 'player' || target.id === 'sun' || target.id.startsWith('peer.')) {
    return { ok: false, reason: 'moving or reference-only target' }
  }
  const planetIdx = PLANETS.findIndex((p) => target.id === `planet.${p.name}` || target.name === p.name)
  if (planetIdx >= 0) {
    selectedJumpIdx = planetIdx
    customJumpDestination = null
    return { ok: true }
  }
  const arenaIdx = pvpArenaDestinationIndex(target.id)
  if (arenaIdx >= 0) {
    // Mobile companion can't enter PvP/black-hole arenas, but the Season Hub is allowed (matches
    // setQuantumDestinationById). Without this exception, clicking the hub marker on mobile rejects.
    if (MOBILE_COMPANION && target.id !== CITIZEN_SEASON_HUB_DESTINATION.id) {
      return { ok: false, reason: 'PvP beacons are desktop-only' }
    }
    selectedJumpIdx = PLANETS.length + arenaIdx
    customJumpDestination = null
    return { ok: true }
  }
  if (target.worldPosition.distanceTo(ship.position) < QUANTUM_TUNING.minTravelDistance) {
    return { ok: false, reason: 'target too close for quantum' }
  }
  customJumpDestination = {
    id: target.id,
    name: target.name,
    kind: target.kind,
    position: target.worldPosition.clone(),
    radius: target.radius,
  }
  return { ok: true }
}

/** Index of the closest named planet — seeds the selection so the first jump is sensible. */
function nearestPlanetIdx(): number {
  let idx = 0, bestD = Infinity
  for (let i = 0; i < PLANETS.length; i++) {
    const d = PLANETS[i].position.distanceToSquared(ship.position)
    if (d < bestD) { bestD = d; idx = i }
  }
  return idx
}

function updateSafeRepair(safe: boolean, pvpActive: boolean, now: number, dt: number): boolean {
  const peacefulSafe = safe && !pvpActive && !weaponActive
  if (!peacefulSafe) {
    safeRepairEnteredAt = null
    return false
  }
  if (safeRepairEnteredAt === null) safeRepairEnteredAt = now
  if (playerHealth.hull >= playerHealth.max) return false
  const repairReadyAt = Math.max(safeRepairEnteredAt, lastPlayerDamageAt) + SAFE_REPAIR_DELAY_MS
  if (now < repairReadyAt) return false
  repairHull(playerHealth, playerHealth.max * SAFE_REPAIR_RATE_PER_SEC * dt)
  return playerHealth.hull < playerHealth.max
}

const _toShip = new THREE.Vector3()
const _t1 = new THREE.Vector3()
const _t2 = new THREE.Vector3()
const _probe = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
// Angular offsets (× probe radius) sampled around the ship's footprint to catch nearby peaks.
const PROBE_OFFSETS: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]
/** Keep the ship above surfaces. Nearby solid planets clamp to the *sampled terrain height*
 *  under the ship (low flight over hills & valleys); the sun, gas giants and distant bodies
 *  use a fast spherical clamp. Inward velocity is killed so you slide along the surface. */
function resolvePlanetCollisions(): void {
  const hit = (cx: number, cy: number, cz: number, radius: number, surface?: SurfaceKind, seed = 0, color = 0x999999): void => {
    _toShip.set(ship.position.x - cx, ship.position.y - cy, ship.position.z - cz)
    const dist = _toShip.length()
    if (dist <= 1e-3) return
    _toShip.multiplyScalar(1 / dist) // surface normal
    let minDist: number
    if (surface && surface !== 'gas' && surface !== 'venus' && dist < radius * 2.5) {
      // Low altitude: follow the real terrain. Sample under the ship AND a ring of nearby
      // points, clamp to the *highest* — otherwise a peak beside us (while our footprint sits
      // in a valley) is ignored and we fly through it. Height matches the close LOD mesh
      // (height × radius × 0.055 × dispScale[=1.6]); a small clearance keeps us just above.
      _t1.crossVectors(_toShip, _up)
      if (_t1.lengthSq() < 1e-6) _t1.set(1, 0, 0) // over a pole — any tangent works
      _t1.normalize()
      _t2.crossVectors(_toShip, _t1).normalize()
      const off = 0.012 // angular probe radius around the ship's footprint
      let maxH = samplePlanetSurface(surface, seed, _toShip.x, _toShip.y, _toShip.z, color, radius).height
      for (const [a, b] of PROBE_OFFSETS) {
        _probe.copy(_toShip).addScaledVector(_t1, a * off).addScaledVector(_t2, b * off).normalize()
        const h = samplePlanetSurface(surface, seed, _probe.x, _probe.y, _probe.z, color, radius).height
        if (h > maxH) maxH = h
      }
      minDist = radius + maxH * radius * 0.055 * 1.6 + radius * 0.004 + 6
    } else {
      minDist = radius * 1.06 + 30 // sun / gas giants / distant: fast spherical clamp
    }
    if (dist < minDist) {
      ship.position.set(cx, cy, cz).addScaledVector(_toShip, minDist)
      const vn = ship.velocity.dot(_toShip)
      if (vn < 0) ship.velocity.addScaledVector(_toShip, -vn)
    }
  }
  hit(SUN_POSITION.x, SUN_POSITION.y, SUN_POSITION.z, SUN_RADIUS)
  for (const p of PLANETS) hit(p.position.x, p.position.y, p.position.z, p.radius, p.surface, p.seed, p.color)
  hit(SPAWN_PLANET.position.x, SPAWN_PLANET.position.y, SPAWN_PLANET.position.z, SPAWN_PLANET.radius)
  // Procedural galaxy planets/moons: fast spherical clamp (no surface data, so no terrain follow).
  for (const b of solidBodies.values()) resolveSphereCollision(ship.position, ship.velocity, b.position, b.radius)
}

// Capital ship hull — fit collision spheres along the longest axis of the *actual* bounding box,
// so it works for both the procedural hull and any GLB regardless of its scale or modelled axis.
const _capWorld = new THREE.Vector3()
function fitCapitalColliders(root: THREE.Group): CapitalCollider[] {
  // Measure in the parent's local space: zero out transform, get bounds, restore.
  const box = new THREE.Box3()
  const size = new THREE.Vector3()
  const ctr = new THREE.Vector3()
  const savedPos = root.position.clone()
  const savedQuat = root.quaternion.clone()
  root.position.set(0, 0, 0)
  root.quaternion.identity()
  root.updateMatrixWorld(true)
  box.setFromObject(root)
  root.position.copy(savedPos)
  root.quaternion.copy(savedQuat)
  root.updateMatrixWorld(true)
  if (box.isEmpty()) return []
  box.getSize(size)
  box.getCenter(ctr)
  const dims = [size.x, size.y, size.z]
  let axis = 0 // longest axis = the hull's spine
  if (dims[1] > dims[axis]) axis = 1
  if (dims[2] > dims[axis]) axis = 2
  const len = dims[axis]
  const r = (dims[(axis + 1) % 3] + dims[(axis + 2) % 3]) * 0.25 + len * 0.04 // cross-section radius
  const cols: { p: THREE.Vector3; r: number }[] = []
  const n = 5
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5 // -0.5..0.5 along the spine
    const p = ctr.clone()
    p.setComponent(axis, ctr.getComponent(axis) + t * len * 0.8)
    cols.push({ p, r })
  }
  return cols
}
function resolveCapitalCollision(): void {
  for (const setpiece of capitalSetpieces) {
    for (const c of setpiece.colliders) {
      _capWorld.copy(c.p)
      setpiece.root.localToWorld(_capWorld) // local hull point → world (follows each ship's rotation/drift)
      _toShip.subVectors(ship.position, _capWorld)
      const dist = _toShip.length()
      if (dist < c.r && dist > 1e-3) {
        _toShip.multiplyScalar(1 / dist)
        ship.position.copy(_capWorld).addScaledVector(_toShip, c.r)
        const vn = ship.velocity.dot(_toShip)
        if (vn < 0) ship.velocity.addScaledVector(_toShip, -vn) // kill inward velocity → slide
      }
    }
  }
}

const boltGeo = new THREE.SphereGeometry(0.4, 8, 8)
const boltHaloGeo = new THREE.SphereGeometry(0.85, 8, 8)
const explosionGeo = new THREE.SphereGeometry(1, 10, 10)
const _projectileLookAt = new THREE.Vector3()

// Per-ship-type bolt colors (player); pirates fire warm orange. Friendly hulls read cool/bright,
// hostiles read orange — so you can tell incoming fire apart at a glance.
const BOLT_COLORS: Record<ShipType, number> = {
  hauler: 0x8ff0ff, fighter: 0xffd23a, miner: 0xaef67a, interceptor: 0xc08aff,
}
const boltMatCache = new Map<string, THREE.MeshBasicMaterial>()
function boltMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  const key = `${color}:${opacity}`
  let m = boltMatCache.get(key)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
    boltMatCache.set(key, m)
  }
  return m
}

function makeBolt(faction: 'player' | 'pirate'): THREE.Mesh {
  const color = faction === 'player' ? BOLT_COLORS[selectedShipType] : 0xff7b4a
  // Bright additive core + soft halo → bloom turns it into a glowing plasma tracer (not a flat dot).
  const core = new THREE.Mesh(boltGeo, boltMat(color, 1))
  core.scale.set(1.1, 1.1, 4.2) // elongated tracer; z aligns to travel via lookAt
  const halo = new THREE.Mesh(boltHaloGeo, boltMat(color, 0.4))
  halo.scale.set(1.45, 1.45, 2.35)
  core.add(halo)
  return core
}

function spawnExplosion(pos: THREE.Vector3, now: number): void {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffb347, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const mesh = new THREE.Mesh(explosionGeo, mat)
  mesh.position.copy(pos)
  scene.add(mesh)
  explosions.push({ mesh, born: now })
}

function spawnHitSpark(pos: THREE.Vector3, now: number, color = 0xfff2a8): void {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), mat)
  mesh.position.copy(pos)
  scene.add(mesh)
  hitSparks.push({ mesh, born: now })
}

function damageFlash(): void {
  flashEl.style.opacity = '0.55'
  setTimeout(() => { flashEl.style.opacity = '0' }, 130)
}

/** Bright collapse flash that fades to the void — the singularity death cue. */
function singularityFlash(): void {
  singularityFlashEl.style.opacity = '1'
  setTimeout(() => { singularityFlashEl.style.opacity = '0' }, 240)
}

/** Black-hole destruction: wipe cargo + full death drama + respawn. Triggered by crossing the
 *  horizon OR by the hull bleeding to zero in the tidal zone. */
function singularityDeath(now: number): void {
  econ.cargo.ORE = 0
  econ.cargo.ALLOY = 0
  bhShake = 1
  singularityFlash()
  addChatLine('BLACK HOLE', 'Consumed by the singularity — cargo lost to the void.', 3)
  dieRun(blackHoleRun)
  // Death drama (explosion at the point of destruction) ...
  spawnExplosion(ship.position, now)
  audio.blip('explosion')
  damageFlash()
  // ... then respawn just OUTSIDE the influence radius, facing the hole, so a re-dive is immediate
  // (no flight back across the system + re-jump). Mirrors respawnPlayer's hull/credit penalty.
  playerHealth.hull = playerHealth.max
  econ.credits = Math.max(0, econ.credits - 100)
  placePlayerAt(BLACK_HOLE_APPROACH_DESTINATION.position.clone(), BLACK_HOLE_CENTER.clone())
  refreshWallet()
}

/** Jitter the camera by the current black-hole trauma, then decay it. Call once per frame. */
function applyBlackHoleShake(dt: number): void {
  if (bhShake <= 0.0001) { bhShake = 0; return }
  const amp = bhShake * bhShake * 200
  camera.position.x += (Math.random() - 0.5) * amp
  camera.position.y += (Math.random() - 0.5) * amp
  camera.position.z += (Math.random() - 0.5) * amp
  bhShake = Math.max(0, bhShake - dt * 1.6)
}

// Per-tier visual identity: elites read as a bigger, charged threat; named (minibosses) bigger still
// and hotter. Applied to BOTH the placeholder hull and the swapped-in GLB so the tier stays readable
// after the async model load (the GLB has no inherent tier colour of its own).
const TIER_SCALE: Record<PirateTier, number> = { grunt: 1, elite: 1.25, named: 1.8 }
const TIER_EMISSIVE: Record<PirateTier, number | null> = { grunt: null, elite: 0xff7a1a, named: 0xff3b2f }

// Tint every MeshStandardMaterial in `obj` with a "charged/dangerous" emissive glow. loadPirateModel
// returns a fresh clone with per-instance materials (cloneCraftModelInstance in shipyard clones every
// mesh's material), so tinting in place affects ONLY this pirate — no cross-instance/player bleed.
function tintModel(obj: THREE.Object3D, hex: number): void {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material
    if (!m) return
    const mats = Array.isArray(m) ? m : [m]
    for (const mat of mats) {
      if ('emissive' in mat) {
        const std = mat as THREE.MeshStandardMaterial
        std.emissive.setHex(hex)
        std.emissiveIntensity = 0.6
      }
    }
  })
}

// Register a freshly-spawned pirate: track it, add its placeholder mesh, then swap in the GLB model.
// Shared by the wave spawner and the campaign's named-raider spawner. (Mesh code lifted verbatim from
// the old spawnPirateWave body, with tier-based color/scale/emissive so elites and minibosses read distinct.)
function addPirate(pirate: Pirate, pos: THREE.Vector3): void {
  pirates.push(pirate)
  const scale = TIER_SCALE[pirate.tier]
  const emissive = TIER_EMISSIVE[pirate.tier]
  const mesh = buildCraft('interceptor', pirate.tier === 'grunt' ? 0xc0392b : 0xff7a1a)
  mesh.scale.multiplyScalar(scale) // elites bigger, minibosses biggest
  if (emissive !== null) tintModel(mesh, emissive)
  mesh.position.copy(pos)
  scene.add(mesh)
  pirateMeshes.set(pirate.id, mesh)
  // ELITE & NAMED pirates carry a floating threat readout (tier/name + hull bar). Grunts get nothing.
  // The label is added to the scene (not the mesh) so it survives the placeholder→GLB swap below;
  // its position is synced to pirate.position each frame in the pirate update loop.
  if (pirate.tier === 'elite' || pirate.tier === 'named') {
    const el = document.createElement('div')
    el.className = pirate.tier === 'named' ? 'enemyplate named' : 'enemyplate'
    enemyLabelParts(el).name.textContent = pirate.tier === 'named' ? (pirate.name ?? 'RAIDER').toUpperCase() : 'ELITE'
    const labelObj = new CSS2DObject(el)
    labelObj.position.copy(pos)
    labelObj.position.y += 3.2 * scale
    scene.add(labelObj)
    pirateLabels.set(pirate.id, labelObj)
  }
  loadPirateModel().then((model) => {
    if (!model) return
    if (pirateMeshes.get(pirate.id) !== mesh) { disposeObject(model); return }
    model.position.copy(mesh.position)
    model.quaternion.copy(mesh.quaternion)
    model.scale.multiplyScalar(scale)
    if (emissive !== null) tintModel(model, emissive) // re-apply on the swapped GLB so the tier persists
    scene.remove(mesh)
    disposeObject(mesh)
    scene.add(model)
    pirateMeshes.set(pirate.id, model)
  })
}

function spawnPirateWave(now: number): void {
  const depth = deepFactor()
  if (pirates.length >= MAX_PIRATES + Math.round(depth * 2)) return // up to +2 more in deep space
  if (inSafeZone(ship.position)) return
  if (withinInfluence(ship.position)) return // no pirates near the black hole — it's a solo skill run
  if (!allowsPveHostiles(ship.position, MOBILE_COMPANION)) return
  const pos = spawnPositionAround(ship.position, 600, pirateSpawnCount++)
  // Deeper space: tankier pirates worth a bigger bounty. 25% of waves are elites.
  const elite = Math.random() < 0.25
  const tier = elite ? ('elite' as const) : ('grunt' as const)
  const hullMul = (elite ? PIRATE_TIER_HULL_MUL.elite : 1) * (1 + depth * 1.6)
  const reward = Math.round((elite ? PIRATE_TIER_REWARD.elite : PIRATE_REWARD) * (1 + depth * 2))
  addPirate(spawnPirate(`pir-${pirateSpawnCount}`, pos, { hullMul, reward, tier }), pos)
  void now
}

// Spawn the named raider for the active campaign step (Vex Marrow, then the heavier Raider Captain),
// once at a time. Killing it advances the chain (kill_named) and clears namedRaiderActive.
function maybeSpawnNamedRaider(now: number): void {
  if (namedRaiderActive) return
  const step = currentCampaignStep(campaign)
  if (!step || step.counter !== 'kill_named') return
  if (inSafeZone(ship.position)) return
  if (withinInfluence(ship.position)) return // no pirates near the black hole — keep the solo dive clean
  const captain = step.id === 's1-captain'
  const name = captain ? 'Raider Captain' : 'Vex Marrow'
  // Intentionally bypasses the MAX_PIRATES count cap — the campaign miniboss must always appear.
  const pos = spawnPositionAround(ship.position, 700, pirateSpawnCount++)
  addPirate(spawnPirate(`named-${campaign.step}`, pos, {
    tier: 'named', name,
    hullMul: captain ? 12 : PIRATE_TIER_HULL_MUL.named,
    reward: PIRATE_TIER_REWARD.named,
  }), pos)
  namedRaiderActive = true
  registerKillBanner(combatFeedback, `INCOMING: ${name.toUpperCase()}`, 'named raider', now)
}

function respawnPlayer(now: number): void {
  spawnExplosion(ship.position, now)
  audio.blip('explosion')
  damageFlash()
  ship.position.copy(randomSpawn())
  faceRefinery()
  ship.velocity.set(0, 0, 0)
  playerHealth.hull = playerHealth.max
  lastPvpCombatAt = -Infinity // respawn clears the combat tag (matches the server's applyPvpRespawn)
  econ.credits = Math.max(0, econ.credits - 100)
  refreshWallet()
}

function syncProjectileMeshes(): void {
  const live = new Set(projectiles)
  for (const [proj, mesh] of projectileMeshes) {
    if (!live.has(proj)) {
      scene.remove(mesh)
      projectileMeshes.delete(proj)
    }
  }
  for (const proj of projectiles) {
    let mesh = projectileMeshes.get(proj)
    if (!mesh) {
      mesh = makeBolt(proj.faction === 'pirate' ? 'pirate' : 'player')
      scene.add(mesh)
      projectileMeshes.set(proj, mesh)
    }
    mesh.position.copy(proj.position)
    if (proj.velocity.lengthSq() > 1e-6) mesh.lookAt(_projectileLookAt.copy(proj.position).add(proj.velocity))
  }
}

function updateExplosions(now: number): void {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i]
    const age = (now - e.born) / 650
    if (age >= 1) {
      scene.remove(e.mesh)
      explosions.splice(i, 1)
      continue
    }
    e.mesh.scale.setScalar(2 + age * 20)
    ;(e.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - age)
  }
}

function updateHitSparks(now: number): void {
  for (let i = hitSparks.length - 1; i >= 0; i--) {
    const spark = hitSparks[i]
    const age = (now - spark.born) / 260
    if (age >= 1) {
      scene.remove(spark.mesh)
      disposeObject(spark.mesh)
      hitSparks.splice(i, 1)
      continue
    }
    spark.mesh.scale.setScalar(1 + age * 3.2)
    ;(spark.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - age)
  }
}

function updateTrainingDroneWrecks(now: number, dt: number): void {
  for (let i = trainingDroneWrecks.length - 1; i >= 0; i--) {
    const wreck = trainingDroneWrecks[i]
    const age = (now - wreck.born) / 820
    if (age >= 1) {
      scene.remove(wreck.mesh)
      disposeObject(wreck.mesh)
      trainingDroneWrecks.splice(i, 1)
      continue
    }
    wreck.mesh.position.addScaledVector(wreck.velocity, dt)
    wreck.velocity.multiplyScalar(Math.max(0, 1 - dt * 1.8))
    wreck.mesh.rotation.x += wreck.spin.x * dt
    wreck.mesh.rotation.y += wreck.spin.y * dt
    wreck.mesh.rotation.z += wreck.spin.z * dt
    wreck.mesh.scale.setScalar(0.72 * (1 - age * 0.65))
  }
}

// --- Game systems (main owns all state; modules are pure)
const econ = loadEconomy()
const crafting = loadCraftingState(localStorage)
let dailyState: DailyState = emptyDaily()
let dailyObjs: Objective[] = []
const dailyProgress = new Map<string, number>() // ephemeral per-session progress, keyed by objective id
let lastEarnedForDaily = 0                       // econ.earned watermark for the earn_credits objective
const upgrades = loadUpgrades()
// Career journey reads live progress only; persistence stays in existing economy, daily, crafting, and local flags.
const upgradeTotal = (): number => upgrades.tiers.cargo + upgrades.tiers.speed + upgrades.tiers.boost + upgrades.tiers.mining
const market = createMarket()
const contracts = generateContracts(20260614, OUTPOSTS)
const audio = new GameAudio()

interface RegionalAmbienceSelection {
  kind: RegionalAmbienceKind
  intensity: number
}

function proximityIntensity(distance: number, radius: number, floor = 0): number {
  return Math.max(floor, Math.min(1, 1 - distance / radius))
}

function currentRegionalAmbience(): RegionalAmbienceSelection {
  if (bhPressure > 0.02) return { kind: 'blackHole', intensity: Math.max(0.25, bhPressure) }
  const raceDist = ship.position.distanceTo(timeTrialOrigin)
  if (hubTimeTrial.active || raceDist < 4200) return { kind: 'race', intensity: hubTimeTrial.active ? 1 : proximityIntensity(raceDist, 4200, 0.22) }
  const pvpZone = pvpZoneAt(ship.position)
  if (pvpZone) return { kind: 'pvp', intensity: proximityIntensity(ship.position.distanceTo(pvpZone.center), pvpZone.radius, 0.45) }
  const hubDist = ship.position.distanceTo(CITIZEN_SEASON_HUB_DESTINATION.position)
  if (hubDist < 7200) return { kind: 'seasonHub', intensity: proximityIntensity(hubDist, 7200, 0.2) }
  if (miningActive) return { kind: 'mining', intensity: 0.55 }
  const spawnDist = Math.min(ship.position.distanceTo(REFINERY_POS), ship.position.distanceTo(COLONY_POS))
  if (spawnDist < 5200) return { kind: 'spawn', intensity: proximityIntensity(spawnDist, 5200, 0.18) }
  return { kind: 'deepSpace', intensity: 0.35 }
}

function applyAmbientVolume(selection: RegionalAmbienceSelection): RegionalAmbienceSelection {
  return { ...selection, intensity: selection.intensity * gameSettings.ambientVolume }
}

const dockTargets: DockTarget[] = [
  { id: 'refinery', position: REFINERY_POS },
  { id: 'colony', position: COLONY_POS },
  ...planetDockTargets,
]
let dockable: string | null = null
let docked = false
let miningActive = false
let lastSave = 0

// Effective stats = chosen craft's base + the delta the upgrade tiers add over a stock hauler.
const baseSpeed = SHIP_STATS.hauler.topSpeed
const baseBoost = SHIP_STATS.hauler.boostMultiplier
const baseCargo = SHIP_STATS.hauler.cargo
function effSpeed(): number { return SHIP_STATS[selectedShipType].topSpeed + (topSpeed(upgrades) - baseSpeed) }
function effBoost(): number { return SHIP_STATS[selectedShipType].boostMultiplier + (boostMultiplier(upgrades) - baseBoost) }
function effMaxHull(): number { return SHIP_STATS[selectedShipType].hull + unlocksForLevel(pilot.level).hullBonus }
function effCargo(): number {
  return Math.max(1, Math.round(SHIP_STATS[selectedShipType].cargo + (cargoCapacity(upgrades) - baseCargo)))
}

function setPlayerCraft(type: ShipType): void {
  playerCosmetics.dispose()
  scene.remove(shipMesh)
  disposeObject(shipMesh)
  shipMesh = buildCraft(type, PLAYER_TINT) // procedural hull shows immediately
  shipMesh.position.copy(ship.position)
  shipMesh.quaternion.copy(ship.quaternion)
  scene.add(shipMesh)
  playerEngineGlows = collectCraftEngineGlows(shipMesh)
  playerCosmetics = createShipCosmetics(shipMesh, scene)
  applyPlayerCosmetics()
  selectedShipType = type
  playerHealth.max = SHIP_STATS[type].hull + unlocksForLevel(pilot.level).hullBonus
  playerHealth.hull = playerHealth.max
  saveHangar()
  updateWalletHUD()
  // Upgrade to the generated GLB model if available (async; keeps the procedural hull on failure).
  const holderVisual = activeHolderShipVisual()
  const loadSeq = ++shipLoadSeq
  loadCraftModelForType(type, selfTier, holderVisual).then((model) => {
    if (!model || selectedShipType !== type || loadSeq !== shipLoadSeq) return // asset missing, or state changed mid-load
    playerCosmetics.dispose()
    scene.remove(shipMesh)
    disposeObject(shipMesh)
    addCraftEngineGlowRig(model, type)
    shipMesh = model
    shipMesh.position.copy(ship.position)
    shipMesh.quaternion.copy(ship.quaternion)
    scene.add(shipMesh)
    playerEngineGlows = collectCraftEngineGlows(shipMesh)
    playerCosmetics = createShipCosmetics(shipMesh, scene)
    applyPlayerCosmetics()
  })
}

function clearPirates(): void {
  for (const p of pirates) {
    removePirateMesh(p.id)
  }
  pirates.splice(0)
  namedRaiderActive = false // wiping all pirates includes any active miniboss — let it re-spawn
  for (let i = projectiles.length - 1; i >= 0; i--) {
    if (projectiles[i].faction === 'pirate') projectiles.splice(i, 1)
  }
}

function removePirateMesh(id: string): void {
  // Drop the enemy readout first so its CSS2D element never lingers in the DOM. Centralized here
  // because every pirate-removal path (kill, despawn, clearPirates) routes through removePirateMesh.
  const label = pirateLabels.get(id)
  if (label) {
    scene.remove(label)
    label.element.remove() // CSS2D label lives in the DOM — drop it or the bar lingers forever
    pirateLabels.delete(id)
  }
  const mesh = pirateMeshes.get(id)
  if (!mesh) return
  scene.remove(mesh)
  disposeObject(mesh)
  pirateMeshes.delete(id)
}

function ensureTrainingDrones(): void {
  if (trainingDrones.length >= TRAINING_DRONE_COUNT) return
  const candidates = createTrainingDrones(ship.position, TRAINING_DRONE_COUNT)
  for (const candidate of candidates) {
    if (trainingDrones.length >= TRAINING_DRONE_COUNT) break
    if (trainingDrones.some((drone) => drone.id === candidate.id)) continue
    trainingDrones.push(candidate)
    ensureTrainingDroneMesh(candidate)
  }
}

function ensureTrainingDroneMesh(drone: TrainingDrone): THREE.Group {
  let mesh = trainingDroneMeshes.get(drone.id)
  if (!mesh) {
    mesh = buildCraft('fighter', 0x58ddff)
    mesh.scale.setScalar(0.72)
    mesh.position.copy(drone.position)
    scene.add(mesh)
    trainingDroneMeshes.set(drone.id, mesh)
  }
  return mesh
}

function removeTrainingDroneMesh(id: string): void {
  const mesh = trainingDroneMeshes.get(id)
  if (!mesh) return
  scene.remove(mesh)
  disposeObject(mesh)
  trainingDroneMeshes.delete(id)
}

function destroyTrainingDroneMesh(id: string, now: number): void {
  const mesh = trainingDroneMeshes.get(id)
  if (!mesh) return
  trainingDroneMeshes.delete(id)
  trainingDroneWrecks.push({
    mesh,
    born: now,
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 90,
      55 + Math.random() * 45,
      (Math.random() - 0.5) * 90,
    ),
    spin: new THREE.Vector3(
      5 + Math.random() * 6,
      4 + Math.random() * 7,
      6 + Math.random() * 8,
    ),
  })
}

function clearTrainingDrones(): void {
  for (const drone of trainingDrones) removeTrainingDroneMesh(drone.id)
  trainingDrones.splice(0)
}

function updateWalletHUD(): void {
  creditsEl.textContent = String(Math.floor(econ.credits))
  cargoEl.textContent = `${Math.floor(cargoUsed(econ))}/${effCargo()}`
  const identity = hudShipIdentity(selectedShipType, selectedHolderShipVisual, selfTier)
  shipClassEl.textContent = identity.shipClass
  shipVisualEl.textContent = identity.visual ?? ''
  shipVisualEl.parentElement!.hidden = identity.visual === null
  // Rank: name + progress to next, with a one-shot promotion banner when it climbs.
  const rank = rankForCredits(econ.earned)
  rankNameEl.textContent = rank.bonus > 0 ? `Career ${rank.name} +${Math.round(rank.bonus * 100)}%` : `Career ${rank.name}`
  rankBarEl.style.width = `${Math.round(rankProgress(econ.earned) * 100)}%`
  const nxt = nextRank(rank)
  rankNextEl.textContent = nxt ? `NEXT ${nxt.name} (${nxt.min.toLocaleString()})` : 'MAX'
  if (lastRankIndex >= 0 && rank.index > lastRankIndex) showPromotion(rank.name)
  lastRankIndex = rank.index
  pilotLevelEl.textContent = `Lv ${pilot.level}`
  const need = xpForLevel(pilot.level)
  pilotXpBarEl.style.width = `${need === Infinity ? 100 : Math.min(100, Math.round((pilot.xp / need) * 100))}%`
  const u = unlocksForLevel(pilot.level)
  pilotBonusEl.textContent = (u.hullBonus > 0 || u.weaponDamageBonus > 0) ? `+${u.hullBonus} HULL · +${u.weaponDamageBonus} DMG` : ''
}

function currentProgress(): PlayerProgress {
  return {
    credits: econ.credits,
    earned: econ.earned,
    cargo: { ORE: econ.cargo.ORE, ALLOY: econ.cargo.ALLOY },
    upgrades: { cargo: upgrades.tiers.cargo, speed: upgrades.tiers.speed, boost: upgrades.tiers.boost, mining: upgrades.tiers.mining },
    hangar: { selected: selectedShipType, owned: [...ownedShips] },
    crafting: { cores: crafting.cores, items: [...crafting.items], equipped: crafting.equipped, pityCount: crafting.pityCount },
    daily: dailyState,
    pilot: { level: pilot.level, xp: pilot.xp },
    campaign: { step: campaign.step, progress: campaign.progress, sectorUnlocked: campaign.sectorUnlocked },
  }
}

function initDaily(nowMs: number): void {
  const today = dayKey(nowMs)
  if (dailyState.day !== today) {
    const roll = rollStreak(dailyState.streak, dailyState.lastStreakDay, today)
    if (roll.advanced) {
      dailyState.streak = roll.streak
      dailyState.lastStreakDay = today
      if (roll.reward > 0) {
        crafting.cores += roll.reward
        registerKillBanner(combatFeedback, `DAY ${roll.streak} STREAK`, `+${roll.reward} cores`, nowMs)
      }
    }
    dailyState.day = today
    dailyState.claimed = []
    dailyState.setBonusClaimed = false
    dailyProgress.clear()
  }
  dailyObjs = dailyObjectives(today)
  lastEarnedForDaily = econ.earned
}

function recordDailyEvent(kind: ObjectiveKind, amount: number, nowMs: number): void {
  const obj = dailyObjs.find((o) => o.kind === kind)
  if (!obj || dailyState.claimed.includes(obj.id)) return
  const next = (dailyProgress.get(obj.id) ?? 0) + amount
  dailyProgress.set(obj.id, next)
  if (next < obj.target) return
  dailyState.claimed.push(obj.id)
  crafting.cores += OBJECTIVE_REWARD
  registerKillBanner(combatFeedback, 'DAILY COMPLETE', `+${OBJECTIVE_REWARD} cores`, nowMs)
  if (dailyState.claimed.length >= 3 && !dailyState.setBonusClaimed) {
    dailyState.setBonusClaimed = true
    crafting.cores += SET_BONUS
    registerKillBanner(combatFeedback, 'ALL DAILIES DONE', `+${SET_BONUS} cores`, nowMs)
  }
  refreshWallet() // persists cores + the daily block via currentProgress()
}

function renderDailyPanel(nowMs: number): void {
  dailyObjsEl.innerHTML = dailyObjs.map((o) => {
    const done = dailyState.claimed.includes(o.id)
    const prog = Math.min(o.target, done ? o.target : (dailyProgress.get(o.id) ?? 0))
    const pct = Math.round((prog / o.target) * 100)
    return `<div class="obj${done ? ' done' : ''}">${done ? '✓ ' : ''}${o.label} `
      + `<span class="rw">+${OBJECTIVE_REWARD} cores</span> — ${prog}/${o.target}`
      + `<div class="bar"><i style="width:${pct}%"></i></div></div>`
  }).join('')
    + `<div class="bonus">All 3 done → <span class="rw">+${SET_BONUS} cores</span> bonus</div>`
  const streakReward = Math.min(dailyState.streak, STREAK_REWARD_CAP)
  dailyStreakEl.textContent = `🔥 Streak: ${dailyState.streak} day${dailyState.streak === 1 ? '' : 's'} · +${streakReward} core${streakReward === 1 ? '' : 's'}/day`
  const msToReset = (Date.parse(`${dayKey(nowMs)}T00:00:00Z`) + 86_400_000) - nowMs
  const h = Math.floor(msToReset / 3_600_000), m = Math.floor((msToReset % 3_600_000) / 60_000)
  dailyResetEl.textContent = `Resets in ${h}h ${m}m`
}

function applyServerProgress(p: PlayerProgress): void {
  econ.credits = p.credits
  econ.earned = p.earned ?? p.credits
  econ.cargo.ORE = p.cargo.ORE
  econ.cargo.ALLOY = p.cargo.ALLOY
  upgrades.tiers.cargo = p.upgrades.cargo
  upgrades.tiers.speed = p.upgrades.speed
  upgrades.tiers.boost = p.upgrades.boost
  upgrades.tiers.mining = p.upgrades.mining ?? 0
  const nextCrafting = normalizeCraftingState(p.crafting)
  crafting.cores = nextCrafting.cores
  crafting.items.splice(0, crafting.items.length, ...nextCrafting.items)
  crafting.equipped = nextCrafting.equipped
  crafting.pityCount = nextCrafting.pityCount
  if (p.pilot) { pilot.level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(p.pilot.level))); pilot.xp = Math.max(0, p.pilot.xp) }
  if (p.campaign) {
    campaign.step = Math.min(SECTOR1_CAMPAIGN.length, Math.max(0, p.campaign.step))
    campaign.progress = Math.max(0, p.campaign.progress)
    campaign.sectorUnlocked = Math.max(1, p.campaign.sectorUnlocked)
  }
  dailyState = p.daily ? { ...emptyDaily(), ...p.daily } : emptyDaily()
  initDaily(Date.now())
  ownedShips.clear()
  for (const t of p.hangar.owned) if (t in SHIP_STATS) ownedShips.add(t as ShipType)
  ownedShips.add('hauler')
  const sel = (p.hangar.selected in SHIP_STATS ? p.hangar.selected : 'hauler') as ShipType
  setPlayerCraft(ownedShips.has(sel) ? sel : 'hauler')
  saveEconomy(econ)
  saveUpgrades(upgrades)
  saveCraftingState(crafting, localStorage)
  saveHangar()
  updateWalletHUD()
}

function refreshWallet(): void {
  updateWalletHUD()
  saveEconomy(econ)
  saveUpgrades(upgrades)
  saveCraftingState(crafting, localStorage)
  savePilot(pilot, localStorage)
  saveCampaign(campaign, localStorage)
  net.saveProgress(currentProgress())
}

const stationMenu = new StationMenu({
  onChange: refreshWallet,
  onUndock: undock,
  // Hide the in-progress item from the inventory panel while the forge animates, so the
  // reveal isn't spoiled there either; cleared (null) on finish/cancel.
  onForgeChange: (id) => inventoryPanel.setHiddenItem(id),
  onContractDelivered: () => recordDailyEvent('deliver_contracts', 1, Date.now()),
})
document.body.appendChild(stationMenu.root)

// DEV-only crafting test helpers. Gated on import.meta.env.DEV, so this whole block is
// dead-code-eliminated from production builds (`npm run build`). In `npm run dev`, open the
// browser console: `dev.grant()` seeds credits + cores so you can spam-craft and watch the
// forge animation / pity ramp / legendary sting; `dev.setPity(20)` forces the next craft to
// hit the epic+ guarantee. Dock at a station first so the panel re-renders.
if (import.meta.env.DEV) {
  ;(window as unknown as { dev: Record<string, (...args: number[]) => void> }).dev = {
    grant(credits = 2_000_000, cores = 12) {
      econ.credits += credits
      econ.earned += credits
      crafting.cores += cores
      saveEconomy(econ)
      saveCraftingState(crafting, localStorage)
      updateWalletHUD()
      stationMenu.refresh()
      console.log(`[dev] +${credits} cr, +${cores} cores → ${econ.credits} cr, ${crafting.cores} cores (rank earned ${econ.earned})`)
    },
    setPity(n = 19) {
      crafting.pityCount = Math.max(0, Math.min(20, Math.floor(n)))
      saveCraftingState(crafting, localStorage)
      stationMenu.refresh()
      console.log(`[dev] pityCount = ${crafting.pityCount} (set 20 → next craft is guaranteed epic+)`)
    },
  }
  console.log('[dev] crafting test helpers: dev.grant(credits?=2e6, cores?=12), dev.setPity(n?=19)')
}
let marketplaceRows: MarketListing[] = []
let pendingTokenBuy: string | null = null

// In-app confirmation before the wallet prompt for $Citizen purchases: shows the buyer exactly
// what they'll pay (95% seller / 5% treasury) since Phantom's preview can be sparse for Token-2022.
const buyModalEl = document.getElementById('buy-modal') as HTMLElement | null
let buyConfirmListingId: string | null = null
const fmtCitizen = (n: number): string => `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} $Citizen`

function openBuyConfirm(listing: MarketListing): void {
  if (!buyModalEl) { startTokenBuy(listing.id); return } // modal markup missing — fall back to direct buy
  const total = listing.price
  const fee = Math.floor(total * 0.05 * 1e6) / 1e6
  const seller = Math.round((total - fee) * 1e6) / 1e6
  buyConfirmListingId = listing.id
  ;(buyModalEl.querySelector('#buy-modal-title') as HTMLElement).textContent = `${listing.item.variant}`
  ;(buyModalEl.querySelector('#buy-total') as HTMLElement).textContent = fmtCitizen(total)
  ;(buyModalEl.querySelector('#buy-seller') as HTMLElement).textContent = fmtCitizen(seller)
  ;(buyModalEl.querySelector('#buy-treasury') as HTMLElement).textContent = fmtCitizen(fee)
  buyModalEl.hidden = false
}

function closeBuyConfirm(): void {
  if (buyModalEl) buyModalEl.hidden = true
  buyConfirmListingId = null
}

function startTokenBuy(listingId: string): void {
  addChatLine('MARKET', 'Preparing on-chain payment…', selfTier)
  pendingTokenBuy = listingId
  net.requestMarketIntent(listingId)
}

buyModalEl?.querySelector('#buy-cancel')?.addEventListener('click', () => closeBuyConfirm())
buyModalEl?.querySelector('#buy-confirm')?.addEventListener('click', () => {
  const id = buyConfirmListingId
  closeBuyConfirm()
  if (id) startTokenBuy(id)
})

// A token payment is submitted on-chain by the wallet BEFORE the server confirms it. If the
// market-buy message never reaches the server (offline / tab closed), the buyer paid but never
// gets the item. Persist any in-flight (listingId, txSig) locally so we can resend on reconnect,
// and surface the signature so it's never silently lost.
const PENDING_BUYS_KEY = 'scc.pendingBuys'
function loadPendingBuys(): { listingId: string; txSig: string }[] {
  try { const v = JSON.parse(localStorage.getItem(PENDING_BUYS_KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function savePendingBuys(list: { listingId: string; txSig: string }[]): void {
  localStorage.setItem(PENDING_BUYS_KEY, JSON.stringify(list.slice(-10)))
}
function rememberPendingBuy(listingId: string, txSig: string): void {
  const list = loadPendingBuys()
  if (!list.some((p) => p.txSig === txSig)) { list.push({ listingId, txSig }); savePendingBuys(list) }
}
function clearPendingBuy(listingId: string): void {
  savePendingBuys(loadPendingBuys().filter((p) => p.listingId !== listingId))
}
function resendPendingBuys(): void {
  for (const p of loadPendingBuys()) net.buyMarketListing(p.listingId, p.txSig)
}

function refreshMarketplaceViews(): void {
  stationMenu.refresh()
  if (inventoryPanel.isOpen) inventoryPanel.render()
}

function requestMarketplaceRefresh(): void {
  net.requestMarketList()
}

function listCraftedItemForSale(itemId: string, price: number, currency: 'credits' | 'token'): void {
  if (!walletSession) {
    addChatLine('MARKET', 'Connect wallet to trade crafted items.', selfTier)
    return
  }
  refreshWallet()
  if (!net.createMarketListing(itemId, price, currency)) addChatLine('MARKET', 'Server unavailable. Listing not created.', selfTier)
}

function equipCraftedItem(itemId: string): void {
  equipCosmetic(crafting, itemId)
  saveCraftingState(crafting, localStorage)
  net.saveProgress(currentProgress())
  applyPlayerCosmetics()
  inventoryPanel.render()
}

function unequipCraftedSlot(slot: 'trail' | 'hull' | 'aura'): void {
  unequipCosmetic(crafting, slot)
  saveCraftingState(crafting, localStorage)
  net.saveProgress(currentProgress())
  applyPlayerCosmetics()
  inventoryPanel.render()
}

function handleMarketAction(result: MarketActionResult): void {
  if (result.progress) applyServerProgress(result.progress)
  const messages: Record<string, string> = {
    'missing-progress': 'Progress not synced yet. Try again in a moment.',
    'invalid-price': 'Invalid listing price.',
    'item-not-found': 'Item is no longer in inventory.',
    'not-tradable': 'That item cannot be traded.',
    'missing-credits': 'Not enough credits.',
    'not-found': 'Listing no longer exists.',
    'not-active': 'Listing is no longer active.',
    'not-seller': 'Only the seller can cancel that listing.',
    'own-listing': 'You cannot buy your own listing.',
    'missing-identity': 'No active pilot identity.',
    'wallet-required': 'Connect wallet to trade crafted items.',
    'not-reserved': 'Your reservation expired — start the purchase again.',
    'payment-unverified': 'Payment not confirmed on-chain. No item was transferred.',
    'token-disabled': 'Token trading is unavailable right now.',
  }
  if (result.ok) {
    const okText: Record<string, string> = {
      create: 'Listing created.',
      buy: 'Marketplace purchase complete.',
      cancel: 'Listing cancelled.',
      sold: 'Marketplace sale complete.',
    }
    if (result.action === 'buy' && result.listing) clearPendingBuy(result.listing.id) // settled — stop resending
    addChatLine('MARKET', okText[result.action] ?? 'Marketplace updated.', selfTier)
    net.requestMarketList()
  } else {
    addChatLine('MARKET', messages[result.reason ?? ''] ?? 'Marketplace action failed.', selfTier)
  }
  refreshMarketplaceViews()
}

// --- Remote ships
interface RemoteShip {
  mesh: THREE.Group
  peer: PeerState
  label: CSS2DObject
  health: ReturnType<typeof createHealth>
  craftKey: string
  loadSeq: number
  cosmetics: ShipCosmetics
  cosmeticsKey: string
}
let selfTier = 0 // token-holder tier, cosmetic identity
let selfHolderBalance = 0 // exact token balance from the relay; used only for holder-gated ranked PvP
let selectedHolderShipVisual = loadHolderShipVisual(localStorage)
// Browser autopilot (?bot=1) is a two-phase loop: TRANSIT (quantum-jump to a destination — warp
// visual, flies through the system, no straight-line collision) then PERFORM (do the thing there —
// dive the black hole, run the race gates, weave the arena, or just loiter at a planet) slowly and
// boost-free so the ship stays visible. Then transit to the next.
let botPhase: 'transit' | 'perform' = 'transit'
let botStopKind = 'planet'
let botLastStop = ''
let botActivity: ReturnType<typeof buildActivity> | null = null
let botDwellUntil = 0      // planet-loiter timer
let botPerformUntil = 0    // hard cap so a maneuver can't run forever
const _botPrevPos = new THREE.Vector3()
const BOT_ENGINE_REF_SPEED = 700  // bot engine-audio reference: the on-rails speed that reads as full-throttle hum
const BOT_PLANET_DWELL_MS = 6000
const BOT_PERFORM_CAP_MS = 45000  // safety cap; black-hole dive's long in-and-out needs room
const BOT_STOP_KINDS = ['planet', 'race', 'pvp-training', 'black-hole-dive']
let botChatRecent: { name: string; text: string }[] = []
let botLastReplyAt = 0
let botThinking = false
const BOT_CHAT_COOLDOWN_MS = 6000
let rankedPvpDeniedUntil = 0
const _rankedBounceDir = new THREE.Vector3()
function applyLocalDevHolderOverride(): void {
  const override = readLocalDevHolderOverride(localStorage, window.location)
  if (!override) return
  selfTier = override.tier
  selfHolderBalance = override.balance
  holderBalance = selfHolderBalance // keep the landing gate in sync so the dev override can unlock LAUNCH
  refreshLaunchGateUI()
}
applyLocalDevHolderOverride()
function activeHolderShipVisual(): HolderShipVisualId {
  return resolveHolderShipVisual(selectedHolderShipVisual, selfTier).id
}

function enforceRankedArenaAccess(now: number): void {
  if (!isInRankedPvpZone(ship.position) || rankedPvpAccess(selfHolderBalance)) return
  _rankedBounceDir.copy(ship.position).sub(PVP_RANKED_ZONE_CENTER)
  if (_rankedBounceDir.lengthSq() < 1) _rankedBounceDir.set(0, 0, 1).applyQuaternion(ship.quaternion)
  _rankedBounceDir.normalize()
  ship.position.copy(PVP_RANKED_ZONE_CENTER).addScaledVector(_rankedBounceDir, PVP_RANKED_ZONE_RADIUS + 180)
  ship.velocity.copy(_rankedBounceDir).multiplyScalar(Math.max(420, ship.velocity.length() * 0.75))
  rankedPvpDeniedUntil = now + 2600
  pvpEl.hidden = false
  pvpEl.textContent = `RANKED LOCKED - HOLD ${PVP_RANKED_MIN_TOKEN_BALANCE.toLocaleString()} TOKENS`
  audio.blip('error')
}

function enforceMobilePvpExclusion(now: number): void {
  if (!MOBILE_COMPANION) return
  const zone = pvpZoneAt(ship.position)
  if (!zone) return
  _rankedBounceDir.copy(ship.position).sub(zone.center)
  if (_rankedBounceDir.lengthSq() < 1) _rankedBounceDir.set(0, 0, 1).applyQuaternion(ship.quaternion)
  _rankedBounceDir.normalize()
  ship.position.copy(zone.center).addScaledVector(_rankedBounceDir, zone.radius + 180)
  ship.velocity.copy(_rankedBounceDir).multiplyScalar(Math.max(360, ship.velocity.length() * 0.7))
  rankedPvpDeniedUntil = now + 2200
  pvpEl.hidden = false
  pvpEl.textContent = 'PVP DESKTOP ONLY'
  audio.blip('error')
}
function nameplateParts(el: HTMLElement): { name: HTMLElement; hull: HTMLElement; fill: HTMLElement } {
  let name = el.querySelector<HTMLElement>('.np-name')
  let hull = el.querySelector<HTMLElement>('.np-hull')
  let fill = hull?.querySelector<HTMLElement>('i') ?? null
  if (!name) {
    name = document.createElement('span')
    name.className = 'np-name'
    el.appendChild(name)
  }
  if (!hull) {
    hull = document.createElement('span')
    hull.className = 'np-hull'
    hull.hidden = true
    fill = document.createElement('i')
    hull.appendChild(fill)
    el.appendChild(hull)
  }
  return { name, hull, fill: fill! }
}
/** Set a peer's nameplate text + holder flair by tier (1 gold · 2 cyan · 3 whale). */
function applyHolderNameplate(el: HTMLElement, name: string, tier: number): void {
  el.className = holderNameplateClass(tier)
  nameplateParts(el).name.textContent = holderNameplateText(name, tier)
}
function updateNameplateHealth(el: HTMLElement, hull: number, maxHull: number, visible: boolean): void {
  const parts = nameplateParts(el)
  parts.hull.hidden = !visible
  const frac = maxHull > 0 ? THREE.MathUtils.clamp(hull / maxHull, 0, 1) : 0
  parts.fill.style.width = `${Math.round(frac * 100)}%`
}
// Enemy readout DOM: mirrors the peer nameplate (a name line + hull track + fill) but with its own
// `.enemyplate` class (threat red/orange) so it stays visually distinct from holder-themed peer plates.
function enemyLabelParts(el: HTMLElement): { name: HTMLElement; fill: HTMLElement } {
  let name = el.querySelector<HTMLElement>('.ep-name')
  let hull = el.querySelector<HTMLElement>('.ep-hull')
  let fill = hull?.querySelector<HTMLElement>('i') ?? null
  if (!name) {
    name = document.createElement('span')
    name.className = 'ep-name'
    el.appendChild(name)
  }
  if (!hull) {
    hull = document.createElement('span')
    hull.className = 'ep-hull'
    fill = document.createElement('i')
    hull.appendChild(fill)
    el.appendChild(hull)
  }
  return { name, fill: fill! }
}
function updateEnemyLabelHealth(el: HTMLElement, frac: number): void {
  enemyLabelParts(el).fill.style.width = `${Math.round(THREE.MathUtils.clamp(frac, 0, 1) * 100)}%`
}
const remotes = new Map<string, RemoteShip>()
const PALETTE = [0xc75d5d, 0x5d8ac7, 0xc7a85d, 0x9b5dc7, 0x5dc7b8, 0xc75da6]
function peerShipType(peer: PeerState): ShipType {
  return peer.ship && peer.ship in SHIP_STATS ? peer.ship as ShipType : 'hauler'
}

function peerHolderShipVisual(peer: PeerState): HolderShipVisualId {
  return resolveHolderShipVisual(peer.visual ?? null, peer.tier ?? 0).id
}

function remoteCraftKey(peer: PeerState): string {
  return `${peerShipType(peer)}:${peerHolderShipVisual(peer)}:${peer.tier ?? 0}`
}

function ensureRemoteCraftModel(remote: RemoteShip): void {
  const key = remoteCraftKey(remote.peer)
  if (remote.craftKey === key) return
  remote.craftKey = key
  const type = peerShipType(remote.peer)
  const visual = peerHolderShipVisual(remote.peer)
  const loadSeq = ++remote.loadSeq
  loadCraftModelForType(type, remote.peer.tier ?? 0, visual).then((model) => {
    if (!model || remotes.get(remote.peer.id) !== remote || remote.loadSeq !== loadSeq) return
    const oldMesh = remote.mesh
    const position = oldMesh.position.clone()
    const quaternion = oldMesh.quaternion.clone()
    oldMesh.remove(remote.label)
    remote.cosmetics.dispose()
    scene.remove(oldMesh)
    disposeObject(oldMesh)
    addCraftEngineGlowRig(model, type)
    model.position.copy(position)
    model.quaternion.copy(quaternion)
    remote.label.position.set(0, 2.2, 0)
    model.add(remote.label)
    scene.add(model)
    remote.mesh = model
    remote.cosmetics = createShipCosmetics(remote.mesh, scene)
    remote.cosmeticsKey = ''
  })
}

const solarMap = new SolarSystemMap({
  getSnapshot: () => ({
    playerPosition: ship.position.clone(),
    playerQuaternion: ship.quaternion.clone(),
    nearbyCelestials: queryCelestials(ship.position, 90000),
    remotes: [...remotes.values()].map(({ mesh, peer }) => {
      const velocity = new THREE.Vector3()
      if (peer.prev && peer.receivedAt > peer.prev.receivedAt) {
        const dt = (peer.receivedAt - peer.prev.receivedAt) / 1000
        if (dt > 0) velocity.fromArray(peer.p).sub(new THREE.Vector3().fromArray(peer.prev.p)).multiplyScalar(1 / dt)
      }
      return {
        id: peer.id,
        name: peer.name,
        color: PALETTE[peer.color % PALETTE.length],
        position: mesh.position.clone(),
        velocity,
        ageMs: Math.max(0, performance.now() - peer.receivedAt),
      }
    }),
    selectedDestinationName: activeQuantumDestination().name,
    activeDestination: activeDestinationSnapshot(),
    landmarks: landmarkTargets(MOBILE_COMPANION),
  }),
  onClose: () => {
    if (MOBILE_COMPANION && running && !docked && !chatOpen) mobileControlsEl.hidden = false
    if (running && !docked && !chatOpen) requestFlightPointerLock()
  },
  onSetDestination: setQuantumDestinationFromAtlas,
})
document.body.appendChild(solarMap.root)

let dockOpenRequest = 0
function dock(id: string): void {
  docked = true
  recordDailyEvent('dock_outposts', 1, Date.now())
  const openRequest = ++dockOpenRequest
  if (!dockedEver) markOnboard('scc.ob.docked', (v) => { dockedEver = v }) // onboarding step 2 — opening the UI counts
  solarMap.close()
  miningActive = false
  leaderboardPanelEl.hidden = true // don't strand the leaderboard open behind the station menu
  dailyPanelEl.hidden = true
  dockPromptEl.hidden = true
  mineEl.hidden = true
  beam.visible = false
  impact.visible = false
  safeEl.hidden = true
  pvpEl.hidden = true
  if (MOBILE_COMPANION) mobileControlsEl.hidden = true
  weaponActive = false
  ship.velocity.set(0, 0, 0)
  audio.setThrust(0, false)
  audio.setMining(false, false)
  audio.blip('dock')
  document.exitPointerLock()
  requestAnimationFrame(() => {
    if (!docked || openRequest !== dockOpenRequest) return
    stationMenu.open({
      outpostId: id, econ, market, crafting, upgrades, contracts, audio,
      capacity: effCargo,
      selectedShip: () => selectedShipType,
      ownedShips,
      shipPrices: SHIP_PRICES,
      onBuyShip: (type) => {
        if (ownedShips.has(type) || econ.credits < SHIP_PRICES[type]) return
        econ.credits -= SHIP_PRICES[type]
        ownedShips.add(type)
        saveHangar()
        refreshWallet()
      },
      onSelectShip: (type) => {
        if (ownedShips.has(type)) setPlayerCraft(type)
      },
      holderTier: () => selfTier,
      selectedHolderShipVisual: () => selectedHolderShipVisual,
      onSelectHolderShipVisual: (id: HolderShipVisualId) => {
        selectedHolderShipVisual = id
        saveHolderShipVisual(localStorage, id)
        setPlayerCraft(selectedShipType)
      },
      marketplaceRows: () => marketplaceRows,
      marketplaceCanTrade: () => Boolean(walletSession),
      onRefreshMarketplace: requestMarketplaceRefresh,
      onBuyMarketListing: (listingId) => {
        if (!walletSession) {
          addChatLine('MARKET', 'Connect wallet to trade crafted items.', selfTier)
          return
        }
        if (pendingTokenBuy) {
          addChatLine('MARKET', 'A token purchase is already in progress.', selfTier)
          return
        }
        refreshWallet()
        const listing = marketplaceRows.find((r) => r.id === listingId)
        if (!listing) {
          addChatLine('MARKET', 'Listing no longer available.', selfTier)
          return
        }
        if (listing.currency === 'token') {
          openBuyConfirm(listing) // show the cost breakdown; Confirm triggers the wallet
        } else {
          net.buyMarketListing(listingId)
        }
      },
      onCancelMarketListing: (listingId) => {
        if (!walletSession) {
          addChatLine('MARKET', 'Connect wallet to trade crafted items.', selfTier)
          return
        }
        refreshWallet()
        net.cancelMarketListing(listingId)
      },
    })
    net.requestMarketList()
  })
}

function undock(): void {
  dockOpenRequest++
  stationMenu.close()
  docked = false
  if (MOBILE_COMPANION) mobileControlsEl.hidden = false
  requestFlightPointerLock()
}

function renderSettingsPanel(): void {
  mouseSensitivityEl.value = String(gameSettings.mouseSensitivity)
  mouseSensitivityValueEl.textContent = formatMouseSensitivity(gameSettings.mouseSensitivity)
  ambientVolumeEl.value = String(gameSettings.ambientVolume)
  ambientVolumeValueEl.textContent = formatAmbientVolume(gameSettings.ambientVolume)
}

function setMouseSensitivity(value: number): void {
  gameSettings = { ...gameSettings, mouseSensitivity: clampMouseSensitivity(value) }
  saveGameSettings(localStorage, gameSettings)
  renderSettingsPanel()
}

function setAmbientVolume(value: number): void {
  gameSettings = { ...gameSettings, ambientVolume: clampAmbientVolume(value) }
  saveGameSettings(localStorage, gameSettings)
  renderSettingsPanel()
}

function resetGameSettings(): void {
  gameSettings = { mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY, ambientVolume: DEFAULT_AMBIENT_VOLUME }
  saveGameSettings(localStorage, gameSettings)
  renderSettingsPanel()
}

function openSettingsPanel(): void {
  if (!running || docked) return
  keys.clear()
  miningActive = false
  weaponActive = false
  mineEl.hidden = true
  beam.visible = false
  impact.visible = false
  leaderboardPanelEl.hidden = true
  dailyPanelEl.hidden = true
  settingsPanelEl.hidden = false
  renderSettingsPanel()
  if (MOBILE_COMPANION) mobileControlsEl.hidden = true
  if (document.pointerLockElement) document.exitPointerLock()
}

function closeSettingsPanel(): void {
  if (settingsPanelEl.hidden) return
  settingsPanelEl.hidden = true
  if (MOBILE_COMPANION && running && !docked && !chatOpen) mobileControlsEl.hidden = false
  if (running && !docked && !chatOpen && !solarMap.isOpen) requestFlightPointerLock()
}

function restoreFlightInputAfterPanel(): void {
  if (MOBILE_COMPANION && running && !docked && !chatOpen && settingsPanelEl.hidden) mobileControlsEl.hidden = false
  if (running && !docked && !chatOpen && !solarMap.isOpen && settingsPanelEl.hidden && leaderboardPanelEl.hidden && dailyPanelEl.hidden) requestFlightPointerLock()
}

const inventoryPanel = new InventoryPanel({
  onClose: restoreFlightInputAfterPanel,
  onListItem: listCraftedItemForSale,
  canListItem: () => Boolean(walletSession),
  walletConnected: () => Boolean(walletSession),
  onEquipItem: (itemId) => equipCraftedItem(itemId),
  onUnequipSlot: (slot) => unequipCraftedSlot(slot),
  equippedSlots: () => crafting.equipped,
})

function openInventoryPanel(): void {
  if (!running) return
  keys.clear()
  miningActive = false
  weaponActive = false
  mineEl.hidden = true
  beam.visible = false
  impact.visible = false
  leaderboardPanelEl.hidden = true
  dailyPanelEl.hidden = true
  settingsPanelEl.hidden = true
  if (MOBILE_COMPANION) mobileControlsEl.hidden = true
  if (document.pointerLockElement) document.exitPointerLock()
  inventoryPanel.open(crafting)
}

function closeInventoryPanel(): void {
  inventoryPanel.close()
}

settingsCloseEl.addEventListener('click', closeSettingsPanel)
settingsResetEl.addEventListener('click', resetGameSettings)
mouseSensitivityEl.addEventListener('input', () => setMouseSensitivity(Number(mouseSensitivityEl.value)))
ambientVolumeEl.addEventListener('input', () => setAmbientVolume(Number(ambientVolumeEl.value)))
renderSettingsPanel()

// --- Input
const keys = new Set<string>()
let mousePitch = 0
let mouseYaw = 0
let assist = true
let cameraMode: CameraMode = 'rear'
let cameraRearDistance = defaultRearDistance()
let cameraRearWheelDelta = 0
let cameraOrbitElapsed = 0
let cameraOrbitDistance = defaultOrbitDistance()
let cameraOrbitWheelDelta = 0
const mobileFlightState: MobileFlightState = {
  stickX: 0,
  stickY: 0,
  thrustHeld: false,
  boostHeld: false,
  brakeHeld: false,
}
let mobileMineHeld = false
let mobileStickPointerId: number | null = null
function cycleCameraView(): void {
  cameraMode = nextCameraMode(cameraMode)
  if (cameraMode === 'rear') {
    cameraOrbitElapsed = 0
    cameraOrbitWheelDelta = 0
  } else {
    cameraRearWheelDelta = 0
  }
}

function setMobileHeld(btn: HTMLButtonElement, held: boolean): void {
  btn.classList.toggle('held', held)
}

function bindMobileHold(btn: HTMLButtonElement, setHeld: (held: boolean) => void): void {
  const down = (event: PointerEvent) => {
    if (!MOBILE_COMPANION) return
    event.preventDefault()
    setHeld(true)
    setMobileHeld(btn, true)
    btn.setPointerCapture?.(event.pointerId)
  }
  const up = (event: PointerEvent) => {
    if (!MOBILE_COMPANION) return
    event.preventDefault()
    setHeld(false)
    setMobileHeld(btn, false)
  }
  btn.addEventListener('pointerdown', down)
  btn.addEventListener('pointerup', up)
  btn.addEventListener('pointercancel', up)
  btn.addEventListener('pointerleave', up)
}

function updateMobileStick(event: PointerEvent): void {
  const rect = mobileStickEl.getBoundingClientRect()
  const radius = Math.max(1, rect.width / 2)
  const dx = event.clientX - (rect.left + radius)
  const dy = event.clientY - (rect.top + radius)
  const len = Math.hypot(dx, dy)
  const scale = len > radius ? radius / len : 1
  const x = dx * scale
  const y = dy * scale
  mobileFlightState.stickX = x / radius
  mobileFlightState.stickY = y / radius
  mobileStickKnobEl.style.transform = `translate(${x}px, ${y}px)`
}

function resetMobileStick(): void {
  mobileStickPointerId = null
  mobileFlightState.stickX = 0
  mobileFlightState.stickY = 0
  mobileStickKnobEl.style.transform = 'translate(0, 0)'
}

if (MOBILE_COMPANION) {
  mobileStickEl.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    mobileStickPointerId = event.pointerId
    mobileStickEl.setPointerCapture?.(event.pointerId)
    updateMobileStick(event)
  })
  mobileStickEl.addEventListener('pointermove', (event) => {
    if (event.pointerId === mobileStickPointerId) updateMobileStick(event)
  })
  mobileStickEl.addEventListener('pointerup', (event) => {
    if (event.pointerId === mobileStickPointerId) resetMobileStick()
  })
  mobileStickEl.addEventListener('pointercancel', (event) => {
    if (event.pointerId === mobileStickPointerId) resetMobileStick()
  })

  bindMobileHold(mobileThrustEl, (held) => { mobileFlightState.thrustHeld = held })
  bindMobileHold(mobileBoostEl, (held) => { mobileFlightState.boostHeld = held })
  bindMobileHold(mobileBrakeEl, (held) => { mobileFlightState.brakeHeld = held })
  bindMobileHold(mobileMineEl, (held) => { mobileMineHeld = held })
  mobileDockEl.addEventListener('click', () => { if (running && !docked && dockable) dock(dockable) })
  mobileJumpEl.addEventListener('click', toggleQuantumTravel)
  mobileNextEl.addEventListener('click', () => cycleQuantumDestination())
  mobileCameraEl.addEventListener('click', () => {
    if (!running || docked) return
    cycleCameraView()
    audio.blip('nav')
  })
}

addEventListener('keydown', (e) => {
  if (chatOpen) return // chat input owns the keyboard while open
  if (solarMap.isOpen) return // map owns M/Escape via its capture listener
  if (inventoryPanel.isOpen) {
    if (e.code === 'Escape' || e.code === 'KeyI') {
      e.preventDefault()
      closeInventoryPanel()
    }
    return
  }
  if (!settingsPanelEl.hidden) {
    if (e.code === 'Escape' || e.code === 'KeyO') {
      e.preventDefault()
      closeSettingsPanel()
    }
    return
  }
  if (e.code === 'KeyM' && running) {
    e.preventDefault()
    keys.clear()
    miningActive = false
    weaponActive = false
    mineEl.hidden = true
    beam.visible = false
    impact.visible = false
    leaderboardPanelEl.hidden = true
    dailyPanelEl.hidden = true
    if (MOBILE_COMPANION) mobileControlsEl.hidden = true
    audio.setMining(false, false)
    if (document.pointerLockElement) document.exitPointerLock()
    solarMap.open()
    return
  }
  if (e.code === 'Enter' && running && !docked && !spectating) { openChat(); return }
  if (e.code === 'Space') e.preventDefault()
  if (e.repeat) return
  if (e.code === 'KeyO' && running && !docked) {
    e.preventDefault()
    openSettingsPanel()
    return
  }
  if (e.code === 'KeyI' && running && !spectating) {
    e.preventDefault()
    openInventoryPanel()
    return
  }
  keys.add(e.code)
  if (e.code === 'KeyV') {
    assist = !assist
    assistEl.textContent = assist ? 'COUPLED' : 'DECOUPLED'
  }
  if (e.code === 'KeyC' && running && !docked && !spectating) {
    cycleCameraView()
    audio.blip('nav')
  }
  if (e.code === 'Space' && running && !docked && !spectating && dockable) dock(dockable)
  if (e.code === 'KeyN' && running && !docked && !spectating && quantum.phase === 'idle') {
    cycleQuantumDestination()
  }
  if (e.code === 'KeyB' && running && !docked && !spectating && quantum.phase === 'idle') {
    cycleQuantumDestination(-1)
  }
  if (!leaderboardPanelEl.hidden && running && !docked && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    e.preventDefault()
    changeLeaderboardPage('hud', e.code === 'ArrowLeft' ? -1 : 1)
    return
  }
  if (e.code === 'KeyL' && running && !docked) {
    const willShow = leaderboardPanelEl.hidden
    leaderboardPanelEl.hidden = !willShow
    if (willShow) {
      if (document.pointerLockElement) document.exitPointerLock()
      if (MOBILE_COMPANION) mobileControlsEl.hidden = true
      fetchLeaderboard('hud') // refresh standings each time it opens
    } else {
      if (MOBILE_COMPANION) mobileControlsEl.hidden = false
      requestFlightPointerLock()
    }
  }
  if (e.code === 'KeyG' && running && !docked && !spectating) {
    if (dailyPanelEl.hidden) {
      renderDailyPanel(Date.now())
      dailyPanelEl.hidden = false
      if (document.pointerLockElement) document.exitPointerLock() // free the cursor to read / click ✕
    } else {
      closeDailyPanel()
    }
    e.preventDefault()
    return
  }
  if (e.code === 'KeyJ' && running && !docked && !spectating) {
    toggleQuantumTravel()
  }
})
addEventListener('keyup', (e) => keys.delete(e.code))
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return
  mouseYaw -= applyMouseSensitivity(e.movementX, gameSettings.mouseSensitivity) * 0.0024
  mousePitch -= applyMouseSensitivity(e.movementY, gameSettings.mouseSensitivity) * 0.0024
  mouseYaw = THREE.MathUtils.clamp(mouseYaw, -1, 1)
  mousePitch = THREE.MathUtils.clamp(mousePitch, -1, 1)
})
renderer.domElement.addEventListener('wheel', (e) => {
  if (!(running && !docked)) return
  e.preventDefault()
  if (cameraMode === 'orbit') {
    cameraOrbitWheelDelta = queueOrbitZoomDelta(cameraOrbitWheelDelta, e.deltaY)
  } else {
    cameraRearWheelDelta = queueOrbitZoomDelta(cameraRearWheelDelta, e.deltaY)
  }
}, { passive: false })
// Left mouse = mining laser, right mouse = weapon (only while flying, mouse captured).
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault())
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!(running && !docked && !spectating && document.pointerLockElement === renderer.domElement)) return
  if (e.button === 0) miningActive = true
  if (e.button === 2) weaponActive = true
})
addEventListener('mouseup', (e) => {
  if (e.button === 0) miningActive = false
  if (e.button === 2) weaponActive = false
})

// Mouse self-centering rate (1/s). Tuned so a 60 fps frame matches the old *0.92 feel
// (e^(-5/60) ≈ 0.92), but now frame-rate independent so it feels identical at any refresh rate.
const MOUSE_DECAY = 5
function readInput(dt: number): ControlInput {
  if (MOBILE_COMPANION) return mobileFlightInput(mobileFlightState)

  // Mouse deflection decays toward center — feels like a virtual joystick (frame-rate independent)
  const keep = Math.exp(-MOUSE_DECAY * dt)
  mousePitch *= keep
  mouseYaw *= keep
  return {
    thrust: new THREE.Vector3(
      (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      (keys.has('KeyR') ? 1 : 0) - (keys.has('KeyF') ? 1 : 0),
      (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
    ),
    pitch: mousePitch,
    yaw: mouseYaw,
    roll: (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0),
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    brake: keys.has('KeyX'),
    assist,
  }
}

const net = new NetClient(nicknameEl.value || 'PILOT', identity, {
  onChallenge: (message) => {
    signMessage(message).then((sig) => {
      if (pendingPubkey) net.submitAuth(pendingPubkey, sig)
    }).catch(() => { setWalletStatus('Signature cancelled.'); pendingPubkey = null; pendingLaunch = false })
  },
  onAuthOk: (pubkey, sessionId, name) => {
    walletSession = { pubkey, sessionId, connectedAt: Date.now() }
    saveWalletSession(localStorage, walletSession)
    pendingPubkey = null
    lockWalletButton(pubkey)
    refreshLaunchGateUI() // wallet linked — re-evaluate the gate (the 'holder' balance will refine it)
    setWalletStatus(`Connected ${pubkey.slice(0, 4)}…${pubkey.slice(-4)} — press LAUNCH to play`)
    if (name && name.toLowerCase() !== 'pilot') {
      nicknameEl.value = name
      localStorage.setItem('callsign', name)
      net.setName(name)
    }
  },
  onAuthError: () => {
    pendingPubkey = null
    pendingLaunch = false // a failed link must never auto-launch later
    setWalletStatus('Wallet not linked — already has a pilot, or signing failed.')
  },
  onProgress(p) {
    if (p) {
      // Server is the source of truth — adopt saved progress when it arrives.
      applyServerProgress(p)
      finishOnboarding() // a returning token already knows the ropes
    } else {
      // Brand-new token: the server confirmed there's nothing saved. Init the daily loop now,
      // event-driven — no timer guess, and no wrong-streak flash for returning pilots.
      initDaily(Date.now())
    }
  },
  onPeerJoin(peer) {
    const mesh = buildCraft(peerShipType(peer), PALETTE[peer.color % PALETTE.length])
    const label = document.createElement('div')
    const labelObj = new CSS2DObject(label)
    labelObj.position.set(0, 2.2, 0)
    mesh.add(labelObj)
    mesh.position.fromArray(peer.p)
    scene.add(mesh)
    const maxHull = peer.maxHull ?? SHIP_STATS[peerShipType(peer)].hull
    const health = createHealth(maxHull)
    health.hull = peer.hull ?? maxHull
    const remote: RemoteShip = { mesh, peer, label: labelObj, health, craftKey: '', loadSeq: 0, cosmetics: createShipCosmetics(mesh, scene), cosmeticsKey: '' }
    remotes.set(peer.id, remote)
    applyHolderNameplate(label, peer.name, peer.tier ?? 0)
    ensureRemoteCraftModel(remote)
  },
  onPeerState(peer) {
    const remote = remotes.get(peer.id)
    if (!remote) return
    if (typeof peer.maxHull === 'number') remote.health.max = peer.maxHull
    if (typeof peer.hull === 'number') remote.health.hull = THREE.MathUtils.clamp(peer.hull, 0, remote.health.max)
    ensureRemoteCraftModel(remote)
  },
  onPeerHolder(id, tier) {
    const remote = remotes.get(id)
    if (remote) {
      remote.peer.tier = tier
      applyHolderNameplate(remote.label.element as HTMLElement, remote.peer.name, tier)
      ensureRemoteCraftModel(remote)
    }
  },
  onHolder(tier, balance) {
    selfTier = tier
    selfHolderBalance = balance
    holderBalance = balance
    refreshLaunchGateUI() // refresh the gate message + buy link for the new balance
    if (pendingLaunch) { pendingLaunch = false; if (balance >= 1) launch() } // connect→holder≥1 auto-enters; <1 leaves the buy warning showing
    applyLocalDevHolderOverride()
    setPlayerCraft(selectedShipType)
  },
  onJoinError(reason) {
    gateMsgEl.hidden = false
    gateMsgEl.textContent = reason === 'wallet-required'
      ? 'Connect a wallet to fly.'
      : reason === 'insufficient-tokens'
        ? "Couldn't confirm ≥1 $CITIZEN — make sure you hold the token and retry."
        : 'Unable to launch right now — retry.'
    if (running && !spectating) {
      // launch() optimistically set running=true and revealed the world; the server refused
      // the join. Roll back to the landing so local state matches the server verdict.
      running = false
      overlayEl.classList.remove('hidden')
      overlayEl.hidden = false
      overlayEl.style.display = '' // mirror browse-back: restore stylesheet default
      // Hide everything launch() revealed so the rollback is clean.
      hudEl.hidden = true
      statusEl.hidden = true
      helpEl.hidden = true
      crosshairEl.hidden = true
      walletEl.hidden = true
      minimapWrapEl.hidden = true
      if (MOBILE_COMPANION) {
        document.documentElement.classList.remove('mobile-flight')
        mobileControlsEl.hidden = true
      }
      if (document.pointerLockElement) document.exitPointerLock()
    }
  },
  onPeerLeave(id) {
    const remote = remotes.get(id)
    if (remote) {
      remote.mesh.remove(remote.label)
      remote.label.element.remove() // CSS2D label lives in the DOM — drop it or the name lingers
      scene.remove(remote.mesh)
      remote.cosmetics.dispose()
      disposeObject(remote.mesh)
      remotes.delete(id)
    }
  },
  onStatus(connected, online) {
    if (!connected) pendingTokenBuy = null
    netConnected = connected
    netEl.textContent = connected ? 'SECTOR LINK: ONLINE' : 'SECTOR LINK: OFFLINE (solo)'
    onlineEl.textContent = String(online)
    if (connected) {
      // Show our own presence immediately, then confirm with the server (don't wait the 6s tick).
      statOnlineEl.textContent = String(Math.max(1, Number(statOnlineEl.textContent) || 0))
      setTimeout(refreshLandingStats, 500)
      // Re-deliver any token payment whose market-buy never reached the server (delayed so the
      // session/identity has restored first). Settled buys clear themselves; unsettleable ones are
      // logged server-side and the signature was shown to the player.
      setTimeout(resendPendingBuys, 2000)
    }
  },
  onChat(name, text, tier) {
    addChatLine(name, text, tier)
    maybeBotReply(name, text)
  },
  onPvpHealth(id, hull, maxHull, self) {
    if (self) {
      playerHealth.max = maxHull
      playerHealth.hull = THREE.MathUtils.clamp(hull, 0, maxHull)
      return
    }
    const remote = remotes.get(id)
    if (!remote) return
    remote.health.max = maxHull
    remote.health.hull = THREE.MathUtils.clamp(hull, 0, maxHull)
    remote.peer.hull = remote.health.hull
    remote.peer.maxHull = maxHull
  },
  onPvpHit(targetId, hull, maxHull, _damage, killed) {
    const remote = remotes.get(targetId)
    if (remote) {
      remote.health.max = maxHull
      remote.health.hull = THREE.MathUtils.clamp(hull, 0, maxHull)
      remote.peer.hull = remote.health.hull
      remote.peer.maxHull = maxHull
      registerHitMarker(combatFeedback, performance.now())
      spawnHitSpark(remote.mesh.position, performance.now(), killed ? 0xff5dff : 0xfff2a8)
      if (killed) spawnFloat('PVP KILL', remote.mesh.position, performance.now(), '#ff5dff')
    }
  },
  onPvpDamage(attackerName, hull, maxHull, damage, killed) {
    playerHealth.max = maxHull
    playerHealth.hull = THREE.MathUtils.clamp(hull, 0, maxHull)
    lastPlayerDamageAt = performance.now()
    lastPvpCombatAt = performance.now()
    damageFlash()
    addChatLine('PVP', `${attackerName} hit you for ${Math.round(damage)}`, 3)
    if (killed) {
      respawnPlayer(performance.now())
      net.sendPvpRespawn(
        [ship.position.x, ship.position.y, ship.position.z],
        [ship.quaternion.x, ship.quaternion.y, ship.quaternion.z, ship.quaternion.w],
        selectedShipType,
        activeHolderShipVisual(),
      )
    }
  },
  onPvpKill(killerName, victimName, reward, killerIsSelf, victimIsSelf) {
    const suffix = reward > 0 ? ` (+${reward} cr)` : ''
    addChatLine('PVP', `${killerName} destroyed ${victimName}${suffix}`, 3)
    if (killerIsSelf) {
      registerKillBanner(combatFeedback, `ELIMINATED ${victimName.toUpperCase()}`, reward > 0 ? `+${reward} cr` : '+1 kill', performance.now())
      audio.blip('trade')
    }
    if (victimIsSelf) damageFlash()
  },
  onPvpReward(credits, victimName) {
    gainCredits(econ, credits)
    refreshWallet()
    spawnFloat(`+${credits} cr`, ship.position, performance.now(), '#ff5dff')
    addChatLine('PVP', `Bounty claimed from ${victimName}: +${credits} cr`, 3)
  },
  onRaceRecorded(timeMs) {
    addChatLine('RACE', `Ranked time recorded: ${formatTrialTime(timeMs / 1000)}`, selfTier)
    if (!raceFinishedEver) markOnboard('scc.journey.race', (v) => { raceFinishedEver = v })
    if (!leaderboardPanelEl.hidden && hudLeaderboardMode === 'race') fetchLeaderboard('hud')
  },
  onBlackHoleRecorded(distance) {
    addChatLine('BLACK HOLE', `Closest approach ${distance.toLocaleString()} m recorded.`, 3)
    if (!blackHoleRecordedEver) markOnboard('scc.journey.blackhole', (v) => { blackHoleRecordedEver = v })
  },
  onMarketList(rows) {
    marketplaceRows = rows
    refreshMarketplaceViews()
  },
  onMarketAction(result) {
    handleMarketAction(result)
  },
  onMarketIntent(result: MarketIntentResult) {
    if (result.listingId !== pendingTokenBuy) return
    if (!result.ok || !result.txBase64) {
      pendingTokenBuy = null
      const messages: Record<string, string> = {
        'wallet-required': 'Connect wallet to trade tokens.',
        'token-disabled': 'Token trading is unavailable right now.',
        'reserved': 'Listing reserved by another pilot — try again shortly.',
        'not-token': 'That listing is not a token listing.',
        'own-listing': 'You cannot buy your own listing.',
        'build-failed': 'Could not prepare the payment. Try again.',
        'sim-failed': 'Payment can’t be completed — check your $Citizen balance (and some SOL for fees) and try again.',
        'not-found': 'Listing no longer exists.',
        'not-active': 'Listing is no longer active.',
      }
      addChatLine('MARKET', messages[result.reason ?? ''] ?? 'Could not start token purchase.', selfTier)
      return
    }
    const listingId = result.listingId
    signAndSendTransaction(result.txBase64)
      .then((txSig) => {
        // Payment is now on-chain. Persist before we rely on the network so a dropped connection
        // can't lose it; cleared once the server confirms the sale (handleMarketAction).
        rememberPendingBuy(listingId, txSig)
        const delivered = net.buyMarketListing(listingId, txSig)
        addChatLine('MARKET', delivered
          ? 'Payment sent — verifying on-chain…'
          : `Payment sent but offline — saved, will finish on reconnect. Signature: ${txSig}`, selfTier)
      })
      .catch((err) => {
        addChatLine('MARKET', err instanceof WalletError && err.message === NO_WALLET ? 'No wallet found.' : 'Wallet transaction rejected.', selfTier)
      })
      .finally(() => { pendingTokenBuy = null })
  },
  onKicked() {
    // Same Pilot Code launched elsewhere — this tab is now read-only to avoid save conflicts.
    sessionKicked = true
    netEl.textContent = 'SECTOR LINK: SIGNED IN ELSEWHERE'
    objectiveEl.textContent = '⚠ This Pilot Code is now active in another tab/device. Refresh to play here.'
    objectiveEl.hidden = false
  },
  onCallsign(name) {
    if (name && name.toLowerCase() !== 'pilot') {
      nicknameEl.value = name
      localStorage.setItem('callsign', name)
      net.setName(name)
      nicknameEl.readOnly = true
    }
  },
})
net.setSession(walletSession?.sessionId ?? null) // resume a verified wallet session if we have one
net.connect() // connect on page load as a viewer (presence) — counts toward "online" on the landing
applyPlayerCosmetics() // broadcast initial equipped loadout now that net is constructed

// --- Chat
let chatOpen = false
const chatLines: HTMLElement[] = []

function maybeBotReply(name: string, text: string): void {
  if (!BOT || name === 'CLAUDE') return
  const apiKey = localStorage.getItem('scc.botApiKey')
  if (!apiKey) return
  botChatRecent.push({ name, text })
  botChatRecent = botChatRecent.slice(-12)
  const now = performance.now()
  if (botThinking || now - botLastReplyAt < BOT_CHAT_COOLDOWN_MS) return
  botLastReplyAt = now
  botThinking = true
  const activityLabel = quantum.phase !== 'idle' ? `quantum-jumping to ${jumpTargetName}`
    : botActivity ? botActivity.kind : `exploring ${botStopKind}`
  const ctx = buildBrainContext({ location: 'in flight', currentActivity: activityLabel, recentChat: botChatRecent })
  void think(ctx, { apiKey, model: 'claude-haiku-4-5' })
    .then((action) => { if (action.say) net.sendChat(action.say) })
    .finally(() => { botThinking = false })
}

function addChatLine(name: string, text: string, tier = 0): void {
  const line = document.createElement('div')
  line.className = 'chat-line'
  const who = document.createElement('b')
  who.className = holderChatNameClass(tier)
  who.textContent = `${name}: `
  line.append(who, document.createTextNode(text)) // textContent — never innerHTML (no XSS)
  chatLogEl.appendChild(line)
  chatLines.push(line)
  while (chatLines.length > 200) chatLines.shift()?.remove() // keep the session's history, capped for memory
  chatLogEl.scrollTop = chatLogEl.scrollHeight // newest at the bottom
  // Fade visually after a while so the idle HUD stays clean — but keep it in the log,
  // so opening chat ([Enter]) reveals the full scrollable history.
  setTimeout(() => { line.style.opacity = '0' }, 30000)
}

function openChat(): void {
  if (spectating) return // Browse is viewer-only — no chat-as-player
  if (chatOpen || !running || docked) return
  chatOpen = true
  document.exitPointerLock()
  if (MOBILE_COMPANION) mobileControlsEl.hidden = true
  chatLogEl.classList.add('open') // expand into the scrollable history
  chatLogEl.scrollTop = chatLogEl.scrollHeight
  chatInputEl.hidden = false
  chatInputEl.value = ''
  chatInputEl.focus()
}

function closeChat(): void {
  chatOpen = false
  chatLogEl.classList.remove('open')
  chatInputEl.hidden = true
  chatInputEl.blur()
  if (MOBILE_COMPANION && running && !docked) mobileControlsEl.hidden = false
  if (running && !docked) requestFlightPointerLock()
}

chatInputEl.addEventListener('keydown', (e) => {
  e.stopPropagation()
  if (e.code === 'Enter') {
    const text = chatInputEl.value.trim()
    if (text && !net.sendChat(text)) addChatLine(nicknameEl.value || 'PILOT', text, selfTier) // offline: echo locally
    closeChat()
  } else if (e.code === 'Escape') {
    closeChat()
  }
})

const _qa = new THREE.Quaternion()
const _qb = new THREE.Quaternion()
const _pa = new THREE.Vector3()
const _pb = new THREE.Vector3()

// Nameplates fade out with distance so far-off pilots don't clutter the screen.
const NAMEPLATE_FADE_NEAR = 1200
const NAMEPLATE_FADE_FAR = 2600
function updateRemotes(): void {
  const renderTime = performance.now() - INTERP_DELAY_MS
  for (const { mesh, peer, label, health } of remotes.values()) {
    if (peer.prev && peer.receivedAt > peer.prev.receivedAt) {
      const span = peer.receivedAt - peer.prev.receivedAt
      const alpha = THREE.MathUtils.clamp((renderTime - peer.prev.receivedAt) / span, 0, 1.25)
      _pa.fromArray(peer.prev.p); _pb.fromArray(peer.p)
      mesh.position.lerpVectors(_pa, _pb, alpha)
      _qa.fromArray(peer.prev.q); _qb.fromArray(peer.q)
      mesh.quaternion.slerpQuaternions(_qa, _qb, Math.min(alpha, 1))
    } else {
      mesh.position.fromArray(peer.p)
      mesh.quaternion.fromArray(peer.q)
    }
    // Distance-fade the nameplate: crisp up close, gone far away.
    const d = ship.position.distanceTo(mesh.position)
    const op = 1 - THREE.MathUtils.clamp((d - NAMEPLATE_FADE_NEAR) / (NAMEPLATE_FADE_FAR - NAMEPLATE_FADE_NEAR), 0, 1)
    label.visible = op > 0.02
    ;(label.element as HTMLElement).style.opacity = String(op)
    updateNameplateHealth(label.element as HTMLElement, peer.hull ?? health.hull, peer.maxHull ?? health.max, pvpZoneAt(ship.position)?.id === pvpZoneAt(mesh.position)?.id && isInPvpZone(ship.position))
  }
}

// --- Mining VFX helpers
function updateMiningVFX(active: boolean, target: THREE.Vector3 | null, now: number): void {
  if (!active || !target) {
    beam.visible = false
    impact.visible = false
    return
  }
  _beamDir.subVectors(target, shipMesh.position)
  const len = _beamDir.length()
  beam.position.copy(shipMesh.position).addScaledVector(_beamDir, 0.5)
  beam.scale.set(1, len, 1)
  beam.quaternion.setFromUnitVectors(_beamUp, _beamDir.normalize())
  beamMat.opacity = 0.4 + 0.25 * Math.sin(now * 0.04)
  beam.visible = true
  impact.position.copy(target)
  impact.scale.setScalar(1 + 0.3 * Math.sin(now * 0.02))
  impact.visible = true
}

function spawnFloat(text: string, pos: THREE.Vector3, now: number, color?: string): void {
  const div = document.createElement('div')
  div.className = 'ore-float'
  div.textContent = text
  if (color) div.style.color = color
  const obj = new CSS2DObject(div)
  obj.position.copy(pos)
  scene.add(obj)
  oreFloats.push({ obj, born: now })
}

function updateOreFloats(now: number): void {
  for (let i = oreFloats.length - 1; i >= 0; i--) {
    const f = oreFloats[i]
    const age = (now - f.born) / 1300
    if (age >= 1) {
      scene.remove(f.obj)
      oreFloats.splice(i, 1)
      continue
    }
    f.obj.position.y += 0.07
    ;(f.obj.element as HTMLElement).style.opacity = String(1 - age)
  }
}

// --- Loot: spin crates, drift them toward the ship within magnet range, collect on contact,
// and occasionally spawn a free treasure crate nearby to reward exploration.
const _lootDir = new THREE.Vector3()
const _lootTmp = new THREE.Vector3()
const _bhGrav = new THREE.Vector3()
const _bhToCam = new THREE.Vector3()
function updateLootCrates(now: number, dt: number): void {
  if (now - lastTreasure > 22000 && lootCrates.length < 8) {
    _lootDir.set(Math.random() * 2 - 1, (Math.random() * 2 - 1) * 0.3, Math.random() * 2 - 1)
    if (_lootDir.lengthSq() < 1e-3) _lootDir.set(0, 0, 1)
    _lootDir.normalize()
    spawnLoot(_lootTmp.copy(ship.position).addScaledVector(_lootDir, 250 + Math.random() * 250))
    lastTreasure = now
  }
  for (let i = lootCrates.length - 1; i >= 0; i--) {
    const loot = lootCrates[i]
    loot.mesh.rotation.y += 1.5 * dt
    loot.mesh.rotation.x += 0.8 * dt
    const d = loot.mesh.position.distanceTo(ship.position)
    if (d < LOOT_PICKUP) {
      gainCredits(econ, loot.value)
      refreshWallet()
      spawnFloat(`+${loot.value} cr`, loot.mesh.position, now, loot.rare ? '#ffd24d' : '#ffe08a')
      audio.blip('trade')
      scene.remove(loot.mesh)
      disposeObject(loot.mesh)
      lootCrates.splice(i, 1)
    } else if (d < LOOT_MAGNET) {
      loot.mesh.position.lerp(ship.position, (1 - d / LOOT_MAGNET) * dt * 4) // magnet pull
    }
  }
}

// --- Combat HUD overlay: target brackets, off-screen threat arrows, and a lead pip.
const _proj = new THREE.Vector3()
const _lead = new THREE.Vector3()
const _leadVelocity = new THREE.Vector3()
function drawCombatHud(now: number): void {
  const W = combatCanvas.width, H = combatCanvas.height
  cctx.clearRect(0, 0, W, H)
  const cx = W / 2, cy = H / 2
  let nearestPos: THREE.Vector3 | null = null
  let nd = Infinity

  const markLeadTarget = (position: THREE.Vector3, velocity: THREE.Vector3, dist: number): void => {
    if (_proj.z < 1 && dist < nd) {
      nd = dist
      nearestPos = position
      _leadVelocity.copy(velocity)
    }
  }

  const drawTarget = (position: THREE.Vector3, velocity: THREE.Vector3, color: string, label: string, lead = true): void => {
    _proj.copy(position).project(camera)
    const infront = _proj.z < 1
    const sx = (_proj.x * 0.5 + 0.5) * W
    const sy = (-_proj.y * 0.5 + 0.5) * H
    const dist = ship.position.distanceTo(position)
    // Out of weapon range: it can't be hit (and pirates only fire up close), so demote the
    // marker — dim it, drop the lead pip, and say so — instead of inviting futile fire.
    const engageable = isEngageable(dist)
    const onScreen = infront && sx >= 0 && sx <= W && sy >= 0 && sy <= H

    if (onScreen) {
      const s = 16
      cctx.save()
      if (!engageable) cctx.globalAlpha = 0.35
      cctx.strokeStyle = color; cctx.lineWidth = 2
      cctx.beginPath()
      for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
        cctx.moveTo(sx + ox * s, sy + oy * s); cctx.lineTo(sx + ox * s, sy + oy * (s - 6))
        cctx.moveTo(sx + ox * s, sy + oy * s); cctx.lineTo(sx + ox * (s - 6), sy + oy * s)
      }
      cctx.stroke()
      cctx.fillStyle = color; cctx.font = '11px ui-monospace, monospace'; cctx.textAlign = 'center'
      const text = engageable ? `${label} ${Math.round(dist)}m` : `${label} ${Math.round(dist)}m · OUT OF RANGE`
      cctx.fillText(text, sx, sy + s + 14)
      cctx.restore()
    } else {
      let dx = sx - cx, dy = sy - cy
      if (!infront) { dx = -dx; dy = -dy } // behind: flip so the arrow points the right way
      const ang = Math.atan2(dy, dx)
      const r = Math.min(W, H) * 0.4
      const ax = cx + Math.cos(ang) * r, ay = cy + Math.sin(ang) * r
      cctx.save(); cctx.translate(ax, ay); cctx.rotate(ang)
      if (!engageable) cctx.globalAlpha = 0.35
      cctx.fillStyle = color
      cctx.beginPath(); cctx.moveTo(13, 0); cctx.lineTo(-8, -7); cctx.lineTo(-8, 7); cctx.closePath(); cctx.fill()
      cctx.restore()
    }
    if (lead && engageable) markLeadTarget(position, velocity, dist)
  }

  for (const p of pirates) drawTarget(p.position, p.velocity, '#ff5d5d', 'HOSTILE')
  for (const drone of trainingDrones) drawTarget(drone.position, drone.velocity, '#58ddff', 'DRONE', false)

  const activePvpZone = pvpZoneAt(ship.position)
  if (activePvpZone) {
    for (const remote of remotes.values()) {
      if (pvpZoneAt(remote.mesh.position)?.id !== activePvpZone.id) continue
      const velocity = new THREE.Vector3()
      if (remote.peer.prev && remote.peer.receivedAt > remote.peer.prev.receivedAt) {
        const dt = (remote.peer.receivedAt - remote.peer.prev.receivedAt) / 1000
        if (dt > 0) velocity.fromArray(remote.peer.p).sub(new THREE.Vector3().fromArray(remote.peer.prev.p)).multiplyScalar(1 / dt)
      }
      drawTarget(remote.mesh.position, velocity, '#ff5dff', remote.peer.name.slice(0, 8).toUpperCase())
    }
  }

  // Lead indicator on the nearest target ahead — put your crosshair here to land hits.
  if (nearestPos) {
    const t = nd / PROJECTILE_SPEED
    _lead.copy(_leadVelocity).multiplyScalar(t).add(nearestPos)
    _proj.copy(_lead).project(camera)
    if (_proj.z < 1) {
      const lx = (_proj.x * 0.5 + 0.5) * W, ly = (-_proj.y * 0.5 + 0.5) * H
      cctx.strokeStyle = '#9fffb0'; cctx.lineWidth = 2
      cctx.beginPath(); cctx.arc(lx, ly, 8, 0, Math.PI * 2); cctx.stroke()
      cctx.beginPath()
      cctx.moveTo(lx - 13, ly); cctx.lineTo(lx - 4, ly); cctx.moveTo(lx + 4, ly); cctx.lineTo(lx + 13, ly)
      cctx.moveTo(lx, ly - 13); cctx.lineTo(lx, ly - 4); cctx.moveTo(lx, ly + 4); cctx.lineTo(lx, ly + 13)
      cctx.stroke()
    }
  }

  const hitAlpha = combatFeedbackAlpha(combatFeedback.hitMarker, now)
  if (hitAlpha > 0) {
    cctx.save()
    cctx.globalAlpha = hitAlpha
    cctx.strokeStyle = combatFeedback.hitMarker.color
    cctx.fillStyle = combatFeedback.hitMarker.color
    cctx.shadowColor = combatFeedback.hitMarker.color
    cctx.shadowBlur = 12
    cctx.lineWidth = 3
    const gap = 13
    const len = 28
    cctx.beginPath()
    cctx.moveTo(cx - gap, cy - gap); cctx.lineTo(cx - len, cy - len)
    cctx.moveTo(cx + gap, cy - gap); cctx.lineTo(cx + len, cy - len)
    cctx.moveTo(cx - gap, cy + gap); cctx.lineTo(cx - len, cy + len)
    cctx.moveTo(cx + gap, cy + gap); cctx.lineTo(cx + len, cy + len)
    cctx.stroke()
    cctx.font = '700 12px ui-monospace, monospace'
    cctx.textAlign = 'center'
    cctx.restore()
  }

  const killAlpha = combatFeedbackAlpha(combatFeedback.killBanner, now)
  if (combatFeedback.killBanner && killAlpha > 0) {
    cctx.save()
    cctx.globalAlpha = killAlpha
    cctx.textAlign = 'center'
    cctx.shadowColor = combatFeedback.killBanner.color
    cctx.shadowBlur = 18
    cctx.fillStyle = combatFeedback.killBanner.color
    cctx.font = '700 24px Orbitron, ui-monospace, monospace'
    cctx.fillText(combatFeedback.killBanner.text ?? '', cx, H * 0.31)
    if (combatFeedback.killBanner.subtext) {
      cctx.shadowBlur = 8
      cctx.fillStyle = '#ffe8ff'
      cctx.font = '700 13px ui-monospace, monospace'
      cctx.fillText(combatFeedback.killBanner.subtext, cx, H * 0.31 + 26)
    }
    cctx.restore()
  }

}

// --- Chase camera
const camOffset = new THREE.Vector3()
const camTarget = new THREE.Vector3()
let camBoost = false // last-known boost input, read by the camera for FOV punch
let camThrust = 0 // last-known commanded thrust 0..1, drives the engine flare (#2)
let prevBoost = false // edge-detect boost engage for the ignition kick
let boostKick = 0 // 1 on ignition, decays — drives camera pull-back, FOV punch, flare stretch
// G-force sway: the camera lags opposite to acceleration, so thrust/braking has weight.
const prevCamVel = new THREE.Vector3()
const gSway = new THREE.Vector3()
const _accel = new THREE.Vector3()
const _gTarget = new THREE.Vector3()
const _cameraLookAt = new THREE.Vector3()
const _cameraLookAtOffset = new THREE.Vector3()
const _timeTrialShowcaseCamera = new THREE.Vector3()
const _timeTrialShowcaseLookAt = new THREE.Vector3()
const G_SWAY_K = 0.03   // accel (m/s²) → offset (m)
const G_SWAY_MAX = 2.6  // clamp so it never gets nauseating
const G_SWAY_RESP = 6   // spring stiffness
// Point the Browse camera orbits — the Meridian Refinery station hub (REFINERY_POS), which is
// visible set-dressing AND where new pilots spawn (scatter r=200–600 around origin) face on
// arrival and cluster. Set in enterBrowseMode from station.position; origin orbits empty space.
// No player ship exists in Browse, so we never read ship.*.
const SPECTATE_ANCHOR = new THREE.Vector3(0, 0, 0)
const SPECTATE_ORBIT_DISTANCE = 600 // frames the station ring + nearby spawned pilots
function updateCamera(dt: number): void {
  if (spectating) {
    cameraOrbitElapsed += dt
    camera.position.copy(SPECTATE_ANCHOR).add(orbitCameraOffset(cameraOrbitElapsed, 0, SPECTATE_ORBIT_DISTANCE))
    camera.lookAt(SPECTATE_ANCHOR)
    return
  }
  if (SHOWCASE_TIME_TRIAL) {
    const startGate = hubTimeTrialGates[0].position
    _timeTrialShowcaseCamera.copy(timeTrialShowcaseApproachPoint(650, 112))
    _timeTrialShowcaseLookAt.copy(startGate).add(new THREE.Vector3(0, -8, 0))
    camera.position.copy(_timeTrialShowcaseCamera)
    camera.lookAt(_timeTrialShowcaseLookAt)
    camera.fov += (50 - camera.fov) * (1 - Math.exp(-6 * dt))
    camera.updateProjectionMatrix()
    return
  }

  // Acceleration this frame → a damped offset opposite to it (push back on boost, dip on brake).
  _accel.copy(ship.velocity).sub(prevCamVel).multiplyScalar(1 / Math.max(dt, 1e-4))
  prevCamVel.copy(ship.velocity)
  _gTarget.copy(_accel).multiplyScalar(-G_SWAY_K)
  if (_gTarget.lengthSq() > G_SWAY_MAX * G_SWAY_MAX) _gTarget.setLength(G_SWAY_MAX)
  gSway.lerp(_gTarget, 1 - Math.exp(-G_SWAY_RESP * dt))

  // Ignition kick: pull the camera back along its boom and punch FOV for a beat.
  if (SHOWCASE_HOLDER) {
    camOffset.set(4.6, 1.95, 3.2 + boostKick * 1.1).applyQuaternion(ship.quaternion)
  } else {
    if (cameraMode === 'orbit') {
      cameraOrbitElapsed += dt
      if (cameraOrbitWheelDelta !== 0) {
        cameraOrbitDistance = zoomOrbitDistance(cameraOrbitDistance, cameraOrbitWheelDelta)
        cameraOrbitWheelDelta = 0
      }
      camOffset.copy(orbitCameraOffset(cameraOrbitElapsed, boostKick, cameraOrbitDistance))
    } else {
      if (cameraRearWheelDelta !== 0) {
        cameraRearDistance = zoomRearDistance(cameraRearDistance, cameraRearWheelDelta)
        cameraRearWheelDelta = 0
      }
      camOffset.copy(rearCameraOffset(boostKick, cameraRearDistance))
    }
    camOffset.applyQuaternion(ship.quaternion)
  }
  camTarget.copy(ship.position).add(camOffset).add(gSway)
  camera.position.lerp(camTarget, 1 - Math.exp(-8 * dt))
  if (!SHOWCASE_HOLDER && cameraMode === 'orbit') {
    _cameraLookAtOffset.set(0, 0.18, 0).applyQuaternion(ship.quaternion)
    _cameraLookAt.copy(ship.position).add(_cameraLookAtOffset)
    camera.lookAt(_cameraLookAt)
  } else {
    camera.quaternion.slerp(ship.quaternion, 1 - Math.exp(-10 * dt))
  }
  // FOV gives a gentle sense of speed: a touch wider under boost / quantum travel. No hard punches.
  // Near the black hole it stretches hard (up to +20°) — a cheap "space is warping / lensing" feel.
  const targetFov = (SHOWCASE_HOLDER ? 48 : (quantum.phase === 'traveling' ? 78 : camBoost ? 82 : 72) + boostKick * 6)
    + bhPressure * 20
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-6 * dt))
  camera.updateProjectionMatrix()
}

// --- Launch flow
// Free Browse spectator mode for non-holders. Reveals the live sector (running=true so the frame
// loop renders and peers interpolate) WITHOUT promoting to a pilot. Replicates launch()'s overlay
// reveal but intentionally SKIPS: net.enterGame (stays a viewer), setPlayerCraft + shipMesh (no
// player ship), pointer lock + flight HUD reveal, audio init, daily/economy init, spawn scheduling.
function enterBrowseMode(): void {
  if (running) return // already in-world
  // Hide the landing FIRST so a later throw (e.g. a missing world symbol) can never leave the
  // overlay stuck up with "nothing happening". `#overlay { display:flex }` beats the UA [hidden]
  // rule, so both .hidden (with the !important CSS rule) and inline display:none are set.
  overlayEl.classList.add('hidden')
  overlayEl.hidden = true
  overlayEl.style.display = 'none'
  spectating = true
  running = true // needed so the frame loop renders + peers interpolate
  // station is a module-level Group (buildStation) created at load, so .position is always present.
  SPECTATE_ANCHOR.copy(station.position) // orbit the refinery hub — visible content + where pilots spawn/cluster
  cameraOrbitElapsed = 0 // start the orbit fresh so the first Browse frame faces the hub
  scene.remove(shipMesh) // no player ship in Browse
  if (statsTimer) clearInterval(statsTimer) // stop the landing-stats poll like launch() does
  if (document.pointerLockElement) document.exitPointerLock()
  browseBannerEl.hidden = false // persistent "connect to fly" banner
}

function launch(): void {
  if (running) return
  // Smart LAUNCH routing (client UX; the relay enforces the real boundary). Exempt showcase/bot auto-launch.
  if (!BOT && !CAPTURE_OG && !SHOWCASE_HOLDER && !SHOWCASE_TIME_TRIAL) {
    // Not connected → kick off connect; onHolder auto-enters once a ≥1 balance arrives.
    if (!walletConnected()) { pendingLaunch = true; setWalletStatus('Connect your wallet to fly…'); startWalletConnect(); return }
    // Connected but holds 0 → show the buy warning; don't enter.
    if (holderBalance < 1) { refreshLaunchGateUI(); return }
  }
  spectating = false // clear any prior Browse state so a real launch flies normally
  browseBannerEl.hidden = true
  const callsign = nicknameEl.value.trim() || 'PILOT'
  localStorage.setItem('callsign', callsign)
  if (BOT) {
    selfTier = 3                                   // local cosmetic: unlock the T3 hull skin for the showcase (relay still gates ranked by balance)
    selectedHolderShipVisual = 'void-interceptor' // T3 skin; with selfTier=3 it resolves now (no relay round-trip needed)
    setPlayerCraft('interceptor')                  // rebuild the hull; enterGame + the final setPlayerCraft use selfTier=3 → void-interceptor
    net.setBotSecret(localStorage.getItem('scc.botSecret') ?? '') // also lets the relay grant peers the T3 view
    // Start in a brief planet-style "perform" dwell at spawn, then the loop transits to the first stop.
    botPhase = 'perform'; botActivity = null; botStopKind = 'planet'
    botDwellUntil = performance.now() + 2000
  }
  net.enterGame(callsign, selectedShipType, activeHolderShipVisual()) // promote from viewer (presence) to an active pilot
  if (statsTimer) clearInterval(statsTimer)
  overlayEl.classList.add('hidden')
  overlayEl.hidden = true
  overlayEl.style.display = 'none'
  // BOT (stream view) shows the flight HUD — hull bar, status, minimap — but hides the wallet panel
  // (it holds credits + rank, which the no-progression bot leaves empty), plus help and crosshair.
  hudEl.hidden = CAPTURE_OG
  statusEl.hidden = CAPTURE_OG
  helpEl.hidden = (CAPTURE_OG || BOT) || MOBILE_COMPANION
  crosshairEl.hidden = (CAPTURE_OG || BOT)
  walletEl.hidden = (CAPTURE_OG || BOT)
  minimapWrapEl.hidden = CAPTURE_OG
  if (MOBILE_COMPANION) {
    document.documentElement.classList.add('mobile-flight')
    mobileControlsEl.hidden = false
  }
  leaderboardPanelEl.hidden = true
  dailyPanelEl.hidden = true
  updateWalletHUD() // HUD only — don't net.saveProgress before onProgress restores, or we'd overwrite saved data
  hullBarEl.style.width = '100%'
  nextSpawnAt = performance.now() + 8000 // first hostiles arrive after ~8s
  audio.init()
  audio.resume()
  running = true
  // Offline safety net: normally the relay answers with a 'progress' message (data or null) and
  // onProgress inits the daily loop. If we're disconnected (no relay), that never arrives — so after
  // a short delay, init locally if nothing else has. No-ops once any path has set the day.
  setTimeout(() => { if (running && dailyState.day === '') initDaily(Date.now()) }, 1500)
  selectedJumpIdx = nearestPlanetIdx() // start aimed at the closest planet
  customJumpDestination = null
  setPlayerCraft(selectedShipType) // apply hull (and load its GLB model) on launch
  schedulePlanetUpgrades()
  showFlightPlan()
}
launchEl.addEventListener('click', launch)
nicknameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') launch() })
browseBtnEl.addEventListener('click', () => enterBrowseMode())
browseBackEl.addEventListener('click', () => {
  spectating = false
  running = false
  browseBannerEl.hidden = true
  overlayEl.classList.remove('hidden')
  overlayEl.hidden = false
  overlayEl.style.display = '' // launch()/enterBrowseMode set 'none'; '' restores the stylesheet default
  scene.add(shipMesh) // restore for a later real launch
  // enterBrowseMode cleared the landing-stats poll — restart it (guard against double-intervals).
  if (statsTimer) clearInterval(statsTimer)
  refreshLandingStats()
  statsTimer = setInterval(refreshLandingStats, 6000)
})
export function launchGame(callsign?: string): void {
  if (callsign) nicknameEl.value = callsign
  launch()
}
if (CAPTURE_OG || SHOWCASE_HOLDER || SHOWCASE_TIME_TRIAL) {
  nicknameEl.value = SHOWCASE_HOLDER ? HOLDER_SHOWCASE_STEPS[0].callsign : SHOWCASE_TIME_TRIAL ? 'RACER' : 'test'
  requestAnimationFrame(() => launch())
}
if (BOT) {
  nicknameEl.value = 'CLAUDE'
  requestAnimationFrame(() => launch())
}
function hideFlightPlan(): void {
  flightPlanEl.hidden = true
}

function showFlightPlan(): void {
  if (CAPTURE_OG || BOT || SHOWCASE_HOLDER || SHOWCASE_TIME_TRIAL) return
  const visiblePlans = new Set(flightPlansForDevice(MOBILE_COMPANION).map((plan) => plan.id))
  for (const button of flightPlanButtons) {
    button.hidden = !visiblePlans.has(button.dataset.plan as FlightPlanId)
  }
  flightPlanEl.hidden = false
  if (document.pointerLockElement) document.exitPointerLock()
}

function applyFlightPlan(id: FlightPlanId): void {
  const plan = flightPlanById(id)
  if (!plan) return
  if (plan.destinationId) setQuantumDestinationById(plan.destinationId)
  spawnAtFlightPlan(plan.spawnMode)
  flightPlanObjective = plan.objective
  flightPlanObjectiveUntil = performance.now() + 45000
  hideFlightPlan()
  audio.blip('nav')
  requestFlightPointerLock()
}

function placePlayerAt(position: THREE.Vector3, target: THREE.Vector3): void {
  cancelTravel(quantum)
  ship.position.copy(position)
  ship.velocity.set(0, 0, 0)
  faceTarget(target)
  shipMesh.position.copy(ship.position)
  shipMesh.quaternion.copy(ship.quaternion)
  prevCamVel.set(0, 0, 0)
  camera.position.copy(ship.position).add(rearCameraOffset(0, cameraRearDistance).applyQuaternion(ship.quaternion))
  camera.lookAt(target)
  net.sendState(
    [ship.position.x, ship.position.y, ship.position.z],
    [ship.quaternion.x, ship.quaternion.y, ship.quaternion.z, ship.quaternion.w],
    performance.now(),
    selectedShipType,
    activeHolderShipVisual(),
  )
}

function spawnAtFlightPlan(spawnMode: FlightPlanSpawnMode): void {
  if (spawnMode === 'race-start') {
    hubTimeTrial.active = false
    hubTimeTrial.startArmed = true
    hubTimeTrial.startTime = 0
    hubTimeTrial.nextGateIndex = 0
    hubTimeTrial.lastFinishTime = null
    placePlayerAt(timeTrialShowcaseApproachPoint(560, 20), hubTimeTrialGates[0].position)
    return
  }
  if (spawnMode === 'pvp-practice') {
    _flightPlanSpawnDir.set(-0.65, 0.08, 0.5).normalize()
    placePlayerAt(
      PVP_PRACTICE_ZONE_CENTER.clone().addScaledVector(_flightPlanSpawnDir, PVP_PRACTICE_ZONE_RADIUS * 0.42),
      PVP_PRACTICE_ZONE_CENTER,
    )
    return
  }
  if (spawnMode === 'mine-field') {
    placePlayerAt(randomSpawn(), REFINERY_POS)
    streamOre()
    lastOreStream = performance.now()
    return
  }
  if (spawnMode === 'black-hole-approach') {
    placePlayerAt(BLACK_HOLE_APPROACH_DESTINATION.position.clone(), BLACK_HOLE_CENTER.clone())
    return
  }
  faceRefinery()
  ship.velocity.set(0, 0, 0)
}

flightPlanSkipEl.addEventListener('click', hideFlightPlan)
for (const button of flightPlanButtons) {
  button.addEventListener('click', () => applyFlightPlan(button.dataset.plan as FlightPlanId))
}
renderer.domElement.addEventListener('click', () => {
  if (running && !docked && !chatOpen && settingsPanelEl.hidden && !solarMap.isOpen && document.pointerLockElement !== renderer.domElement) {
    requestFlightPointerLock()
  }
})

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  composer.setSize(innerWidth, innerHeight)
  labelRenderer.setSize(innerWidth, innerHeight)
  combatCanvas.width = innerWidth
  combatCanvas.height = innerHeight
})

// --- Main loop
let running = false
// Free spectator (Browse) mode for non-holders: the world renders and peers interpolate
// (running=true), but there is no player ship and all flight/combat/dock input is inert.
let spectating = false
let last = performance.now()
let hiddenQuantumAt: number | null = null

// --- Minimap (top-down radar, north-up, player-centered)
const MAP_RANGE = 4500 // world units from player to minimap edge
function atmoColorFor(surface: string): string {
  return surface === 'earth' ? '#88bbff'
    : surface === 'venus' ? '#e8c070'
    : surface === 'mars' ? '#d98a5a'
    : surface === 'gas' ? '#d8c0a0'
    : '#9fb4c8'
}

const _skyN = new THREE.Vector3()
const _skySun = new THREE.Vector3()
// Atmospheric-entry sky: the closer you get to a planet's surface, the more the screen
// fills with that planet's air color — brighter on the sun-facing (day) side, fading to
// dark space at night. A sense of descending into the atmosphere and flying under its sky.
function updateAtmoVeil(): number {
  let prox = 0
  let surface = 'rocky'
  let nx = 0, ny = 0, nz = 0
  for (const p of [...PLANETS, SPAWN_PLANET]) {
    const d = ship.position.distanceTo(p.position)
    const pr = 1 - Math.min(1, Math.max(0, (d - p.radius * 1.06) / (p.radius * 1.6)))
    if (pr > prox) { prox = pr; surface = p.surface; nx = p.position.x; ny = p.position.y; nz = p.position.z }
  }
  if (prox > 0.01) {
    // Day/night at our spot on the planet → sky brightness.
    _skyN.set(ship.position.x - nx, ship.position.y - ny, ship.position.z - nz).normalize()
    _skySun.set(SUN_POSITION.x - ship.position.x, SUN_POSITION.y - ship.position.y, SUN_POSITION.z - ship.position.z).normalize()
    const day = THREE.MathUtils.clamp(_skyN.dot(_skySun) * 0.5 + 0.5, 0, 1)
    const sky = atmoColorFor(surface)
    atmoVeilEl.style.background = `radial-gradient(ellipse at center, transparent 22%, ${sky} 128%)`
    atmoVeilEl.style.opacity = String(Math.min(0.82, prox) * (0.18 + day * 0.82))
  } else {
    atmoVeilEl.style.background = 'none'
    atmoVeilEl.style.opacity = '0'
  }
  return prox
}

const _altN = new THREE.Vector3()
// Low-altitude readout: height above the nearest solid planet's sampled terrain.
function updateAltitudeHUD(): void {
  let best: typeof PLANETS[number] | null = null
  let bestD = Infinity
  for (const p of PLANETS) {
    const d = ship.position.distanceTo(p.position)
    if (d < bestD) { bestD = d; best = p }
  }
  if (best && bestD < best.radius * 2.5) {
    _altN.set(ship.position.x - best.position.x, ship.position.y - best.position.y, ship.position.z - best.position.z).normalize()
    const solid = best.surface !== 'gas' && best.surface !== 'venus'
    const s = solid ? samplePlanetSurface(best.surface, best.seed, _altN.x, _altN.y, _altN.z, best.color, best.radius) : null
    const terrainR = s ? best.radius + s.height * best.radius * 0.055 * 1.6 : best.radius
    const alt = Math.max(0, Math.round(bestD - terrainR))
    altLabelEl.textContent = `ALT ${alt.toLocaleString()} m`
    altLineEl.hidden = false
  } else {
    altLineEl.hidden = true
  }
}

function updateDepthHUD(): void {
  const df = deepFactor()
  let label: string, color: string
  if (df < 0.12) { label = 'CORE SPACE'; color = '#6fdc8c' }
  else if (df < 0.45) { label = 'FRONTIER'; color = '#bfe06f' }
  else if (df < 0.75) { label = 'DEEP SPACE'; color = '#ffb347' }
  else { label = 'FAR REACHES'; color = '#ff5d5d' }
  depthLabelEl.textContent = label
  depthLabelEl.style.color = color
  depthBarEl.style.width = `${Math.round(df * 100)}%`
  depthBarEl.style.background = color
}

function drawMinimap(): void {
  const w = minimapCanvas.width
  const c = w / 2
  const R = c - 4
  mctx.clearRect(0, 0, w, w)
  mctx.strokeStyle = 'rgba(63,174,95,0.14)'
  mctx.beginPath(); mctx.arc(c, c, R * 0.5, 0, Math.PI * 2); mctx.stroke()

  const plot = (wx: number, wz: number, color: string, size: number, clampEdge: boolean, outline = false): void => {
    let mx = ((wx - ship.position.x) / MAP_RANGE) * R
    let my = ((wz - ship.position.z) / MAP_RANGE) * R
    const d = Math.hypot(mx, my)
    if (d > R) {
      if (!clampEdge) return
      mx = (mx / d) * R; my = (my / d) * R
    }
    mctx.fillStyle = color
    mctx.beginPath(); mctx.arc(c + mx, c + my, size, 0, Math.PI * 2); mctx.fill()
    if (outline) {
      mctx.strokeStyle = 'rgba(255,255,255,0.85)'; mctx.lineWidth = 1
      mctx.stroke()
    }
  }

  for (const mesh of spawnedBodies.values()) plot(mesh.position.x, mesh.position.z, 'rgba(150,170,190,0.55)', 1.4, false)
  plot(SUN_POSITION.x, SUN_POSITION.z, '#fff0be', 3, true)
  for (const planet of PLANETS) plot(planet.position.x, planet.position.z, '#9bb8e0', 2, true)
  plot(REFINERY_POS.x, REFINERY_POS.z, '#6fdc8c', 3.4, true, true)
  plot(COLONY_POS.x, COLONY_POS.z, '#ffb347', 3.4, true, true)
  plot(CITIZEN_SEASON_HUB_DESTINATION.position.x, CITIZEN_SEASON_HUB_DESTINATION.position.z, '#5df4ff', 3.5, true, true)
  plot(TRAINING_RANGE_DESTINATION.position.x, TRAINING_RANGE_DESTINATION.position.z, '#9fffb0', 3.2, true, true)
  plot(PVP_PRACTICE_ZONE_CENTER.x, PVP_PRACTICE_ZONE_CENTER.z, '#5df4ff', 3.2, true, true)
  plot(PVP_RANKED_ZONE_CENTER.x, PVP_RANKED_ZONE_CENTER.z, '#ffd24d', 3.2, true, true)
  for (const p of pirates) plot(p.position.x, p.position.z, '#ff5d5d', 2.2, false)

  // player heading arrow at center
  _fwd.set(0, 0, -1).applyQuaternion(ship.quaternion)
  const ang = Math.atan2(_fwd.x, -_fwd.z)
  mctx.save(); mctx.translate(c, c); mctx.rotate(ang)
  mctx.fillStyle = '#9fffb0'
  mctx.beginPath(); mctx.moveTo(0, -5); mctx.lineTo(3.5, 4); mctx.lineTo(-3.5, 4); mctx.closePath(); mctx.fill()
  mctx.restore()
}

function syncQuantumShipVisual(): void {
  shipMesh.position.copy(ship.position)
  if (ship.velocity.lengthSq() > 1) {
    _qLook.copy(ship.position).add(ship.velocity)
    shipMesh.lookAt(_qLook)
    ship.quaternion.copy(shipMesh.quaternion)
  }
}

function updateQuantumHud(qr: { phase: 'idle' | 'spooling' | 'traveling'; progress: number }): void {
  quantumEl.hidden = qr.phase === 'idle'
  if (qr.phase === 'idle') return
  quantumEl.textContent = qr.phase === 'spooling'
    ? `QUANTUM SPOOLING -> ${jumpTargetName}...`
    : `QUANTUM TRAVEL -> ${jumpTargetName} - ${Math.round(qr.progress * 100)}%`
}

function catchUpHiddenQuantum(now = performance.now()): void {
  if (hiddenQuantumAt === null) return
  const elapsed = (now - hiddenQuantumAt) / 1000
  hiddenQuantumAt = null
  if (running && !docked && quantum.phase !== 'idle') {
    const qr = catchUpQuantum(quantum, ship.position, ship.velocity, elapsed)
    syncQuantumShipVisual()
    updateQuantumHud(qr)
  }
  last = now
}

document.addEventListener('visibilitychange', () => {
  const now = performance.now()
  if (document.hidden) {
    hiddenQuantumAt = now
    return
  }
  catchUpHiddenQuantum(now)
})

// --- DEV frame profiler: when a frame busts the budget, log which sections ate the time.
// Stripped from production via import.meta.env.DEV. Watch the console while flying; a slow frame
// prints e.g. "[frame 38.2ms] render 22.1 · stream 9.4 · minimap 3.1" so the culprit is obvious.
const DEV_PROFILE = import.meta.env.DEV
const FRAME_LOG_MS = 24
let _pfStart = 0
let _pfPrev = 0
const _pfSections: Array<[string, number]> = []
function pfBegin(_now: number): void {
  if (!DEV_PROFILE) return
  _pfSections.length = 0
  // Use performance.now() (NOT the rAF timestamp arg): pfMark/pfEnd also use performance.now(),
  // and the rAF timestamp is the *scheduled* frame time, which can lag wall-clock by the duration
  // of any prior main-thread stall (a big build, shader compile, GC). Mixing the two dumps that
  // stall onto the first mark, making an innocent section look like it froze for ~1.7s.
  const t = performance.now()
  _pfStart = t
  _pfPrev = t
}
function pfMark(label: string): void {
  if (!DEV_PROFILE) return
  const t = performance.now()
  _pfSections.push([label, t - _pfPrev])
  _pfPrev = t
}
function pfEnd(): void {
  if (!DEV_PROFILE) return
  const total = performance.now() - _pfStart
  if (total > FRAME_LOG_MS) {
    const parts = _pfSections
      .filter(([, ms]) => ms >= 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([l, ms]) => `${l} ${ms.toFixed(1)}`)
    console.warn(`[frame ${total.toFixed(1)}ms] ${parts.join(' · ')}`)
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame)
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  pfBegin(now)

  // Full-screen overlays own the screen. Pause the game's sim/render so UI clicks do not
  // compete with WebGL, LOD swaps, or texture work on the same main thread.
  if (!shouldRenderWorldFrame({ running, docked, solarMapOpen: solarMap.isOpen })) return

  station.rotation.z += dt * 0.05
  colony.rotation.y += dt * 0.03
  starfield.position.copy(ship.position) // keep the star backdrop centered on the player
  nebula.position.copy(ship.position) // nebula skydome rides with the player too
  for (const g of planetGroups) g.rotation.y += dt * (g.userData.spin as number) // living, rotating worlds
  capital.rotation.y += dt * 0.0015 // capital ship drifts almost imperceptibly
  capitalCarrier.rotation.y -= dt * 0.0011 // different silhouette, different lazy drift
  updateSeasonHubLifeRig(seasonHubLifeRig, now * 0.001, dt)
  syncHubTimeTrialGates(now * 0.001)
  ;(sun.userData.sunMat as THREE.ShaderMaterial).uniforms.uTime.value = now * 0.001 // boil the star surface
  if (shouldRunBackgroundWorldWork({ running, docked })) {
    streamCelestials(now)
    pfMark('stream')
    processCelestialBuilds()
    pfMark('build')
    upgradeNextPlanet(now)
    for (const lod of planetLODs) lod.update(camera) // swap planet detail by distance
  }

  if (running && !docked && quantum.phase !== 'idle') {
    // Quantum jump in progress: the drive flies the ship; normal flight/combat is suspended.
    pvpEl.hidden = true
    const qr = stepQuantum(quantum, ship.position, ship.velocity, dt)
    syncQuantumShipVisual()
    updateQuantumHud(qr)
    navHintEl.textContent = ''
    audio.setThrust(qr.phase === 'traveling' ? 0.75 : 0.2, qr.phase === 'traveling', qr.phase === 'traveling' ? 0.95 : 0)
    audio.setAmbience({
      atmosphere: 0,
      quantum: qr.phase === 'spooling' ? 0.55 : 1,
      speedFrac: qr.phase === 'traveling' ? 1.2 : 0.25,
    })
    audio.setRegionalAmbience(applyAmbientVolume({ kind: 'deepSpace', intensity: 0.2 }))
    net.sendState(
      [ship.position.x, ship.position.y, ship.position.z],
      [ship.quaternion.x, ship.quaternion.y, ship.quaternion.z, ship.quaternion.w],
      now,
      selectedShipType,
      activeHolderShipVisual(),
    )
  } else if (running && !docked && !spectating) {
    // Idle: small nav hint under the minimap (no big banner).
    quantumEl.hidden = true
    const dest = destinationArrival()
    navHintEl.textContent = MOBILE_COMPANION
      ? `[NAV] ${dest.name} | ${(dest.dist / 1000).toFixed(1)} km | [JUMP]`
      : `[B/N] pick destination | ${dest.name} | ${(dest.dist / 1000).toFixed(1)} km   |   [J] jump`
    const flightTuning = hubTimeTrial.active
      ? { maxSpeed: baseSpeed, boostMultiplier: baseBoost }
      : { maxSpeed: effSpeed(), boostMultiplier: effBoost() }
    let input: ControlInput
    if (BOT) {
      input = { thrust: new THREE.Vector3(), pitch: 0, yaw: 0, roll: 0, boost: false, brake: false, assist: true }
      weaponActive = false
      const idle = quantum.phase === 'idle'
      // We only enter 'transit' right after a jump starts (phase != idle), so transit + idle = arrived.
      // (Robust against a missed traveling→idle edge, e.g. a backgrounded tab fast-forwarding the jump.)
      if (botPhase === 'transit' && idle) {
        if (botStopKind === 'planet') { botActivity = null; botDwellUntil = now + BOT_PLANET_DWELL_MS }
        else { botActivity = buildActivity(botStopKind, ship.position, Math.random, now, BOT_WORLD); botPerformUntil = now + BOT_PERFORM_CAP_MS; net.sendChat(botActivity.intro) }
        botPhase = 'perform'
      }
      if (botPhase === 'perform' && idle) {
        if (botActivity) {
          // Run the local maneuver on-rails. Each activity carries its own speed (close-quarters content
          // flies near real flight speed; the black-hole dive boosts) — no global cap, so it reads naturally.
          const cmd = stepActivity(botActivity, ship.position, dt, now, BOT_WORLD)
          if (cmd.done || now >= botPerformUntil) {
            // Content done → linger and wander the spot for a few seconds before jumping on. The wander
            // activity itself ends straight into the next transit (so we never nest wander-on-wander).
            if (botActivity.kind === 'wander') startBotTransit()
            else { botActivity = buildActivity('wander', ship.position, Math.random, now, BOT_WORLD); botPerformUntil = now + BOT_PERFORM_CAP_MS }
          } else {
            if (botActivity.kind === 'pvp-training' && botActivity.phase === 'spar') {
              const targetDrone = trainingDrones
                .filter((drone) => !isDead(drone.health))
                .sort((a, b) => ship.position.distanceToSquared(a.position) - ship.position.distanceToSquared(b.position))[0]
              if (targetDrone) {
                cmd.target = targetDrone.position
                cmd.speed = Math.max(cmd.speed, 520)
                weaponActive = true
              }
            }
            _botPrevPos.copy(ship.position)
            const r = stepMover(ship.position, cmd.target, cmd.speed, dt)
            ship.position.copy(r.pos)
            ship.quaternion.copy(r.quat)
            ship.velocity.copy(r.pos).sub(_botPrevPos).multiplyScalar(1 / Math.max(dt, 1e-4))
          }
        } else if (now >= botDwellUntil) {
          startBotTransit() // planet loiter done — move on
        } else {
          input.thrust.set(0, 0, -0.3) // gentle, boost-free drift while loitering at the planet
          stepShip(ship, input, dt, flightTuning)
        }
      }
      // during TRANSIT the quantum drive (above) owns movement — don't fight it
    } else {
      input = readInput(dt)
      stepShip(ship, input, dt, flightTuning)
    }
    if (quantum.phase === 'idle') {
      ship.velocity.addScaledVector(gravityAccel(ship.position, _bhGrav), dt)
      if (isPastHorizon(ship.position)) {
        singularityDeath(now) // hard backstop — crossing the horizon is always fatal
      } else {
        const dps = tidalDamageRate(ship.position)
        if (dps > 0) {
          applyDamage(playerHealth, dps * dt) // hull bleeds the deeper you dive
          lastPlayerDamageAt = now // suppresses auto-repair while in the zone
          damageFlash() // sustained red vignette: you're being torn apart
          if (isDead(playerHealth)) singularityDeath(now)
        }
      }
    }
    // Distance fade so the glow/disk show only once you're near, never looming from across the system.
    const bhDist = _bhToCam.copy(BLACK_HOLE_CENTER).sub(camera.position).length()
    const bhDistFactor = Math.max(0, Math.min(1, 1 - (bhDist - INFLUENCE_RADIUS) / INFLUENCE_RADIUS))
    blackHoleVisual.update(dt, bhDistFactor)
    pfMark('sim')
    const inInfluence = withinInfluence(ship.position)
    const diving = inInfluence && quantum.phase === 'idle'
    if (diving) {
      const d = distanceToCenter(ship.position)
      if (!blackHoleRun.active) enterRun(blackHoleRun, d)
      else sampleRun(blackHoleRun, d)
      // proximity: 0 at the influence edge, 1 at the horizon
      const p = Math.max(0, Math.min(1, 1 - (d - HORIZON_RADIUS) / (INFLUENCE_RADIUS - HORIZON_RADIUS)))
      bhPressure = p
      if (p > 0.55) bhShake = Math.max(bhShake, ((p - 0.55) / 0.45) * 0.6) // shudder builds toward the horizon
      blackHoleEl.hidden = false
      // Escape readout: current pull vs the engine authority a full boost-out can muster
      // (accelResponse ×1.8 while boosting × this hull's max boost speed). r≥1 ⇒ past the point of no return.
      const escapeAuthority = TUNING.accelResponse * 1.8 * effSpeed() * effBoost()
      const r = escapeAuthority > 0 ? _bhGrav.length() / escapeAuthority : 99
      const esc = r >= 1 ? '  ·  ⚠ NO ESCAPE' : r >= 0.7 ? '  ·  ESCAPE: MARGINAL' : '  ·  ESCAPE: OK'
      // CLOSEST gets a '*' until the dive reaches the tidal zone — only then will it qualify for the board.
      const closest = `${Math.round(blackHoleRun.min).toLocaleString()}${blackHoleRun.min < TIDAL_RADIUS ? '' : '*'}`
      blackHoleEl.textContent = `${p > 0.55 ? '⚠ GRAVITY WELL' : 'BLACK HOLE'}  ${Math.round(d).toLocaleString()}  ·  CLOSEST ${closest}${esc}`
    } else {
      // Ship left influence OR started a quantum jump — either way the run ended alive, so submit it
      // (exitRunAlive gates on the tidal radius and resets the run; null = never qualified).
      if (blackHoleRun.active) {
        const best = exitRunAlive(blackHoleRun)
        if (best != null && !BOT) net.sendBlackHoleRun(best)
      }
      bhPressure = 0
      if (!blackHoleEl.hidden) blackHoleEl.hidden = true
    }
    resolvePlanetCollisions()
    resolveCapitalCollision()
    enforceRankedArenaAccess(now)
    enforceMobilePvpExclusion(now)
    shipMesh.position.copy(ship.position)
    shipMesh.quaternion.copy(ship.quaternion)

    const trialNow = now * 0.001
    const previousBest = hubTimeTrial.bestTime
    const trialUpdate = updateTimeTrial(hubTimeTrial, ship.position, trialNow)
    if (trialUpdate.event === 'start') {
      timeTrialBannerText = `HUB TIME TRIAL - START - GATE 2/${hubTimeTrial.gates.length}`
      timeTrialMessageUntil = trialNow + 2.5
      showTimeTrialCenterBanner(timeTrialEventBannerText(trialUpdate, hubTimeTrial.gates.length), trialNow, 2.6)
      audio.blip('nav')
    } else if (trialUpdate.event === 'gate') {
      timeTrialBannerText = `HUB TIME TRIAL - GATE ${hubTimeTrial.nextGateIndex}/${hubTimeTrial.gates.length}`
      timeTrialMessageUntil = trialNow + 1.6
      showTimeTrialCenterBanner(timeTrialEventBannerText(trialUpdate, hubTimeTrial.gates.length), trialNow, 1.1)
      audio.blip('nav')
    } else if (trialUpdate.event === 'finish' && trialUpdate.time !== undefined) {
      const isNewBest = previousBest === null || trialUpdate.time < previousBest
      if (hubTimeTrial.bestTime !== null) saveTimeTrialBest(hubTimeTrial.bestTime)
      timeTrialBannerText = `${isNewBest ? 'NEW BEST' : 'FINISH'} - ${formatTrialTime(trialUpdate.time)}`
      if (!BOT) net.sendRaceFinish(Math.round(trialUpdate.time * 1000))
      timeTrialMessageUntil = trialNow + 5
      showTimeTrialCenterBanner(timeTrialEventBannerText(trialUpdate, hubTimeTrial.gates.length, isNewBest, previousBest), trialNow, 4)
      showRaceFinishGlow(trialNow)
      audio.blip('trade')
    }
    if (timeTrialCenterBannerUntil > 0 && trialNow >= timeTrialCenterBannerUntil) {
      timeTrialBannerEl.hidden = true
      timeTrialCenterBannerUntil = 0
    } else if (timeTrialCenterBannerUntil > 0 && trialNow > timeTrialCenterBannerUntil - 0.35) {
      timeTrialBannerEl.style.opacity = '0'
    }
    if (raceFinishGlowUntil > 0 && trialNow >= raceFinishGlowUntil) {
      raceFinishGlowEl.style.opacity = '0'
      raceFinishGlowUntil = 0
    } else if (raceFinishGlowUntil > 0 && trialNow > raceFinishGlowUntil - 0.2) {
      raceFinishGlowEl.style.opacity = '0'
    }
    const nearTimeTrial = ship.position.distanceToSquared(timeTrialOrigin) < 4200 * 4200
    timeTrialEl.hidden = !hubTimeTrial.active && !nearTimeTrial && trialNow >= timeTrialMessageUntil
    if (!timeTrialEl.hidden) {
      if (trialNow < timeTrialMessageUntil && timeTrialBannerText) {
        timeTrialEl.textContent = timeTrialBannerText
      } else if (hubTimeTrial.active) {
        timeTrialEl.textContent = timeTrialStatusText(hubTimeTrial, trialNow)
      } else {
        const best = hubTimeTrial.bestTime === null ? 'NO BEST' : `BEST ${formatTrialTime(hubTimeTrial.bestTime)}`
        timeTrialEl.textContent = `HUB TIME TRIAL - ENTER GOLD GATE - ${best}`
      }
    }

    speedEl.textContent = String(Math.round(ship.velocity.length()))
    boostEl.style.visibility = input.boost ? 'visible' : 'hidden'
    camBoost = input.boost
    if (input.boost && !prevBoost) {
      boostKick = 1
      audio.playBoostPunch(ship.velocity.length() / flightTuning.maxSpeed)
    } // ignition punch
    prevBoost = input.boost

    // Engine audio tracks commanded thrust; wind layer tracks actual speed. The bot flies on-rails with
    // no thrust input, so for it the engine note tracks actual speed instead — else content play is silent.
    camThrust = BOT ? Math.min(1, ship.velocity.length() / BOT_ENGINE_REF_SPEED) : Math.min(1, input.thrust.length())
    audio.setThrust(camThrust, input.boost || (BOT && ship.velocity.length() > 1500), ship.velocity.length() / flightTuning.maxSpeed)

    // Market prices drift back toward base over time.
    marketStep(market, dt)

    if (MOBILE_COMPANION) {
      miningActive = mobileMineHeld
      weaponActive = false
    }

    // Mining: transfer ORE from the nearest in-range asteroid while the laser is held.
    const mineResult = mineStep(field, ship.position, econ, dt, miningActive, effCargo(), miningYield(upgrades))
    if (mineResult.mined > 0 && mineResult.asteroid) {
      recordDailyEvent('mine_ore', mineResult.mined, now)
      applyCampaignAdvance(recordCampaignEvent(campaign, 'mine_ore', mineResult.mined), now)
      if (!minedEver) markOnboard('scc.ob.mined', (v) => { minedEver = v }) // onboarding step 1
      const rm = rockMeshes.get(mineResult.asteroid.id)
      if (rm?.rare) gainCredits(econ, mineResult.mined * ORE_RARE_BONUS) // rare vein jackpot, on top of the ORE
      updateWalletHUD()
      if (rm) {
        const ratio = Math.max(0, mineResult.asteroid.reserves / rm.initial)
        rm.mesh.scale.setScalar(0.3 + 0.7 * ratio)
        if (mineResult.asteroid.reserves <= 0) rm.mesh.visible = false
      }
      // Accumulate mined ORE into periodic floating "+N ORE" cues (gold for a rare vein).
      oreAccum += mineResult.mined
      if (now - lastFloat > 500 && oreAccum >= 1) {
        spawnFloat(`+${Math.floor(oreAccum)} ORE`, mineResult.asteroid.position, now, rm?.rare ? '#ffd24d' : undefined)
        oreAccum -= Math.floor(oreAccum)
        lastFloat = now
      }
      if (now - lastSave > 2000) { saveEconomy(econ); net.saveProgress(currentProgress()); lastSave = now }
    }
    updateMiningVFX(miningActive && mineResult.inRange, mineResult.asteroid?.position ?? null, now)
    audio.setMining(miningActive, mineResult.inRange)
    mineEl.hidden = !(miningActive && mineResult.inRange)

    // Keep the ore pool flowing around the player: cull depleted/distant veins, respawn fresh ones.
    if (now - lastOreStream > 400) { streamOre(); lastOreStream = now }

    dockable = dockableTarget(ship.position, ship.velocity.length(), dockTargets)
    dockPromptEl.hidden = dockable === null

    net.sendState(
      [ship.position.x, ship.position.y, ship.position.z],
      [ship.quaternion.x, ship.quaternion.y, ship.quaternion.z, ship.quaternion.w],
      now,
      selectedShipType,
      activeHolderShipVisual(),
    )

    // --- Combat
    const pvpZone = pvpZoneAt(ship.position)
    const pvpProximity = pvpZoneProximity(ship.position)
    const pvpActive = pvpCombatActive(ship.position, MOBILE_COMPANION)
    const trainingProtected = isInTrainingRange(ship.position)
    const dronesActive = trainingDronesActive(ship.position, MOBILE_COMPANION, trainingDrones.length > 0)
    const pvpProtected = pvpZone !== null
    const rankedDenied = now < rankedPvpDeniedUntil
    const pvpCombatTagged = now - lastPvpCombatAt < PVP_COMBAT_TAG_MS
    pvpEl.hidden = !pvpActive && !trainingProtected && !rankedDenied && !pvpProximity && !pvpCombatTagged
    if (rankedDenied) {
      pvpEl.textContent = MOBILE_COMPANION ? 'PVP DESKTOP ONLY' : `RANKED LOCKED - HOLD ${PVP_RANKED_MIN_TOKEN_BALANCE.toLocaleString()} TOKENS`
    } else if (trainingProtected) {
      pvpEl.textContent = MOBILE_COMPANION ? 'TRAINING DESKTOP ONLY' : 'TRAINING RANGE - DRONES ACTIVE'
    } else if (MOBILE_COMPANION && pvpProtected) {
      pvpEl.textContent = 'PVP DESKTOP ONLY'
    } else if (pvpZone?.id === 'ranked') {
      pvpEl.textContent = 'RANKED PVP ENABLED'
    } else if (pvpZone?.id === 'practice') {
      pvpEl.textContent = 'PRACTICE PVP ENABLED'
    } else if (pvpProximity) {
      const entryMeters = Math.max(0, Math.ceil(pvpProximity.distanceToBoundary))
      const zoneName = pvpProximity.zone.id === 'ranked' ? 'RANKED ARENA' : 'PRACTICE ARENA'
      if (MOBILE_COMPANION) {
        pvpEl.textContent = `PVP DESKTOP ONLY - ${entryMeters}m TO ARENA`
      } else if (pvpProximity.zone.id === 'ranked' && !rankedPvpAccess(selfHolderBalance)) {
        pvpEl.textContent = `RANKED LOCKED - ${entryMeters}m TO BARRIER`
      } else {
        pvpEl.textContent = `${zoneName} - ENTRY ${entryMeters}m`
      }
    } else if (pvpCombatTagged) {
      pvpEl.textContent = `IN COMBAT ${Math.ceil((PVP_COMBAT_TAG_MS - (now - lastPvpCombatAt)) / 1000)}s`
    }
    const pvpWeapon = pvpWeaponForShip(selectedShipType)
    const combatWeaponActive = pvpActive || dronesActive || pvpCombatTagged
    playerWeapon.interval = combatWeaponActive ? pvpWeapon.interval : 0.16
    stepWeapon(playerWeapon, dt)
    if (weaponActive && canFire(playerWeapon)) {
      _fwd.set(0, 0, -1).applyQuaternion(ship.quaternion)
      projectiles.push(spawnProjectile(
        ship.position,
        _fwd,
        'player',
        PROJECTILE_SPEED,
        combatWeaponActive ? pvpWeapon.damage : PROJECTILE_DAMAGE + unlocksForLevel(pilot.level).weaponDamageBonus,
        ship.velocity,
      ))
      fireWeapon(playerWeapon)
      audio.blip('fire')
    }

    // Safe zone: near an outpost, hostiles break off and leave you alone.
    const safe = inSafeZone(ship.position)
    const repairing = updateSafeRepair(safe, pvpActive, now, dt)
    safeEl.hidden = !safe
    safeEl.textContent = repairing ? 'SAFE ZONE · HULL REPAIRING' : 'SAFE ZONE'
    const pirateProjectileCount = projectiles.reduce((count, projectile) => count + (projectile.faction === 'pirate' ? 1 : 0), 0)
    const pveHostilesAllowed = allowsPveHostiles(ship.position, MOBILE_COMPANION)
    if (shouldClearPveHostiles({ safe, pvpActive: pvpProtected, trainingActive: dronesActive || trainingProtected, mobileCivilian: MOBILE_COMPANION, pirates: pirates.length, pirateProjectiles: pirateProjectileCount })) {
      clearPirates()
    }

    if (!safe && pveHostilesAllowed && !BOT && now >= nextSpawnAt) {
      spawnPirateWave(now)
      maybeSpawnNamedRaider(now)
      nextSpawnAt = now + 19000
    }

    if (dronesActive) {
      if (trainingProtected) ensureTrainingDrones()
      for (const drone of trainingDrones) {
        stepTrainingDrone(drone, ship.position, dt)
        const mesh = ensureTrainingDroneMesh(drone)
        mesh.position.copy(drone.position)
        mesh.lookAt(ship.position)
      }
    } else if (trainingDrones.length > 0) {
      clearTrainingDrones()
    }

    for (const pirate of pirates) {
      const r = stepPirate(pirate, ship.position, dt)
      if (r.fired) projectiles.push(r.fired) // pirate fire is silent — many at once would be noise
      const mesh = pirateMeshes.get(pirate.id)
      if (mesh) {
        mesh.position.copy(pirate.position)
        mesh.lookAt(ship.position)
      }
      // Enemy readout (elite/named only): track the ship, fill the hull bar, and distance-fade
      // like peer nameplates so distant threats don't clutter the screen.
      const label = pirateLabels.get(pirate.id)
      if (label) {
        label.position.copy(pirate.position)
        label.position.y += 3.2 * TIER_SCALE[pirate.tier]
        const d = ship.position.distanceTo(pirate.position)
        const op = 1 - THREE.MathUtils.clamp((d - NAMEPLATE_FADE_NEAR) / (NAMEPLATE_FADE_FAR - NAMEPLATE_FADE_NEAR), 0, 1)
        label.visible = op > 0.02
        ;(label.element as HTMLElement).style.opacity = String(op)
        updateEnemyLabelHealth(label.element as HTMLElement, hullFraction(pirate.health))
      }
    }

    stepProjectiles(projectiles, dt)

    const targets: HitTarget[] = [
      { position: ship.position, radius: 4, health: playerHealth, faction: 'player' },
      ...pirates.map((p) => ({ position: p.position, radius: 5, health: p.health, faction: 'pirate' as const })),
      ...trainingDrones.map((drone) => ({ id: drone.id, position: drone.position, radius: drone.radius, health: drone.health, faction: 'pirate' as const })),
      ...(pvpActive && pvpZone
        ? [...remotes.entries()]
            .filter(([, r]) => pvpZoneAt(r.mesh.position)?.id === pvpZone.id)
            .map(([id, r]) => ({ id, position: r.mesh.position, radius: PVP_PEER_HIT_RADIUS, health: r.health, faction: 'peer' as const }))
        : pvpCombatTagged
          // Combat-tagged pursuit outside the zone: target all peers; the server authoritatively
          // gates the hit on both parties being tagged + within range, so loose client targeting is safe.
          ? [...remotes.entries()]
              .map(([id, r]) => ({ id, position: r.mesh.position, radius: PVP_PEER_HIT_RADIUS, health: r.health, faction: 'peer' as const }))
          : []),
    ]
    const hits = resolveHits(projectiles, targets)
    pfMark('combat')
    for (const h of hits) {
      audio.blip('hit')
      if (h.target.faction === 'pirate') {
        registerHitMarker(combatFeedback, now)
        spawnHitSpark(h.target.position, now)
      }
      if (h.target.faction === 'player') {
        damageFlash()
        lastPlayerDamageAt = now
      }
      if (h.target.faction === 'peer' && h.target.id) {
        net.sendPvpHit(h.target.id)
        lastPvpCombatAt = now
      }
    }

    for (let i = pirates.length - 1; i >= 0; i--) {
      if (isDead(pirates[i].health)) {
        const p = pirates[i]
        spawnExplosion(p.position, now)
        registerKillBanner(combatFeedback, p.tier === 'named' && p.name ? `${p.name.toUpperCase()} DESTROYED` : 'PIRATE DESTROYED', `+${p.reward} cr`, now)
        audio.blip('explosion')
        gainCredits(econ, p.reward)
        recordDailyEvent('kill_pirates', 1, now)
        // Pilot Level XP for the kill (tier-scaled), then campaign progress.
        awardPilotXp(xpForKill(p.tier))
        if (p.tier === 'named') {
          namedRaiderActive = false
          crafting.cores += 1 // named minibosses guarantee a core
        }
        applyCampaignAdvance(recordCampaignEvent(campaign, p.tier === 'named' ? 'kill_named' : 'kill_pirates', 1), now)
        finishOnboarding() // graduates the onboarding objective
        refreshWallet()
        spawnLoot(p.position) // drop a loot crate where it died
        removePirateMesh(p.id)
        pirates.splice(i, 1)
      } else if (shouldDespawnPirate(ship.position.distanceTo(pirates[i].position))) {
        // Outran it (boost/quantum) — cull the orphaned chaser silently so the slot
        // frees up for a fresh near spawn. No bounty: it wasn't killed.
        if (pirates[i].tier === 'named') namedRaiderActive = false // outran the miniboss — let it re-spawn
        removePirateMesh(pirates[i].id)
        pirates.splice(i, 1)
      }
    }

    if (econ.earned > lastEarnedForDaily) {
      recordDailyEvent('earn_credits', econ.earned - lastEarnedForDaily, now)
      lastEarnedForDaily = econ.earned
    }

    for (let i = trainingDrones.length - 1; i >= 0; i--) {
      if (isDead(trainingDrones[i].health)) {
        const drone = trainingDrones[i]
        spawnExplosion(drone.position, now)
        registerKillBanner(combatFeedback, 'DRONE DESTROYED', 'training target', now)
        audio.blip('explosion')
        if (BOT && botActivity?.kind === 'pvp-training') {
          const trainingActivity = botActivity as typeof botActivity & { droneKills?: number; droneKillGoal?: number }
          const previousKills = typeof trainingActivity.droneKills === 'number' ? trainingActivity.droneKills : 0
          const killGoal = typeof trainingActivity.droneKillGoal === 'number' ? trainingActivity.droneKillGoal : Infinity
          trainingActivity.droneKills = previousKills + 1
          if (previousKills < killGoal && trainingActivity.droneKills >= killGoal) {
            net.sendChat('Training targets cleared. Moving on.')
          }
        }
        destroyTrainingDroneMesh(drone.id, now)
        trainingDrones.splice(i, 1)
      }
    }

    if (isDead(playerHealth)) respawnPlayer(now)

    syncProjectileMeshes()
    hullBarEl.style.width = `${Math.round(hullFraction(playerHealth) * 100)}%`
    enemiesEl.textContent = String(pirates.length + trainingDrones.length)
  }

  if (running) {
    updateDeepSpaceVisibility()
    updateRemotes()
    pfMark('remotes')
    for (const remote of remotes.values()) {
      const key = remote.peer.cosmetics ?? ''
      if (key !== remote.cosmeticsKey) {
        remote.cosmetics.apply(decodeCosmetics(key))
        remote.cosmeticsKey = key
      }
      remote.cosmetics.update(dt, remote.mesh.position)
    }
    updateCamera(dt)
    applyBlackHoleShake(dt)
    drawMinimap()
    pfMark('minimap')
    updateDepthHUD()
    updateAltitudeHUD()
    const atmosphere = updateAtmoVeil()
    if (quantum.phase === 'idle') {
      // Black-hole proximity adds a low rumble; regional ambience gives each landmark its own air.
      audio.setAmbience({ atmosphere, quantum: bhPressure, speedFrac: ship.velocity.length() / (hubTimeTrial.active ? baseSpeed : effSpeed()) })
      audio.setRegionalAmbience(applyAmbientVolume(currentRegionalAmbience()))
    }
    if (!dailyPanelEl.hidden) renderDailyPanel(now)
  } else {
    sun.visible = true
    for (const mesh of planetGroups) mesh.visible = true
    // Menu background: slow orbit around the station
    const t = now * 0.0001
    camera.position.set(Math.cos(t) * 220 + 120, 60, Math.sin(t) * 220 - 350)
    camera.lookAt(station.position)
  }

  updateOreFloats(now)
  updateExplosions(now)
  updateHitSparks(now)
  updateTrainingDroneWrecks(now, dt)

  // Subtle quantum motion: faint streaks ease in during the jump (spool-up pulls them gently
  // toward the vanishing point, travel lets them drift past). Kept light — easy on the eyes.
  let warpIntensity = 0, warpInward = false
  if (running && !docked) {
    if (quantum.phase === 'spooling') {
      warpIntensity = (1 - quantum.spoolRemaining / QUANTUM_TUNING.spoolTime) * 0.3
      warpInward = true
    } else if (quantum.phase === 'traveling') {
      warpIntensity = 0.45
    }
  } else {
    camBoost = false // don't strand a wide FOV while docked/in menu
  }
  updateWarpField(warpField, warpIntensity, dt, warpInward)
  if (running) updateDustField(dustField, camera.position)

  // Combat HUD — target brackets, threat arrows, lead pip (hidden while docked/in menu).
  if (shouldShowCombatHud({ running, docked, bot: BOT, botActivityKind: botActivity?.kind })) drawCombatHud(now)
  else cctx.clearRect(0, 0, combatCanvas.width, combatCanvas.height)

  if (running && !docked) updateLootCrates(now, dt) // spin / magnet / collect loot crates

  // Engine bloom lives on the craft's own engine bells. Holder cosmetics stay on
  // name/chat styling and prestige hull parts, so the drive color remains stock.
  boostKick = Math.max(0, boostKick - dt * 3.5)
  updateHolderShowcase(now)
  const speedFrac = ship.velocity.length() / Math.max(1, hubTimeTrial.active ? baseSpeed : effSpeed())
  applyEngineGlowStyle(playerEngineGlows, engineGlowStyle({
    thrust: camThrust,
    boost: camBoost,
    speedFrac,
    cosmeticTier: 0,
    time: now * 0.001,
  }))
  playerCosmetics.update(dt, ship.position)

  // Onboarding objective — new pilots get a "next step" until they hunt their first pirate.
  // (Frozen if kicked: the objective slot shows the "signed in elsewhere" warning instead.)
  if (!sessionKicked) {
    const obj = running && !docked ? currentObjective() : null
    objectiveEl.hidden = !obj
    if (obj) objectiveEl.textContent = `${obj.kind === 'campaign' ? 'CAMPAIGN' : 'PILOT JOURNEY'} - ${obj.text}`
  }

  pfMark('logic')
  composer.render()
  pfMark('render')
  labelRenderer.render(scene, camera)
  drawHolderShowcaseComposite(now)
  pfMark('labels')
  pfEnd()
}
requestAnimationFrame(frame)
