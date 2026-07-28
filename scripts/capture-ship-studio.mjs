// Screenshot the ship studio for a list of query strings.
// Mirrors scripts/capture-gameplay.mjs's CDP setup, which is the part I
// got wrong by hand: page-level methods need a PAGE target created via /json/new, not the browser
// endpoint. Waits on window.studioReady so it never races the GLB load.
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const BASE = process.env.STUDIO_BASE ?? 'http://localhost:5173/social/ship-studio.html'
const OUT = process.env.STUDIO_OUT ?? join(tmpdir(), 'studio')
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = JSON.parse(process.env.STUDIO_SHOTS)
const WIDTH = Number(process.env.STUDIO_WIDTH ?? 1600)
const HEIGHT = Number(process.env.STUDIO_HEIGHT ?? 1000)
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
}

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

const profile = join(tmpdir(), `chrome-studio-${Date.now()}`)
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle',
  '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

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

  for (const { name, query } of SHOTS) {
    const url = `${BASE}?${query}`
    await page.send('Page.navigate', { url })
    let ready = false
    for (let i = 0; i < 250; i++) {
      const r = await page.send('Runtime.evaluate', {
        expression: 'window.studioReady === true', returnByValue: true,
      })
      if (r.result?.value === true) { ready = true; break }
      await sleep(200)
    }
    // Skip rather than write a file that looks like a result but isn't — a blank PNG here would
    // silently become "the hull renders black" in the comparison.
    if (!ready) { console.log(`  !! ${name}: studioReady never set — SKIPPED`); continue }
    await sleep(600)
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    const buf = Buffer.from(shot.data, 'base64')
    await writeFile(join(OUT, `${name}.png`), buf)
    console.log(`  ${name}.png  ${buf.length} bytes  <- ${query}`)
  }
} finally {
  chrome.kill()
}
