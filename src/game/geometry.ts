import type { Vec3 } from './types'

export const TAU = Math.PI * 2
export const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z })
export const flatDistance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z)
export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export function angleDelta(previous: number, current: number): number {
  return Math.atan2(Math.sin(current - previous), Math.cos(current - previous))
}

export function pointSegmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const lengthSquared = dx * dx + dz * dz
  const t = lengthSquared === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSquared, 0, 1)
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz)
}

/** Includes touching endpoints, but not movement along a remote collinear line. */
export function crossesSegment(previous: Vec3, next: Vec3, a: Vec3, b: Vec3): boolean {
  const cross = (p: Vec3, q: Vec3, r: Vec3): number => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x)
  const sideA = cross(a, b, previous)
  const sideB = cross(a, b, next)
  if (sideA * sideB > 0 || (Math.abs(sideA) < 1e-8 && Math.abs(sideB) < 1e-8)) return false
  const motionA = cross(previous, next, a)
  const motionB = cross(previous, next, b)
  return motionA * motionB <= 0
}

export function flatSegmentDistance(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  if (crossesSegment(a, b, c, d)) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}

/** Truncates a movement segment at an upper height plane before horizontal collision testing. */
export function movementBelowHeight(from: Vec3, to: Vec3, height: number): readonly [Vec3, Vec3] | null {
  if (from.y > height && to.y > height) return null
  if (from.y <= height && to.y <= height) return [from, to]
  const t = (height - from.y) / (to.y - from.y)
  const crossing = { x: from.x + (to.x - from.x) * t, y: height, z: from.z + (to.z - from.z) * t }
  return from.y <= height ? [from, crossing] : [crossing, to]
}

export function moveToward(from: Vec3, target: Vec3, amount: number): Vec3 {
  const d = flatDistance(from, target)
  if (d <= amount || d === 0) return { x: target.x, y: from.y, z: target.z }
  return { x: from.x + (target.x - from.x) / d * amount, y: from.y, z: from.z + (target.z - from.z) / d * amount }
}

export function arrivalsInWindow(arrivals: readonly number[], count: number, windowSeconds: number): boolean {
  return arrivals.length === count && Math.max(...arrivals) - Math.min(...arrivals) <= windowSeconds + 1e-8
}
