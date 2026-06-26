// Off-main-thread planet/cloud texture pixel generation. The synchronous FBM loop for a high-res
// planet (2048×1024 ≈ 2M samples) freezes the main thread for ~2s; running it here keeps flight
// smooth while the home planets upgrade to full quality. Results are posted back as transferable
// buffers and folded into the shared texture cache on the main thread.
import { computePlanetPixels, computeCloudPixels, type PlanetTextureKind } from './planetTextures'

interface PlanetJob {
  id: number
  job: 'planet'
  kind: PlanetTextureKind
  seed: number
  baseColor: number
  width: number
  height: number
  radius: number
}
interface CloudJob {
  id: number
  job: 'cloud'
  kind: PlanetTextureKind
  seed: number
  width: number
  height: number
  radius: number
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<PlanetJob | CloudJob>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

ctx.onmessage = (e) => {
  const m = e.data
  if (m.job === 'planet') {
    const { color, bump } = computePlanetPixels(m.kind, m.seed, m.baseColor, m.width, m.height, m.radius)
    ctx.postMessage({ id: m.id, color: color.buffer, bump: bump.buffer }, [color.buffer, bump.buffer])
  } else {
    const data = computeCloudPixels(m.kind, m.seed, m.width, m.height, m.radius)
    ctx.postMessage({ id: m.id, data: data ? data.buffer : null }, data ? [data.buffer] : [])
  }
}
