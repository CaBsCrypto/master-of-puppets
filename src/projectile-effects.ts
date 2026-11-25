import {
  AssetLoad, engine, GltfContainer, GltfContainerLoadingState, LoadingState,
  Material, MaterialTransparencyMode, Transform
} from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { playerAttackPosition } from './game/attacks'
import type { EncounterSnapshot, GameEvent, PlayerAttackSnapshot, Vec3 } from './game/types'
import { combatPosition, place, releasePrimitiveWhenHidden, show } from './scene-bindings'

const MODELS = {
  melee: ['projectile-cartista-card', 'projectile-cartista-hand'],
  mage: ['projectile-mage-bolt', 'projectile-mage-burst'],
  archer: ['projectile-archer-arrow', 'projectile-archer-piercing']
} as const
const ASSETS = Object.values(MODELS).flat().map(file => `assets/Models/${file}.glb`)
const UP = { x: 0, y: 1, z: 0 }
const FORWARD = { x: 0, y: 0, z: 1 }
const RIGHT = { x: 1, y: 0, z: 0 }
const MINT = { r: .16, g: .94, b: .77 }
const VIOLET = { r: .74, g: .45, b: .99 }
const GOLD = { r: .94, g: .71, b: .37 }
const WINE = { r: .66, g: .18, b: .29 }
const PALE = { r: .96, g: .96, b: .82 }
const ASH = { r: .62, g: .54, b: .49 }
const DEG = 180 / Math.PI

type Color = { r: number; g: number; b: number }
type ImpactKind = 'hit' | 'blocked' | 'closed' | 'guarded' | 'range'
interface Launch { id: number; offset: Vec3; mergeAt: number }
interface Contact {
  kind: ImpactKind
  at: number
  position: Vec3
  attack: PlayerAttackSnapshot
  damage: number
}
interface Mote { entity: Entity; tint?: string }

function smallMesh(): Mote {
  const entity = engine.addEntity()
  Transform.create(entity)
  releasePrimitiveWhenHidden(entity, 'box')
  show(entity, false)
  return { entity }
}

/** Traces the authoritative flight after a brief, cosmetic join from the weapon. */
export class ProjectileEffects {
  private readonly model = engine.addEntity()
  private readonly fallback = smallMesh()
  private readonly arrowGlint = smallMesh()
  private readonly motes = Array.from({ length: 9 }, smallMesh)
  private attack: PlayerAttackSnapshot | null = null
  private launch: Launch | null = null
  private contact: Contact | null = null
  private asset = ''
  private activeMotes = 0
  private camera: Vec3 | undefined

  constructor() {
    Transform.create(this.model)
    AssetLoad.create(this.model, { assets: ASSETS })
    show(this.model, false)
  }

  onEvent(event: GameEvent): void {
    if (event.type === 'respawn' || event.type === 'death' || event.type === 'failsafe_tp') {
      this.reset()
      return
    }
    const data = event.data
    if (!data) return
    if (event.type === 'attack_start') {
      this.contact = null
      this.launch = null
      this.attack = data as unknown as PlayerAttackSnapshot
      return
    }
    if (event.type === 'attack_release' && this.attack && data.id === this.attack.id) {
      this.attack = data as unknown as PlayerAttackSnapshot
      this.launch = null
      return
    }
    const attack = this.attack
    if (!attack || data.attackId !== attack.id) return
    const hit = event.type === 'hit' || event.type === 'puppet_hit'
    if (hit || event.type === 'attack_miss') {
      const position = combatPosition(data.contactPosition) ?? combatPosition(data.position)
      const kind = hit ? 'hit' : data.reason
      if (position && (kind === 'hit' || kind === 'blocked' || kind === 'closed' || kind === 'guarded' || kind === 'range')) {
        const damage = typeof data.damage === 'number' && Number.isFinite(data.damage) ? data.damage : 0
        this.contact = { kind, at: event.elapsed, position, attack, damage }
      }
      this.attack = null
      this.launch = null
    }
  }

  reset(): void {
    this.attack = null
    this.launch = null
    this.contact = null
    this.hideModel()
    this.finishMotes(0)
  }

  render(s: EncounterSnapshot, muzzle: Vec3 | undefined, displayElapsed: number): void {
    this.camera = Transform.getOrNull(engine.CameraEntity)?.position
    if (s.attack && !s.respawning && !s.outcome) {
      this.attack = s.attack
      this.renderShot(s.attack, displayElapsed, muzzle)
      return
    }
    const contact = this.contact
    if (contact && displayElapsed - contact.at < contactDuration(contact)) {
      this.renderContact(contact, displayElapsed - contact.at)
      return
    }
    this.hideModel()
    this.finishMotes(0)
    this.contact = null
  }

  private renderShot(attack: PlayerAttackSnapshot, elapsed: number, muzzle?: Vec3): void {
    const direction = heading(attack.origin, attack.target)
    const magic = attack.role === 'mage'
    const card = attack.role === 'melee'
    const power = isPower(attack)
    const charging = attack.kind === 'secondary'
    const prepared = elapsed < attack.launchElapsed
    const prepare = unit((elapsed - attack.startElapsed) / (attack.launchElapsed - attack.startElapsed))
    const socket = muzzle ?? Vector3.add(attack.origin, Vector3.scale(Vector3.cross(UP, direction), magic ? -.27 : .21))
    const lead = card ? .22 : magic ? (power ? .25 : .17) : (power ? .8 : .65)
    const tip = Vector3.add(socket, Vector3.scale(direction, lead))
    if (prepared || this.launch?.id !== attack.id) this.launch = joinedLaunch(attack, tip, direction)
    const launch = this.launch
    const launchPosition = Vector3.add(attack.origin, launch.offset)
    const head = prepared ? launchPosition : displayPosition(attack, launch, elapsed)
    const axis = prepared ? direction : heading(displayPosition(attack, launch, elapsed - .012), displayPosition(attack, launch, elapsed + .012), direction)
    const age = Math.max(0, elapsed - attack.launchElapsed)
    const color = magic ? MINT : card ? PALE : attack.ability === 'drawn_shot' ? GOLD : VIOLET
    const scale = (magic || card) && prepared ? .56 + .44 * prepare : 1
    const roll = card ? -35 + age * (power ? 870 : 1180)
      : magic ? elapsed * (power ? 690 : 440) : age * (power ? 650 : 360)
    if (prepared && charging && card && prepare < .66) this.hideModel()
    else this.drawModel(attack, head, axis, roll, scale, color)
    if (attack.role === 'archer' && !prepared) {
      const edge = Vector3.add(head, Vector3.add(Vector3.scale(axis, -.14), Vector3.scale(UP, .034)))
      this.drawMote(this.arrowGlint, edge, axis, power ? .30 : .23, power ? .031 : .023, power ? color : PALE, .86)
    } else show(this.arrowGlint.entity, false)

    if (prepared) {
      if (charging) {
        this.renderCharge(attack, socket, direction, prepare, elapsed)
        return
      }
      const basis = plane(direction)
      const count = magic ? (power ? 6 : 4) : card ? (power ? 4 : 2) : power ? 3 : 0
      for (let i = 0; i < count; i++) {
        const angle = elapsed * 12 + i * Math.PI * 2 / count
        const radius = (magic ? .30 : .17) - prepare * .10
        const radial = Vector3.add(Vector3.scale(basis.right, Math.cos(angle)), Vector3.scale(basis.up, Math.sin(angle)))
        const point = Vector3.add(socket, Vector3.scale(radial, radius + i % 2 * .035))
        this.drawMote(this.motes[i], point, radial, magic ? .087 : .065, power ? .028 : .018, i % 3 ? color : card ? WINE : GOLD, .45 + prepare * .30)
      }
      this.finishMotes(count)
      return
    }

    const count = magic || card ? (power ? 7 : 5) : power ? 5 : 3
    const basis = plane(axis)
    for (let i = 0; i < count; i++) {
      const delay = .024 * (i + 1)
      if (age < delay) { show(this.motes[i].entity, false); continue }
      const point = displayPosition(attack, launch, elapsed - delay)
      const behind = Vector3.length(Vector3.subtract(head, point))
      const wave = elapsed * 13 - i * .7
      const drift = card ? .14 + i * .022 : magic ? .065 + i * .019 : .028
      const world = Vector3.add(point, Vector3.add(Vector3.scale(basis.right, Math.cos(wave) * drift), Vector3.scale(basis.up, Math.sin(wave) * drift)))
      const fade = 1 - (i + 1) / (count + 1)
      if (behind < (card ? .37 : magic ? .20 : .53)) { show(this.motes[i].entity, false); continue }
      this.drawMote(this.motes[i], world, axis, card ? .09 + .08 * fade : magic ? .07 + .09 * fade : .12 + .14 * fade,
        card ? .047 : magic ? .021 + .011 * fade : .014 + .009 * fade, card && i % 2 ? WINE : i === 0 ? PALE : color, .23 + fade * .62,
        card && power ? elapsed * 690 + i * 29 : undefined)
    }
    this.finishMotes(count)
  }

  private renderCharge(attack: PlayerAttackSnapshot, socket: Vec3, axis: Vec3, progress: number, elapsed: number): void {
    const basis = plane(axis)
    const strength = unit(progress * 3)
    const card = attack.role === 'melee'
    const magic = attack.role === 'mage'
    const count = card ? 5 : magic ? 8 : 5
    const center = Vector3.add(socket, Vector3.scale(axis, card ? .29 : .22))
    for (let i = 0; i < count; i++) {
      if (card) {
        const column = i - 2
        const spread = .088 + .093 * strength
        const side = Vector3.scale(basis.right, column * spread * (1 - .21 * progress))
        const rise = Vector3.scale(basis.up, .07 + strength * .18 - column ** 2 * .028)
        const point = Vector3.add(center, Vector3.add(side, rise))
        this.drawMote(this.motes[i], point, axis, .14 + strength * .07, .085 + strength * .04,
          i % 2 === 0 ? PALE : WINE, .25 + strength * .65, column * (18 + 9 * progress) + 9)
        continue
      }
      const angle = elapsed * (magic ? 14 : 5) + i * 2 * Math.PI / count
      const radial = Vector3.add(Vector3.scale(basis.right, Math.cos(angle)), Vector3.scale(basis.up, Math.sin(angle)))
      const distance = magic ? .42 - .19 * progress : .26 - .135 * progress
      const point = Vector3.add(center, Vector3.add(Vector3.scale(radial, distance), Vector3.scale(axis, (i % 2) * .19)))
      this.drawMote(this.motes[i], point, magic ? radial : axis, magic ? .12 + strength * .11 : .31 + strength * .15,
        magic ? .038 : .025, i % 3 === 0 ? PALE : magic ? MINT : VIOLET, .32 + strength * .58)
    }
    this.finishMotes(count)
  }

  private renderContact(contact: Contact, age: number): void {
    show(this.arrowGlint.entity, false)
    const { attack, kind, position } = contact
    const impactAt = Math.min(contact.at, attack.impactElapsed)
    const axis = heading(playerAttackPosition(attack, impactAt - .025), playerAttackPosition(attack, impactAt), heading(attack.origin, position))
    const progress = unit(age / contactDuration(contact))
    if (kind === 'range') {
      this.renderRangeFade(position, axis, age, progress)
      return
    }
    const facing = this.camera ? heading(this.camera, position, axis) : axis
    const basis = plane(facing)
    if (kind !== 'hit') {
      this.renderDeflection(contact, axis, basis, age, progress)
      return
    }
    if (isPower(attack)) {
      this.renderPowerContact(contact, axis, basis, age, progress)
      return
    }
    this.renderBasicHit(contact, axis, basis, age, progress)
  }

  private renderBasicHit(contact: Contact, axis: Vec3, basis: { right: Vec3; up: Vec3 }, age: number, progress: number): void {
    const { attack, position } = contact
    const card = attack.role === 'melee'
    const color = attack.role === 'mage' ? MINT : GOLD
    if (attack.role === 'archer' && age < .19) {
      this.drawModel(attack, position, axis, 0, 1 - progress * .38, color)
    } else this.hideModel()

    const count = 7
    const spread = .14 + .68 * progress
    for (let i = 0; i < count; i++) {
      const angle = i * Math.PI * 2 / count + attack.id * .47
      const radial = Vector3.add(Vector3.scale(basis.right, Math.cos(angle)), Vector3.scale(basis.up, Math.sin(angle)))
      const point = Vector3.add(position, Vector3.scale(radial, spread * (.80 + (i % 3) * .17)))
      const fragmentColor = i % 3 === 0 ? PALE : card && i % 3 === 1 ? WINE : color
      const size = 1 - progress * .56
      this.drawMote(this.motes[i], point, radial, (.18 + (i % 2) * .08) * size,
        (card ? .072 : .054) * size, fragmentColor, 1 - progress)
    }
    this.finishMotes(count)
  }

  private renderDeflection(contact: Contact, axis: Vec3, basis: { right: Vec3; up: Vec3 }, age: number, progress: number): void {
    const { attack, kind, position } = contact
    const obstacle = kind === 'blocked'
    const color = obstacle ? GOLD : VIOLET
    const rebound = Vector3.normalize(Vector3.add(Vector3.scale(axis, -1), Vector3.scale(basis.up, .56)))
    if (attack.role === 'archer' && age < .19) {
      const point = Vector3.add(position, Vector3.scale(rebound, age * 2.6))
      this.drawModel(attack, point, rebound, age * 430, 1 - progress * .43, color)
    } else this.hideModel()

    const count = 6
    const center = Vector3.add(position, Vector3.scale(axis, -.07))
    for (let i = 0; i < count; i++) {
      const angle = obstacle ? .25 + i * .52 : .24 + i * 1.05
      const radial = Vector3.add(Vector3.scale(basis.right, Math.cos(angle)), Vector3.scale(basis.up, Math.sin(angle)))
      const tangent = Vector3.add(Vector3.scale(basis.right, -Math.sin(angle)), Vector3.scale(basis.up, Math.cos(angle)))
      const offset = obstacle ? Vector3.scale(rebound, progress * (.42 + .12 * (i % 3))) : { x: 0, y: 0, z: 0 }
      const radius = obstacle ? .13 + progress * .23 : .41 + progress * .14
      const point = Vector3.add(center, Vector3.add(Vector3.scale(radial, radius), offset))
      this.drawMote(this.motes[i], point, obstacle ? rebound : tangent, (obstacle ? .20 : .31) * (1 - progress * .48),
        .054 * (1 - progress * .60), i % 3 ? color : PALE, (1 - progress) * .92)
    }
    this.finishMotes(count)
  }

  private renderRangeFade(position: Vec3, axis: Vec3, age: number, progress: number): void {
    this.hideModel()
    const count = 3
    for (let i = 0; i < count; i++) {
      const point = Vector3.add(position, Vector3.add(Vector3.scale(axis, -.07 - i * .14), Vector3.scale(UP, -age * (.36 + i * .12))))
      this.drawMote(this.motes[i], point, axis, (.14 - i * .022) * (1 - progress * .56), .043 * (1 - progress * .5),
        ASH, (1 - progress) * (.75 - i * .15))
    }
    this.finishMotes(count)
  }

  private renderPowerContact(contact: Contact, axis: Vec3, basis: { right: Vec3; up: Vec3 }, age: number, progress: number): void {
    const { attack, position, damage } = contact
    const card = attack.role === 'melee'
    const magic = attack.role === 'mage'
    const strength = .90 + unit(damage / 42) * .25
    if (card && age < .14) this.drawModel(attack, position, axis, 22 + age * 675, (1.03 - progress * .53) * strength, PALE)
    else if (!card && !magic && age < .31) {
      this.drawModel(attack, position, axis, 0, 1 - Math.max(0, progress - .50) * .55, VIOLET)
    } else this.hideModel()

    const count = card ? 7 : magic ? 9 : 6
    for (let i = 0; i < count; i++) {
      const angle = i * 2 * Math.PI / count + attack.id * .31
      const radial = Vector3.add(Vector3.scale(basis.right, Math.cos(angle)), Vector3.scale(basis.up, Math.sin(angle)))
      const fade = Math.max(0, 1 - progress)
      const spread = strength * (.15 + progress * (card ? .95 : magic ? 1.32 : .37))
      const point = Vector3.add(position, Vector3.add(Vector3.scale(radial, spread), Vector3.scale(axis, -age * (card ? .95 : magic ? .35 : 1.8))))
      const size = strength * (.45 + .55 * fade)
      const tint = i % 3 === 0 ? PALE : card ? (i % 2 ? WINE : GOLD) : magic ? MINT : VIOLET
      const fragmentAxis = card ? axis : magic ? radial : Vector3.normalize(Vector3.add(axis, radial))
      this.drawMote(this.motes[i], point, fragmentAxis,
        size * (card ? .21 : magic ? .28 : .45), size * (card ? .115 : magic ? .041 : .048), tint,
        fade * .94, card ? i * 27 + 250 * age : undefined)
    }
    this.finishMotes(count)
  }

  private drawModel(attack: PlayerAttackSnapshot, head: Vec3, axis: Vec3, roll: number, scale: number, color: Color): void {
    const file = MODELS[attack.role][isPower(attack) ? 1 : 0]
    if (file !== this.asset) {
      GltfContainer.createOrReplace(this.model, {
        src: `assets/Models/${file}.glb`,
        visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0
      })
      this.asset = file
    }
    const extent = attack.role === 'mage' ? .34 : attack.role === 'melee' && isPower(attack) ? .82 : .66
    const visible = this.clearOfCamera(head, .28 + extent * scale)
    const loaded = GltfContainerLoadingState.getOrNull(this.model)?.currentState === LoadingState.FINISHED
    if (visible) place(this.model, head, { x: scale, y: scale, z: scale }, orient(axis, roll))
    show(this.model, visible && loaded)
    if (!loaded && visible) {
      const fallback = Vector3.add(head, Vector3.scale(axis, attack.role === 'mage' ? -.15 : -.28))
      const fallbackWidth = attack.role === 'mage' ? .16 : attack.role === 'melee' ? .075 : .035
      this.drawMote(this.fallback, fallback, axis, attack.role === 'mage' ? .24 : .53, fallbackWidth, color, 1)
    } else show(this.fallback.entity, false)
  }

  private drawMote(mote: Mote, point: Vec3, axis: Vec3, length: number, width: number, color: Color, opacity: number, cardRoll?: number): void {
    const alpha = Math.round(unit(opacity) * 8) / 8
    const visible = alpha > .05 && this.clearOfCamera(point, .78 + length * .5)
    show(mote.entity, visible)
    if (!visible) return
    const key = `${color.r},${color.g},${color.b},${alpha}`
    if (mote.tint !== key) {
      mote.tint = key
      Material.setPbrMaterial(mote.entity, {
        albedoColor: { ...color, a: alpha },
        emissiveColor: color, emissiveIntensity: .65 + alpha * .45,
        roughness: .8, metallic: 0, castShadows: false,
        transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
      })
    }
    const scale = cardRoll === undefined ? { x: width, y: width * .74, z: length } : { x: width, y: length, z: width * .15 }
    place(mote.entity, point, scale, orient(axis, cardRoll ?? 38))
  }

  private clearOfCamera(point: Vec3, distance: number): boolean {
    return !this.camera || Vector3.distanceSquared(point, this.camera) >= distance * distance
  }

  private finishMotes(count: number): void {
    for (let i = count; i < this.activeMotes; i++) show(this.motes[i].entity, false)
    this.activeMotes = count
  }

  private hideModel(): void {
    show(this.model, false)
    show(this.fallback.entity, false)
    show(this.arrowGlint.entity, false)
    if (this.asset) GltfContainer.deleteFrom(this.model)
    this.asset = ''
  }
}

function joinedLaunch(attack: PlayerAttackSnapshot, tip: Vec3, direction: Vec3): Launch {
  const flight = attack.impactElapsed - attack.launchElapsed
  const mergeAt = attack.launchElapsed + Math.min(.14, flight * .58)
  const desired = Vector3.subtract(tip, attack.origin)
  const along = Vector3.dot(desired, direction)
  const join = Vector3.subtract(playerAttackPosition(attack, mergeAt), attack.origin)
  const maxLead = Math.max(0, Vector3.dot(join, direction) * .76)
  const side = Vector3.subtract(desired, Vector3.scale(direction, along))
  const sideLength = Vector3.length(side)
  const limitedSide = Vector3.scale(side, Math.min(1, .80 / Math.max(.001, sideLength)))
  const lead = Math.max(-.28, Math.min(maxLead, along))
  return { id: attack.id, offset: Vector3.add(limitedSide, Vector3.scale(direction, lead)), mergeAt }
}

function displayPosition(attack: PlayerAttackSnapshot, launch: Launch, elapsed: number): Vec3 {
  const time = unit((elapsed - attack.launchElapsed) / (launch.mergeAt - attack.launchElapsed))
  return Vector3.add(playerAttackPosition(attack, elapsed), Vector3.scale(launch.offset, 1 - time))
}

function unit(value: number): number { return Math.max(0, Math.min(1, value)) }

function contactDuration(contact: Contact): number {
  if (contact.kind === 'range') return .27
  return contact.kind === 'hit' && isPower(contact.attack) ? .46 : .38
}

function isPower(attack: PlayerAttackSnapshot): boolean {
  return attack.kind === 'secondary' || attack.ability === 'drawn_shot'
}

function heading(from: Vec3, to: Vec3, fallback = FORWARD): Vec3 {
  const delta = Vector3.subtract(to, from)
  return Vector3.lengthSquared(delta) > .00001 ? Vector3.normalize(delta) : fallback
}

function plane(axis: Vec3): { right: Vec3; up: Vec3 } {
  const right = Vector3.normalize(Vector3.cross(Math.abs(axis.y) > .96 ? RIGHT : UP, axis))
  return { right, up: Vector3.cross(axis, right) }
}

function orient(axis: Vec3, roll: number): Quaternion {
  const yaw = Math.atan2(axis.x, axis.z)
  const pitch = -Math.atan2(axis.y, Math.hypot(axis.x, axis.z))
  return Quaternion.fromEulerDegrees(pitch * DEG, yaw * DEG, roll % 360)
}
