import type { Vector3, Quaternion } from 'three'
export function stepMover(pos: Vector3, dest: Vector3, speed: number, dt: number): { pos: Vector3; quat: Quaternion; arrived: boolean }
