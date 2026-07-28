// Headless capture of the running game for before/after visual comparisons.
//
// Reuses the CDP + swiftshader setup from scripts/capture-comet-wake-showcase.mjs (see that
// file for the CdpPage class and the Chrome launch flags — those flags are what make headless
// WebGL actually render instead of producing black frames). This script drives the real game
// at ?bot=1 (browser autopilot) instead of a standalone showcase page: it clicks #launch itself
// (the landing page requires a click or Enter-in-the-callsign-field — ?bot=1 also auto-launches
// on its own via a requestAnimationFrame callback in src/main.ts, but our explicit click is a
// harmless no-op in that case since launch() guards on `if (running) return`, so this works
// whichever fires first), waits for a real "world is rendering" signal, then grabs a series of
// screenshots.
//
// Two modes:
//   - plain (default): screenshots spaced out at a fixed interval, whatever the autopilot is
//     doing. Good for general before/after scenery comparisons.
//   - ship-framed (CAPTURE_SHIP_FRAMED=1): waits out the autopilot's opening quantum jump (which
//     leaves the ship out of frame — see the top-level comment above the ship-framed section),
//     switches to the orbit camera so the hull fills the frame, and captures a mix of orbit +
//     rear-chase shots. Built for judging hull material quality (metal vs. flat matte grey).
//
// Headless WebGL can silently produce blank/black frames even when every CDP call succeeds, so
// after capture this script decodes each PNG with pngjs and checks pixel variance / distinct
// colours. A "successful" run that wrote eight black rectangles is worse than a loud failure.

import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'
import { PNG } from 'pngjs'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const VITE_URL = process.env.VITE_URL ?? 'http://localhost:5173/'
const RELAY_URL = process.env.RELAY_URL ?? 'http://localhost:8080/'
const CAPTURE_URL = process.env.CAPTURE_URL ?? 'http://localhost:5173/?bot=1'
const WIDTH = 1920
const HEIGHT = 1080
const FRAME_COUNT = Number(process.env.CAPTURE_FRAMES ?? 8)
const INTERVAL_MS = Number(process.env.CAPTURE_INTERVAL_MS ?? 6000)
const READY_TIMEOUT_MS = Number(process.env.CAPTURE_READY_TIMEOUT_MS ?? 45000)
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// --- Ship-framed mode (see top comment) ---
const SHIP_FRAMED = process.env.CAPTURE_SHIP_FRAMED === '1'
const SHIP_REAR_FRAMES = Number(process.env.CAPTURE_SHIP_REAR_FRAMES ?? 2) // rest of FRAME_COUNT is orbit
const SHIP_INTERVAL_MS = Number(process.env.CAPTURE_SHIP_INTERVAL_MS ?? 2500)
const SHIP_ZOOM_DELTA = Number(process.env.CAPTURE_SHIP_ZOOM_DELTA ?? -300) // negative = zoom in; 0 disables
// Quantum cruise is 9000 m/s with 2500 m/s² accel/decel (see src/sim/quantum.ts's QUANTUM_TUNING);
// a long-haul jump (e.g. to the black hole) can be a genuinely long way off, so this needs real
// headroom rather than a short guess.
const JUMP_SETTLE_TIMEOUT_MS = Number(process.env.CAPTURE_JUMP_SETTLE_TIMEOUT_MS ?? 120000)
const MIN_OBSERVE_MS = Number(process.env.CAPTURE_MIN_OBSERVE_MS ?? 4000)

const OUT_DIR = process.env.CAPTURE_OUT
  ?? join(ROOT, 'docs', 'screenshots', SHIP_FRAMED ? 'before-ship' : 'before')

// Below these, a frame is reported as suspiciously blank (see analyzePng below for what they mean).
const BLANK_STDDEV_THRESHOLD = 2
const BLANK_UNIQUE_BUCKET_THRESHOLD = 3

class CdpPage {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.ws.on('message', (raw) => this.onMessage(raw))
  }

  async open() {
    await new Promise((resolveOpen, rejectOpen) => {
      this.ws.once('open', resolveOpen)
      this.ws.once('error', rejectOpen)
    })
  }

  onMessage(raw) {
    const msg = JSON.parse(String(raw))
    if (msg.id && this.pending.has(msg.id)) {
      const { resolvePending, rejectPending } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) rejectPending(new Error(`${msg.error.message}: ${msg.error.data ?? ''}`))
      else resolvePending(msg.result)
      return
    }
    if (msg.method) this.events.push(msg)
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('page exception:', msg.params?.exceptionDetails?.text, msg.params?.exceptionDetails?.exception?.description)
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = msg.params?.args?.map((arg) => arg.value ?? arg.description).join(' ')
      console.error('page console:', msg.params?.type, args)
    }
    if (msg.method === 'Log.entryAdded') {
      console.error('page log:', msg.params?.entry?.level, msg.params?.entry?.text)
    }
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolvePending, rejectPending) => {
      this.pending.set(id, { resolvePending, rejectPending })
    })
  }

  async waitFor(method, timeoutMs = 10000) {
    const existing = this.events.findIndex((event) => event.method === method)
    if (existing >= 0) return this.events.splice(existing, 1)[0]
    return new Promise((resolveWait, rejectWait) => {
      const timer = setTimeout(() => {
        cleanup()
        rejectWait(new Error(`Timed out waiting for ${method}`))
      }, timeoutMs)
      const onMessage = () => {
        const index = this.events.findIndex((event) => event.method === method)
        if (index < 0) return
        const event = this.events.splice(index, 1)[0]
        cleanup()
        resolveWait(event)
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.ws.off('message', onMessage)
      }
      this.ws.on('message', onMessage)
    })
  }

  close() {
    this.ws.close()
  }
}

function sleep(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

async function checkServerUp(url, label) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok && res.status >= 500) {
      throw new Error(`${label} at ${url} responded with HTTP ${res.status}`)
    }
    return true
  } catch (error) {
    throw new Error(`${label} does not appear to be running at ${url} (${error.message}).`)
  }
}

async function waitForDevToolsUrl(proc) {
  let stderr = ''
  return new Promise((resolveUrl, rejectUrl) => {
    const timer = setTimeout(() => rejectUrl(new Error(`Chrome did not expose DevTools URL.\n${stderr}`)), 15000)
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk)
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (!match) return
      clearTimeout(timer)
      resolveUrl(match[1])
    })
    proc.once('exit', (code, signal) => {
      clearTimeout(timer)
      rejectUrl(new Error(`Chrome exited before DevTools was ready: ${code ?? signal}\n${stderr}`))
    })
  })
}

// Landing page interactive: #launch exists and #nickname exists (both defined at module top
// level in src/main.ts, so they exist as soon as index.html's DOM has parsed — no need to wait
// for game modules to finish loading before driving them).
async function waitForLandingInteractive(page) {
  for (let i = 0; i < 80; i++) {
    const result = await page.send('Runtime.evaluate', {
      expression: `!!(document.getElementById('launch') && document.getElementById('nickname'))`,
      returnByValue: true,
    })
    if (result.result?.value === true) return
    await sleep(250)
  }
  throw new Error('Landing page never became interactive (#launch / #nickname not found).')
}

// Readiness signal for "the world is actually rendering": #hud is the flight HUD (hull bar,
// status, minimap) that src/main.ts's launch() reveals (hudEl.hidden = false) once net.enterGame
// has been called and the overlay has been dismissed. It is a plain DOM check, independent of
// any internal game state, so it holds whether ?bot=1 auto-launched on its own or our explicit
// click below triggered it.
async function waitForWorldReady(page, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const result = await page.send('Runtime.evaluate', {
      expression: `(() => { const hud = document.getElementById('hud'); return !!hud && hud.hidden === false; })()`,
      returnByValue: true,
    })
    if (result.result?.value === true) return
    await sleep(300)
  }
  throw new Error(`#hud never became visible within ${timeoutMs}ms — world did not start rendering.`)
}

// #quantum is src/main.ts's quantum-travel HUD banner ("QUANTUM SPOOLING..." / "QUANTUM TRAVEL ->
// ... - N%"). updateQuantumHud() sets `quantumEl.hidden = qr.phase === 'idle'`, so this element's
// visibility is a direct, DOM-only proxy for "is the quantum drive currently spooling or
// travelling" — true whenever the ship is warping (and therefore not usefully in frame).
async function isQuantumTraveling(page) {
  const result = await page.send('Runtime.evaluate', {
    expression: `(() => { const q = document.getElementById('quantum'); return !!q && q.hidden === false; })()`,
    returnByValue: true,
  })
  return result.result?.value === true
}

// The bot's very first move after launch is usually a quantum jump (see src/main.ts's
// startBotTransit / BOT_STOP_KINDS) — the ship is not in frame at all while #quantum is visible.
// This waits for that opening jump to finish (#quantum goes hidden again) before we touch the
// camera. If the bot picks 'mine-and-gamble' as its first stop, there is no jump at all (it drops
// straight into local activity at spawn); we can't tell those two cases apart in advance, so this
// just observes for MIN_OBSERVE_MS and accepts "no jump ever started" as also being settled.
async function waitUntilSettledOutOfQuantum(page, { settleTimeoutMs, minObserveMs }) {
  const start = Date.now()
  let sawTraveling = false
  while (Date.now() - start < settleTimeoutMs) {
    const traveling = await isQuantumTraveling(page)
    if (traveling) sawTraveling = true
    const elapsed = Date.now() - start
    if (!traveling && (sawTraveling || elapsed >= minObserveMs)) return { sawTraveling }
    await sleep(300)
  }
  throw new Error(`Quantum travel did not settle within ${settleTimeoutMs}ms (#quantum stayed visible).`)
}

// Dispatches a real KeyC keydown+keyup through CDP Input — the same event src/main.ts's
// `addEventListener('keydown', ...)` handler reads to call cycleCameraView() (KeyC toggles
// 'rear' <-> 'orbit'; see src/ui/cameraView.ts's CameraMode).
async function pressKeyC(page) {
  const base = { code: 'KeyC', key: 'c', windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 }
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

// Dispatches a wheel event over the canvas to zoom the active camera in (negative deltaY), per
// src/main.ts's `renderer.domElement.addEventListener('wheel', ...)` -> zoomOrbitDistance /
// zoomRearDistance in src/ui/cameraView.ts. Optional — the default orbit radius already frames
// the hull reasonably; this just lets the hull fill more of the frame if wanted.
async function dispatchZoomWheel(page, deltaY) {
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: WIDTH / 2, y: HEIGHT / 2, deltaX: 0, deltaY,
  })
}

async function captureFrame(page) {
  const shot = await page.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  return Buffer.from(shot.data, 'base64')
}

// Quantized-colour + variance check: a real gameplay frame (starfield, HUD chrome, ships,
// planets) has a wide spread of luminance and many distinct colours. A frame that failed to
// render under headless WebGL comes back as a single flat colour (usually solid black), which
// shows up here as ~zero variance and a single colour bucket.
function analyzePng(buffer) {
  const png = PNG.sync.read(buffer)
  const { width, height, data } = png
  const pixelCount = width * height
  let sum = 0
  let sumSq = 0
  const buckets = new Set()
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sum += luminance
    sumSq += luminance * luminance
    // Quantize to 8 levels per channel (512 possible buckets) so this stays cheap while still
    // distinguishing "genuinely varied scene" from "one flat colour".
    buckets.add(((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5))
  }
  const mean = sum / pixelCount
  const variance = sumSq / pixelCount - mean * mean
  const stddev = Math.sqrt(Math.max(0, variance))
  const uniqueBuckets = buckets.size
  const isBlank = stddev < BLANK_STDDEV_THRESHOLD || uniqueBuckets < BLANK_UNIQUE_BUCKET_THRESHOLD
  return { width, height, meanLuminance: mean, stddevLuminance: stddev, uniqueBuckets, isBlank }
}

// Cheap, explicitly-a-heuristic signal for "is there likely a foreground object (the ship)
// breaking up the background": compares pixel variation in the center of the frame (where both
// camera modes place the ship) against the four corners (almost always background — starfield,
// sky, or a planet's edge). A real foreground hull tends to add sharp edges/specular highlights
// that raise the center's local variance well above a typical corner's. This is NOT a substitute
// for actually looking at the frame — see the run report for that — it just flags frames worth
// a second look versus frames where the center looks exactly as flat as the background.
function analyzeCenterFocus(buffer) {
  const png = PNG.sync.read(buffer)
  const { width, height, data } = png
  const luminanceAt = (x, y) => {
    const i = (y * width + x) * 4
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  }
  const regionStddev = (x0, y0, w, h) => {
    let sum = 0
    let sumSq = 0
    let n = 0
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const lum = luminanceAt(x, y)
        sum += lum
        sumSq += lum * lum
        n++
      }
    }
    const mean = sum / n
    return Math.sqrt(Math.max(0, sumSq / n - mean * mean))
  }
  const cw = Math.round(width * 0.4)
  const ch = Math.round(height * 0.4)
  const centerStddev = regionStddev(Math.round((width - cw) / 2), Math.round((height - ch) / 2), cw, ch)
  const cornerW = Math.round(width * 0.15)
  const cornerH = Math.round(height * 0.15)
  const corners = [
    regionStddev(0, 0, cornerW, cornerH),
    regionStddev(width - cornerW, 0, cornerW, cornerH),
    regionStddev(0, height - cornerH, cornerW, cornerH),
    regionStddev(width - cornerW, height - cornerH, cornerW, cornerH),
  ]
  const cornerStddev = corners.reduce((a, b) => a + b, 0) / corners.length
  return { centerStddev, cornerStddev, likelyForeground: centerStddev > cornerStddev * 1.15 }
}

function timestampTag() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

// Plain mode: fixed-interval screenshots of whatever the autopilot is doing.
async function captureIntervalFrames(page) {
  const runTag = timestampTag()
  const saved = []
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    if (frame > 0) await sleep(INTERVAL_MS)
    const buffer = await captureFrame(page)
    const fileName = `gameplay-${runTag}-${String(frame).padStart(2, '0')}.png`
    const filePath = join(OUT_DIR, fileName)
    await writeFile(filePath, buffer)
    saved.push({ filePath, mode: 'auto' })
    console.log(`captured ${frame + 1}/${FRAME_COUNT} -> ${filePath} (${buffer.length} bytes)`)
  }
  return saved
}

// Ship-framed mode: wait out the opening quantum jump, switch to orbit camera, and shoot a mix
// of orbit (hull-centered, several angles as the camera circles) + rear chase-cam frames.
async function captureShipFramedFrames(page) {
  console.log('waiting for the autopilot to settle out of its first quantum jump (#quantum hidden)...')
  const settle = await waitUntilSettledOutOfQuantum(page, {
    settleTimeoutMs: JUMP_SETTLE_TIMEOUT_MS,
    minObserveMs: MIN_OBSERVE_MS,
  })
  console.log(settle.sawTraveling
    ? 'quantum jump completed — #quantum hidden again, ship should now be stationary-ish at the destination.'
    : `no quantum jump observed in the first ${MIN_OBSERVE_MS}ms — proceeding (bot is likely doing an in-place activity, e.g. mining, that never warps).`)

  console.log('switching to orbit camera (dispatching KeyC via Input.dispatchKeyEvent)...')
  await pressKeyC(page)
  await sleep(400) // let the camera lerp into position (see updateCamera()'s exponential smoothing)
  if (SHIP_ZOOM_DELTA !== 0) {
    await dispatchZoomWheel(page, SHIP_ZOOM_DELTA)
    console.log(`zoomed orbit camera in (wheel deltaY=${SHIP_ZOOM_DELTA})`)
  }

  const runTag = timestampTag()
  const saved = []
  let anyReJump = false

  const captureOne = async (mode, index) => {
    if (await isQuantumTraveling(page)) {
      console.log(`  [${mode} ${index}] autopilot started another quantum jump mid-capture — waiting it out...`)
      anyReJump = true
      await waitUntilSettledOutOfQuantum(page, { settleTimeoutMs: JUMP_SETTLE_TIMEOUT_MS, minObserveMs: 0 })
      // The jump likely knocked the camera back to a default view of nothing useful; re-apply orbit.
      if (mode === 'orbit') { await pressKeyC(page); await pressKeyC(page); await sleep(400) }
    }
    const buffer = await captureFrame(page)
    const fileName = `gameplay-ship-${runTag}-${String(saved.length).padStart(2, '0')}-${mode}.png`
    const filePath = join(OUT_DIR, fileName)
    await writeFile(filePath, buffer)
    saved.push({ filePath, mode })
    console.log(`captured ${saved.length}/${FRAME_COUNT} [${mode}] -> ${filePath} (${buffer.length} bytes)`)
  }

  const orbitFrameCount = Math.max(0, FRAME_COUNT - SHIP_REAR_FRAMES)
  for (let i = 0; i < orbitFrameCount; i++) {
    if (i > 0) await sleep(SHIP_INTERVAL_MS)
    await captureOne('orbit', i)
  }

  if (SHIP_REAR_FRAMES > 0) {
    console.log('switching to rear chase camera (dispatching KeyC again)...')
    await pressKeyC(page)
    await sleep(400)
    for (let i = 0; i < SHIP_REAR_FRAMES; i++) {
      if (i > 0) await sleep(SHIP_INTERVAL_MS)
      await captureOne('rear', i)
    }
  }

  if (anyReJump) {
    console.log('\nnote: the autopilot queued at least one more quantum jump during the capture window; frames after a re-jump were captured once #quantum went hidden again (captured in the gaps, as expected).')
  }
  return saved
}

async function main() {
  console.log(`checking vite dev server (${VITE_URL})...`)
  await checkServerUp(VITE_URL, 'Vite dev server')
  console.log(`checking relay (${RELAY_URL})...`)
  try {
    await checkServerUp(RELAY_URL, 'Relay server')
  } catch (error) {
    // The game (and the autopilot) still work offline — main.ts's launch() falls back to
    // local-only daily state after ~1.5s if the relay never answers. Warn, don't fail.
    console.warn(`warning: ${error.message} The game and autopilot still work without it, but continuing without the relay.`)
  }

  await mkdir(OUT_DIR, { recursive: true })

  const profile = join(tmpdir(), `chrome-gameplay-capture-${Date.now()}`)
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--no-sandbox',
    '--hide-scrollbars',
    '--mute-audio',
    '--force-color-profile=srgb',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  let page
  let savedFiles = []
  try {
    const browserWsUrl = await waitForDevToolsUrl(chrome)
    const base = new URL(browserWsUrl)
    const created = await fetch(`http://${base.host}/json/new?${encodeURIComponent(CAPTURE_URL)}`, { method: 'PUT' }).then((res) => res.json())
    page = new CdpPage(created.webSocketDebuggerUrl)
    await page.open()
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Log.enable')
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: WIDTH,
      screenHeight: HEIGHT,
    })

    console.log(`navigating to ${CAPTURE_URL}...`)
    await page.send('Page.navigate', { url: CAPTURE_URL })
    await page.waitFor('Page.loadEventFired')

    console.log('waiting for landing page to become interactive...')
    await waitForLandingInteractive(page)

    console.log('setting callsign and clicking #launch...')
    await page.send('Runtime.evaluate', {
      expression: `(() => {
        const nickname = document.getElementById('nickname')
        if (nickname) nickname.value = 'CAPTURE'
        const launchBtn = document.getElementById('launch')
        if (launchBtn) launchBtn.click()
        return true
      })()`,
      returnByValue: true,
    })

    console.log('waiting for #hud to become visible (world rendering)...')
    await waitForWorldReady(page, READY_TIMEOUT_MS)
    console.log('world is rendering — readiness signal: #hud element visible (hud.hidden === false)')

    savedFiles = SHIP_FRAMED ? await captureShipFramedFrames(page) : await captureIntervalFrames(page)
  } finally {
    page?.close()
    if (!chrome.killed) chrome.kill('SIGTERM')
    await new Promise((resolveWait) => {
      const timer = setTimeout(resolveWait, 1500)
      chrome.once('exit', () => {
        clearTimeout(timer)
        resolveWait()
      })
    })
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }

  console.log('\nverifying frames are not blank...')
  let anyBlank = false
  for (const entry of savedFiles) {
    const buffer = await readFile(entry.filePath)
    const stats = analyzePng(buffer)
    const flag = stats.isBlank ? 'BLANK?!' : 'ok'
    let line = `  ${entry.filePath} [${entry.mode}]: ${stats.width}x${stats.height} `
      + `meanLuminance=${stats.meanLuminance.toFixed(2)} stddevLuminance=${stats.stddevLuminance.toFixed(2)} `
      + `uniqueColorBuckets=${stats.uniqueBuckets} [${flag}]`
    if (SHIP_FRAMED) {
      const focus = analyzeCenterFocus(buffer)
      line += ` centerStddev=${focus.centerStddev.toFixed(2)} cornerStddev=${focus.cornerStddev.toFixed(2)} `
        + `heuristicForegroundLikely=${focus.likelyForeground}`
    }
    console.log(line)
    if (stats.isBlank) anyBlank = true
  }
  if (SHIP_FRAMED) {
    console.log(
      '\nNote: centerStddev/cornerStddev/heuristicForegroundLikely is a cheap heuristic (foreground '
      + 'edge contrast vs. corner background), not a real hull detector. It flags frames worth a '
      + 'second look; it does not substitute for actually viewing the PNGs.',
    )
  }

  console.log(`\nwrote ${savedFiles.length} frame(s) to ${OUT_DIR}`)
  for (const entry of savedFiles) console.log(`  ${entry.filePath} [${entry.mode}]`)

  if (anyBlank) {
    throw new Error(
      'One or more frames look blank (low pixel variance / too few distinct colours). '
      + 'Headless WebGL likely failed to render — see per-frame numbers above.',
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
