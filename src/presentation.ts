import {
  engine, Entity, Transform, TextShape, PointerEvents,
  AvatarAttach, AvatarAnchorPointType, MeshRenderer, Material, GltfContainer, AssetLoad,
  Billboard, BillboardMode, ColliderLayer, MeshCollider
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import type { AttackMissReason, EncounterSnapshot, GameEvent, PuppetSnapshot, Vec3 } from './game/types'
import { angleDelta } from './game/geometry'
import { byName, combatPosition, place, show, thread, tint, animation, resetAnimations, stopAnimation, releasePrimitiveWhenHidden } from './scene-bindings'
import { music, stopAudio, sound } from './audio'
import { TheatreDressing } from './theatre-dressing'
import { sampleBossAnchors } from './boss-anchors'
import { BossAttacks } from './boss-attacks'
import { PHASE_NAMES } from './story'

const CREAM = { r: 0.92, g: 0.83, b: 0.66 }
const RED = { r: 0.91, g: 0.025, b: 0.09 }
const GOLD = { r: 0.91, g: 0.59, b: 0.17 }
const PUPPET_HIT = { r: 1, g: .42, b: .48, a: 1 }
const PUPPET_STUN = { ...GOLD, a: 1 }
const PUPPET_HEALTH = { ...CREAM, a: 1 }
const HIT_TEXT = { r: 1, g: .82, b: .47, a: 1 }
const MISS_TEXT = { r: .99, g: .56, b: .46, a: 1 }
const ARMOR = { r: 0.35, g: 0.055, b: 0.09 }
const DIM = { r: 0.23, g: 0.17, b: 0.12 }
const CHEST_HEIGHT = 3.45
const KNEEL_CHEST_HEIGHT = 2.537
const KNEEL_SETTLE_SECONDS = 40 / 30
const KNOT_POINTER = { x: 1.72, y: 1.65, z: 1.52 }
const CLOSED_POINTER = { x: 1.28, y: 1.28, z: 1.18 }
const ACT_NUMBER = { onboarding: 1, f1: 1, f2: 2, f3: 3, f4: 4, victory: 4, defeat: 4, timeout: 4 }
const COMPANY_NAMES = {
  en: ['I · Knight', 'II · Princess', 'III · Dragon'],
  es: ['I · Caballero', 'II · Princesa', 'III · Dragón']
}
const PUPPET_NAMES = {
  en: { rehearsal: 'Rehearsal puppet', knight: 'Knight', princess: 'Princess', dragon: 'Dragon' },
  es: { rehearsal: 'Títere de ensayo', knight: 'Caballero', princess: 'Princesa', dragon: 'Dragón' }
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const smooth = (n: number) => { const t = clamp01(n); return t * t * (3 - 2 * t) }
interface PuppetPose { position: Vec3; yaw: number; born: number; stunned: boolean }
type DisplayMiss = Exclude<AttackMissReason, 'cancelled'>
const MISS_LABELS: Record<'es' | 'en', Record<DisplayMiss, string>> = {
  es: { blocked: 'OBSTÁCULO', closed: 'NUDO CERRADO', guarded: 'PROTEGIDA POR EL ELENCO', range: 'TIRO FALLIDO' },
  en: { blocked: 'OBSTRUCTION', closed: 'KNOT CLOSED', guarded: 'PROTECTED BY THE CAST', range: 'SHOT MISSED' }
}

function createPuppetTarget(): Entity {
  const entity = engine.addEntity()
  Transform.create(entity)
  return entity
}

function createPuppetHealth(): Entity {
  const entity = engine.addEntity()
  Transform.create(entity)
  Billboard.create(entity, { billboardMode: BillboardMode.BM_ALL })
  TextShape.create(entity, { text: '', fontSize: .48, textColor: PUPPET_HEALTH, width: 12, height: 3, textWrapping: false, outlineWidth: .035 })
  show(entity, false)
  return entity
}

function useModel(entity: Entity, src: string): void {
  if (GltfContainer.getOrNull(entity)?.src === src) return
  stopAnimation(entity)
  GltfContainer.createOrReplace(entity, { src, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
}

export class TheatrePresentation {
  readonly boss = byName('Marionette')
  private readonly firstForm = GltfContainer.get(this.boss).src
  private bossClipKey = ''
  private bossClipStarted = 0
  private bossYaw = Math.PI
  private bossYawAt = 0
  private bossHitAt = -Infinity
  private fightStartedAt = -Infinity
  private lastCut: { position: Vec3; damage: number; final: boolean } | null = null
  private lastMiss: { at: number; position: Vec3; reason: DisplayMiss } | null = null
  readonly knot = byName('CrimsonKnot')
  readonly interaction = byName('KnotInteraction')
  private strikePrompt = byName('StrikePrompt')
  readonly force = byName('TetherForce')
  private halo = byName('KnotHalo')
  private cross = byName('ControlCross')
  private curtains = [byName('Curtain0'), byName('Curtain1')]
  private finale = byName('CurtainFinale')
  private timeText = byName('CurtainTime')
  private strings = Array.from({ length: 4 }, (_, i) => byName(`SuspensionThread${i}`))
  private looseEnds = Array.from({ length: 4 }, (_, i) => byName(`SeveredThread${i}`))
  private puppets = Array.from({ length: 3 }, (_, i) => byName(`CompanyPuppet${i}`))
  readonly puppetTargets = this.puppets.map(createPuppetTarget)
  private readonly puppetHealth = this.puppets.map(createPuppetHealth)
  private readonly puppetTargetIds = new Map<Entity, string>()
  private readonly puppetImpact = new Map<string, { at: number; damage: number }>()
  private puppetThreads = Array.from({ length: 3 }, (_, i) => byName(`CompanyThread${i}`))
  private marks = Array.from({ length: 3 }, (_, i) => byName(`StageMark${i}`))
  private markLabels = Array.from({ length: 3 }, (_, i) => byName(`StageMarkLabel${i}`))
  private hazardLines = Array.from({ length: 10 }, (_, i) => byName(`Hazard_line${i}`))
  private hazardCircles = Array.from({ length: 10 }, (_, i) => byName(`Hazard_circle${i}`))
  private orbit = Array.from({ length: 32 }, (_, i) => byName(`OrbitSegment${i}`))
  private tether = [byName('TetherSegment0'), byName('TetherSegment1')]
  private lastPuppets = new Map<string, PuppetPose>()
  private readonly dressing = new TheatreDressing()
  private readonly attacks = new BossAttacks()
  private trophy: { anchor: Entity; mesh: Entity }[] = []
  private lastPhase = ''
  private reachedFourth = false
  private crossLanded = false
  private curtainClosing = 0
  private closingAtOutcome = 0
  private transitionOrigin: Vec3 | null = null
  private kneelAt: number | null = null
  private lastProgressSegments = -1
  private markLanguage: boolean | null = null

  constructor() {
    for (const entity of [...this.strings, ...this.looseEnds, ...this.puppetThreads, ...this.marks, ...this.hazardCircles, ...this.tether]) {
      releasePrimitiveWhenHidden(entity, 'cylinder')
    }
    for (const entity of [...this.hazardLines, ...this.orbit]) releasePrimitiveWhenHidden(entity, 'box')
    for (const entity of [this.knot, this.halo]) releasePrimitiveWhenHidden(entity, 'sphere')
    AssetLoad.create(engine.addEntity(), { assets: [
      'assets/Models/marionette-act-2.glb',
      'assets/Models/marionette-act-3.glb',
      'assets/Models/marionette-act-4.glb',
      ...['rehearsal', 'knight', 'princess', 'dragon'].map(kind => `assets/Models/puppet-${kind}.glb`)
    ] })
  }

  reset(): void {
    for (const item of this.trophy) { engine.removeEntity(item.mesh); engine.removeEntity(item.anchor) }
    this.trophy = []
    this.lastPuppets.clear()
    this.puppetImpact.clear()
    for (const target of this.puppetTargets) this.clearPuppetTarget(target)
    for (const label of this.puppetHealth) show(label, false)
    for (const actor of this.puppets) this.clearPuppet(actor)
    this.bossClipKey = ''
    this.bossYaw = Math.PI
    this.bossYawAt = 0
    this.bossHitAt = -Infinity
    this.fightStartedAt = -Infinity
    this.lastCut = null
    this.lastMiss = null
    this.dressing.reset()
    this.attacks.reset()
    this.lastPhase = ''
    this.reachedFourth = false
    this.crossLanded = false
    this.curtainClosing = 0
    this.closingAtOutcome = 0
    this.transitionOrigin = null
    this.kneelAt = null
    this.lastProgressSegments = -1
    resetAnimations()
    stopAudio()
    music(true)
  }

  onEvent(event: GameEvent): void {
    this.dressing.onEvent(event)
    if (event.type === 'fight_start') this.fightStartedAt = event.elapsed
    if (event.type === 'attack_miss') {
      const reason = event.data?.reason
      const position = combatPosition(event.data?.position)
      if (position && (reason === 'blocked' || reason === 'closed' || reason === 'guarded' || reason === 'range')) {
        this.lastMiss = { at: event.elapsed, position, reason }
      }
      return
    }
    if (event.type === 'puppet_hit' || event.type === 'puppet_defeated') {
      const id = event.data?.puppetId
      const damage = event.data?.damage
      if (typeof id === 'string' && typeof damage === 'number') this.puppetImpact.set(id, { at: event.elapsed, damage })
      return
    }
    if (event.type !== 'hit') return
    this.bossHitAt = event.elapsed
    const position = combatPosition(event.data?.position)
    const damage = event.data?.damage
    if (position && typeof damage === 'number') {
      this.lastCut = { position, damage, final: event.data?.health === 0 }
    }
  }

  puppetTargetId(entity: Entity): string | undefined {
    return this.puppetTargetIds.get(entity)
  }

  render(s: EncounterSnapshot, player: Vec3, spanish: boolean): void {
    this.dressing.render(s)
    const victorious = s.phase === 'victory'
    const defeated = s.phase === 'defeat' || s.phase === 'timeout'
    this.reachedFourth ||= s.phase === 'f4'
    const fourth = s.phase === 'f4' || victorious || (defeated && this.reachedFourth)
    const severing = s.transition === 'cut_strings'
    const lifting = s.transition === 'controller_cracks'
    const phaseChanged = this.lastPhase !== s.phase
    if (phaseChanged && (severing || lifting)) this.transitionOrigin = { ...Transform.get(this.boss).position }
    if (!severing && !lifting) this.transitionOrigin = null
    const transitionProgress = smooth(s.phaseElapsed / 3)
    const bossScale = fourth ? 1 + 0.5 * (severing ? transitionProgress : 1) : 1
    const bossPosition = defeated ? Transform.get(this.boss).position
      : this.transitionOrigin ? Vector3.lerp(this.transitionOrigin, s.bossPosition, transitionProgress) : s.bossPosition
    if (phaseChanged && !s.outcome) {
      const act = ACT_NUMBER[s.phase]
      useModel(this.boss, act === 1 ? this.firstForm : `assets/Models/marionette-act-${act}.glb`)
    }
    const attack = s.hazards.find(h => !h.id.includes('tripwire') && (h.telegraph || h.active))
    const facing = !s.knotOpen && !s.outcome ? attack?.to ?? (fourth ? player : undefined) : undefined
    const targetYaw = facing ? Math.atan2(facing.x - bossPosition.x, facing.z - bossPosition.z) : Math.PI
    const turn = Math.min(1, Math.max(0, s.elapsed - this.bossYawAt) * 13)
    this.bossYaw += angleDelta(this.bossYaw, targetYaw) * turn
    this.bossYawAt = s.elapsed
    const yaw = this.bossYaw
    place(this.boss, bossPosition, { x: bossScale, y: bossScale, z: bossScale }, Quaternion.fromEulerDegrees(0, yaw * 180 / Math.PI, 0))
    let clip = 'idle'
    const recoiling = s.elapsed - this.bossHitAt < .62 && !s.transition && !s.outcome && (!fourth || !s.knotOpen)
    if (severing) clip = 'break_strings'
    else if (lifting) clip = 'summon_company'
    else if (s.transition === 'pull_own_strings') clip = 'take_strings'
    else if (victorious) clip = s.victoryElapsed >= 5 && s.victoryElapsed < 8 ? 'bow' : 'kneel'
    else if (recoiling) clip = 'stagger'
    else if (s.knotOpen) clip = fourth ? 'kneel' : 'stagger'
    else if (s.tethered) clip = 'cast_thread'
    else if (attack?.kind === 'circle') clip = 'spin'
    else if (attack?.kind === 'line') clip = 'pull'
    const loop = clip === 'idle' || clip === 'cast_thread'
    const actionKey = recoiling ? `impact-${this.bossHitAt}` : (clip === 'pull' || clip === 'spin') ? attack?.id ?? clip : clip
    const clipKey = `${GltfContainer.get(this.boss).src}:${clip}:${actionKey}`
    if (this.bossClipKey !== clipKey) {
      this.bossClipKey = clipKey
      this.bossClipStarted = s.elapsed
    }
    animation(this.boss, clip, loop, actionKey)
    const cos = Math.cos(yaw), sin = Math.sin(yaw)
    const anchors = sampleBossAnchors(clip, s.elapsed - this.bossClipStarted, loop).map(local => ({
      x: bossPosition.x + (local.x * cos + local.z * sin) * bossScale,
      y: bossPosition.y + local.y * bossScale,
      z: bossPosition.z + (-local.x * sin + local.z * cos) * bossScale
    }))
    this.attacks.render(s.hazards, s.elapsed, anchors[1])

    const pulse = s.knotOpen ? 1 + Math.sin(s.elapsed * Math.PI * 2) * 0.08 : 1
    const knotSize = (s.knotOpen ? 0.9 : 0.42) * pulse
    const knotPosition = s.knotOpen || victorious ? s.knotPosition : {
      x: bossPosition.x + Math.sin(yaw) * 0.56 * bossScale,
      y: bossPosition.y + (s.phase === 'f4' ? (s.knotPosition.y - s.bossPosition.y) / 1.5 * bossScale : s.knotPosition.y - s.bossPosition.y),
      z: bossPosition.z + Math.cos(yaw) * 0.56 * bossScale
    }
    place(this.knot, knotPosition, { x: knotSize, y: knotSize, z: knotSize })
    tint(this.knot, s.knotOpen ? GOLD : ARMOR, s.knotOpen)
    place(this.interaction, knotPosition, s.knotOpen ? KNOT_POINTER : CLOSED_POINTER)
    const canPoint = !!s.selectedClass && !s.classSelectionOpen && !s.transition && !s.respawning && !s.outcome
    if (canPoint && !MeshCollider.has(this.interaction)) MeshCollider.setBox(this.interaction, ColliderLayer.CL_POINTER)
    if (!canPoint && MeshCollider.has(this.interaction)) MeshCollider.deleteFrom(this.interaction)
    place(this.halo, knotPosition, { x: knotSize * 1.08, y: knotSize * 1.08, z: knotSize * 1.08 })
    show(this.knot, !s.transition && !defeated && (!victorious || s.endingElapsed < 1.2))
    show(this.halo, s.knotOpen && !victorious)
    const inReach = Vector3.distanceSquared(player, s.knotPosition) <= s.knotReach ** 2
    const hover = !canPoint ? ''
      : s.bossGuardedBySummons ? (spanish ? 'Protegida por el elenco' : 'Protected by the cast')
      : !s.knotOpen ? (spanish ? 'Hilos cerrados' : 'Threads closed')
      : inReach ? (spanish ? 'Atacar nudo' : 'Attack knot') : reachPrompt(s.knotReach, spanish)
    const pointer = PointerEvents.getOrNull(this.interaction)?.pointerEvents[0]?.eventInfo
    if (pointer && pointer.hoverText !== hover) {
      const event = PointerEvents.getMutable(this.interaction).pointerEvents[0].eventInfo
      if (event) event.hoverText = hover
    }
    this.renderStrikePrompt(s, knotPosition, inReach, spanish)

    const fall = fourth ? (severing ? smooth((s.phaseElapsed - 1) / 2) : 1) : 0
    const crossTwist = lifting ? 12 * Math.sin(s.phaseElapsed * 11) * (1 - transitionProgress) : 0
    const crossY = 12 - 8.6 * fall
    if (s.phase === 'f4' && fall > 0.98 && !this.crossLanded) {
      sound('controller-fall', 0.74)
      this.crossLanded = true
    }
    place(this.cross, { x: 16, y: crossY, z: 16 }, undefined, Quaternion.fromEulerDegrees(0, fourth ? 22 * fall : Math.sin(s.elapsed * 1.6) * 5, crossTwist + 3 * fall))
    const upper = { x: 16, y: crossY - 0.3, z: 16 }
    const suspensionAnchors = [anchors[1], anchors[0], anchors[3], anchors[2]]
    for (let i = 0; i < this.strings.length; i++) {
      const side = i % 2 ? 1 : -1
      const anchor = { x: upper.x + side * (i < 2 ? 2.4 : 0.9), y: upper.y, z: upper.z + (i < 2 ? -1 : 1) }
      const bottom = suspensionAnchors[i]
      const sinceCut = s.phaseElapsed - (0.48 + i * 0.17)
      if (!fourth || (severing && sinceCut < 0)) thread(this.strings[i], anchor, bottom, 0.026)
      else show(this.strings[i], false)
      if (severing && sinceCut >= 0 && sinceCut < 0.7) {
        const freeEnd = {
          x: bottom.x + side * (0.3 + sinceCut * 1.6),
          y: bottom.y + 1.1 - sinceCut * sinceCut * 4,
          z: bottom.z - 0.45 - sinceCut
        }
        const tip = { x: freeEnd.x + side * 0.48, y: freeEnd.y + 0.94, z: freeEnd.z - 0.52 }
        thread(this.looseEnds[i], freeEnd, tip, 0.035 * (1 - sinceCut))
      } else show(this.looseEnds[i], false)
    }
    if (s.knotOpen && !victorious) {
      let chestHeight = CHEST_HEIGHT
      if (fourth) {
        this.kneelAt ??= s.elapsed
        const crouch = smooth((s.elapsed - this.kneelAt) / KNEEL_SETTLE_SECONDS)
        chestHeight += (KNEEL_CHEST_HEIGHT - CHEST_HEIGHT) * crouch
      }
      const chest = {
        x: bossPosition.x + Math.sin(yaw) * 0.49 * bossScale,
        y: bossPosition.y + chestHeight * bossScale,
        z: bossPosition.z + Math.cos(yaw) * 0.49 * bossScale
      }
      thread(this.strings[3], chest, s.knotPosition, 0.04)
    } else this.kneelAt = null

    const introOpen = smooth(s.elapsed / 3)
    if (s.outcome && phaseChanged) this.closingAtOutcome = this.curtainClosing
    this.curtainClosing = s.outcome
      ? this.closingAtOutcome + (1 - this.closingAtOutcome) * smooth((s.endingElapsed - 11) / 4)
      : s.failsafe ? 0.85 : s.climax ? 0.6 * clamp01((s.elapsed - 230) / 35) : 0
    const curtainY = 7.6 + 9.6 * introOpen * (1 - this.curtainClosing)
    for (let i = 0; i < 2; i++) place(this.curtains[i], { x: i ? 22.4 : 9.6, y: curtainY, z: 2.2 })
    show(this.finale, !!s.outcome && s.endingElapsed >= 11)
    show(this.timeText, s.complete)
    if (s.complete && s.outcomeElapsed !== null) TextShape.getMutable(this.timeText).text = formatTime(s.outcomeElapsed)

    if (this.markLanguage !== spanish) {
      this.markLanguage = spanish
      const names = COMPANY_NAMES[spanish ? 'es' : 'en']
      this.markLabels.forEach((label, i) => { TextShape.getMutable(label).text = names[i] })
    }

    const liveIds = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const actor = this.puppets[i]
      const puppet = s.puppets[i]
      const mark = s.marks[i]
      let puppetPosition: Vec3 | undefined
      if (puppet && !s.outcome) {
        useModel(actor, `assets/Models/puppet-${puppet.kind}.glb`)
        show(actor, true)
        const previous = this.lastPuppets.get(puppet.id)
        let movingYaw = previous?.yaw ?? Math.PI
        if (previous && (Math.abs(puppet.position.x - previous.position.x) + Math.abs(puppet.position.z - previous.position.z)) > 0.002) {
          movingYaw = Math.atan2(puppet.position.x - previous.position.x, puppet.position.z - previous.position.z)
        }
        const born = previous?.born ?? s.elapsed
        puppetPosition = { ...puppet.position, y: puppet.position.y - 0.8 * (1 - smooth((s.elapsed - born) / 0.37)) }
        const impact = this.puppetImpact.get(puppet.id)
        const hitAge = impact ? s.elapsed - impact.at : Infinity
        const recoil = puppet.fallen ? 0 : 1 - smooth(hitAge / .24)
        place(actor, puppetPosition, { x: 1 + .12 * recoil, y: 1 - .15 * recoil, z: 1 + .12 * recoil }, Quaternion.fromEulerDegrees(0, movingYaw * 180 / Math.PI, recoil * 8))
        if (puppet.fallen) animation(actor, 'fall', false, puppet.id)
        else if (!puppet.stunned) animation(actor, 'walk', true, puppet.id)
        else if (!previous?.stunned) stopAnimation(actor)
        const puppetInReach = Vector3.distanceSquared(player, puppet.hitPosition) <= s.knotReach ** 2
        this.renderPuppetTarget(i, puppet, puppetPosition, movingYaw, hitAge, impact?.damage ?? 0, canPoint, puppetInReach, spanish)
        this.lastPuppets.set(puppet.id, { position: { ...puppet.position }, yaw: movingYaw, born, stunned: puppet.stunned })
        liveIds.add(puppet.id)
      } else {
        this.clearPuppet(actor)
        this.clearPuppetTarget(this.puppetTargets[i])
        show(this.puppetHealth[i], false)
      }
      if (puppet && puppetPosition && !puppet.fallen && (s.phase === 'f2' || s.phase === 'f3')) {
        tint(this.puppetThreads[i], mark?.called ? GOLD : RED)
        const hand = anchors[(i + 1) % 2]
        thread(this.puppetThreads[i], hand, { ...puppetPosition, y: puppetPosition.y + 1.35 }, 0.027)
      } else show(this.puppetThreads[i], false)
      show(this.marks[i], !!mark && !victorious)
      show(this.markLabels[i], !!mark && !victorious)
      if (mark) {
        place(this.marks[i], { ...mark.position, y: 3.035 })
        place(this.markLabels[i], { ...mark.position, y: 3.3 })
        tint(this.marks[i], mark.called ? GOLD : CREAM)
      }
    }
    for (const id of this.lastPuppets.keys()) if (!liveIds.has(id)) this.lastPuppets.delete(id)
    for (const id of this.puppetImpact.keys()) if (!liveIds.has(id)) this.puppetImpact.delete(id)

    for (let i = 0; i < 10; i++) {
      const hazard = s.hazards[i]
      show(this.hazardLines[i], !!hazard && hazard.kind === 'line')
      show(this.hazardCircles[i], !!hazard && hazard.kind === 'circle')
      if (!hazard) continue
      const target = hazard.kind === 'line' ? this.hazardLines[i] : this.hazardCircles[i]
      if (hazard.kind === 'line' && hazard.to) {
        const delta = Vector3.subtract(hazard.to, hazard.from)
        const length = Math.sqrt(delta.x * delta.x + delta.z * delta.z)
        const wire = hazard.id.includes('tripwire')
        place(target, { x: (hazard.from.x + hazard.to.x) / 2, y: wire ? hazard.from.y : 3.045, z: (hazard.from.z + hazard.to.z) / 2 }, { x: Math.max(0.1, hazard.width), y: wire ? 0.075 : 0.035, z: length }, Quaternion.fromEulerDegrees(0, Math.atan2(delta.x, delta.z) * 180 / Math.PI, 0))
      } else place(target, { ...hazard.from, y: 3.04 }, { x: hazard.radius * 2, y: 0.035, z: hazard.radius * 2 })
      tint(target, hazard.active ? RED : CREAM)
    }
    const segments = Math.floor(s.wrapProgress * 32)
    for (let i = 0; i < this.orbit.length; i++) {
      show(this.orbit[i], fourth && !s.outcome)
      if (segments !== this.lastProgressSegments || s.phase !== this.lastPhase) tint(this.orbit[i], i < segments ? RED : DIM)
    }
    this.lastProgressSegments = segments
    if (s.tethered) {
      const hand = anchors[1]
      const chest = { x: player.x, y: player.y + 1.1, z: player.z }
      if (s.wrapProgress > 0.05) {
        const hook = { x: 16, y: 3.7, z: 16 }
        thread(this.tether[0], hand, hook, 0.045)
        thread(this.tether[1], hook, chest, 0.045)
      } else { thread(this.tether[0], hand, chest, 0.045); show(this.tether[1], false) }
    } else this.tether.forEach(e => show(e, false))
    if (victorious && s.victoryElapsed >= 8 && this.trophy.length === 0) this.createTrophy()
    if (this.trophy.length && s.victoryElapsed >= 10) for (const item of this.trophy) {
      const t = Transform.getMutable(item.mesh)
      t.position = { x: 0, y: 0.13, z: 0 }
      t.scale = { x: 0.028, y: 0.26, z: 0.028 }
    }
    this.lastPhase = s.phase
  }

  private clearPuppet(actor: Entity): void {
    if (!GltfContainer.has(actor)) return
    stopAnimation(actor)
    show(actor, false)
    GltfContainer.deleteFrom(actor)
  }

  private clearPuppetTarget(target: Entity): void {
    this.puppetTargetIds.delete(target)
    if (MeshCollider.has(target)) MeshCollider.deleteFrom(target)
  }

  private renderPuppetTarget(i: number, puppet: PuppetSnapshot, position: Vec3, yaw: number, hitAge: number, damage: number, canAttack: boolean, inReach: boolean, spanish: boolean): void {
    const target = this.puppetTargets[i]
    const label = this.puppetHealth[i]
    const name = PUPPET_NAMES[spanish ? 'es' : 'en'][puppet.kind]
    if (!puppet.fallen && puppet.attackable && canAttack) {
      this.puppetTargetIds.set(target, puppet.id)
      place(target, puppet.hitPosition, { x: 1.52, y: 1.73, z: .82 }, Quaternion.fromEulerDegrees(0, yaw * 180 / Math.PI, 0))
      if (!MeshCollider.has(target)) {
        MeshCollider.create(target, { collisionMask: ColliderLayer.CL_POINTER, mesh: { $case: 'box', box: {} } })
      }
      const event = PointerEvents.getOrNull(target)?.pointerEvents[0]?.eventInfo
      const hover = inReach ? `${spanish ? 'Atacar' : 'Attack'} · ${name}` : `${name} · ${spanish ? 'Fuera de alcance' : 'Out of range'}`
      if (event && event.hoverText !== hover) {
        const mutable = PointerEvents.getMutable(target).pointerEvents[0]?.eventInfo
        if (mutable) mutable.hoverText = hover
      }
    } else this.clearPuppetTarget(target)

    const wasHit = hitAge >= 0 && hitAge < .45
    const showHealth = !puppet.fallen || wasHit
    show(label, showHealth)
    if (!showHealth) return
    place(label, { ...position, y: position.y + 1.94 + (wasHit ? hitAge * .35 : 0) })
    const health = `${puppet.health}/${puppet.maxHealth}`
    const suffix = puppet.stunned && !puppet.fallen ? (spanish ? ' · Aturdido' : ' · Stunned') : ''
    const loss = wasHit ? ` · −${damage} ${spanish ? 'PV' : 'HP'}` : ''
    const value = `${name} · ${health}${loss || suffix}`
    const color = wasHit ? PUPPET_HIT : puppet.stunned ? PUPPET_STUN : PUPPET_HEALTH
    const text = TextShape.get(label)
    if (text.text !== value || text.textColor?.r !== color.r || text.textColor?.g !== color.g || text.textColor?.b !== color.b) {
      const next = TextShape.getMutable(label)
      next.text = value
      next.textColor = color
    }
  }

  private renderStrikePrompt(s: EncounterSnapshot, knot: Vec3, inReach: boolean, spanish: boolean): void {
    const age = s.elapsed - this.bossHitAt
    const cut = this.lastCut
    const miss = this.lastMiss
    const locale = spanish ? 'es' : 'en'
    const fightStart = s.phase === 'f1' && s.elapsed - this.fightStartedAt < 2.25
    let position: Vec3
    let label: string
    let size = .64
    let color = PUPPET_HEALTH
    if (!s.outcome && s.transition) {
      const defeatedForm = cut?.final && age < .55
      label = defeatedForm ? `${spanish ? 'FORMA VENCIDA' : 'FORM DEFEATED'} · −${cut.damage} ${spanish ? 'PV' : 'HP'}`
        : PHASE_NAMES[locale][s.phase].toUpperCase()
      position = { x: 16, y: 6.15, z: 15.6 }
      size = defeatedForm ? .74 : .97
    } else if ((!s.outcome || s.phase === 'victory') && cut && age < .68) {
      label = `−${cut.damage} ${spanish ? 'PV' : 'HP'}`
      position = { ...cut.position, y: cut.position.y + .76 + age * .45 }
      color = HIT_TEXT
    } else if (!s.outcome && !s.respawning && miss && s.elapsed - miss.at < .70) {
      label = MISS_LABELS[locale][miss.reason]
      position = { ...miss.position, y: miss.position.y + .46 }
      size = .57
      color = MISS_TEXT
    } else if (s.classSelectionOpen && !s.respawning) {
      label = spanish ? 'ELIGE TU CLASE' : 'CHOOSE YOUR CLASS'
      position = { x: 16, y: 6.12, z: 7.4 }
    } else if (!s.outcome && s.bossGuardedBySummons) {
      label = spanish ? 'EL ELENCO PROTEGE A LA JEFA' : 'THE CAST PROTECTS THE BOSS'
      position = { x: s.bossPosition.x, y: 5.95, z: s.bossPosition.z - .55 }
      size = .69
    } else if (!s.outcome && s.knotOpen && !s.respawning) {
      const target = inReach ? (spanish ? 'NUDO EXPUESTO' : 'KNOT EXPOSED') : reachPrompt(s.knotReach, spanish)
      label = fightStart ? `${PHASE_NAMES[locale].f1.toUpperCase()}\n${target}` : target
      position = { ...knot, y: knot.y + .82 }
    } else if (!s.outcome && fightStart && !s.respawning) {
      label = spanish ? 'I / ENSAYO\nESQUIVA Y ESPERA EL NUDO' : 'I / REHEARSAL\nDODGE AND WATCH FOR THE KNOT'
      position = { x: s.bossPosition.x, y: 6.25, z: s.bossPosition.z - .80 }
    } else {
      show(this.strikePrompt, false)
      return
    }
    place(this.strikePrompt, position)
    const text = TextShape.get(this.strikePrompt)
    if (text.text !== label || text.fontSize !== size || text.textColor?.r !== color.r || text.textColor?.g !== color.g || text.textColor?.b !== color.b) {
      const next = TextShape.getMutable(this.strikePrompt)
      next.text = label
      next.fontSize = size
      next.textColor = color
    }
    show(this.strikePrompt, true)
  }

  private createTrophy(): void {
    for (const anchorPointId of [AvatarAnchorPointType.AAPT_LEFT_HAND, AvatarAnchorPointType.AAPT_RIGHT_HAND]) {
      const anchor = engine.addEntity()
      Transform.create(anchor)
      AvatarAttach.create(anchor, { anchorPointId })
      const mesh = engine.addEntity()
      Transform.create(mesh, { parent: anchor, position: { x: 0, y: 2, z: 0 }, scale: { x: 0.025, y: 4, z: 0.025 } })
      MeshRenderer.setCylinder(mesh)
      Material.setPbrMaterial(mesh, { albedoColor: { ...RED, a: 1 }, emissiveColor: RED, emissiveIntensity: 1.4 })
      this.trophy.push({ anchor, mesh })
    }
  }
}

function reachPrompt(reach: number, spanish: boolean): string {
  const metres = spanish ? `${reach}`.replace('.', ',') : `${reach}`
  return spanish ? `Acércate a ${metres} m` : `Get within ${metres} m`
}

export function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}
