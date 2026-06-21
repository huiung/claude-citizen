const MASTER_GAIN = 0.36
const ROOT = 55
const CHORDS = [
  [0, 7, 14, 19],
  [-2, 5, 12, 17],
  [-5, 2, 9, 16],
  [-7, 0, 7, 14],
]
const ARP = [0, 7, 12, 19, 24, 19, 14, 12, 7, 12, 19, 26]
const INTRO_MOTIF = [12, 19, 24, 31, 36]

function note(root: number, semitone: number): number {
  return root * Math.pow(2, semitone / 12)
}

export class LandingMusic {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private filter: BiquadFilterNode | null = null
  private pad: OscillatorNode[] = []
  private padGains: GainNode[] = []
  private drone: OscillatorNode | null = null
  private chordTimer = 0
  private arpTimer = 0
  private chordIdx = 0
  private arpIdx = 0
  private started = false
  private stopping = false

  start(): void {
    if (this.stopping) return
    if (this.started) {
      void this.ctx?.resume()
      return
    }
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
      master.gain.value = 0
      master.connect(ctx.destination)
      master.gain.linearRampToValueAtTime(MASTER_GAIN, ctx.currentTime + 2.4)
      this.master = master

      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 1320
      filter.Q.value = 0.8
      filter.connect(master)
      this.filter = filter

      const droneGain = ctx.createGain()
      droneGain.gain.value = 0.28
      droneGain.connect(filter)
      const drone = ctx.createOscillator()
      drone.type = 'sine'
      drone.frequency.value = ROOT / 2
      drone.connect(droneGain)
      drone.start()
      this.drone = drone

      for (let i = 0; i < 4; i++) {
        const gain = ctx.createGain()
        gain.gain.value = 0.075
        gain.connect(filter)
        const osc = ctx.createOscillator()
        osc.type = i % 2 ? 'triangle' : 'sine'
        osc.detune.value = (i - 1.5) * 5
        osc.frequency.value = note(ROOT, CHORDS[0][i])
        osc.connect(gain)
        osc.start()
        this.pad.push(osc)
        this.padGains.push(gain)
      }

      this.playIntroStinger()
      this.chordTimer = window.setInterval(() => this.nextChord(), 6500)
      this.arpTimer = window.setInterval(() => this.playArpNote(), 520)
      void ctx.resume()
    } catch {
      this.stop(0)
    }
  }

  stop(fadeSeconds = 1.2): void {
    if (this.stopping) return
    this.stopping = true
    if (this.chordTimer) window.clearInterval(this.chordTimer)
    if (this.arpTimer) window.clearInterval(this.arpTimer)
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const t = ctx.currentTime
    master.gain.cancelScheduledValues(t)
    master.gain.setValueAtTime(master.gain.value, t)
    master.gain.linearRampToValueAtTime(0, t + fadeSeconds)
    window.setTimeout(() => {
      try {
        this.pad.forEach((osc) => osc.stop())
        this.drone?.stop()
        void ctx.close()
      } catch {
        // Audio shutdown is best-effort; navigation may already be underway.
      }
    }, fadeSeconds * 1000 + 100)
  }

  private nextChord(): void {
    const ctx = this.ctx
    if (!ctx) return
    this.chordIdx = (this.chordIdx + 1) % CHORDS.length
    const chord = CHORDS[this.chordIdx]
    const t = ctx.currentTime
    this.pad.forEach((osc, i) => {
      osc.frequency.cancelScheduledValues(t)
      osc.frequency.setValueAtTime(osc.frequency.value, t)
      osc.frequency.exponentialRampToValueAtTime(note(ROOT, chord[i]), t + 1.8)
    })
    if (this.filter) {
      this.filter.frequency.cancelScheduledValues(t)
      this.filter.frequency.setValueAtTime(this.filter.frequency.value, t)
      this.filter.frequency.linearRampToValueAtTime(this.chordIdx % 2 ? 980 : 1450, t + 2)
    }
  }

  private playIntroStinger(): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const start = ctx.currentTime + 0.18

    INTRO_MOTIF.forEach((semitone, i) => {
      const t = start + i * 0.16
      const gain = ctx.createGain()
      gain.gain.value = 0.0001
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)

      const pan = ctx.createStereoPanner?.()
      if (pan) {
        pan.pan.value = -0.36 + i * 0.18
        gain.connect(pan)
        pan.connect(master)
      } else {
        gain.connect(master)
      }

      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = note(ROOT, semitone + 24)
      osc.detune.value = i % 2 ? 4 : -4
      osc.connect(gain)
      osc.start(t)
      osc.stop(t + 0.62)
    })

    const bassGain = ctx.createGain()
    bassGain.gain.value = 0.0001
    bassGain.gain.exponentialRampToValueAtTime(0.16, start + 0.08)
    bassGain.gain.exponentialRampToValueAtTime(0.0001, start + 1.05)
    bassGain.connect(master)

    const bass = ctx.createOscillator()
    bass.type = 'sine'
    bass.frequency.setValueAtTime(ROOT / 2, start)
    bass.frequency.exponentialRampToValueAtTime(ROOT, start + 0.9)
    bass.connect(bassGain)
    bass.start(start)
    bass.stop(start + 1.1)
  }

  private playArpNote(): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const t = ctx.currentTime
    const semitone = CHORDS[this.chordIdx][0] + ARP[this.arpIdx]
    this.arpIdx = (this.arpIdx + 1) % ARP.length

    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.gain.linearRampToValueAtTime(0.11, t + 0.025)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.82)
    gain.connect(master)

    const pan = ctx.createStereoPanner?.()
    if (pan) {
      pan.pan.value = Math.sin(this.arpIdx * 1.7) * 0.35
      gain.disconnect()
      gain.connect(pan)
      pan.connect(master)
    }

    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = note(ROOT, semitone + 24)
    osc.connect(gain)
    osc.start(t)
    osc.stop(t + 1.2)
  }
}
