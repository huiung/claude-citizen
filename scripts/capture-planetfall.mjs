// Deterministic headless capture of the on-foot (planetfall) state.
//
// The existing harnesses do not fit this one. `capture-ship-studio.mjs` drives a standalone page
// with a hull and a light rig and no planet, so it can say nothing about a figure standing on a
// skypad; and `capture-gameplay.mjs` drives `?bot=1`, whose autopilot picks a different route on
// every launch, so two runs are not comparable and neither is guaranteed to be anywhere near a
// city. This drives the real game at `?earthview=seoul-foot`, a DEV hook that puts the ship over
// the Seoul skypad, lands it, and steps the pilot out — the same code path a player takes, with
// none of the timing left to chance.
//
// Waits on `window.planetfallReady`, which main.ts sets only once the walker exists. Without that
// the early frames are of a ship still settling onto the deck, which produces a run of plausible
// PNGs that say nothing about the mode under test.
//
// Shots are described as a list of {name, yaw, pitch, walk} — `dev.foot(yawDeg, pitchDeg)` aims
// the camera (mouse look needs a pointer lock that headless Chrome will not grant) and `walk` is a
// number of seconds to hold a movement key, dispatched as real key events so the walk goes through
// the same keydown handler a player's does.
//
// Chrome flags and the CDP plumbing are lifted from capture-ship-studio.mjs; the swiftshader flags
// in particular are what make headless WebGL render at all rather than emit black frames.

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { PNG } from 'pngjs'

const BASE = process.env.FOOT_BASE ?? 'http://localhost:5199/?earthview=seoul-foot'
const OUT = process.env.FOOT_OUT ?? join(tmpdir(), 'planetfall')
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WIDTH = Number(process.env.FOOT_WIDTH ?? 1600)
const HEIGHT = Number(process.env.FOOT_HEIGHT ?? 1000)
const READY_TIMEOUT_MS = Number(process.env.FOOT_READY_TIMEOUT_MS ?? 120000)

// yaw 0 is the site frame's +v axis; the disembark faces the ship, so shot yaws are relative to
// nothing in particular and are chosen by looking at the output. walk: [key, seconds].
const SHOTS = JSON.parse(process.env.FOOT_SHOTS ?? JSON.stringify([
  { name: '01-step-out', pitch: 3 },
  { name: '02-look-up', pitch: -28 },
  { name: '03-walk-away', walk: ['KeyS', 2.2], pitch: 0 },
  { name: '04-side-on', yaw: 90, pitch: 5 },
  { name: '05-walk-forward', walk: ['KeyW', 2.0], pitch: 5 },
  { name: '06-top-down', pitch: 55 },
]))

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
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        console.error('  page error:', msg.params.args?.map((a) => a.value ?? a.description).join(' '))
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
    // keydown that no key could produce.
    const letter = code.replace('Key', '')
    return this.send('Input.dispatchKeyEvent', {
      type, code, key: letter.toLowerCase(), text: type === 'keyDown' ? letter.toLowerCase() : undefined,
      windowsVirtualKeyCode: letter.charCodeAt(0), nativeVirtualKeyCode: letter.charCodeAt(0),
    })
  }
}

// Blank-frame detection, same idea as capture-gameplay.mjs: headless WebGL can succeed at every
// CDP call and still write a black rectangle, and a run of those looks exactly like a good run
// from the outside.
function analyzePng(buffer) {
  const { width, height, data } = PNG.sync.read(buffer)
  const pixels = width * height
  let sum = 0
  let sumSq = 0
  const buckets = new Set()
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    sum += l
    sumSq += l * l
    buckets.add(((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5))
  }
  const mean = sum / pixels
  const stddev = Math.sqrt(Math.max(0, sumSq / pixels - mean * mean))
  return { mean, stddev, buckets: buckets.size, blank: stddev < 2 || buckets.size < 3 }
}

const profile = join(tmpdir(), `chrome-planetfall-${Date.now()}`)
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

let failures = 0
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
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
    screenWidth: WIDTH, screenHeight: HEIGHT,
  })
  await mkdir(OUT, { recursive: true })

  console.log(`navigating to ${BASE}`)
  await page.send('Page.navigate', { url: BASE })
  await sleep(2500)

  // The landing page needs a click (or Enter in the callsign field) before the game runs; the dev
  // hook then waits for `running` AND for the flight-plan chooser to be dismissed. That chooser
  // starts hidden and is shown as launch()'s last act, so "dismiss it once it is hidden" is a trap
  // — it is hidden before it has ever appeared. Keep clicking skip for as long as it is visible,
  // inside the same loop that waits for the walker.
  await page.evaluate("document.getElementById('launch')?.click()")
  const deadline = Date.now() + READY_TIMEOUT_MS
  let ready = false
  while (Date.now() < deadline) {
    if (await page.evaluate('window.planetfallReady === true')) { ready = true; break }
    await page.evaluate("if (document.getElementById('flight-plan')?.hidden === false) document.getElementById('flight-plan-skip')?.click()")
    await sleep(500)
  }
  if (!ready) {
    const state = await page.evaluate(
      "JSON.stringify({ plan: document.getElementById('flight-plan')?.hidden, prompt: document.getElementById('dock-prompt')?.textContent })",
    )
    throw new Error(`planetfallReady never set within ${READY_TIMEOUT_MS}ms — page state ${state}`)
  }
  console.log('on foot — capturing')
  await sleep(1500) // let the boom finish its lerp in from the flight camera

  for (const shot of SHOTS) {
    // Aim first, then walk: the heading decides which way `KeyW` goes, so doing it the other way
    // round would send the first leg wherever the previous shot happened to leave the walker facing.
    await page.evaluate(`window.dev?.foot(${shot.yaw ?? 'undefined'}, ${shot.pitch ?? 'undefined'})`)
    if (shot.walk) {
      const [code, seconds] = shot.walk
      await page.key('keyDown', code)
      await sleep(seconds * 1000)
      await page.key('keyUp', code)
      await sleep(250)
    }
    // `press` is for the mode transitions themselves — E to board, E again to step back out — so a
    // run can show the round trip and not just the on-foot state in isolation.
    if (shot.press) {
      await page.key('keyDown', shot.press)
      await sleep(60)
      await page.key('keyUp', shot.press)
      await sleep(400)
    }
    await sleep(900) // the boom lerps; a shot taken immediately is of the previous angle
    const raw = await page.send('Page.captureScreenshot', { format: 'png' })
    const buf = Buffer.from(raw.data, 'base64')
    await writeFile(join(OUT, `${shot.name}.png`), buf)
    const a = analyzePng(buf)
    const verdict = a.blank ? '!! BLANK' : 'ok'
    if (a.blank) failures++
    console.log(`  ${shot.name}.png  ${buf.length}B  mean=${a.mean.toFixed(1)} sd=${a.stddev.toFixed(1)} colours=${a.buckets}  ${verdict}`)
  }
  console.log(`\nwrote ${SHOTS.length} frame(s) to ${OUT}`)
  console.log('These numbers only rule out a black screen. Open the PNGs.')
} finally {
  chrome.kill()
}
process.exit(failures > 0 ? 1 : 0)
