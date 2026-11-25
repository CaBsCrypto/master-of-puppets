import {
  engine, Transform, pointerEventsSystem, InputAction, InputModifier,
  MainCamera, Physics, inputSystem, PointerEventType, PointerLock, PrimaryPointerInfo, VirtualCamera
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo, triggerEmote } from '~system/RestrictedActions'
import { Encounter } from './game/encounter'
import type { AttackTarget, GameEvent, Vec3, CombatClass, CombatPhase, EncounterSnapshot, PuppetSnapshot } from './game/types'
import { COMBAT_CLASSES, MAX_AIMED_REACH } from './game/classes'
import { LIVE_ENCOUNTER_CONFIG } from './game/config'
import { createReplayEncounter, encodeReplayFrame, replayAttackTarget, REPLAY_HZ, ReplayActions, stepReplay } from './game/replay'
import { CastEntrance } from './class-entrance'
import { ClassEffects } from './class-effects'
import { HeroPresentation } from './class-hero'
import { DEBUG, TETHER_MODE } from './settings'
import { TheatrePresentation } from './presentation'
import { setupAudio, sound, music, duckMusic, renderScore } from './audio'
import { setupUi } from './ui'
import { updateUi, consumeUiActions, getUiLanguage, notifyUiEvent } from './ui-driver'
import { Ranking } from './ranking'

const CHOICE = { melee: ReplayActions.chooseMelee, mage: ReplayActions.chooseMage, archer: ReplayActions.chooseArcher }
const FRAME_SECONDS = 1 / REPLAY_HZ
const ATTACK_POINTER_REACH = MAX_AIMED_REACH + 6
const CLICK_ASSIST_ALIGNMENT = Math.cos(12 * Math.PI / 180)

type CombatAction = 'attack' | 'power' | 'ability'

function denialReason(action: CombatAction, s: EncounterSnapshot, player: Vec3, target: AttackTarget): 'closed' | 'guarded' | 'range' | 'cooldown' | 'busy' | 'wait' {
  if (!s.selectedClass || s.outcome || s.respawning || s.transition) return 'wait'
  const coolingDown = (action === 'ability' && s.abilityCooldownRemaining > 0) ||
    (action === 'power' && s.secondaryAbilityCooldownRemaining > 0)
  if (coolingDown) return 'cooldown'
  if (action !== 'ability' && s.attack) return 'busy'
  if (action !== 'ability' || s.ability === 'arcane_bind') {
    const puppet = action !== 'ability' && target !== 'boss' ? s.puppets.find(p => p.kind === target && p.attackable) : undefined
    if (!puppet) {
      if (action !== 'ability' && target !== 'boss') return 'wait'
      if (s.bossGuardedBySummons) return 'guarded'
      if (!s.knotOpen) return 'closed'
    }
    const reach = action === 'power' ? s.secondaryAbilityReach : s.knotReach
    if (Vector3.distanceSquared(player, puppet?.hitPosition ?? s.knotPosition) > reach ** 2) return 'range'
  }
  return 'wait'
}

function powerTarget(s: EncounterSnapshot, player: Vec3, focused: string | undefined): PuppetSnapshot | undefined {
  let nearest: PuppetSnapshot | undefined
  let nearestDistance = Infinity
  for (const puppet of s.puppets) {
    if (!puppet.attackable) continue
    const distance = Vector3.distanceSquared(player, puppet.hitPosition)
    if (puppet.id === focused && distance <= s.secondaryAbilityReach ** 2) return puppet
    if (distance < nearestDistance) {
      nearest = puppet
      nearestDistance = distance
    }
  }
  return nearest
}

/** Forgive a near miss on the visible target without substituting an off-screen enemy. */
function clickTarget(s: EncounterSnapshot): 'boss' | PuppetSnapshot | undefined {
  const camera = Transform.getOrNull(engine.CameraEntity)
  if (!camera) return undefined
  const origin = camera.position
  const pointerRay = PrimaryPointerInfo.getOrNull(engine.RootEntity)?.worldRayDirection
  const direction = pointerRay && Vector3.lengthSquared(pointerRay) > .01
    ? Vector3.normalize(pointerRay) : Vector3.rotate(Vector3.Forward(), camera.rotation)
  function alignment(point: Vec3): number {
    const offset = Vector3.subtract(point, origin)
    return Vector3.lengthSquared(offset) > .01 ? Vector3.dot(direction, Vector3.normalize(offset)) : -1
  }

  let target: PuppetSnapshot | undefined
  let best = CLICK_ASSIST_ALIGNMENT
  for (const puppet of s.puppets) {
    if (!puppet.attackable) continue
    const match = alignment(puppet.hitPosition)
    if (match > best) {
      best = match
      target = puppet
    }
  }
  if (target) return target
  return alignment(s.knotPosition) >= CLICK_ASSIST_ALIGNMENT ? 'boss' : undefined
}

export function main(): void {
  const encounter = TETHER_MODE === 'leash'
    ? new Encounter({ ...LIVE_ENCOUNTER_CONFIG, maxTetherLength: 10, tetherPull: 0 })
    : createReplayEncounter()
  const ranking = new Ranking()
  const view = new TheatrePresentation()
  const entrance = new CastEntrance(encounter.config.spawn, choose)
  const effects = new ClassEffects()
  const hero = new HeroPresentation()
  const victoryCamera = engine.addEntity()
  // A frontal cut from the audience frames the bow and the closing curtain.
  // An interpolated move from the player's orbit could cross the marionette.
  Transform.create(victoryCamera, {
    position: { x: 16, y: 7.2, z: 0.85 },
    rotation: Quaternion.fromEulerDegrees(-1, 0, 0)
  })
  VirtualCamera.create(victoryCamera, { fov: 52 })
  setupAudio()
  setupUi()
  let started = false
  let lastWallTime = Date.now()
  let queuedActions = 0
  let queuedTarget: AttackTarget = 'boss'
  let focusedPuppet: string | undefined
  let accumulator = 0
  let previousPosition: Vec3 | null = null
  let finished = false
  let restartAt: number | null = null
  let nextKnockback = 0
  let emoteRequested = false
  let movementLocked = false
  let teleporting = false
  let autoPreference = false
  const log = (event: GameEvent) => { if (DEBUG) console.log('[PT] ' + JSON.stringify(event)) }

  function choose(id: CombatClass): boolean {
    if (!encounter.snapshot.classSelectionOpen) return false
    queuedActions = (queuedActions & ~3) | CHOICE[id]
    return true
  }

  function aimAt(targetId?: string): void {
    const s = encounter.snapshot
    if (s.classSelectionOpen || s.outcome) return
    const puppet = targetId && s.puppets.find(p => p.id === targetId && p.attackable)
    if (targetId && !puppet) return
    if (puppet) focusedPuppet = puppet.id
    if (queuedActions & ReplayActions.secondaryAbility) return
    queuedTarget = puppet ? puppet.kind : 'boss'
    queuedActions |= ReplayActions.aimedCut
  }

  function assistWorldClick(): void {
    if (!PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked || !inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) return
    const exactPointerHit = [view.interaction, ...view.puppetTargets].some(entity =>
      inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN, entity))
    if (exactPointerHit || (queuedActions & (ReplayActions.aimedCut | ReplayActions.secondaryAbility))) return
    const s = encounter.snapshot
    if (!s.selectedClass || s.outcome || s.respawning || s.transition) return
    const target = clickTarget(s)
    if (target) aimAt(target === 'boss' ? undefined : target.id)
    else notifyUiEvent({ type: 'action_rejected', elapsed: s.elapsed, data: { action: 'attack', reason: 'no_target' } })
  }

  function teleport(position: Vec3): void {
    if (teleporting) return
    teleporting = true
    Physics.removeForceFromPlayer(view.force)
    void movePlayerTo({ newRelativePosition: position, cameraTarget: { x: 16, y: 4.2, z: 16 } })
      .catch(error => console.log('[game] Player reposition failed: ' + String(error)))
      .finally(() => { teleporting = false })
  }
  function unlock(): void {
    if (movementLocked) InputModifier.deleteFrom(engine.PlayerEntity)
    movementLocked = false
  }
  function restart(phase?: CombatPhase): void {
    Physics.removeForceFromPlayer(view.force)
    unlock()
    const camera = MainCamera.getOrNull(engine.CameraEntity)
    if (camera?.virtualCameraEntity === victoryCamera) MainCamera.getMutable(engine.CameraEntity).virtualCameraEntity = undefined
    view.reset()
    entrance.reset()
    effects.reset()
    hero.reset()
    encounter.start(phase)
    ranking.start(!phase)
    finished = false
    queuedActions = autoPreference ? ReplayActions.toggleAutoAttack : 0
    queuedTarget = 'boss'
    focusedPuppet = undefined
    accumulator = 0
    previousPosition = null
    emoteRequested = false
    nextKnockback = 0
    lastWallTime = Date.now()
    restartAt = lastWallTime
    teleport(encounter.config.spawn)
  }
  pointerEventsSystem.onPointerDown({
    entity: view.interaction,
    opts: { button: InputAction.IA_POINTER, maxPlayerDistance: ATTACK_POINTER_REACH, hoverText: 'Attack', showFeedback: true, showHighlight: false }
  }, () => aimAt())
  for (const entity of view.puppetTargets) {
    pointerEventsSystem.onPointerDown({
      entity,
      opts: { button: InputAction.IA_POINTER, maxPlayerDistance: ATTACK_POINTER_REACH, hoverText: 'Attack puppet', showFeedback: true, showHighlight: false }
    }, () => {
      const id = view.puppetTargetId(entity)
      if (id) aimAt(id)
    })
  }

  function events(player: Vec3): void {
    for (const event of encounter.drainEvents()) {
      log(event)
      view.onEvent(event)
      hero.onEvent(event)
      effects.onEvent(event)
      notifyUiEvent(event)
      if (event.type === 'respawn' || event.type === 'failsafe_tp') teleport(event.data?.position as unknown as Vec3)
      else if (event.type === 'telegraph') { duckMusic(event.elapsed); sound('telegraph', 0.32) }
      else if (event.type === 'open') { duckMusic(event.elapsed); sound('knot-open') }
      else if (event.type === 'fight_start') { duckMusic(event.elapsed); sound('three-knocks', .46) }
      else if (event.type === 'attack_start') {
        if (event.data?.kind === 'secondary') sound('telegraph', .16)
      }
      else if (event.type === 'attack_release') {
        const role = event.data?.role
        const power = event.data?.kind === 'secondary'
        sound(role === 'mage' ? 'knot-open' : 'archer-draw', power ? .48 : role === 'archer' ? .34 : .23)
      }
      else if (event.type === 'attack_miss' && (event.data?.reason === 'closed' || event.data?.reason === 'guarded' || event.data?.reason === 'blocked')) {
        sound('wood-hit', .32)
      }
      else if (event.type === 'puppet_hit') sound('wood-hit', 0.58)
      else if (event.type === 'puppet_defeated') sound('strings-break', 0.42)
      else if (event.type === 'hit') {
        const role = encounter.snapshot.selectedClass ?? 'melee'
        const charged = event.data?.ability === 'drawn_shot'
        const special = event.data?.input === 'secondary'
        sound('knot-cut', special || charged ? 0.8 : 0.55)
        if (special) sound(role === 'mage' ? 'knot-open' : 'archer-draw', 0.38)
      }
      else if (event.type === 'damage') sound('damage', 0.4)
      else if (event.type === 'class_selected' && !event.data?.automatic) sound('wood-hit', 0.35)
      else if (event.type === 'guard_blocked') sound('wood-hit', 0.5)
      else if (event.type === 'class_ability' && event.data?.ability === 'arcane_bind') {
        effects.arcaneBind(event.elapsed)
        sound('knot-open', 0.38)
      }
      else if (event.type === 'class_ability' && event.data?.ability === 'drawn_shot') sound('archer-draw', 0.48)
      else if (event.type === 'class_ability' && event.data?.ability === 'guard') sound('knot-open', 0.32)
      else if (event.type === 'puppet_caught') sound('wood-hit', 0.44)
      else if (event.type === 'mark') sound('wood-hit', 0.28)
      else if (event.type === 'failsafe') { duckMusic(event.elapsed); sound('curtain', 0.32) }
      else if (event.type === 'death') { sound('fall', 0.4); effects.fall(event.elapsed, player) }
      else if (event.type === 'climax') sound('three-knocks')
      else if (event.type === 'phase' && event.data?.phase === 'f2') sound('wood-hit', 0.4)
      else if (event.type === 'phase' && event.data?.phase === 'f3') sound('three-knocks', 0.42)
      else if (event.type === 'phase' && event.data?.phase === 'f4') sound('strings-break', 0.48)
      else if (event.type === 'outcome') {
        const ending = encounter.snapshot
        if (ending.phase === 'victory') MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: victoryCamera })
        ranking.finish(ending)
        music(false)
        sound(ending.phase === 'victory' ? 'finale' : 'curtain', 0.45)
      }
      else if (event.type === 'complete') {
        finished = true
        if (encounter.snapshot.phase === 'victory') sound('applause', 0.4)
      }
    }
  }

  engine.addSystem((dt) => {
    const transform = Transform.getOrNull(engine.PlayerEntity)
    if (!transform) { hero.reset(); return }
    const player = transform.position
    const actions = consumeUiActions()
    if (!started) {
      started = true
      view.reset()
      encounter.start()
      ranking.start(true)
      lastWallTime = Date.now()
    } else if (actions.restart && encounter.snapshot.complete) restart()
    if (DEBUG) {
      const presets: [InputAction, CombatPhase][] = [[InputAction.IA_ACTION_3, 'f1'], [InputAction.IA_ACTION_4, 'f2'], [InputAction.IA_ACTION_5, 'f3'], [InputAction.IA_ACTION_6, 'f4']]
      for (const [button, phase] of presets) if (inputSystem.isTriggered(button, PointerEventType.PET_DOWN)) restart(phase)
    }
    if (actions.selectClass) choose(actions.selectClass)
    const primaryPressed = inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)
    const choseNearby = primaryPressed && encounter.snapshot.classSelectionOpen && entrance.chooseNearest(player)
    if (actions.attackPuppet) aimAt(actions.attackPuppet)
    else if (actions.attack) aimAt()
    if ((primaryPressed && !choseNearby) || actions.power) {
      const s = encounter.snapshot
      if (!s.classSelectionOpen && !s.outcome) {
        queuedTarget = powerTarget(s, player, focusedPuppet)?.kind ?? 'boss'
        queuedActions = (queuedActions & ~ReplayActions.aimedCut) | ReplayActions.secondaryAbility
      }
    }
    assistWorldClick()
    if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN) || actions.ability) queuedActions |= ReplayActions.ability
    if (actions.autoAttack !== undefined) {
      autoPreference = actions.autoAttack
      if (autoPreference !== encounter.snapshot.autoAttackEnabled) queuedActions |= ReplayActions.toggleAutoAttack
      else queuedActions &= ~ReplayActions.toggleAutoAttack
    }
    // The local clock continues across a stall. A stalled trace is kept out of public results.
    const now = Date.now()
    if (restartAt !== null) {
      lastWallTime = now
      const nearSpawn = Vector3.distanceSquared(player, encounter.config.spawn) <= 1.44
      if (!nearSpawn && now - restartAt < 650) return
      if (!nearSpawn) ranking.invalidate()
      restartAt = null
    }
    const elapsed = Math.max(0, (now - lastWallTime) / 1000)
    lastWallTime = now
    if (elapsed > 0.4) ranking.invalidate()
    accumulator = Math.min(295, accumulator + (elapsed || dt))
    const frameCount = Math.floor(accumulator * REPLAY_HZ + 1e-8)
    const preceding = previousPosition ?? player
    const canInterpolate = elapsed <= 0.4 && Vector3.distanceSquared(preceding, player) < 9
    for (let i = 0; i < frameCount && !finished; i++) {
      const newest = i === frameCount - 1
      const position = canInterpolate ? Vector3.lerp(preceding, player, (i + 1) / frameCount) : newest ? player : preceding
      const inputs = newest ? queuedActions : 0
      const target = newest ? queuedTarget : 'boss'
      const frame = encodeReplayFrame(position, inputs | replayAttackTarget(target))
      ranking.record(frame)
      const result = stepReplay(encounter, frame)
      events(position)
      const rejectedAttack = !result.attack && ((inputs & ReplayActions.secondaryAbility) ? 'power'
        : (inputs & ReplayActions.aimedCut) ? 'attack' : null)
      const rejectedAbility = !result.ability && (inputs & ReplayActions.ability) !== 0
      if (rejectedAttack || rejectedAbility) {
        const after = encounter.snapshot
        if (after.selectedClass && !after.outcome) {
          const action = rejectedAttack || 'ability'
          const reason = denialReason(action, after, position, target)
          notifyUiEvent({ type: 'action_rejected', elapsed: after.elapsed, data: { action, reason, targetKind: target } })
          if (reason !== 'busy' && !after.attack) effects.reject(after.elapsed, position)
        }
      }
      previousPosition = position
    }
    if (frameCount > 0) {
      queuedActions = 0
      queuedTarget = 'boss'
    }
    accumulator = Math.max(0, accumulator - frameCount * FRAME_SECONDS)
    const s = encounter.snapshot
    if (s.tethered && !teleporting && TETHER_MODE === 'force') {
      const delta = { x: s.bossPosition.x - player.x, y: 0, z: s.bossPosition.z - player.z }
      if (Vector3.lengthSquared(delta) > 0.01) Physics.applyForceToPlayer(view.force, Vector3.normalize(delta), s.tetherPull)
    } else Physics.removeForceFromPlayer(view.force)
    if (s.tethered && TETHER_MODE === 'knockback' && s.elapsed >= nextKnockback) {
      Physics.applyKnockbackToPlayer({ ...s.bossPosition, y: player.y }, -1.3)
      nextKnockback = s.elapsed + 0.5
    }
    if (s.phase === 'victory' && !s.complete) {
      if (!movementLocked) {
        InputModifier.createOrReplace(engine.PlayerEntity, { mode: { $case: 'standard', standard: { disableWalk: true, disableRun: true, disableJump: true } } })
        movementLocked = true
      }
      if (!emoteRequested && s.victoryElapsed >= 8 && s.victoryElapsed < 11) {
        emoteRequested = true
        void triggerEmote({ predefinedEmote: 'robot' }).catch(error => console.log('[game] Optional emote unavailable: ' + String(error)))
      }
    } else unlock()
    const language = getUiLanguage()
    entrance.render(s, player, language)
    view.render(s, player, language === 'es')
    hero.render(s, player, dt)
    // Only the visuals sample between replay ticks. Impacts still come from the encounter.
    const displayElapsed = s.elapsed + accumulator
    effects.render(s, player, s.attack ? hero.projectileMuzzle(s.attack, displayElapsed) : undefined, displayElapsed)
    renderScore(s, dt)
    const knotDistance = Vector3.distanceSquared(player, s.knotPosition)
    const puppet = powerTarget(s, player, focusedPuppet)
    const powerDistance = puppet ? Vector3.distanceSquared(player, puppet.hitPosition) : knotDistance
    const aimed = s.bossGuardedBySummons && PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked ? clickTarget(s) : undefined
    const puppetsInReach = new Set(s.puppets.filter(p => p.attackable && Vector3.distanceSquared(player, p.hitPosition) <= s.knotReach ** 2).map(p => p.id))
    updateUi(s, DEBUG, entrance.isRevealed, ranking.view, {
      attackInReach: knotDistance <= s.knotReach ** 2,
      attackDistance: Math.sqrt(knotDistance),
      basicTarget: typeof aimed === 'object' ? aimed.id : undefined,
      powerInReach: powerDistance <= s.secondaryAbilityReach ** 2,
      powerDistance: Math.sqrt(powerDistance),
      powerPuppet: puppet?.id,
      puppetsInReach,
      autoInReach: s.selectedClass !== null && knotDistance <= COMBAT_CLASSES[s.selectedClass].autoAttackReach ** 2,
      autoEnabled: s.autoAttackEnabled
    })
  })
}
