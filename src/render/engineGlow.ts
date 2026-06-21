function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

const ENGINE_GLOW_COLOR = 0x9fe0ff

export interface EngineGlowStyleInput {
  thrust: number
  boost: boolean
  speedFrac: number
  cosmeticTier: number
  time: number
}

export interface EngineGlowStyle {
  color: number
  discIntensity: number
  coreIntensity: number
  discOpacity: number
  coreOpacity: number
  scale: number
}

export function engineGlowColor(cosmeticTier: number): number {
  void cosmeticTier
  return ENGINE_GLOW_COLOR
}

export function engineGlowStyle(input: EngineGlowStyleInput): EngineGlowStyle {
  const thrust = clamp01(input.thrust)
  const speed = clamp01(input.speedFrac)
  const boost = input.boost ? 1 : 0
  const pulse = 0.5 + 0.5 * Math.sin(input.time * 18)
  const activity = Math.max(speed * 0.34, thrust * 0.62, boost * 0.92)
  const shimmer = 0.92 + pulse * 0.08

  return {
    color: engineGlowColor(input.cosmeticTier),
    discIntensity: (1.05 + activity * 1.15) * shimmer,
    coreIntensity: (1.45 + activity * 1.65) * shimmer,
    discOpacity: Math.min(0.82, 0.42 + activity * 0.32),
    coreOpacity: Math.min(0.96, 0.7 + activity * 0.22),
    scale: Math.min(1.55, 1 + activity * 0.34 + boost * 0.12),
  }
}
