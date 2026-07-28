// Headless capture of the running game for before/after visual comparisons.
//
// Reuses the CDP + swiftshader setup from scripts/capture-comet-wake-showcase.mjs (see that
// file for the CdpPage class and the Chrome launch flags — those flags are what make headless
// WebGL actually render instead of producing black frames). This script drives the real game
// at ?bot=1 (browser autopilot) instead of a standalone showcase page: it clicks #launch itself
// (the landing page requires a click or Enter-in-the-callsign-field; nothing auto-launches it
// on this script's behalf), waits for a real "world is rendering" signal, then grabs a series
// of screenshots spaced out in time so the autopilot has moved through different scenery.
//
// Headless WebGL can silently produce blank/black frames even when every CDP call succeeds, so
// after capture this script decodes each PNG with pngjs and checks pixel variance / distinct
// colours. A "successful" run that wrote eight black rectangles is worse than a loud failure.

import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
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
const OUT_DIR = process.env.CAPTURE_OUT ?? join(ROOT, 'docs', 'screenshots', 'before')

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
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
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
    await new Promise((resolveWait) => setTimeout(resolveWait, 300))
  }
  throw new Error(`#hud never became visible within ${timeoutMs}ms — world did not start rendering.`)
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

function timestampTag() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
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
  const savedFiles = []
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

    const runTag = timestampTag()
    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      if (frame > 0) await new Promise((resolveWait) => setTimeout(resolveWait, INTERVAL_MS))
      const shot = await page.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      })
      const buffer = Buffer.from(shot.data, 'base64')
      const fileName = `gameplay-${runTag}-${String(frame).padStart(2, '0')}.png`
      const filePath = join(OUT_DIR, fileName)
      await writeFile(filePath, buffer)
      savedFiles.push(filePath)
      console.log(`captured ${frame + 1}/${FRAME_COUNT} -> ${filePath} (${buffer.length} bytes)`)
    }
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
  for (const filePath of savedFiles) {
    const buffer = await import('node:fs/promises').then((fs) => fs.readFile(filePath))
    const stats = analyzePng(buffer)
    const flag = stats.isBlank ? 'BLANK?!' : 'ok'
    console.log(
      `  ${filePath}: ${stats.width}x${stats.height} meanLuminance=${stats.meanLuminance.toFixed(2)} `
      + `stddevLuminance=${stats.stddevLuminance.toFixed(2)} uniqueColorBuckets=${stats.uniqueBuckets} [${flag}]`,
    )
    if (stats.isBlank) anyBlank = true
  }

  console.log(`\nwrote ${savedFiles.length} frame(s) to ${OUT_DIR}`)
  for (const filePath of savedFiles) console.log(`  ${filePath}`)

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
