// Procedural audio — engine hum + UI cues synthesized live from oscillators and
// filtered noise. Zero asset files. The pure math (thrust → frequency, thrust → gain)
// lives in exported helpers and is unit-tested in sound.test.ts; the GameAudio class
// itself touches WebAudio and so is not unit-testable headless.

/** Lowest / highest fundamental the engine drone sweeps between, in Hz. */
export const ENGINE_FREQ_IDLE = 55
export const ENGINE_FREQ_MAX = 140
/** Extra fundamental pitch (Hz) layered on top of the max when boosting. */
export const ENGINE_FREQ_BOOST = 60

/** Master gain the engine hum reaches; idle is audible but quiet. */
export const ENGINE_GAIN_IDLE = 0.006
export const ENGINE_GAIN_MAX = 0.04
/** Multiplier applied to the gain when boost is engaged. */
export const ENGINE_GAIN_BOOST_MULT = 1.3
/** Quiet continuous mining laser tone. Kept below idle engine gain on purpose. */
export const MINING_GAIN_ACTIVE = 0.0035
export const MINING_FREQ = 520

/** Clamp `x` into [min, max]. NaN collapses to `min` so audio params never go NaN. */
export function clamp(x: number, min: number, max: number): number {
  if (Number.isNaN(x)) return min
  return x < min ? min : x > max ? max : x
}

/**
 * Map a thrust level in [0, 1] to the engine fundamental frequency (Hz).
 * Boost lifts the ceiling so a boosting ship sounds higher than a coasting one.
 * Input is clamped, so out-of-range callers never produce silence or NaN.
 */
export function thrustToFrequency(level: number, boost = false): number {
  const t = clamp(level, 0, 1)
  const top = ENGINE_FREQ_MAX + (boost ? ENGINE_FREQ_BOOST : 0)
  return ENGINE_FREQ_IDLE + (top - ENGINE_FREQ_IDLE) * t
}

/**
 * Map a thrust level in [0, 1] to the engine master gain (linear amplitude).
 * Boost multiplies the result. Input is clamped to [0, 1].
 */
export function thrustToGain(level: number, boost = false): number {
  const t = clamp(level, 0, 1)
  const g = ENGINE_GAIN_IDLE + (ENGINE_GAIN_MAX - ENGINE_GAIN_IDLE) * t
  return g * (boost ? ENGINE_GAIN_BOOST_MULT : 1)
}

/** Mining hum is audible only while the laser is active and a rock is actually in range. */
export function miningToGain(active: boolean, inRange: boolean): number {
  return active && inRange ? MINING_GAIN_ACTIVE : 0
}

/** One-shot UI / combat cue kinds. */
export type BlipKind = 'dock' | 'trade' | 'error' | 'fire' | 'hit' | 'explosion' | 'boost'

interface AssetBlipSpec {
  /** Public URLs for short one-shot variants. */
  variants: string[]
  /** Buffer playback gain, kept below full scale because several cues can overlap. */
  gain: number
}

interface BlipSpec {
  /** Oscillator start/end frequency in Hz (a quick glide). */
  from: number
  to: number
  /** Peak gain of the cue. */
  peak: number
  /** Total duration in seconds. */
  dur: number
  type: OscillatorType
}

/** Tone design for each cue — pure data, exported so callers/tests can inspect it. */
export const BLIP_SPECS: Record<BlipKind, BlipSpec> = {
  // pleasant rising chirp on successful dock
  dock: { from: 440, to: 660, peak: 0.18, dur: 0.18, type: 'triangle' },
  // bright two-tone "ka-ching"-ish blip on a trade
  trade: { from: 660, to: 880, peak: 0.16, dur: 0.14, type: 'square' },
  // low descending buzz on error
  error: { from: 220, to: 110, peak: 0.2, dur: 0.22, type: 'sawtooth' },
  // quick high "pew" on weapon fire — quiet, since it repeats rapidly
  fire: { from: 900, to: 320, peak: 0.07, dur: 0.09, type: 'sawtooth' },
  // dull thud when something takes a hit
  hit: { from: 320, to: 170, peak: 0.13, dur: 0.11, type: 'square' },
  // low descending boom on a kill
  explosion: { from: 160, to: 40, peak: 0.24, dur: 0.5, type: 'sawtooth' },
  // rising whoosh on boost ignition
  boost: { from: 180, to: 560, peak: 0.14, dur: 0.28, type: 'sawtooth' },
}

/** CC0 Kenney sci-fi sounds for short event cues. Continuous audio stays procedural. */
export const ASSET_BLIP_SPECS: Partial<Record<BlipKind, AssetBlipSpec>> = {
  fire: {
    variants: [
      '/audio/kenney-sci-fi/laserSmall_000.ogg',
      '/audio/kenney-sci-fi/laserSmall_001.ogg',
      '/audio/kenney-sci-fi/laserSmall_002.ogg',
    ],
    gain: 0.26,
  },
  hit: {
    variants: [
      '/audio/kenney-sci-fi/impactMetal_000.ogg',
      '/audio/kenney-sci-fi/impactMetal_001.ogg',
      '/audio/kenney-sci-fi/impactMetal_002.ogg',
    ],
    gain: 0.38,
  },
  explosion: {
    variants: [
      '/audio/kenney-sci-fi/explosionCrunch_003.ogg',
      '/audio/kenney-sci-fi/explosionCrunch_004.ogg',
    ],
    gain: 0.58,
  },
  dock: {
    variants: [
      '/audio/kenney-sci-fi/doorClose_001.ogg',
      '/audio/kenney-sci-fi/doorOpen_001.ogg',
    ],
    gain: 0.34,
  },
  error: {
    variants: ['/audio/kenney-sci-fi/forceField_003.ogg'],
    gain: 0.3,
  },
}

/** Smoothing time (s) for engine parameter ramps — avoids zipper noise. */
const RAMP = 0.08

/**
 * Live procedural audio engine. Construct freely (headless-safe); call `init()`
 * once after a user gesture to actually start the AudioContext. Every method is
 * guarded so it never throws when audio is unavailable or `init()` was skipped.
 */
export class GameAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null

  // Engine voices
  private osc1: OscillatorNode | null = null
  private osc2: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private noiseGain: GainNode | null = null
  private miningOsc: OscillatorNode | null = null
  private miningGain: GainNode | null = null
  private assetBuffers = new Map<BlipKind, AudioBuffer[]>()
  private assetCursor = new Map<BlipKind, number>()
  private loadingAssets = false

  private started = false

  /**
   * Create the AudioContext and build the persistent engine graph. Must be called
   * from within a user-gesture handler (browser autoplay policy). Safe to call
   * more than once — subsequent calls are no-ops. Never throws.
   */
  init(): void {
    if (this.started) return
    this.started = true
    try {
      const Ctor: typeof AudioContext | undefined =
        typeof window !== 'undefined'
          ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined
      if (!Ctor) return

      const ctx = new Ctor()
      this.ctx = ctx

      const master = ctx.createGain()
      master.gain.value = 1
      master.connect(ctx.destination)
      this.master = master

      // Engine: two detuned oscillators + a band of filtered noise for grit.
      const engineGain = ctx.createGain()
      engineGain.gain.value = ENGINE_GAIN_IDLE
      engineGain.connect(master)
      this.engineGain = engineGain

      const osc1 = ctx.createOscillator()
      osc1.type = 'triangle' // smoother than sawtooth — less harsh whine
      osc1.frequency.value = ENGINE_FREQ_IDLE

      const osc2 = ctx.createOscillator()
      osc2.type = 'sine'
      osc2.frequency.value = ENGINE_FREQ_IDLE * 0.5 // sub-octave body
      osc2.detune.value = 8

      osc1.connect(engineGain)
      osc2.connect(engineGain)
      osc1.start()
      osc2.start()
      this.osc1 = osc1
      this.osc2 = osc2

      // Filtered noise layer — quiet hiss that scales with the engine.
      const noiseGain = ctx.createGain()
      noiseGain.gain.value = 0
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 280 // darker — kills the hiss, leaves a faint rumble
      noiseGain.connect(master)

      const buf = this.makeNoiseBuffer(ctx)
      if (buf) {
        const noise = ctx.createBufferSource()
        noise.buffer = buf
        noise.loop = true
        noise.connect(lp)
        lp.connect(noiseGain)
        noise.start()
      }
      this.noiseGain = noiseGain

      // Mining laser: a very quiet, smooth continuous tone, gated by setMining().
      const miningGain = ctx.createGain()
      miningGain.gain.value = 0
      miningGain.connect(master)
      const miningOsc = ctx.createOscillator()
      miningOsc.type = 'triangle'
      miningOsc.frequency.value = MINING_FREQ
      miningOsc.connect(miningGain)
      miningOsc.start()
      this.miningGain = miningGain
      this.miningOsc = miningOsc
      void this.loadAssetBlips(ctx)
    } catch {
      // Audio unavailable (headless, blocked, OOM) — degrade to silence.
      this.ctx = null
    }
  }

  /** Build ~1s of white noise. Returns null if buffer allocation fails. */
  private makeNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
    try {
      const len = Math.floor(ctx.sampleRate * 1)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      return buf
    } catch {
      return null
    }
  }

  private async loadAssetBlips(ctx: AudioContext): Promise<void> {
    if (this.loadingAssets) return
    this.loadingAssets = true
    const entries = Object.entries(ASSET_BLIP_SPECS) as [BlipKind, AssetBlipSpec][]
    await Promise.all(entries.map(async ([kind, spec]) => {
      const decoded = await Promise.all(spec.variants.map(async (path) => {
        try {
          if (typeof fetch !== 'function') return null
          const res = await fetch(path)
          if (!res.ok) return null
          const data = await res.arrayBuffer()
          return await ctx.decodeAudioData(data.slice(0))
        } catch {
          return null
        }
      }))
      const buffers = decoded.filter((buffer): buffer is AudioBuffer => buffer !== null)
      if (buffers.length > 0) this.assetBuffers.set(kind, buffers)
    }))
  }

  private playAssetBlip(kind: BlipKind): boolean {
    const ctx = this.ctx
    const master = this.master
    const spec = ASSET_BLIP_SPECS[kind]
    const buffers = this.assetBuffers.get(kind)
    if (!ctx || !master || !spec || !buffers?.length) return false
    try {
      const cursor = this.assetCursor.get(kind) ?? 0
      const buffer = buffers[cursor % buffers.length]
      this.assetCursor.set(kind, cursor + 1)

      const src = ctx.createBufferSource()
      const gain = ctx.createGain()
      src.buffer = buffer
      gain.gain.value = spec.gain
      src.connect(gain)
      gain.connect(master)
      src.start(ctx.currentTime)
      src.onended = () => {
        try {
          src.disconnect()
          gain.disconnect()
        } catch {
          /* already gone */
        }
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * Set engine intensity from thrust in [0, 1]. Pitch and volume track thrust;
   * pass `boost` to raise both. No-op (never throws) if `init()` has not run or
   * audio is unavailable. Call every frame.
   */
  setThrust(level: number, boost = false): void {
    const ctx = this.ctx
    if (!ctx || !this.engineGain || !this.osc1 || !this.osc2) return
    try {
      const freq = thrustToFrequency(level, boost)
      const gain = thrustToGain(level, boost)
      const now = ctx.currentTime
      this.osc1.frequency.setTargetAtTime(freq, now, RAMP)
      this.osc2.frequency.setTargetAtTime(freq * 0.5, now, RAMP)
      this.engineGain.gain.setTargetAtTime(gain, now, RAMP)
      if (this.noiseGain) {
        this.noiseGain.gain.setTargetAtTime(gain * 0.1 * clamp(level, 0, 1), now, RAMP)
      }
    } catch {
      /* ignore transient audio errors */
    }
  }

  /**
   * Gate the mining laser hum. Keep this tied to actual in-range mining so merely
   * holding the mouse in empty space stays quiet.
   */
  setMining(active: boolean, inRange: boolean): void {
    const ctx = this.ctx
    if (!ctx || !this.miningGain || !this.miningOsc) return
    try {
      const now = ctx.currentTime
      this.miningOsc.frequency.setTargetAtTime(MINING_FREQ + (active && inRange ? 12 : 0), now, RAMP)
      this.miningGain.gain.setTargetAtTime(miningToGain(active, inRange), now, 0.05)
    } catch {
      /* ignore transient audio errors */
    }
  }

  /**
   * Engage/disengage boost without changing the commanded thrust level. This is a
   * convenience that re-applies thrust at full level when boosting; for precise
   * control prefer passing `boost` straight to `setThrust`. Never throws.
   */
  setBoost(on: boolean): void {
    const ctx = this.ctx
    if (!ctx || !this.engineGain) return
    try {
      const now = ctx.currentTime
      // Nudge the master engine gain to make boost instantly audible even if the
      // caller does not re-send thrust this frame.
      const cur = this.engineGain.gain.value
      const target = on ? cur * ENGINE_GAIN_BOOST_MULT : cur / ENGINE_GAIN_BOOST_MULT
      this.engineGain.gain.setTargetAtTime(clamp(target, 0, ENGINE_GAIN_MAX * ENGINE_GAIN_BOOST_MULT), now, RAMP)
    } catch {
      /* ignore */
    }
  }

  /**
   * Fire a one-shot UI cue. Allocates a short-lived oscillator that disconnects
   * itself when done, so cues never leak nodes. Never throws.
   */
  blip(kind: BlipKind): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    try {
      if (this.playAssetBlip(kind)) return
      const spec = BLIP_SPECS[kind]
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = spec.type
      osc.frequency.setValueAtTime(spec.from, now)
      osc.frequency.linearRampToValueAtTime(spec.to, now + spec.dur)

      g.gain.setValueAtTime(0, now)
      g.gain.linearRampToValueAtTime(spec.peak, now + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, now + spec.dur)

      osc.connect(g)
      g.connect(master)
      osc.start(now)
      osc.stop(now + spec.dur + 0.02)
      osc.onended = () => {
        try {
          osc.disconnect()
          g.disconnect()
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Resume the AudioContext if a browser suspended it (some browsers start it
   * suspended even after a gesture). Optional; safe and never throws.
   */
  resume(): void {
    try {
      void this.ctx?.resume()
    } catch {
      /* ignore */
    }
  }
}
