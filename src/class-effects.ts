import { AssetLoad, Entity, GltfContainer, Transform, engine } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { COMBAT_CLASSES } from './game/classes'
import type { ClassAbility, EncounterSnapshot, GameEvent, Vec3 } from './game/types'
import { ProjectileEffects } from './projectile-effects'
import { combatPosition, place, show, thread, tint, releasePrimitiveWhenHidden } from './scene-bindings'

const COLORS = {
  melee: { r: 1, g: 0.69, b: 0.26 },
  mage: { r: 0.2, g: 0.9, b: 0.82 },
  archer: { r: 0.8, g: 0.58, b: 1 }
}
const MUTED = { r: 0.56, g: 0.53, b: 0.49 }
const PAPER = { r: .98, g: .87, b: .59 }
const X = { x: 1, y: 0, z: 0 }
const Z = { x: 0, y: 0, z: 1 }
const DECOY_ASSET = 'assets/Models/prop-cardsharp-deck.glb'
const REJECTION_COOLDOWN = 0.6
interface EffectColor { r: number; g: number; b: number }
interface Feedback { start: number; position: Vec3 }
interface UtilityEffect { ability: ClassAbility; start: number; position?: Vec3 }

/** One visual attack pool follows the encounter's launch path and eventual hit or miss. */
export class ClassEffects {
  private readonly projectiles = new ProjectileEffects()
  private guard = this.create('cylinder')
  private decoy = engine.addEntity()
  private bind = this.create('cylinder')
  private aim = this.create('sphere')
  private fallRing = this.create('cylinder')
  private frayed = Array.from({ length: 3 }, () => this.create('cylinder'))
  private accents = Array.from({ length: 4 }, () => this.create('cylinder'))
  private fallen: Feedback | null = null
  private rejected: Feedback | null = null
  private rejectReadyAt = 0
  private utility: UtilityEffect | null = null
  private guardBlockedAt = -Infinity

  constructor() {
    Transform.create(this.decoy)
    AssetLoad.create(this.decoy, { assets: [DECOY_ASSET] })
    show(this.decoy, false)
  }

  onEvent(event: GameEvent): void {
    this.projectiles.onEvent(event)
    if (event.type === 'attack_start' || event.type === 'hit' || event.type === 'puppet_hit') this.rejected = null
    if (event.type === 'class_ability') {
      const ability = event.data?.ability
      if (ability === 'guard' || ability === 'arcane_bind' || ability === 'drawn_shot') {
        this.utility = { ability, start: event.elapsed, position: combatPosition(event.data?.position) }
      }
    } else if (event.type === 'class_ability_end' || event.type === 'respawn' || event.type === 'death' || event.type === 'outcome') {
      this.utility = null
    }
    if (event.type === 'guard_blocked') this.guardBlockedAt = event.elapsed
  }

  reject(elapsed: number, player: Vec3): boolean {
    if (elapsed < this.rejectReadyAt) return false
    this.rejectReadyAt = elapsed + REJECTION_COOLDOWN
    this.rejected = { start: elapsed, position: { ...player, y: player.y + 0.08 } }
    return true
  }

  arcaneBind(elapsed: number): void {
    this.utility ??= { ability: 'arcane_bind', start: elapsed }
  }

  fall(elapsed: number, position: Vec3): void {
    this.fallen = { start: elapsed, position: { ...position, y: Math.max(3.06, position.y) } }
  }

  reset(): void {
    this.projectiles.reset()
    this.fallen = null
    this.rejected = null
    this.rejectReadyAt = 0
    this.utility = null
    this.guardBlockedAt = -Infinity
    this.renderDecoy(false, 0, { x: 0, y: 0, z: 0 })
    for (const effect of [this.guard, this.bind, this.aim, this.fallRing, ...this.frayed, ...this.accents]) show(effect, false)
  }

  render(s: EncounterSnapshot, player: Vec3, muzzle: Vec3 | undefined, displayElapsed: number): void {
    this.renderFall(s.elapsed)
    const utilityRing = this.renderUtilities(s, player)
    this.projectiles.render(s, muzzle, displayElapsed)

    if (this.rejected) {
      const progress = unit((s.elapsed - this.rejected.start) / 0.28)
      if (progress < 1 && !utilityRing) {
        this.drawRing(this.rejected.position, X, Z, 0.38 + progress * 0.24,
          Math.max(0.008, 0.027 * (1 - progress)), MUTED, false)
        return
      }
      if (progress >= 1) this.rejected = null
    }
    if (!utilityRing) for (const entity of this.accents) show(entity, false)
  }

  private renderUtilities(s: EncounterSnapshot, player: Vec3): boolean {
    const enabled = !s.outcome && !s.respawning && !s.transition
    const ability = enabled && s.abilityActiveRemaining > 0 ? s.ability : null
    const timing = this.utility?.ability === ability ? this.utility : null
    const duration = s.selectedClass ? COMBAT_CLASSES[s.selectedClass].effectSeconds : 0
    const age = Math.max(0, timing ? s.elapsed - timing.start : duration - s.abilityActiveRemaining)
    const enter = ease(age / .22)
    const steady = enter * ease(s.abilityActiveRemaining / .18)
    const guarding = ability === 'guard'
    const binding = ability === 'arcane_bind' && s.knotOpen
    const aiming = ability === 'drawn_shot' && !s.attack
    this.renderDecoy(guarding, age, timing?.position ?? player)
    show(this.bind, binding)
    if (binding) {
      tint(this.bind, COLORS.mage)
      const hand = { ...player, y: player.y + 1.34 }
      const captured = Vector3.lerp(hand, s.knotPosition, enter)
      thread(this.bind, hand, captured, .021 + steady * (.025 + Math.sin(age * 18) * .007))
    }
    const aimingAtKnot = aiming && s.knotOpen
    show(this.aim, aimingAtKnot)
    if (aimingAtKnot) {
      tint(this.aim, PAPER)
      const size = .09 + .08 * steady
      place(this.aim, { ...s.knotPosition, y: s.knotPosition.y + .69 }, { x: size, y: size, z: size })
    }
    const deflect = (s.elapsed - this.guardBlockedAt) / .31
    show(this.guard, guarding || (enabled && deflect < 1))
    if (enabled && deflect < 1) {
      tint(this.guard, PAPER)
      const size = 1 + deflect * 1.5
      place(this.guard, { ...player, y: player.y + .055 }, { x: size, y: .035 * (1 - deflect), z: size })
      this.drawRing({ ...player, y: player.y + .16 }, X, Z, .58 + deflect, .038 * (1 - deflect), PAPER)
      return true
    }
    if (guarding) {
      tint(this.guard, COLORS.melee)
      const size = .79 + steady * .32
      place(this.guard, { ...player, y: player.y + .045 }, { x: size, y: .022, z: size })
      const anchor = timing?.position ?? player
      this.drawRing({ ...anchor, y: anchor.y + .095 }, X, Z, .72 + enter * .31, .015 + steady * .017, COLORS.melee)
      return true
    }
    if (aimingAtKnot || binding) {
      const axis = Vector3.subtract(s.knotPosition, player)
      const tangent = Vector3.normalize({ x: axis.z || .0001, y: 0, z: -axis.x })
      this.drawRing({ ...s.knotPosition, y: s.knotPosition.y + (aimingAtKnot ? .37 : .03) }, tangent, { x: 0, y: 1, z: 0 },
        (aimingAtKnot ? .74 : .91) - enter * .28, .012 + .018 * steady, aimingAtKnot ? COLORS.archer : COLORS.mage)
      return true
    }
    if (aiming) {
      this.drawRing({ ...player, y: player.y + .09 }, X, Z, .69 - enter * .12, .012 + steady * .019, COLORS.archer)
      return true
    }
    return false
  }

  private renderDecoy(active: boolean, age: number, player: Vec3): void {
    show(this.decoy, active)
    if (!active) {
      if (GltfContainer.has(this.decoy)) GltfContainer.deleteFrom(this.decoy)
      return
    }
    if (!GltfContainer.has(this.decoy)) GltfContainer.create(this.decoy, {
      src: DECOY_ASSET, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0
    })
    const open = ease(age / .24)
    const angle = age * Math.PI * 2.05
    const scale = 1.75 + open * 1.50
    place(this.decoy, { x: player.x + Math.cos(angle) * (1 + .30 * open), y: player.y + .55 + .57 * open, z: player.z + Math.sin(angle) * (1 + .30 * open) },
      { x: scale, y: scale, z: scale }, Quaternion.fromEulerDegrees(-12, age * 435, -35 + open * 15))
  }

  private drawRing(center: Vec3, right: Vec3, up: Vec3, radius: number, thickness: number, color: EffectColor, emissive = true): void {
    const point = (angle: number) => offset(offset(center, right, Math.cos(angle) * radius), up, Math.sin(angle) * radius)
    const step = 2 * Math.PI / this.accents.length
    for (let i = 0; i < this.accents.length; i++) {
      const segment = this.accents[i]
      const angle = step * i + Math.PI / 4
      tint(segment, color, emissive)
      thread(segment, point(angle + 0.08), point(angle + step - 0.08), thickness)
    }
  }

  private renderFall(elapsed: number): void {
    if (!this.fallen) return
    const { start, position } = this.fallen
    const progress = Math.max(0, (elapsed - start) / 0.75)
    if (progress >= 1) {
      this.fallen = null
      for (const effect of [this.fallRing, ...this.frayed]) show(effect, false)
      return
    }
    const red = { r: 0.96, g: 0.13, b: 0.23 }
    const size = 0.55 + 1.4 * progress
    show(this.fallRing, true)
    tint(this.fallRing, red)
    place(this.fallRing, position, { x: size, y: 0.04 * (1 - progress), z: size })
    for (let i = 0; i < this.frayed.length; i++) {
      const angle = i * Math.PI * 2 / this.frayed.length
      const outward = 0.12 + progress
      const piece = this.frayed[i]
      tint(piece, red)
      thread(piece, { x: position.x + Math.cos(angle) * outward, y: position.y + (1 - progress) * 0.9, z: position.z + Math.sin(angle) * outward },
        { x: position.x + Math.cos(angle) * (outward + 0.24), y: position.y + (1 - progress) * 1.3, z: position.z + Math.sin(angle) * (outward + 0.24) }, 0.026)
    }
  }

  private create(shape: 'cylinder' | 'sphere'): Entity {
    const entity = engine.addEntity()
    Transform.create(entity)
    releasePrimitiveWhenHidden(entity, shape)
    show(entity, false)
    return entity
  }
}

function unit(value: number): number { return Math.min(1, Math.max(0, value)) }

function ease(value: number): number { const t = unit(value); return t * t * (3 - 2 * t) }

function offset(point: Vec3, direction: Vec3, distance: number): Vec3 {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance, z: point.z + direction.z * distance }
}
