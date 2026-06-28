import type { Vector3 } from 'three'
export interface BotWorld {
  landmarks: { id: string; name: string; position: Vector3; weight?: number }[]
  stations: { id: string; name: string; position: Vector3 }[]
  raceGates: Vector3[]
  pvpArenaCenter: Vector3
  blackHoleCenter: Vector3
  blackHoleInfluence: number
}
export const BOT_WORLD: BotWorld
