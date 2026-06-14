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

/** One-shot UI cue kinds. */
export type BlipKind = 'dock' | 'trade' | 'error'

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
