import { clamp, distance } from './geometry'
import { THEATRE_COLUMN, THEATRE_COLUMNS } from './theatre-layout.mjs'
import type { AttackMissReason, AttackTarget, ClassAbility, CombatClass, KnotAttackInput, PlayerAttackSnapshot, SecondaryAbility, Vec3 } from './types'

const KNOT_RADIUS = 0.32
const PATH_SEGMENTS = 12

interface AttackRequest {
  id: number
  role: CombatClass
  input: KnotAttackInput
  elapsed: number
  player: Vec3
  target: Vec3
  targetVelocity?: Vec3
  targetKind: AttackTarget
  reach: number
  protection: 'guarded' | 'closed' | null
  ability: ClassAbility | SecondaryAbility | null
  theatreColumns: boolean
}

const { halfWidth, height } = THEATRE_COLUMN
const COLUMNS = THEATRE_COLUMNS.map(({ position: { x, y, z } }) => ({
  min: { x: x - halfWidth, y, z: z - halfWidth },
  max: { x: x + halfWidth, y: y + height, z: z + halfWidth }
}))

function pathPoint(origin: Vec3, target: Vec3, progress: number, arcHeight: number): Vec3 {
  return {
    x: origin.x + (target.x - origin.x) * progress,
    y: origin.y + (target.y - origin.y) * progress + 4 * arcHeight * progress * (1 - progress),
    z: origin.z + (target.z - origin.z) * progress
  }
}

function flightSeconds(trajectory: PlayerAttackSnapshot['trajectory'], length: number): number {
  if (trajectory === 'card') return clamp(length / 22, .14, .33)
  if (trajectory === 'arc') return clamp(length / 24, .16, .36)
  return clamp(length / 30, .15, .37)
}

function projectileRadius(trajectory: PlayerAttackSnapshot['trajectory'], secondary: boolean): number {
  if (trajectory === 'card') return secondary ? .105 : .055
  if (trajectory === 'arc') return secondary ? .20 : .14
  return secondary ? .075 : .045
}

/** Deterministic visual/physical trajectory. Windup stays attached to its launch origin. */
export function playerAttackPosition(attack: PlayerAttackSnapshot, elapsed: number): Vec3 {
  const progress = clamp((elapsed - attack.launchElapsed) / (attack.impactElapsed - attack.launchElapsed), 0, 1)
  return pathPoint(attack.origin, attack.target, progress, attack.arcHeight)
}

export function createPlayerAttack(request: AttackRequest): { attack: PlayerAttackSnapshot; miss: AttackMissReason | null } {
  const { id, role, input, elapsed, player, target: targetPosition, targetVelocity, targetKind, reach, protection, ability, theatreColumns } = request
  const kind = input === 'secondary' ? 'secondary' : input === 'auto' ? 'auto' : 'basic'
  const trajectory = role === 'mage' ? 'arc' : role === 'archer' ? 'arrow' : 'card'
  const origin = { ...player, y: player.y + 1.05 }
  let aim = targetPosition
  if (targetVelocity) {
    // One iteration corrects the estimate when leading changes travel distance.
    for (let i = 0; i < 2; i++) {
      const seconds = flightSeconds(trajectory, distance(origin, aim))
      aim = { x: targetPosition.x + targetVelocity.x * seconds, y: targetPosition.y + targetVelocity.y * seconds, z: targetPosition.z + targetVelocity.z * seconds }
    }
  }
  const distanceToTarget = distance(player, aim)
  const inReach = distance(player, targetPosition) <= reach
  const desired = pathPoint(origin, aim, distanceToTarget <= reach ? 1 : reach / distanceToTarget, 0)
  const flightDistance = distance(origin, desired)
  const arcHeight = trajectory === 'arc' ? clamp(flightDistance * .16, .40, 1.35) : 0
  const radius = projectileRadius(trajectory, kind === 'secondary')
  const pointAt = (progress: number) => pathPoint(origin, desired, progress, arcHeight)
  const segments = arcHeight > 0 ? PATH_SEGMENTS : 1
  const obstruction = theatreColumns ? firstPathContact(pointAt, segments, (from, to) => firstColumnHit(from, to, radius)) : null
  const knot = targetKind === 'boss' ? firstPathContact(pointAt, segments, (from, to) =>
    firstSphereContact(relative(from, targetPosition), relative(to, targetPosition), radius + KNOT_RADIUS)) : null
  const blocked = obstruction !== null && (knot === null || obstruction <= knot)
  const travelled = Math.min(obstruction ?? 1, knot ?? 1)
  const target = pointAt(travelled)
  const windup = kind === 'secondary' ? .34 : trajectory === 'card' ? .19 : .16
  const flight = flightSeconds(trajectory, flightDistance)
  const launchElapsed = elapsed + windup
  return {
    attack: {
      id, role, kind, input, trajectory, startElapsed: elapsed, launchElapsed,
      impactElapsed: launchElapsed + Math.max(.04, flight * travelled), origin, target, targetKind,
      arcHeight: arcHeight * travelled ** 2, radius, ability
    },
    miss: blocked ? 'blocked' : protection ?? (!inReach || (targetKind === 'boss' && knot === null) ? 'range' : null)
  }
}

const relative = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

function firstSphereContact(from: Vec3, to: Vec3, radius: number): number | null {
  const start = dot(from, from) - radius ** 2
  if (start <= 0) return 0
  const delta = relative(to, from)
  const lengthSquared = dot(delta, delta)
  const direction = dot(from, delta)
  if (lengthSquared <= 1e-12 || direction >= 0) return null
  const determinant = direction ** 2 - lengthSquared * start
  if (determinant < 0) return null
  const fraction = (-direction - Math.sqrt(determinant)) / lengthSquared
  return fraction <= 1 ? fraction : null
}

/** Sweep both bodies over the same interval in relative coordinates. */
export function sweptAttackContact(attack: PlayerAttackSnapshot, start: number, end: number, targetBefore: Vec3, targetAfter: Vec3, radius: number): { elapsed: number; position: Vec3 } | null {
  const duration = end - start
  const flight = attack.impactElapsed - attack.launchElapsed
  // Keep short frames inexpensive while following the arc through a longer update.
  const segments = attack.arcHeight > 0 ? clamp(Math.ceil(PATH_SEGMENTS * duration / flight), 1, PATH_SEGMENTS) : 1
  const relativeAt = (fraction: number) => relative(
    playerAttackPosition(attack, start + duration * fraction), pathPoint(targetBefore, targetAfter, fraction, 0)
  )
  const hit = firstPathContact(relativeAt, segments, (from, to) => firstSphereContact(from, to, radius + attack.radius))
  if (hit === null) return null
  const elapsed = start + duration * hit
  return { elapsed, position: playerAttackPosition(attack, elapsed) }
}

function sweptSphereBox(from: Vec3, to: Vec3, radius: number, { min, max }: typeof COLUMNS[number]): number | null {
  // The nearest box point is linear between crossings of its six face planes.
  const boundaries = [0, 1]
  for (const axis of ['x', 'y', 'z'] as const) {
    if (Math.min(from[axis], to[axis]) > max[axis] + radius || Math.max(from[axis], to[axis]) < min[axis] - radius) return null
    const delta = to[axis] - from[axis]
    if (Math.abs(delta) <= 1e-8) continue
    const enter = (min[axis] - from[axis]) / delta
    const exit = (max[axis] - from[axis]) / delta
    if (enter > 0 && enter < 1) boundaries.push(enter)
    if (exit > 0 && exit < 1) boundaries.push(exit)
  }
  const offset = (p: Vec3): Vec3 => ({ x: p.x - clamp(p.x, min.x, max.x), y: p.y - clamp(p.y, min.y, max.y), z: p.z - clamp(p.z, min.z, max.z) })
  boundaries.sort((a, b) => a - b)
  let previous = offset(from)
  for (let i = 1; i < boundaries.length; i++) {
    const next = offset(pathPoint(from, to, boundaries[i], 0))
    const hit = firstSphereContact(previous, next, radius)
    if (hit !== null) return boundaries[i - 1] + (boundaries[i] - boundaries[i - 1]) * hit
    previous = next
  }
  return null
}

function firstColumnHit(from: Vec3, to: Vec3, radius: number): number | null {
  let earliest: number | null = null
  for (const column of COLUMNS) {
    const hit = sweptSphereBox(from, to, radius, column)
    if (hit !== null) earliest = earliest === null ? hit : Math.min(earliest, hit)
  }
  return earliest
}

function firstPathContact(pointAt: (progress: number) => Vec3, count: number, contact: (from: Vec3, to: Vec3) => number | null): number | null {
  let previous = pointAt(0)
  for (let segment = 0; segment < count; segment++) {
    const next = pointAt((segment + 1) / count)
    const hit = contact(previous, next)
    if (hit !== null) return (segment + hit) / count
    previous = next
  }
  return null
}
