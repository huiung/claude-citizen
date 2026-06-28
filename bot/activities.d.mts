import type { Vector3 } from 'three'
import type { BotWorld } from './landmarks.mjs'
export interface Activity { kind: string; name?: string; intro: string; phase: string; target: Vector3; [k: string]: unknown }
export const SPEEDS: Record<string, number>
export const ACTIVITY_WEIGHTS: Record<string, number>
export function pickActivity(prevKind: string | null, rng: () => number): string
export function buildActivity(kind: string, fromPos: Vector3, rng: () => number, nowMs: number, world: BotWorld): Activity
export function stepActivity(a: Activity, botPos: Vector3, dtSec: number, nowMs: number, world: BotWorld): { target: Vector3; speed: number; done: boolean }
