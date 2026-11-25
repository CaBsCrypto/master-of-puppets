import {
  Animator, AvatarBase, AvatarModifierArea, AvatarModifierType, CameraMode, CameraType,
  engine, GltfContainer, GltfContainerLoadingState, LoadingState, PlayerIdentityData, Transform
} from '@dcl/sdk/ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { onEnterScene, onLeaveScene } from '@dcl/sdk/players'
import { ClassProps } from './class-props'
import type { UtilityPropMotion } from './class-props'
import { COMBAT_CLASSES } from './game/classes'
import { DEFAULT_CONFIG } from './game/config'
import type { ClassAbility, CombatClass, EncounterSnapshot, GameEvent, PlayerAttackSnapshot, Vec3 } from './game/types'
import { heroProjectileSocket } from './projectile-sockets'
import { animation, combatPosition, place, show, stopAnimation } from './scene-bindings'

const MODELS = { melee: 'cardsharp', mage: 'mage', archer: 'archer' } as const
const ACTIONS = {
  class_selected: ['transform', .88],
  hit: ['attack', .58],
  class_ability: ['ability', .72],
  guard_blocked: ['ability', .50],
  damage: ['hit', .43],
  death: ['fall', .95]
} as const
type Action = (typeof ACTIONS)[keyof typeof ACTIONS][0]
type HeroClip = Action | 'idle' | 'walk' | 'run' | 'jump' | 'land'
interface TimedAction {
  clip: Action
  start: number
  end: number
  serial: number
  strike?: boolean
  target?: Vec3
  attackId?: string | number
  releaseAt?: number
  speed?: number
  recoverySpeed?: number
  utility?: ClassAbility
}

const CLIPS: readonly HeroClip[] = ['transform', 'idle', 'walk', 'run', 'jump', 'land', 'attack', 'ability', 'hit', 'fall']
// The baked GLBs use 30 fps. Match each class's release pose to the launch.
const STRIKE_CLIPS = {
  attack: { duration: 17 / 30, frames: { melee: 8, mage: 5, archer: 8 } },
  ability: { duration: 22 / 30, frames: { melee: 12, mage: 7, archer: 6 } }
} as const
// Fingertip at equal intervals from rest to release. SDK coordinates relative to the feet.
const CARD_FINGERTIP = {
  basic: [
    { x: -.4200, y: 1.2400, z: .2780 }, { x: -.4832, y: 1.2137, z: .1657 },
    { x: -.5539, y: 1.1970, z: .0452 }, { x: -.4643, y: 1.3502, z: .3136 },
    { x: -.1411, y: 1.5551, z: .5310 }
  ],
  secondary: [
    { x: -.4200, y: 1.2400, z: .2780 }, { x: -.4823, y: 1.1612, z: .1893 },
    { x: -.5623, y: 1.0759, z: .0888 }, { x: -.4430, y: 1.2980, z: .3865 },
    { x: -.0508, y: 1.5235, z: .5834 }
  ]
} as const
const HIDE_VOLUME = { x: .7, y: 2.7, z: .7 }
const LANE_CLEARANCE = 1.25
const SCENE_SIZE = 32

/** The player entity still owns movement, collisions, input and camera in every class. */
export class HeroPresentation {
  private model: { role: CombatClass; entity: Entity } | null = null
  private readonly props = new ClassProps()
  private readonly modifier = engine.addEntity()
  private visible: Entity | null = null
  private action: TimedAction | null = null
  private actionSerial = 0
  private lastAttackId: string | number | undefined
  private utilityStart: { ability: ClassAbility; start: number } | null = null
  private localId = ''
  private enteredScene = true
  private excludeKey = ''
  private previous: Vec3 | null = null
  private airborne = false
  private landedAt = -1
  private speed = 0
  private heading: number | null = null

  constructor() {
    Transform.create(this.modifier)
    onLeaveScene(id => {
      if (!this.localId || id.toLowerCase() !== this.localId) return
      this.enteredScene = false
      this.reset()
    })
    onEnterScene(player => {
      if (player?.entity === engine.PlayerEntity) this.enteredScene = true
    })
  }

  reset(): void {
    this.showNative()
    this.releaseModel()
    this.props.render(null, 'avatar')
    this.action = null
    this.lastAttackId = undefined
    this.utilityStart = null
    this.clearMotion()
  }

  onEvent(event: GameEvent): void {
    if (event.type === 'respawn' || event.type === 'failsafe_tp') {
      this.action = null
      this.lastAttackId = undefined
      this.utilityStart = null
      this.clearMotion()
      return
    }
    const current = this.action && this.action.end > event.elapsed ? this.action : null
    if (current?.clip === 'fall') return
    if (event.type === 'class_ability') {
      const ability = event.data?.ability
      if (ability !== 'guard' && ability !== 'arcane_bind' && ability !== 'drawn_shot') return
      this.utilityStart = { ability, start: event.elapsed }
      if (current?.attackId === undefined) {
        this.action = {
          clip: 'ability', start: event.elapsed, end: event.elapsed + .82, serial: ++this.actionSerial,
          utility: ability, target: ability === 'arcane_bind' ? combatPosition(event.data?.position) : undefined
        }
      }
      return
    }
    if (event.type === 'class_ability_end') {
      this.utilityStart = null
      if (current?.utility && event.data?.reason === 'interrupted') this.action = null
      return
    }
    if (event.type === 'attack_start') {
      this.startStrike(event)
      return
    }
    if (event.type === 'attack_release' && current && current.attackId === event.data?.id) {
      current.target = combatPosition(event.data?.target) ?? current.target
      const impact = event.data?.impactElapsed
      if (typeof impact === 'number' && Number.isFinite(impact)) current.end = Math.max(current.end, impact + .16)
      return
    }
    if (event.type === 'attack_miss' && event.data?.reason === 'cancelled' && current?.attackId === event.data?.attackId) {
      this.action = null
      return
    }
    if ((event.type === 'hit' || event.type === 'puppet_hit') && this.lastAttackId !== undefined && this.lastAttackId === event.data?.attackId) {
      if (current?.attackId === this.lastAttackId) current.target = combatPosition(event.data?.position) ?? current.target
      return
    }
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, event.type)) return
    // Preserve the visible recovery and avoid rewinding to frame zero on impact.
    if (current?.attackId !== undefined && event.type !== 'death' && event.type !== 'hit') return
    const strike = event.type === 'hit'
    const special = strike && event.data?.input === 'secondary'
    const [clip, duration] = special ? ACTIONS.class_ability : ACTIONS[event.type as keyof typeof ACTIONS]
    this.action = {
      clip, start: event.elapsed, end: event.elapsed + duration, serial: ++this.actionSerial,
      strike, target: strike ? combatPosition(event.data?.position) : undefined
    }
  }

  private startStrike(event: GameEvent): void {
    const data = event.data
    const role = data?.role
    if (role !== 'melee' && role !== 'mage' && role !== 'archer') return
    if (typeof data?.id !== 'number' && typeof data?.id !== 'string') return
    if (typeof data.launchElapsed !== 'number' || typeof data.impactElapsed !== 'number') return
    if (!Number.isFinite(data.launchElapsed) || !Number.isFinite(data.impactElapsed)) return
    const start = event.elapsed
    const clip = data.kind === 'secondary' ? 'ability' : 'attack'
    const timing = STRIKE_CLIPS[clip]
    const releaseAt = data.launchElapsed
    const secondsToRelease = Math.max(.075, releaseAt - start)
    const releaseFrameSeconds = timing.frames[role] / 30
    const speed = releaseFrameSeconds / secondsToRelease
    const duration = role === 'melee' ? (clip === 'ability' ? 24 : 18) / 30 : timing.duration
    const recoverySpeed = clip === 'ability' ? Math.max(speed, 1.25) : speed
    const end = Math.max(releaseAt + (duration - releaseFrameSeconds) / recoverySpeed, data.impactElapsed + .16)
    this.lastAttackId = data.id
    this.action = {
      clip, start, end, serial: ++this.actionSerial, strike: true,
      target: combatPosition(data.target), attackId: data.id, releaseAt, speed, recoverySpeed
    }
  }

  render(s: EncounterSnapshot, player: Vec3, dt: number): void {
    const identity = PlayerIdentityData.getOrNull(engine.PlayerEntity)
    this.localId = identity?.address.toLowerCase() ?? ''
    if (!this.enteredScene || player.x < 0 || player.x >= SCENE_SIZE || player.z < 0 || player.z >= SCENE_SIZE) {
      this.reset()
      return
    }

    if (this.model && this.model.role !== s.selectedClass) this.releaseModel()

    const locomotion = this.sampleMotion(player, s.elapsed, dt)
    const act = this.action && this.action.end > s.elapsed ? this.action : null
    const canPlayEnding = !!act && (act.clip === 'fall' || (!!s.outcome && act.strike))
    const role = s.complete || ((s.outcome || s.respawning) && !canPlayEnding) ? null : s.selectedClass
    const camera = CameraMode.getOrNull(engine.CameraEntity)?.mode
    const firstPerson = camera === CameraType.CT_FIRST_PERSON && Transform.has(engine.CameraEntity)
    const hero = role ? this.modelFor(role) : null
    const loaded = hero !== null && GltfContainerLoadingState.getOrNull(hero)?.currentState === LoadingState.FINISHED
    const exclusions = loaded && camera === CameraType.CT_THIRD_PERSON ? this.otherPlayers(player) : null
    if (hero === null || exclusions === null) {
      this.showNative()
      const activeProps = s.respawning || (s.outcome && !act?.strike) ? null : role
      const swing = act && !act.utility && firstPerson ? {
        clip: act.clip, progress: (s.elapsed - act.start) / (act.end - act.start),
        contact: act.strike ? ((act.releaseAt ?? act.start + (act.end - act.start) * .44) - act.start) / (act.end - act.start) : undefined
      } : undefined
      this.props.render(activeProps, firstPerson ? 'first-person' : 'avatar', swing, this.utilityMotion(s))
      return
    }

    const rotation = this.rotation(player, act, act?.target ?? s.knotPosition)
    place(hero, player, undefined, rotation)
    if (this.visible !== hero) {
      if (this.visible !== null) this.hideModel(this.visible)
      show(hero, true)
      this.visible = hero
      if (!act) this.action = { clip: 'transform', start: s.elapsed, end: s.elapsed + .88, serial: ++this.actionSerial }
    }
    this.props.render(null, 'avatar')
    this.hideNative(player, exclusions)
    const current = this.action && this.action.end > s.elapsed ? this.action : null
    const clip: HeroClip = current?.clip ?? locomotion
    const loop = clip === 'idle' || clip === 'walk' || clip === 'run'
    const state = Animator.getClipOrNull(hero, clip)
    const released = current?.releaseAt !== undefined && s.elapsed >= current.releaseAt
    const speed = (released ? current?.recoverySpeed : current?.speed) ?? 1
    if (state && state.speed !== speed) state.speed = speed
    animation(hero, clip, loop, current ? `${clip}-${current.serial}` : clip)
  }

  private utilityMotion(s: EncounterSnapshot): UtilityPropMotion | undefined {
    if (!s.selectedClass || !s.ability || s.abilityActiveRemaining <= 0 || s.respawning || s.outcome) return undefined
    const timing = this.utilityStart
    const age = timing?.ability === s.ability ? s.elapsed - timing.start : COMBAT_CLASSES[s.selectedClass].effectSeconds - s.abilityActiveRemaining
    return { ability: s.ability, age, remaining: s.abilityActiveRemaining }
  }

  projectileMuzzle(attack: PlayerAttackSnapshot, elapsed: number): Vec3 | undefined {
    const firstPerson = this.props.projectileMuzzle(attack.role)
    if (firstPerson) return firstPerson
    if (this.visible === null || this.action?.attackId !== attack.id) return undefined
    const hero = Transform.get(this.visible)
    const release = this.action.releaseAt ?? elapsed
    const chargeTime = Math.min(elapsed, release) - this.action.start
    const recoveryTime = Math.max(0, elapsed - release)
    const clipSeconds = chargeTime * (this.action.speed ?? 1) + recoveryTime * (this.action.recoverySpeed ?? 1)
    const local = attack.role === 'melee' ? cardMuzzle(attack.kind === 'secondary', clipSeconds)
      : heroProjectileSocket(attack.role, attack.kind === 'secondary', clipSeconds)
    return Vector3.add(hero.position, Vector3.rotate(local, hero.rotation))
  }

  private modelFor(role: CombatClass): Entity {
    if (this.model) return this.model.entity
    const entity = engine.addEntity()
    Transform.create(entity)
    GltfContainer.create(entity, {
      src: `assets/Models/hero-${MODELS[role]}.glb`,
      visibleMeshesCollisionMask: 0,
      invisibleMeshesCollisionMask: 0
    })
    Animator.create(entity, { states: CLIPS.map(clip => ({ clip, playing: false, speed: 1, weight: 1 })) })
    show(entity, false)
    this.model = { role, entity }
    return entity
  }

  private releaseModel(): void {
    if (!this.model) return
    if (this.visible === this.model.entity) this.showNative()
    engine.removeEntity(this.model.entity)
    this.model = null
  }

  private otherPlayers(player: Vec3): string[] | null {
    if (!this.localId) return null
    for (const [entity] of engine.getEntitiesWith(AvatarBase)) {
      if (entity !== engine.PlayerEntity && !PlayerIdentityData.getOrNull(entity)?.address) return null
    }
    const exclusions: string[] = []
    for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
      if (entity === engine.PlayerEntity) continue
      const other = Transform.getOrNull(entity)?.position
      // Fall back to native if another avatar is close enough to share our modifier volume.
      if (!identity.address || identity.address.toLowerCase() === this.localId || !other) return null
      if (Math.abs(other.y - player.y) < HIDE_VOLUME.y && Math.hypot(other.x - player.x, other.z - player.z) < LANE_CLEARANCE) return null
      exclusions.push(identity.address)
    }
    return exclusions.sort()
  }

  private hideNative(player: Vec3, excludeIds: string[]): void {
    place(this.modifier, { x: player.x, y: player.y + .65, z: player.z })
    const key = excludeIds.join(',')
    if (key === this.excludeKey && AvatarModifierArea.has(this.modifier)) return
    AvatarModifierArea.createOrReplace(this.modifier, {
      area: HIDE_VOLUME, excludeIds, modifiers: [AvatarModifierType.AMT_HIDE_AVATARS]
    })
    this.excludeKey = key
  }

  private hideModel(entity: Entity): void {
    show(entity, false)
    stopAnimation(entity)
  }

  private showNative(): void {
    if (AvatarModifierArea.has(this.modifier)) AvatarModifierArea.deleteFrom(this.modifier)
    if (this.visible !== null) this.hideModel(this.visible)
    this.visible = null
  }

  private clearMotion(): void {
    this.previous = null
    this.speed = 0
    this.heading = null
    this.airborne = false
    this.landedAt = -1
  }

  private sampleMotion(player: Vec3, elapsed: number, dt: number): HeroClip {
    const before = this.previous
    this.previous = { ...player }
    if (before && dt > 0) {
      const dx = player.x - before.x
      const dz = player.z - before.z
      const travelled = Math.hypot(dx, dz)
      const speed = travelled / dt
      if (speed < 15 && Math.abs(player.y - before.y) < 1.8) {
        this.speed += (speed - this.speed) * Math.min(1, dt * 11)
        if (travelled > .012) this.heading = Math.atan2(dx, dz)
      } else this.speed = 0
    }

    const height = player.y - DEFAULT_CONFIG.floorY
    if (height < -.22) { this.airborne = false; return 'fall' }
    if (height > (this.airborne ? .22 : .35)) { this.airborne = true; return 'jump' }
    if (this.airborne) this.landedAt = elapsed
    this.airborne = false
    if (this.landedAt >= 0 && elapsed - this.landedAt < .24) return 'land'
    if (this.speed > 4.6) return 'run'
    return this.speed > .28 ? 'walk' : 'idle'
  }

  private rotation(player: Vec3, act: TimedAction | null, target: Vec3) {
    if (act?.strike || act?.utility === 'arcane_bind') {
      const dx = target.x - player.x
      const dz = target.z - player.z
      if (Math.hypot(dx, dz) > .2) return Quaternion.fromEulerDegrees(0, Math.atan2(dx, dz) * 180 / Math.PI, 0)
    }
    if (this.heading === null) return Transform.getOrNull(engine.PlayerEntity)?.rotation
    return Quaternion.fromEulerDegrees(0, this.heading * 180 / Math.PI, 0)
  }
}

function cardMuzzle(secondary: boolean, clipSeconds: number): Vec3 {
  const points = CARD_FINGERTIP[secondary ? 'secondary' : 'basic']
  const release = STRIKE_CLIPS[secondary ? 'ability' : 'attack'].frames.melee / 30
  const index = Math.min(points.length - 1, Math.max(0, clipSeconds / release * (points.length - 1)))
  const start = Math.floor(index)
  return Vector3.lerp(points[start], points[Math.ceil(index)], index - start)
}
