// Flies a real landing, headless, using ONLY what a player has: the launch UI, the flight-plan
// cards, the keyboard, and the text the HUD puts on screen.
//
// This is deliberately not capture-planetfall.mjs. That one drives `?earthview=seoul-foot`, a DEV
// hook that lands the ship itself — perfect for photographing the on-foot state, useless as evidence
// that a landing is reachable, because the thing it skips IS the thing under test. Nothing here
// reads the sim: the controller's only inputs are `#land-cue`, `#dock-prompt`, `#landing-toast` and
// `#nav-hint`, i.e. the same words a pilot reads, and its only outputs are key events.
//
// The one exception is `dev.aim()`, which points the nose at the planet below. Mouse look genuinely
// cannot be driven headless (the handler bails without a pointer lock, and headless Chrome will not
// grant one — measured in capture-planetfall.mjs), so this stands in for the mouse and nothing else:
// it does not move the ship, set velocity, or land. Both legs still fly the descent on W/A/D/R/F/X
// and land on SPACE.
//
// Two legs, because one landing proves less than it looks:
//   1. Seoul, from the Planetfall flight-plan card — the path a first-time player takes.
//   2. Tokyo, by cycling the destination with N to its skypad and jumping with J — the path to the
//      other 15 cities, which is the one that needs the nav cue and the beam to actually work.
//
// Env: PF_BASE (default http://localhost:5173/ — localhost, NOT 127.0.0.1: vite binds IPv6),
// PF_OUT (screenshot dir), PF_CITY2 (second city, default Tokyo).

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { PNG } from 'pngjs'

const BASE = process.env.PF_BASE ?? 'http://localhost:5173/'
const OUT = process.env.PF_OUT ?? join(tmpdir(), 'planetfall-verify')
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WIDTH = Number(process.env.PF_WIDTH ?? 1440)
const HEIGHT = Number(process.env.PF_HEIGHT ?? 900)
const CITY2 = process.env.PF_CITY2 ?? 'Tokyo'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class CdpPage {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw))
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
        return
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error('  page exception:', msg.params?.exceptionDetails?.text,
          msg.params?.exceptionDetails?.exception?.description)
      }
    })
  }
  open() { return new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej) }) }
  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => this.pending.set(id, { res, rej }))
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.value
  }
  key(type, code) {
    // windowsVirtualKeyCode matters: the game reads e.code, but Chrome will not synthesise a
    // keydown that no physical key could produce.
    const letter = code.replace('Key', '')
    const vk = code === 'Space' ? 32 : letter.charCodeAt(0)
    return this.send('Input.dispatchKeyEvent', {
      type, code, key: code === 'Space' ? ' ' : letter.toLowerCase(),
      text: type === 'keyDown' ? (code === 'Space' ? ' ' : letter.toLowerCase()) : undefined,
      windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    })
  }
  async tap(code, ms = 60) {
    await this.key('keyDown', code)
    await sleep(ms)
    await this.key('keyUp', code)
  }
  /** Hold a key for `ms`, then release. The flight model decays speed on release (coupled mode), so
   *  successive probes start from near rest rather than compounding drift. */
  async hold(code, ms) {
    await this.key('keyDown', code)
    await sleep(ms)
    await this.key('keyUp', code)
  }
}

/** Everything the controller is allowed to know: the HUD's own words. */
async function readHud(page) {
  const raw = await page.evaluate(`JSON.stringify({
    cue: document.getElementById('land-cue')?.hidden ? '' : document.getElementById('land-cue')?.textContent ?? '',
    marker: document.getElementById('land-marker')?.hidden ? '' : document.getElementById('land-marker')?.textContent ?? '',
    prompt: document.getElementById('dock-prompt')?.hidden ? '' : document.getElementById('dock-prompt')?.textContent ?? '',
    toast: document.getElementById('landing-toast')?.hidden ? '' : document.getElementById('landing-toast')?.textContent ?? '',
    nav: document.getElementById('nav-hint')?.textContent ?? '',
    markerX: parseFloat(document.getElementById('land-marker')?.style.left || 'NaN'),
    markerY: parseFloat(document.getElementById('land-marker')?.style.top || 'NaN'),
    alt: document.getElementById('alt-line')?.hidden ? '' : document.getElementById('alt-label')?.textContent ?? '',
    speed: document.getElementById('speed')?.textContent ?? '',
    quantum: document.getElementById('quantum')?.hidden ? '' : document.getElementById('quantum')?.textContent ?? '',
  })`)
  return JSON.parse(raw)
}

/** Metres out of a cue fragment like "212 m OFF CENTRE" / "3.4 km — FLY". */
function metres(text, re) {
  const m = text.match(re)
  if (!m) return null
  return Number(m[1]) * (m[2] === 'km' ? 1000 : 1)
}
const cueLateral = (cue) => metres(cue, /([\d.]+) (m|km) (?:OFF CENTRE|— FLY)/)
const cueAlt = (cue) => metres(cue, /ALT ([\d.]+) (m|km)/)

function analyzePng(buffer) {
  const { width, height, data } = PNG.sync.read(buffer)
  const pixels = width * height
  let sum = 0, sumSq = 0
  const buckets = new Set()
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    sum += l; sumSq += l * l
    buckets.add(((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5))
  }
  const mean = sum / pixels
  const stddev = Math.sqrt(Math.max(0, sumSq / pixels - mean * mean))
  return { mean, stddev, buckets: buckets.size, blank: stddev < 2 || buckets.size < 3 }
}

async function shot(page, name) {
  const raw = await page.send('Page.captureScreenshot', { format: 'png' })
  const buf = Buffer.from(raw.data, 'base64')
  await writeFile(join(OUT, `${name}.png`), buf)
  const a = analyzePng(buf)
  console.log(`    shot ${name}.png  mean=${a.mean.toFixed(1)} sd=${a.stddev.toFixed(1)} colours=${a.buckets}${a.blank ? '  !! BLANK' : ''}`)
  return a
}

/** Tap N until the nav hint names `wanted` — the destination cycle as a player walks it. */
async function pickDestination(page, wanted) {
  for (let i = 0; i < 60; i++) {
    if ((await readHud(page)).nav.toUpperCase().includes(wanted.toUpperCase())) return
    await page.tap('KeyN')
    await sleep(180)
  }
  throw new Error(`${wanted} never appeared in the destination cycle`)
}

/**
 * Wait for a quantum jump to spool AND finish.
 *
 * "Wait until the quantum banner is gone" is a trap: the drive spools for 1.6s before the banner
 * appears, so the first read finds it already absent and the script sails on into the jump — which
 * is what made an earlier run press thrust keys during travel and end up over the wrong city.
 */
async function waitForJump(page, label) {
  let seen = false
  for (let i = 0; i < 120; i++) {
    const q = (await readHud(page)).quantum
    if (q) seen = true
    else if (seen) break
    await sleep(400)
  }
  if (!seen) console.log(`  ${label}: no quantum banner ever appeared — the jump did not start`)
  await sleep(800) // one settled frame after the drop-out
}

/**
 * Fly the approach the cue asks for, until the LAND prompt appears.
 *
 * The whole controller is a reading of the HUD: the marker's screen position says WHICH WAY the deck
 * is (screen-left → strafe left, because the camera sits behind the nose), the cue's metres say how
 * far and how fast, DESCEND → thrust, BELOW THE DECK → up-thrust, BRAKE → X, LAND → space. If the
 * HUD were silent — as it was before this task — there would be nothing here to write.
 */
async function flyApproach(page, label, expectCity, deadlineMs) {
  let attempts = 0
  const until = Date.now() + deadlineMs
  let lastLog = ''
  while (Date.now() < until) {
    const hud = await readHud(page)
    if (/TO LAND/.test(hud.prompt)) {
      // Take it immediately, and settle the drift first. A screenshot between seeing the prompt and
      // pressing the key costs a second in swiftshader, which at 45 m/s is 45 metres — enough to
      // leave the pad. (That, not the key handling, is what made the first run of this script look
      // like SPACE did nothing.)
      console.log(`  ${label}: prompt "${hud.prompt.trim()}" (attempt ${++attempts})`)
      await page.hold('KeyX', 500)
      await page.tap('Space')
      // Poll for the outcome rather than sleeping a fixed 1.5s (the settle-down lerp): dt is
      // real-time and swiftshader renders at a few fps, so 1.5 SIM seconds is many wall seconds here.
      let after = null
      for (let i = 0; i < 40; i++) {
        await sleep(500)
        after = await readHud(page)
        if (after.toast || /STEP OUT/.test(after.prompt)) break
      }
      if (after.toast.toUpperCase().includes(expectCity.toUpperCase()) || /STEP OUT/.test(after.prompt)) {
        console.log(`  ${label}: toast "${after.toast.trim()}"  prompt "${after.prompt.trim()}"`)
        return after
      }
      // dev.landing() is a diagnostic ONLY — printed on a miss, never steered on. Without it a miss
      // is just "no prompt", which is consistent with five different causes.
      console.log(`  ${label}: attempt did not take (toast "${after.toast.trim()}") — flying it again`)
      console.log(`    state ${await page.evaluate('window.dev?.landing()')}`)
      continue
    }
    const line = `${hud.cue} | ${hud.prompt} | ${hud.alt} | ${hud.speed} m/s`
    if (line !== lastLog) { console.log(`    ${line}`); lastLog = line }
    if (!hud.cue) { await sleep(400); continue }
    // Line up before coming down: strafing is what closes the offset, and it is easier to judge from
    // altitude. The marker is hidden once the ship is over the deck, which is also when it stops
    // mattering.
    const lateral = cueLateral(hud.cue)
    if (lateral !== null && lateral > 80 && Number.isFinite(hud.markerX)) {
      const dx = hud.markerX - WIDTH / 2
      const dy = hud.markerY - HEIGHT / 2
      const ms = Math.max(160, Math.min(900, lateral * 3))
      // One axis per pass, the further-off one first — the correction is re-read either way.
      if (Math.abs(dx) >= Math.abs(dy)) await page.hold(dx < 0 ? 'KeyA' : 'KeyD', ms)
      else await page.hold(dy < 0 ? 'KeyR' : 'KeyF', ms)
      await sleep(400) // coupled-mode decay, so the next read is a position and not a velocity
      continue
    }
    if (/DESCEND/.test(hud.cue)) {
      // Thrust straight down the nose, in bites, so the descent can be re-read between them.
      const alt = cueAlt(hud.cue) ?? 0
      await page.hold('KeyW', alt > 400 ? 1400 : 260)
      continue
    }
    if (/BELOW THE DECK/.test(hud.cue)) {
      await page.hold('KeyR', 220)
      continue
    }
    if (/OFF CENTRE/.test(hud.cue)) {
      // Inside 80m with no marker to steer by (it hides over the deck): nudge and re-read.
      await page.hold('KeyA', 180)
      await sleep(400)
      continue
    }
    if (/BRAKE WITH X/.test(hud.cue)) {
      await page.hold('KeyX', 700)
      continue
    }
    await sleep(300)
  }
  console.log(`    state ${await page.evaluate('window.dev?.landing()')}`)
  throw new Error(`${label}: never reached the LAND prompt — last cue "${lastLog}"`)
}

const profile = join(tmpdir(), `chrome-pf-verify-${Date.now()}`)
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle',
  '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

function waitForDevToolsUrl(proc) {
  let stderr = ''
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`no DevTools URL\n${stderr}`)), 15000)
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk)
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (!m) return
      clearTimeout(timer)
      res(m[1])
    })
    proc.once('exit', (code) => { clearTimeout(timer); rej(new Error(`chrome exited ${code}\n${stderr}`)) })
  })
}

try {
  const browserWsUrl = await waitForDevToolsUrl(chrome)
  const host = new URL(browserWsUrl).host
  const created = await fetch(`http://${host}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
    .then((r) => r.json())
  const page = new CdpPage(created.webSocketDebuggerUrl)
  await page.open()
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false, screenWidth: WIDTH, screenHeight: HEIGHT,
  })
  await mkdir(OUT, { recursive: true })

  console.log(`navigating to ${BASE}`)
  await page.send('Page.navigate', { url: BASE })
  await sleep(3000)

  // --- Leg 1: the Planetfall flight-plan card, exactly as a first-time player clicks it.
  console.log('leg 1: LAUNCH → Planetfall card → descend on Seoul')
  await page.evaluate("document.getElementById('launch').click()")
  for (let i = 0; i < 40 && !(await page.evaluate("document.getElementById('flight-plan')?.hidden === false")); i++) {
    await sleep(500)
  }
  const cardFound = await page.evaluate(
    "!!document.querySelector('.flight-plan-card[data-plan=\"planetfall\"]:not([hidden])')",
  )
  if (!cardFound) throw new Error('no visible Planetfall flight-plan card')
  await page.evaluate("document.querySelector('.flight-plan-card[data-plan=\"planetfall\"]').click()")
  await sleep(2500)
  await shot(page, '01-orbit-over-seoul')
  await page.evaluate('window.dev?.aim()') // mouse stand-in: nose on the planet below
  await sleep(600)
  await shot(page, '02-nose-down')
  await flyApproach(page, 'seoul', 'Seoul', 180000)
  await shot(page, '03-seoul-landed')

  // --- Leg 2: lift off, cycle the destination to the second city's skypad, jump, land again.
  console.log(`leg 2: N to ${CITY2} Skypad → J → descend → land`)
  await page.tap('KeyJ') // jumping off the deck IS the liftoff
  await waitForJump(page, 'liftoff')
  await pickDestination(page, `${CITY2} Skypad`)
  console.log(`  nav hint: ${(await readHud(page)).nav}`)
  console.log(`    before jump ${await page.evaluate('window.dev?.landing()')}`)
  await page.tap('KeyJ')
  await waitForJump(page, CITY2.toLowerCase())
  await shot(page, '05-dropout-over-city2')
  await page.evaluate('window.dev?.aim()')
  await sleep(600)
  const afterJump = await readHud(page)
  console.log(`  on drop-out: cue "${afterJump.cue}"  marker "${afterJump.marker}"  ${afterJump.alt}`)
  await flyApproach(page, CITY2.toLowerCase(), CITY2, 210000)
  await shot(page, `06-${CITY2.toLowerCase()}-landed`)

  // --- Leg 3: the path the bug was reported on — jump to EARTH itself, from another planet, and
  // arrive somewhere arbitrary. There is no landing to fly here; what is being checked is that the
  // pilot is told a city exists and where, which is precisely what used to be missing.
  console.log('leg 3: J to Mars, then J to Earth — does an arbitrary arrival say where a city is?')
  await page.tap('KeyJ')
  await waitForJump(page, 'liftoff')
  await pickDestination(page, 'Mars')
  await page.tap('KeyJ')
  await waitForJump(page, 'mars')
  await pickDestination(page, 'Earth')
  await page.tap('KeyJ')
  await waitForJump(page, 'earth')
  const atEarth = await readHud(page)
  console.log(`  arrived: ${atEarth.alt}  cue "${atEarth.cue}"  marker "${atEarth.marker}"`)
  await shot(page, '07-earth-arrival-guidance')
  if (!/SKYPAD/.test(atEarth.cue) || !atEarth.marker) {
    console.log(`    state ${await page.evaluate('window.dev?.landing()')}`)
    throw new Error('arriving at Earth says nothing about where a skypad is')
  }

  console.log(`\nboth landings reached, and an Earth arrival names a pad. frames in ${OUT} — open them.`)
} finally {
  chrome.kill()
}
