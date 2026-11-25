import { engine, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import type { Entity } from '@dcl/sdk/ecs'
import type { HazardSnapshot, Vec3 } from './game/types'
import { place, releasePrimitiveWhenHidden, show, thread, tint } from './scene-bindings'
import { sound } from './audio'

const WIRE_RED = { r: 1, g: .065, b: .17 }
const EDGE_RED = { r: .87, g: .045, b: .12 }
const EDGE_GOLD = { r: .90, g: .45, b: .20 }
const FLASH = { r: 1, g: .64, b: .36 }
const RING_STEPS = 16

function piece(shape: 'box' | 'cylinder'): Entity {
  const entity = engine.addEntity()
  Transform.create(entity)
  releasePrimitiveWhenHidden(entity, shape)
  show(entity, false)
  return entity
}

/** Visualizes the model's active lane and radius without contributing new hitboxes. */
export class BossAttacks {
  private readonly lash = Array.from({ length: 3 }, () => piece('cylinder'))
  private readonly ring = Array.from({ length: RING_STEPS }, () => piece('box'))
  private activeLine = ''
  private activeCircle = ''
  private lineAt = 0
  private circleAt = 0

  reset(): void {
    this.activeLine = this.activeCircle = ''
    for (const entity of [...this.lash, ...this.ring]) show(entity, false)
  }

  render(hazards: readonly HazardSnapshot[], elapsed: number, hand: Vec3): void {
    const lane = hazards.find(h => h.kind === 'line' && h.active && !h.id.includes('tripwire'))
    const circle = hazards.find(h => h.kind === 'circle')
    this.renderLane(lane, elapsed, hand)
    this.renderCircle(circle, elapsed)
  }

  private renderLane(lane: HazardSnapshot | undefined, elapsed: number, hand: Vec3): void {
    if (!lane?.to) {
      this.activeLine = ''
      this.lash.forEach(entity => show(entity, false))
      return
    }
    if (this.activeLine !== lane.id) {
      this.activeLine = lane.id
      this.lineAt = elapsed
      sound('wood-hit', .41)
    }
    const age = elapsed - this.lineAt
    const spring = Math.max(0, 1 - age / .38)
    const start = { ...lane.from, y: lane.from.y + .3 }
    const bend = Vector3.lerp(start, lane.to, .55)
    bend.y += .38 + spring * .46
    const end = { ...lane.to, y: lane.to.y + .1 }
    const nodes = [hand, start, bend, end]
    for (let i = 0; i < this.lash.length; i++) {
      const entity = this.lash[i]
      tint(entity, age < .11 ? FLASH : WIRE_RED)
      thread(entity, nodes[i], nodes[i + 1], .062 + spring * .086)
    }
  }

  private renderCircle(circle: HazardSnapshot | undefined, elapsed: number): void {
    if (!circle) {
      this.activeCircle = ''
      this.ring.forEach(entity => show(entity, false))
      return
    }
    if (circle.active && this.activeCircle !== circle.id) {
      this.activeCircle = circle.id
      this.circleAt = elapsed
      sound('controller-fall', .36)
    }
    const impact = circle.active && elapsed - this.circleAt < .15
    const color = impact ? FLASH : circle.active ? EDGE_RED : EDGE_GOLD
    const halfStep = Math.PI / RING_STEPS
    const radius = circle.radius * Math.cos(halfStep)
    const length = 2 * circle.radius * Math.sin(halfStep)
    for (let i = 0; i < this.ring.length; i++) {
      const angle = i * 2 * halfStep
      const entity = this.ring[i]
      place(entity, {
        x: circle.from.x + Math.cos(angle) * radius,
        y: circle.from.y + (impact ? .18 : .075),
        z: circle.from.z + Math.sin(angle) * radius
      }, { x: impact ? .20 : .095, y: impact ? .23 : .055, z: length + .025 },
      Quaternion.fromEulerDegrees(0, -angle * 180 / Math.PI, 0))
      tint(entity, color)
      show(entity, true)
    }
  }
}
