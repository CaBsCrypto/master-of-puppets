import { AvatarAnchorPointType, AvatarAttach, engine, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import type { ClassAbility, CombatClass, Vec3 } from './game/types'
import { place, show } from './scene-bindings'

const RIGHT = AvatarAnchorPointType.AAPT_RIGHT_HAND
const LEFT = AvatarAnchorPointType.AAPT_LEFT_HAND
const PROJECTILE_SOCKET = {
  melee: { x: 0, y: .15, z: .03 },
  mage: { x: 0, y: .579, z: .052 },
  archer: { x: 0, y: .0085, z: -.11 }
}
const PROPS = [
  { role: 'melee', file: 'prop-cardsharp-deck', anchor: RIGHT, offset: { x: .39, y: -.35, z: .93 }, scale: .92, tilt: -23 },
  { role: 'mage', file: 'prop-mage-lantern', anchor: RIGHT, offset: { x: .49, y: -.43, z: 1.05 }, scale: .52, tilt: -12 },
  { role: 'archer', file: 'prop-archer-bow', anchor: LEFT, offset: { x: -.47, y: -.44, z: 1.08 }, scale: .53, tilt: 20 }
] as const

type PropView = 'avatar' | 'first-person'
interface PropMotion {
  clip: 'transform' | 'attack' | 'ability' | 'hit' | 'fall'
  progress: number
  contact?: number
}
export interface UtilityPropMotion {
  ability: ClassAbility
  age: number
  remaining: number
}
type Prop = typeof PROPS[number]
type CameraPose = readonly [x: number, y: number, z: number, pitch: number, yaw: number, roll: number]
interface StrikePoses { windup: CameraPose; release: CameraPose }

const STRIKES: Record<Prop['file'], { attack: StrikePoses; ability: StrikePoses }> = {
  'prop-cardsharp-deck': {
    attack: { windup: [.08, .04, -.16, -21, 18, -29], release: [-.30, .16, .37, 31, -20, 55] },
    ability: { windup: [.19, .23, -.15, -32, 16, -52], release: [-.39, .25, .46, 40, -26, 65] }
  },
  'prop-mage-lantern': {
    attack: { windup: [.01, .16, -.17, -20, 14, -23], release: [-.33, .27, .44, 35, -25, 29] },
    ability: { windup: [-.13, .21, -.24, -28, 18, -37], release: [-.41, .39, .51, 51, -34, 39] }
  },
  'prop-archer-bow': {
    attack: { windup: [.16, .29, -.17, -8, 16, 9], release: [.24, .31, .29, 6, -13, -16] },
    ability: { windup: [.23, .32, -.24, -14, 24, 13], release: [.32, .38, .38, 13, -17, -23] }
  }
}
const UTILITY_POSES: Record<ClassAbility, CameraPose> = {
  guard: [-.14, .25, .02, -9, 18, 46],
  arcane_bind: [-.23, .27, .10, 25, -21, 24],
  drawn_shot: [.17, .30, .08, 4, -12, -29]
}
const DRAWN_ARROW = 'assets/Models/projectile-archer-piercing.glb'
const DRAWN_SCALE = .62
const DRAWN_ANGLE = Quaternion.fromEulerDegrees(-1.6, 3, 0)

/** Local costume props never affect movement, aim or collision. */
export class ClassProps {
  private visibleRole: CombatClass | null = null
  private view: PropView = 'avatar'
  private animating = false
  private readonly drawnArrow = engine.addEntity()
  private readonly props = PROPS.map(spec => {
    const hand = engine.addEntity()
    Transform.create(hand)
    AvatarAttach.create(hand, { anchorPointId: spec.anchor })
    const entity = engine.addEntity()
    Transform.create(entity, { parent: hand })
    show(entity, false)
    return { ...spec, entity, hand }
  })

  constructor() {
    Transform.create(this.drawnArrow, { parent: engine.CameraEntity })
    show(this.drawnArrow, false)
  }

  projectileMuzzle(role: CombatClass): Vec3 | undefined {
    if (this.view !== 'first-person' || this.visibleRole !== role) return undefined
    const prop = this.props.find(item => item.role === role)
    const camera = Transform.getOrNull(engine.CameraEntity)
    if (!prop || !camera) return undefined
    const weapon = Transform.get(prop.entity)
    const local = socketPosition(role, weapon)
    return Vector3.add(camera.position, Vector3.rotate(local, camera.rotation))
  }

  render(role: CombatClass | null, view: PropView, motion?: PropMotion, utility?: UtilityPropMotion): void {
    const firstPerson = view === 'first-person'
    const strike = firstPerson && !!motion && (motion.clip === 'attack' || motion.clip === 'ability')
    const animate = strike || (firstPerson && !!utility)
    if (role === this.visibleRole && view === this.view && !animate && !this.animating) return
    this.visibleRole = role
    this.view = view
    this.animating = animate
    for (const prop of this.props) {
      const visible = prop.role === role
      show(prop.entity, visible)
      if (!visible) {
        if (GltfContainer.has(prop.entity)) GltfContainer.deleteFrom(prop.entity)
        continue
      }
      if (!GltfContainer.has(prop.entity)) GltfContainer.create(prop.entity, {
        src: `assets/Models/${prop.file}.glb`, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0
      })
      const parent = view === 'first-person' ? engine.CameraEntity : prop.hand
      const transform = Transform.getMutable(prop.entity)
      if (transform.parent !== parent) transform.parent = parent
      if (view === 'avatar') {
        place(prop.entity, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, Quaternion.Identity())
        continue
      }
      const beat = strike && motion ? Math.sin(Math.PI * Math.min(1, Math.max(0, motion.progress))) : 0
      const direction = prop.anchor === RIGHT ? 1 : -1
      const scale = { x: prop.scale, y: prop.scale, z: prop.scale }
      const [x, y, z, pitch, yaw, roll] = strike && motion?.contact !== undefined
        ? cameraStrike(prop, motion)
        : utility ? cameraUtility(utility)
        : [-beat * .07 * direction, beat * .06, beat * .05, beat * 14, 0, -beat * 15 * direction]
      place(prop.entity, { x: prop.offset.x + x, y: prop.offset.y + y, z: prop.offset.z + z },
        scale, Quaternion.fromEulerDegrees(pitch, yaw, prop.tilt + roll))
    }
    this.renderDrawnArrow(firstPerson && role === 'archer' && !strike && utility?.ability === 'drawn_shot' && utility.age > .10)
  }

  private renderDrawnArrow(active: boolean): void {
    if (!active) {
      show(this.drawnArrow, false)
      if (GltfContainer.has(this.drawnArrow)) GltfContainer.deleteFrom(this.drawnArrow)
      return
    }
    const bow = this.props.find(prop => prop.role === 'archer')
    if (!bow) return
    if (!GltfContainer.has(this.drawnArrow)) {
      GltfContainer.create(this.drawnArrow, { src: DRAWN_ARROW, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
    }
    const nock = socketPosition('archer', Transform.get(bow.entity))
    const tip = Vector3.add(nock, Vector3.rotate({ x: 0, y: 0, z: 1.11 * DRAWN_SCALE }, DRAWN_ANGLE))
    place(this.drawnArrow, tip, { x: DRAWN_SCALE, y: DRAWN_SCALE, z: DRAWN_SCALE }, DRAWN_ANGLE)
    show(this.drawnArrow, true)
  }
}

function socketPosition(role: CombatClass, weapon: { scale: Vec3; position: Vec3; rotation: Quaternion }): Vec3 {
  const socket = Vector3.multiply(PROJECTILE_SOCKET[role], weapon.scale)
  return Vector3.add(weapon.position, Vector3.rotate(socket, weapon.rotation))
}

function cameraStrike(prop: Prop, motion: PropMotion): CameraPose {
  const contact = Math.max(.16, Math.min(.72, motion.contact ?? .45))
  const power = motion.clip === 'ability'
  const fullyLoaded = contact * (power ? .47 : .68)
  const fireAt = contact * (power ? .80 : .68)
  const release = ease((motion.progress - fireAt) / (contact - fireAt))
  const windupWeight = ease(motion.progress / fullyLoaded) * (1 - release)
  const releaseWeight = release * (1 - ease((motion.progress - contact) / (1 - contact)))
  const poses = STRIKES[prop.file][motion.clip === 'ability' ? 'ability' : 'attack']
  const sample = (axis: 0 | 1 | 2 | 3 | 4 | 5) => poses.windup[axis] * windupWeight + poses.release[axis] * releaseWeight
  return [sample(0), sample(1), sample(2), sample(3), sample(4), sample(5)]
}

function cameraUtility(motion: UtilityPropMotion): CameraPose {
  const peak = ease(motion.age / .22) * ease(motion.remaining / .19)
  const flutter = Math.sin(motion.age * 13) * peak * (motion.ability === 'guard' ? 3 : 1.5)
  const [x, y, z, pitch, yaw, roll] = UTILITY_POSES[motion.ability]
  return [x * peak, y * peak, z * peak, pitch * peak, yaw * peak, roll * peak + flutter]
}

function ease(progress: number): number {
  const t = Math.max(0, Math.min(1, progress))
  return t * t * (3 - 2 * t)
}
