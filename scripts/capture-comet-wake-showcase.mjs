import { spawn, spawnSync } from 'node:child_process'
import { mkdir, rm, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const SHOWCASE_URL = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5174/social/comet-wake-showcase.html'
const WIDTH = 1920
const HEIGHT = 1080
const FPS = 30
const TOTAL_FRAMES = 480
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT_DIR = join(ROOT, 'public', 'social')
const FRAME_DIR = join(tmpdir(), `comet-wake-showcase-frames-${Date.now()}`)
const OUT_MP4 = join(OUT_DIR, 'comet-wake-showcase.mp4')
const OUT_POSTER = join(OUT_DIR, 'comet-wake-showcase-poster.png')

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

async function waitUntilReady(page) {
  for (let i = 0; i < 120; i++) {
    const result = await page.send('Runtime.evaluate', {
      expression: 'window.__showcaseReady === true',
      returnByValue: true,
    })
    if (result.result?.value === true) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error('Showcase page did not become ready.')
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  await rm(FRAME_DIR, { recursive: true, force: true })
  await mkdir(FRAME_DIR, { recursive: true })

  const profile = join(tmpdir(), `chrome-comet-wake-${Date.now()}`)
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
  try {
    const browserWsUrl = await waitForDevToolsUrl(chrome)
    const base = new URL(browserWsUrl)
    const created = await fetch(`http://${base.host}/json/new?${encodeURIComponent(SHOWCASE_URL)}`, { method: 'PUT' }).then((res) => res.json())
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
    await page.send('Page.navigate', { url: SHOWCASE_URL })
    await page.waitFor('Page.loadEventFired')
    await waitUntilReady(page)

    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      await page.send('Runtime.evaluate', {
        expression: `window.renderShowcaseFrame(${frame}, ${TOTAL_FRAMES})`,
        awaitPromise: true,
      })
      const shot = await page.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      })
      const file = join(FRAME_DIR, `frame_${String(frame).padStart(6, '0')}.png`)
      await writeFile(file, Buffer.from(shot.data, 'base64'))
      if (frame % 60 === 0) console.log(`captured ${frame}/${TOTAL_FRAMES}`)
    }

    await copyFile(join(FRAME_DIR, 'frame_000180.png'), OUT_POSTER)
    const ffmpeg = spawnSync('/opt/homebrew/bin/ffmpeg', [
      '-y',
      '-framerate', String(FPS),
      '-i', join(FRAME_DIR, 'frame_%06d.png'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      OUT_MP4,
    ], { stdio: 'inherit' })
    if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed with status ${ffmpeg.status}`)
    console.log(`wrote ${OUT_MP4}`)
    console.log(`wrote ${OUT_POSTER}`)
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
    await rm(FRAME_DIR, { recursive: true, force: true }).catch(() => {})
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
