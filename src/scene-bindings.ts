import { engine, Entity, Transform, VisibilityComponent, Material, Animator, MeshRenderer } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import type { Vec3 } from './game/types'

export function byName(name: string): Entity {
  const entity = engine.getEntityOrNullByName(name)
  if (entity === null) throw new Error(`Missing authored scene entity: ${name}. Run npm run scene:generate with Creator Hub closed.`)
  return entity
}
export function combatPosition(value: unknown): Vec3 | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { x, y, z } = value as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return undefined
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined
  return { x, y, z }
}
type Primitive = 'box' | 'cylinder' | 'sphere'
const primitives = new Map<Entity, Primitive>()

/** Hidden renderers still count toward the Explorer scene limits. */
export function releasePrimitiveWhenHidden(entity: Entity, shape: Primitive): void {
  primitives.set(entity, shape)
}

export function show(entity: Entity, visible: boolean): void {
  const shape = primitives.get(entity)
  if (shape) {
    const attached = MeshRenderer.has(entity)
    if (attached && !visible) MeshRenderer.deleteFrom(entity)
    if (!attached && visible) {
      if (shape === 'box') MeshRenderer.setBox(entity)
      else if (shape === 'cylinder') MeshRenderer.setCylinder(entity)
      else MeshRenderer.setSphere(entity)
    }
  }
  if (VisibilityComponent.getOrNull(entity)?.visible !== visible) VisibilityComponent.createOrReplace(entity, { visible })
}
export function place(entity: Entity, position: Vec3, scale?: Vec3, rotation?: { x: number; y: number; z: number; w: number }): void {
  const t = Transform.getMutable(entity)
  t.position = position
  if (scale) t.scale = scale
  if (rotation) t.rotation = rotation
}
export function thread(entity: Entity, from: Vec3, to: Vec3, thickness = 0.032): void {
  const delta = Vector3.subtract(to, from)
  const length = Vector3.length(delta)
  show(entity, length > 0.01)
  if (length <= 0.01) return
  // A cylinder's length axis is local +Y, so rotate that axis onto the segment.
  const d = Vector3.normalize(delta)
  const rotation = d.y < -0.9999 ? Quaternion.fromEulerDegrees(180, 0, 0) : Quaternion.normalize({ x: d.z, y: 0, z: -d.x, w: 1 + d.y })
  place(entity, Vector3.scale(Vector3.add(from, to), 0.5), { x: thickness, y: length, z: thickness }, rotation)
}
const tints = new Map<Entity, string>()
export function tint(entity: Entity, color: { r: number; g: number; b: number }, emissive = true): void {
  const key = `${color.r},${color.g},${color.b},${emissive}`
  if (tints.get(entity) === key) return
  Material.setPbrMaterial(entity, { albedoColor: { ...color, a: 1 }, emissiveColor: color, emissiveIntensity: emissive ? 1.1 : 0, metallic: 0, roughness: 0.8 })
  tints.set(entity, key)
}
const playing = new Map<Entity, string>()
export function animation(entity: Entity, clip: string, loop = false, actionKey = clip): void {
  const key = clip + ':' + actionKey
  if (!Animator.has(entity) || playing.get(entity) === key) return
  const state = Animator.getClipOrNull(entity, clip)
  if (!state) return
  state.loop = loop
  Animator.playSingleAnimation(entity, clip, true)
  playing.set(entity, key)
}
export function resetAnimations(): void { playing.clear() }
export function stopAnimation(entity: Entity): void {
  if (Animator.has(entity)) Animator.stopAllAnimations(entity)
  playing.delete(entity)
}
