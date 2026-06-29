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
/** Toggle for thrust/boost/wind layers; menu music and UI/ambient cues are separate. */
export const FLIGHT_AUDIO_ENABLED = true
/** Quiet continuous mining laser tone. Kept below idle engine gain on purpose. */
export const MINING_GAIN_ACTIVE = 0.0035
export const MINING_FREQ = 520
export const SPACE_AMBIENCE_GAIN = 0.0032
export const ATMO_AMBIENCE_GAIN_MAX = 0.026
export const QUANTUM_AMBIENCE_GAIN_MAX = 0.012
export const REGIONAL_AMBIENCE_GAIN_MAX = 0.0065
export const REGIONAL_AMBIENCE_PULSE_MAX = 0.0048
export const REGIONAL_AMBIENCE_NOISE_MAX = 0.004

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

export interface AmbienceState {
  /** Atmospheric proximity in [0, 1], usually the same value driving the visual veil. */
  atmosphere: number
  /** Quantum-drive intensity in [0, 1]. */
  quantum: number
  /** Current speed as a fraction of the ship's effective max speed. */
  speedFrac: number
}

export interface AmbienceParams {
  spaceGain: number
  spaceFilterFreq: number
  atmoGain: number
  atmoFilterFreq: number
  quantumGain: number
  quantumFilterFreq: number
}

export type RegionalAmbienceKind = 'deepSpace' | 'spawn' | 'seasonHub' | 'pvp' | 'race' | 'blackHole' | 'mining'

export interface RegionalAmbienceState {
  kind: RegionalAmbienceKind
  intensity: number
}

export interface RegionalAmbienceParams {
  bedGain: number
  bedFreq: number
  pulseGain: number
  pulseFreq: number
  noiseGain: number
  noiseFilterFreq: number
}

/** Shape the living-space ambience layers from game state. Pure and unit-tested. */
export function ambienceToParams(state: AmbienceState): AmbienceParams {
  const atmosphere = clamp(state.atmosphere, 0, 1)
  const quantum = clamp(state.quantum, 0, 1)
  const speed = clamp(state.speedFrac, 0, 1.4)
  const atmo = atmosphere * atmosphere
  const q = quantum * quantum

  return {
    spaceGain: SPACE_AMBIENCE_GAIN * (1 - atmosphere * 0.45) * (1 - quantum * 0.25),
    spaceFilterFreq: 140 + speed * 90,
    atmoGain: ATMO_AMBIENCE_GAIN_MAX * atmo * (0.55 + Math.min(speed, 1) * 0.45),
    atmoFilterFreq: 340 + atmo * 980 + Math.min(speed, 1) * 420,
    quantumGain: QUANTUM_AMBIENCE_GAIN_MAX * q,
    quantumFilterFreq: 1200 + q * 1800,
  }
}

/** Region ambience is intentionally quiet: a faint identity layer, not background music. */
export function regionalAmbienceToParams(state: RegionalAmbienceState): RegionalAmbienceParams {
  const intensity = clamp(state.intensity, 0, 1)
  const i = intensity * intensity
  switch (state.kind) {
    case 'spawn':
      return { bedGain: REGIONAL_AMBIENCE_GAIN_MAX * 0.48 * i, bedFreq: 72, pulseGain: REGIONAL_AMBIENCE_PULSE_MAX * 0.18 * i, pulseFreq: 0.16, noiseGain: REGIONAL_AMBIENCE_NOISE_MAX * 0.16 * i, noiseFilterFreq: 420 }
    case 'seasonHub':
      return { bedGain: REGIONAL_AMBIENCE_GAIN_MAX * 0.72 * i, bedFreq: 92, pulseGain: REGIONAL_AMBIENCE_PULSE_MAX * 0.38 * i, pulseFreq: 0.23, noiseGain: REGIONAL_AMBIENCE_NOISE_MAX * 0.2 * i, noiseFilterFreq: 620 }
    case 'pvp':
      return { bedGain: REGIONAL_AMBIENCE_GAIN_MAX * 0.5 * i, bedFreq: 48, pulseGain: REGIONAL_AMBIENCE_PULSE_MAX * 0.68 * i, pulseFreq: 0.72, noiseGain: REGIONAL_AMBIENCE_NOISE_MAX * 0.32 * i, noiseFilterFreq: 780 }
    case 'race':
      return { bedGain: REGIONAL_AMBIENCE_GAIN_MAX * 0.42 * i, bedFreq: 110, pulseGain: REGIONAL_AMBIENCE_PULSE_MAX * 0.82 * i, pulseFreq: 1.18, noiseGain: REGIONAL_AMBIENCE_NOISE_MAX * 0.18 * i, noiseFilterFreq: 1050 }
    case 'blackHole':
      return { bedGain: REGIONAL_AMBIENCE_GAIN_MAX * 0.9 * i, bedFreq: 31, pulseGain: REGIONAL_AMBIENCE_PULSE_MAX * 0.2 * i, pulseFreq: 0.09, noiseGain: REGIONAL_AMBIENCE_NOISE_MAX * 0.88 * i, noiseFilterFreq: 180 + 380 * intensity }
    case 'mining':
      return { bedGain: REGIONAL_AMBIENCE_GAIN_MAX * 0.36 * i, bedFreq: 63, pulseGain: REGIONAL_AMBIENCE_PULSE_MAX * 0.3 * i, pulseFreq: 0.31, noiseGain: REGIONAL_AMBIENCE_NOISE_MAX * 0.26 * i, noiseFilterFreq: 520 }
    case 'deepSpace':
    default:
      return { bedGain: REGIONAL_AMBIENCE_GAIN_MAX * 0.12 * i, bedFreq: 40, pulseGain: 0, pulseFreq: 0.1, noiseGain: 0, noiseFilterFreq: 300 }
  }
}

export interface BoostPunchParams {
  noisePeak: number
  tonePeak: number
  filterStart: number
  filterEnd: number
  toneStart: number
  toneEnd: number
  duration: number
}

/** Short boost ignition punch: a pressure thump plus a filtered whoosh. */
export function boostPunchToParams(speedFrac: number): BoostPunchParams {
  const speed = clamp(speedFrac, 0, 1.4)
  const t = Math.min(speed, 1)
  return {
    noisePeak: 0.068 + t * 0.035,
    tonePeak: 0.024 + t * 0.018,
    filterStart: 180 + t * 120,
    filterEnd: 820 + t * 850,
    toneStart: 72 + t * 18,
    toneEnd: 118 + t * 34,
    duration: 0.3,
  }
}

/** One-shot UI / combat cue kinds. */
export type BlipKind = 'dock' | 'trade' | 'error' | 'fire' | 'hit' | 'explosion' | 'boost' | 'nav' | 'forge' | 'forge-done'

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
  // soft, quiet UI tick — cycling the quantum destination / spooling a jump
  nav: { from: 540, to: 600, peak: 0.06, dur: 0.07, type: 'sine' },
  // metallic clank fallback for each forging stage
  forge: { from: 240, to: 170, peak: 0.12, dur: 0.12, type: 'square' },
  // bright rising chime when forging completes
  'forge-done': { from: 520, to: 880, peak: 0.16, dur: 0.22, type: 'triangle' },
}

/** CC0 Kenney sci-fi sounds for short event cues. Continuous audio stays procedural. */
export const ASSET_BLIP_SPECS: Partial<Record<BlipKind, AssetBlipSpec>> = {
  fire: {
    variants: [
      '/audio/kenney-sci-fi/laserSmall_000.ogg',
      '/audio/kenney-sci-fi/laserSmall_001.ogg',
      '/audio/kenney-sci-fi/laserSmall_002.ogg',
    ],
    gain: 0.22,
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
  forge: {
    variants: [
      '/audio/kenney-sci-fi/impactMetal_000.ogg',
      '/audio/kenney-sci-fi/impactMetal_001.ogg',
      '/audio/kenney-sci-fi/impactMetal_002.ogg',
    ],
    gain: 0.3,
  },
  dock: {
    variants: ['/audio/kenney-sci-fi/doorClose_001.ogg'],
    gain: 0.1,
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
  private windGain: GainNode | null = null // air-rush layer that swells with speed
  private windFilter: BiquadFilterNode | null = null
  private spaceAmbienceGain: GainNode | null = null
  private spaceAmbienceFilter: BiquadFilterNode | null = null
  private atmoAmbienceGain: GainNode | null = null
  private atmoAmbienceFilter: BiquadFilterNode | null = null
  private quantumAmbienceGain: GainNode | null = null
  private quantumAmbienceFilter: BiquadFilterNode | null = null
  private regionalBedOsc: OscillatorNode | null = null
  private regionalBedGain: GainNode | null = null
  private regionalPulseOsc: OscillatorNode | null = null
  private regionalPulseGain: GainNode | null = null
  private regionalNoiseGain: GainNode | null = null
  private regionalNoiseFilter: BiquadFilterNode | null = null
  private miningOsc: OscillatorNode | null = null
  private miningGain: GainNode | null = null
  private assetBuffers = new Map<BlipKind, AudioBuffer[]>()
  private assetCursor = new Map<BlipKind, number>()
  private noiseBuffer: AudioBuffer | null = null
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
      engineGain.gain.value = FLIGHT_AUDIO_ENABLED ? ENGINE_GAIN_IDLE : 0
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

      // A very low musical bed: not a song, just space pressure under the engine.
      const spaceAmbienceGain = ctx.createGain()
      spaceAmbienceGain.gain.value = SPACE_AMBIENCE_GAIN
      const spaceAmbienceFilter = ctx.createBiquadFilter()
      spaceAmbienceFilter.type = 'lowpass'
      spaceAmbienceFilter.frequency.value = 140
      spaceAmbienceFilter.Q.value = 0.7
      const spaceA = ctx.createOscillator()
      spaceA.type = 'sine'
      spaceA.frequency.value = 36
      const spaceB = ctx.createOscillator()
      spaceB.type = 'triangle'
      spaceB.frequency.value = 54
      spaceB.detune.value = -11
      spaceA.connect(spaceAmbienceFilter)
      spaceB.connect(spaceAmbienceFilter)
      spaceAmbienceFilter.connect(spaceAmbienceGain)
      spaceAmbienceGain.connect(master)
      spaceA.start()
      spaceB.start()
      this.spaceAmbienceGain = spaceAmbienceGain
      this.spaceAmbienceFilter = spaceAmbienceFilter

      // Filtered noise layer — quiet hiss that scales with the engine.
      // Regional ambience: very quiet identity layer for landmarks/zones.
      const regionalBedGain = ctx.createGain()
      regionalBedGain.gain.value = 0
      const regionalBedOsc = ctx.createOscillator()
      regionalBedOsc.type = 'sine'
      regionalBedOsc.frequency.value = 40
      regionalBedOsc.connect(regionalBedGain)
      regionalBedGain.connect(master)
      regionalBedOsc.start()
      this.regionalBedGain = regionalBedGain
      this.regionalBedOsc = regionalBedOsc

      const regionalPulseGain = ctx.createGain()
      regionalPulseGain.gain.value = 0
      const regionalPulseOsc = ctx.createOscillator()
      regionalPulseOsc.type = 'triangle'
      regionalPulseOsc.frequency.value = 0.1
      regionalPulseOsc.connect(regionalPulseGain)
      regionalPulseGain.connect(master)
      regionalPulseOsc.start()
      this.regionalPulseGain = regionalPulseGain
      this.regionalPulseOsc = regionalPulseOsc

      const noiseGain = ctx.createGain()
      noiseGain.gain.value = 0
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 280 // darker — kills the hiss, leaves a faint rumble
      noiseGain.connect(master)

      const buf = this.makeNoiseBuffer(ctx)
      if (buf) {
        this.noiseBuffer = buf
        const noise = ctx.createBufferSource()
        noise.buffer = buf
        noise.loop = true
        noise.connect(lp)
        lp.connect(noiseGain)
        noise.start()

        // Air-rush layer: a separate band-passed noise voice whose gain and brightness
        // climb with speed — the "wind" of going fast (no real air up here, but it sells it).
        const windGain = ctx.createGain()
        windGain.gain.value = 0
        windGain.connect(master)
        const windFilter = ctx.createBiquadFilter()
        windFilter.type = 'lowpass' // soft air flow, not a high-frequency hiss
        windFilter.frequency.value = 300
        windFilter.Q.value = 0.5
        windFilter.connect(windGain)
        const wind = ctx.createBufferSource()
        wind.buffer = buf
        wind.loop = true
        wind.connect(windFilter)
        wind.start()
        this.windGain = windGain
        this.windFilter = windFilter

        // Region noise: pressure/static for black hole, PvP, hubs, and industrial spaces.
        const regionalNoiseGain = ctx.createGain()
        regionalNoiseGain.gain.value = 0
        const regionalNoiseFilter = ctx.createBiquadFilter()
        regionalNoiseFilter.type = 'lowpass'
        regionalNoiseFilter.frequency.value = 300
        regionalNoiseFilter.Q.value = 0.55
        const regionalNoise = ctx.createBufferSource()
        regionalNoise.buffer = buf
        regionalNoise.loop = true
        regionalNoise.connect(regionalNoiseFilter)
        regionalNoiseFilter.connect(regionalNoiseGain)
        regionalNoiseGain.connect(master)
        regionalNoise.start()
        this.regionalNoiseGain = regionalNoiseGain
        this.regionalNoiseFilter = regionalNoiseFilter

        // Atmosphere: soft, wide noise that appears with the visual entry veil.
        const atmoAmbienceGain = ctx.createGain()
        atmoAmbienceGain.gain.value = 0
        const atmoAmbienceFilter = ctx.createBiquadFilter()
        atmoAmbienceFilter.type = 'lowpass'
        atmoAmbienceFilter.frequency.value = 340
        atmoAmbienceFilter.Q.value = 0.4
        const atmo = ctx.createBufferSource()
        atmo.buffer = buf
        atmo.loop = true
        atmo.connect(atmoAmbienceFilter)
        atmoAmbienceFilter.connect(atmoAmbienceGain)
        atmoAmbienceGain.connect(master)
        atmo.start()
        this.atmoAmbienceGain = atmoAmbienceGain
        this.atmoAmbienceFilter = atmoAmbienceFilter

        // Quantum pressure: brighter filtered noise, kept quieter than atmosphere.
        const quantumAmbienceGain = ctx.createGain()
        quantumAmbienceGain.gain.value = 0
        const quantumAmbienceFilter = ctx.createBiquadFilter()
        quantumAmbienceFilter.type = 'bandpass'
        quantumAmbienceFilter.frequency.value = 1200
        quantumAmbienceFilter.Q.value = 0.9
        const quantumNoise = ctx.createBufferSource()
        quantumNoise.buffer = buf
        quantumNoise.loop = true
        quantumNoise.connect(quantumAmbienceFilter)
        quantumAmbienceFilter.connect(quantumAmbienceGain)
        quantumAmbienceGain.connect(master)
        quantumNoise.start()
        this.quantumAmbienceGain = quantumAmbienceGain
        this.quantumAmbienceFilter = quantumAmbienceFilter
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
  setThrust(level: number, boost = false, speedFrac = 0): void {
    const ctx = this.ctx
    if (!ctx || !this.engineGain || !this.osc1 || !this.osc2) return
    try {
      const freq = thrustToFrequency(level, boost)
      const gain = thrustToGain(level, boost)
      const now = ctx.currentTime
      this.osc1.frequency.setTargetAtTime(freq, now, RAMP)
      this.osc2.frequency.setTargetAtTime(freq * 0.5, now, RAMP)
      if (!FLIGHT_AUDIO_ENABLED) {
        this.engineGain.gain.setTargetAtTime(0, now, RAMP)
        this.noiseGain?.gain.setTargetAtTime(0, now, RAMP)
        this.windGain?.gain.setTargetAtTime(0, now, RAMP)
        return
      }
      this.engineGain.gain.setTargetAtTime(gain, now, RAMP)
      if (this.noiseGain) {
        this.noiseGain.gain.setTargetAtTime(gain * 0.1 * clamp(level, 0, 1), now, RAMP)
      }
      // Air-rush: louder and brighter the faster you go; boost pushes it further.
      if (this.windGain && this.windFilter) {
        const s = clamp(speedFrac, 0, 1.4)
        this.windGain.gain.setTargetAtTime(0.011 * Math.min(s, 1) * (boost ? 1.3 : 1), now, RAMP)
        this.windFilter.frequency.setTargetAtTime(260 + s * 700, now, RAMP) // dark, rumbly — never hisses
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

  /** Update procedural ambience layers. Call every frame with cheap, normalized game state. */
  setAmbience(state: AmbienceState): void {
    const ctx = this.ctx
    if (!ctx) return
    try {
      const now = ctx.currentTime
      const params = ambienceToParams(state)
      this.spaceAmbienceGain?.gain.setTargetAtTime(params.spaceGain, now, 0.35)
      this.spaceAmbienceFilter?.frequency.setTargetAtTime(params.spaceFilterFreq, now, 0.5)
      this.atmoAmbienceGain?.gain.setTargetAtTime(params.atmoGain, now, 0.22)
      this.atmoAmbienceFilter?.frequency.setTargetAtTime(params.atmoFilterFreq, now, 0.25)
      this.quantumAmbienceGain?.gain.setTargetAtTime(params.quantumGain, now, 0.18)
      this.quantumAmbienceFilter?.frequency.setTargetAtTime(params.quantumFilterFreq, now, 0.2)
    } catch {
      /* ignore transient audio errors */
    }
  }

  /** Update the current place identity layer. Call every frame; values crossfade slowly. */
  setRegionalAmbience(state: RegionalAmbienceState): void {
    const ctx = this.ctx
    if (!ctx) return
    try {
      const now = ctx.currentTime
      const params = regionalAmbienceToParams(state)
      this.regionalBedGain?.gain.setTargetAtTime(params.bedGain, now, 1.2)
      this.regionalBedOsc?.frequency.setTargetAtTime(params.bedFreq, now, 1.4)
      this.regionalPulseGain?.gain.setTargetAtTime(params.pulseGain, now, 1.0)
      this.regionalPulseOsc?.frequency.setTargetAtTime(params.pulseFreq, now, 1.2)
      this.regionalNoiseGain?.gain.setTargetAtTime(params.noiseGain, now, 1.1)
      this.regionalNoiseFilter?.frequency.setTargetAtTime(params.noiseFilterFreq, now, 1.2)
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
    if (!FLIGHT_AUDIO_ENABLED) return
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

  /** One-shot boost ignition: pressure thump + filtered noise whoosh. */
  playBoostPunch(speedFrac = 0): void {
    if (!FLIGHT_AUDIO_ENABLED) return
    const ctx = this.ctx
    const master = this.master
    const noiseBuffer = this.noiseBuffer
    if (!ctx || !master) return
    try {
      const now = ctx.currentTime
      const p = boostPunchToParams(speedFrac)

      const tone = ctx.createOscillator()
      const toneGain = ctx.createGain()
      tone.type = 'triangle'
      tone.frequency.setValueAtTime(p.toneStart, now)
      tone.frequency.exponentialRampToValueAtTime(p.toneEnd, now + p.duration * 0.75)
      toneGain.gain.setValueAtTime(0.0001, now)
      toneGain.gain.exponentialRampToValueAtTime(p.tonePeak, now + 0.035)
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + p.duration)
      tone.connect(toneGain)
      toneGain.connect(master)
      tone.start(now)
      tone.stop(now + p.duration + 0.03)
      tone.onended = () => {
        try {
          tone.disconnect()
          toneGain.disconnect()
        } catch {
          /* already gone */
        }
      }

      if (noiseBuffer) {
        const noise = ctx.createBufferSource()
        const filter = ctx.createBiquadFilter()
        const gain = ctx.createGain()
        noise.buffer = noiseBuffer
        filter.type = 'bandpass'
        filter.Q.value = 0.85
        filter.frequency.setValueAtTime(p.filterStart, now)
        filter.frequency.exponentialRampToValueAtTime(p.filterEnd, now + p.duration * 0.65)
        gain.gain.setValueAtTime(0.0001, now)
        gain.gain.exponentialRampToValueAtTime(p.noisePeak, now + 0.045)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + p.duration)
        noise.connect(filter)
        filter.connect(gain)
        gain.connect(master)
        noise.start(now)
        noise.stop(now + p.duration + 0.03)
        noise.onended = () => {
          try {
            noise.disconnect()
            filter.disconnect()
            gain.disconnect()
          } catch {
            /* already gone */
          }
        }
      }
    } catch {
      /* ignore transient audio errors */
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
