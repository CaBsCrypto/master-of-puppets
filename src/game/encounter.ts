import { DEFAULT_CONFIG } from './config'
import { COMBAT_CLASSES, type CombatClassStats } from './classes'
import { createPlayerAttack, playerAttackPosition, sweptAttackContact } from './attacks'
import { angleDelta, arrivalsInWindow, clamp, copy, crossesSegment, distance, flatDistance, flatSegmentDistance, movementBelowHeight, moveToward, pointSegmentDistance, TAU } from './geometry'
import { THEATRE_CENTER } from './theatre-layout.mjs'
import type { AttackMissReason, AttackTarget, CombatClass, CombatPhase, EncounterConfig, EncounterSnapshot, GameEvent, HazardSnapshot, KnotAttackInput, ManualKnotAttack, MarkSnapshot, Phase, PlayerAttackSnapshot, PuppetKind, RunOutcome, SecondaryAbility, Vec3 } from './types'

interface Puppet {
  id: string
  kind: PuppetKind
  position: Vec3
  health: number
  maxHealth: number
  fallen: boolean
  called: boolean
  arrivedAt: number | null
  bornAt: number
  stunnedUntil: number
}
interface HazardTarget { from: Vec3; to: Vec3 }
interface FormHandoff { actIndex: number; health: number; forced: boolean }
interface PendingAttack {
  trace: PlayerAttackSnapshot
  openingId: number
  miss: AttackMissReason | null
  player: Vec3
  reach: number
  startedInRange: boolean
  released: boolean
  sampleTime: number
  samplePosition: Vec3
}
const PHASES: CombatPhase[] = ['f1', 'f2', 'f3', 'f4']
const CUES: Record<Phase, string> = { onboarding: 'cut_knot', f1: 'read_controller', f2: 'lure_puppet', f3: 'call_company', f4: 'wrap_thread', victory: 'free', defeat: 'defeat', timeout: 'timeout' }
const AUTO_ATTACK_GRACE_SECONDS = 1.2
const PUPPET_IMPACT_RADIUS = .65
const PUPPET_STUN_SECONDS = 2.5

function puppetHitPosition(puppet: Puppet): Vec3 {
  return { ...puppet.position, y: puppet.position.y + (puppet.kind === 'dragon' ? .70 : .85) }
}

function dropPuppet(puppet: Puppet): void {
  puppet.fallen = true
  puppet.health = 0
  puppet.stunnedUntil = 0
}

/** Deterministic gameplay model. SDK entities, input and audio are adapters, not dependencies. */
export class Encounter {
  readonly config: EncounterConfig
  private started = false
  private phase: Phase = 'onboarding'
  private actIndex = 0
  private formHandoff: FormHandoff | null = null
  private elapsed = 0
  private phaseElapsed = 0
  private health = 5
  private selectedClass: CombatClass | null = null
  private abilityReadyAt = 0
  private abilityActiveUntil = 0
  private secondaryReadyAt = 0
  private autoAttackEnabled = false
  private autoAttackReadyAt: number | null = null
  private openingBound = false
  private formHealth = 3
  private bossDamageDealt = 0
  private knotOpen = false
  private knotRemaining = 0
  private openingId = 0
  private nextAttackId = 0
  private pendingAttack: PendingAttack | null = null
  private endingBossHealth: number | null = null
  private assistance: 0 | 1 | 2 = 0
  private failures = 0
  private defeats = 0
  private successfulCuts = 0
  private assisted = false
  private climax = false
  private failsafe = false
  private outcome: RunOutcome | null = null
  private outcomeElapsed: number | null = null
  private complete = false
  private respawnRemaining = 0
  private protectedRemaining = 0
  private damageCooldown = 0
  private player: Vec3
  private previousPlayer: Vec3
  private transition = ''
  private transitionRemaining = 0
  private cycleElapsed = 0
  private cycleNumber = 0
  private openedThisCycle = false
  private retry = false
  private hazards: HazardSnapshot[] = []
  private puppets: Puppet[] = []
  private marks: MarkSnapshot[] = []
  private targets = new Map<string, HazardTarget>()
  private hitSources = new Set<string>()
  private events: GameEvent[] = []
  private tethered = false
  private tetherCastAt = 0
  private tetherTarget: Vec3 | null = null
  private wrapAngle: number | null = null
  private wrapNet = 0
  private wrapProgress = 0

  constructor(config: Partial<EncounterConfig> & { hitsPerPhase?: EncounterConfig['healthPerPhase'] } = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config, healthPerPhase: config.healthPerPhase ?? config.hitsPerPhase ?? DEFAULT_CONFIG.healthPerPhase }
    this.config.center = copy(config.center ?? DEFAULT_CONFIG.center)
    this.config.spawn = copy(config.spawn ?? DEFAULT_CONFIG.spawn)
    this.config.failsafePosition = copy(config.failsafePosition ?? DEFAULT_CONFIG.failsafePosition)
    this.player = copy(this.config.spawn)
    this.previousPlayer = copy(this.player)
    this.health = this.config.maxHealth
    this.formHealth = this.config.healthPerPhase[0]
  }

  /** A phase argument is only for local development presets; normal play starts with no argument. */
  start(initialPhase: 'onboarding' | CombatPhase = 'onboarding'): void {
    this.reset()
    this.started = true
    this.emit('run_start')
    this.emit('curtain_start')
    if (initialPhase !== 'onboarding') this.enterPhase(initialPhase)
  }

  reset(): void {
    this.started = false
    this.phase = 'onboarding'
    this.actIndex = 0
    this.formHandoff = null
    this.elapsed = this.phaseElapsed = this.cycleElapsed = this.cycleNumber = 0
    this.health = this.config.maxHealth
    this.selectedClass = null
    this.abilityReadyAt = this.abilityActiveUntil = 0
    this.secondaryReadyAt = 0
    this.autoAttackEnabled = false
    this.autoAttackReadyAt = null
    this.openingBound = false
    this.formHealth = this.config.healthPerPhase[0]
    this.bossDamageDealt = 0
    this.knotOpen = false
    this.knotRemaining = 0
    this.openingId = this.nextAttackId = 0
    this.pendingAttack = null
    this.endingBossHealth = null
    this.assistance = 0
    this.failures = 0
    this.defeats = this.successfulCuts = 0
    this.assisted = this.climax = this.failsafe = this.complete = false
    this.outcome = this.outcomeElapsed = null
    this.respawnRemaining = this.protectedRemaining = this.damageCooldown = 0
    this.transition = ''
    this.transitionRemaining = 0
    this.openedThisCycle = this.retry = false
    this.player = copy(this.config.spawn)
    this.previousPlayer = copy(this.player)
    this.hazards = []
    this.puppets = []
    this.marks = []
    this.targets.clear()
    this.hitSources.clear()
    this.events = []
    this.releaseTether()
  }

  update(dt: number, player: Vec3): void {
    if (!this.started || this.complete || !Number.isFinite(dt) || dt <= 0) return
    if (![player.x, player.y, player.z].every(Number.isFinite)) return
    this.previousPlayer = copy(this.player)
    this.player = copy(player)
    // A teleport is not a turn around the cruceta. Substeps must not disguise it.
    if (flatDistance(this.player, this.previousPlayer) > 4) this.resetWrap()
    let remaining = Math.min(dt, Math.max(0, this.config.finishAt - this.elapsed))
    while (remaining > 1e-8 && !this.complete) {
      const boundary = this.outcomeElapsed === null ? this.config.timeoutAt : this.outcomeElapsed + this.config.endingSeconds
      const untilBoundary = boundary - this.elapsed
      const pending = this.pendingAttack
      const attackBoundary = pending ? (pending.released ? pending.trace.impactElapsed : pending.trace.launchElapsed) - this.elapsed : Infinity
      const step = Math.min(remaining, 0.05, untilBoundary > 1e-8 ? untilBoundary : 0.05, attackBoundary > 1e-8 ? attackBoundary : 0.05)
      this.tick(step)
      this.advancePlayerAttack()
      remaining -= step
      this.previousPlayer = copy(this.player)
    }
  }

  chooseClass(id: CombatClass): boolean {
    if (!this.classSelectionOpen || this.respawnRemaining > 0 || !Object.prototype.hasOwnProperty.call(COMBAT_CLASSES, id)) return false
    this.selectClass(id, false)
    if (this.config.practiceOnClassSelect) this.openKnot(this.config.onboardingSeconds - this.phaseElapsed)
    return true
  }

  useClassAbility(): boolean {
    const stats = this.classStats
    if (!stats?.ability || !this.canUseAbility()) return false
    this.abilityReadyAt = this.elapsed + stats.cooldownSeconds
    this.abilityActiveUntil = this.elapsed + stats.effectSeconds
    if (stats.ability === 'arcane_bind') {
      this.knotRemaining += stats.effectSeconds
      this.openingBound = true
    }
    this.emit('class_ability', {
      id: this.selectedClass, ability: stats.ability, position: copy(this.player), effectSeconds: stats.effectSeconds,
      activeUntil: this.abilityActiveUntil, cooldownReadyAt: this.abilityReadyAt
    })
    return true
  }

  cutKnot(input: ManualKnotAttack = 'aimed'): boolean {
    const reach = input === 'proximity' ? this.proximityReach : this.knotReach
    return this.pendingAttack === null && this.canCut(reach) && this.commitCut(input)
  }

  useSecondaryAbility(): boolean {
    const stats = this.classStats
    if (!stats || this.pendingAttack || this.abilitySecondsUntil(this.secondaryReadyAt) > 0 || !this.canCut(stats.knotReach)) return false
    this.secondaryReadyAt = this.elapsed + stats.secondaryAbilityCooldownSeconds
    return this.commitCut('secondary', stats.secondaryAbility)
  }

  queueAttack(input: Exclude<KnotAttackInput, 'auto'> = 'aimed', target: AttackTarget = 'boss'): boolean {
    return this.startPlayerAttack(input, target)
  }

  toggleAutoAttack(): void {
    if (!this.started || this.outcome) return
    this.autoAttackEnabled = !this.autoAttackEnabled
    this.autoAttackReadyAt = null
    this.emit('auto_attack_toggled', { enabled: this.autoAttackEnabled })
  }

  /** Called after this step's manual inputs, so they always get the first opportunity. */
  resolveAutoAttack(allowCut = true): boolean {
    if (!this.autoAttackEnabled || this.successfulCuts === 0 || this.failsafe || this.pendingAttack || !this.canCut(this.classStats?.autoAttackReach ?? 0)) {
      this.autoAttackReadyAt = null
      return false
    }
    this.autoAttackReadyAt ??= this.elapsed + AUTO_ATTACK_GRACE_SECONDS
    return allowCut && this.abilitySecondsUntil(this.autoAttackReadyAt) === 0 && this.startPlayerAttack('auto')
  }

  private startPlayerAttack(input: KnotAttackInput, targetKind: AttackTarget = 'boss'): boolean {
    const role = this.selectedClass
    if (!role || !this.canStartPlayerAttack() || (input === 'secondary' && this.abilitySecondsUntil(this.secondaryReadyAt) > 0)) return false
    const stats = COMBAT_CLASSES[role]
    const reach = input === 'secondary' ? stats.knotReach : input === 'auto' ? stats.autoAttackReach
      : input === 'proximity' ? stats.proximityReach : this.knotReach
    if (reach <= 0) return false
    const puppet = this.attackablePuppet(targetKind)
    if (targetKind !== 'boss' && !puppet) return false
    const ability = input === 'secondary' ? stats.secondaryAbility : input === 'aimed' && this.drawnShotActive ? 'drawn_shot' : null
    const protection = puppet ? null : this.bossGuardedBySummons ? 'guarded' : this.knotOpen ? null : 'closed'
    const target = puppet ? puppetHitPosition(puppet) : this.knotPosition()
    const { attack, miss } = createPlayerAttack({
      id: ++this.nextAttackId, role, input, elapsed: this.elapsed, player: this.player, reach, ability, target, targetKind, protection,
      theatreColumns: this.hasTheatreColumns
    })
    this.pendingAttack = {
      trace: attack, openingId: this.openingId, miss, reach, player: copy(this.player),
      startedInRange: distance(this.player, target) <= reach, released: false, sampleTime: this.elapsed, samplePosition: target
    }
    this.autoAttackReadyAt = null
    this.emit('attack_start', { ...attack, origin: copy(attack.origin), target: copy(attack.target) })
    return true
  }

  private canStartPlayerAttack(): boolean {
    return this.started && !!this.selectedClass && !this.pendingAttack && !this.outcome && this.respawnRemaining <= 0 && this.transitionRemaining <= 0
  }

  private get hasTheatreColumns(): boolean {
    const { floorY, center } = this.config
    return floorY === THEATRE_CENTER.y && distance(center, THEATRE_CENTER) === 0
  }

  private advancePlayerAttack(): void {
    const pending = this.pendingAttack
    if (!pending) return
    const { trace, openingId, miss } = pending
    const puppet = this.attackablePuppet(trace.targetKind)
    if (trace.targetKind !== 'boss' && !puppet) { this.missPlayerAttack('cancelled'); return }
    const position = puppet ? puppetHitPosition(puppet) : this.knotPosition()
    if (!pending.released) {
      if (this.elapsed >= trace.launchElapsed - 1e-8) this.releasePlayerAttack(pending, position, !!puppet)
      pending.samplePosition = position
      pending.sampleTime = this.elapsed
      return
    }
    const contact = puppet && pending.startedInRange && (miss === null || miss === 'blocked')
      ? sweptAttackContact(trace, pending.sampleTime, this.elapsed, pending.samplePosition, position, PUPPET_IMPACT_RADIUS) : null
    const hit = contact && (miss !== 'blocked' || contact.elapsed < trace.impactElapsed - 1e-8)
    pending.samplePosition = position
    pending.sampleTime = this.elapsed
    if (!hit && this.elapsed < trace.impactElapsed - 1e-8) return
    if (!hit && miss) { this.missPlayerAttack(miss); return }
    if (puppet) {
      if (!hit) { this.missPlayerAttack('range'); return }
    } else {
      if (this.bossGuardedBySummons) { this.missPlayerAttack('guarded'); return }
      if (!this.knotOpen || openingId !== this.openingId) { this.missPlayerAttack('closed'); return }
    }
    this.pendingAttack = null
    if (trace.input === 'secondary') this.secondaryReadyAt = this.elapsed + COMBAT_CLASSES[trace.role].secondaryAbilityCooldownSeconds
    if (puppet && contact) this.damagePuppet(puppet, trace, position, contact.position)
    else this.commitCut(trace.input, undefined, trace, trace.target)
  }

  private releasePlayerAttack(pending: PendingAttack, position: Vec3, moving: boolean): void {
    const { trace, samplePosition } = pending
    const elapsedSinceSample = this.elapsed - pending.sampleTime
    if (moving && elapsedSinceSample > 1e-8) {
      const velocity = {
        x: (position.x - samplePosition.x) / elapsedSinceSample,
        y: (position.y - samplePosition.y) / elapsedSinceSample,
        z: (position.z - samplePosition.z) / elapsedSinceSample
      }
      const { attack, miss } = createPlayerAttack({
        id: trace.id, role: trace.role, input: trace.input, elapsed: trace.startElapsed, player: pending.player, reach: pending.reach,
        ability: trace.ability, target: position, targetVelocity: velocity, targetKind: trace.targetKind,
        protection: null, theatreColumns: this.hasTheatreColumns
      })
      pending.trace = attack
      pending.miss = miss ?? (pending.startedInRange ? null : 'range')
    }
    pending.released = true
    const attack = pending.trace
    this.emit('attack_release', { ...attack, origin: copy(attack.origin), target: copy(attack.target) })
  }

  private attackablePuppet(target: AttackTarget): Puppet | undefined {
    if (!this.config.combatSummonsEnabled || target === 'boss') return
    return this.puppets.find(puppet => puppet.kind === target && !puppet.fallen)
  }

  private get bossGuardedBySummons(): boolean {
    return this.config.combatSummonsEnabled && this.puppets.some(puppet => !puppet.fallen)
  }

  private attackDamage(input: KnotAttackInput, ability?: PlayerAttackSnapshot['ability']): number {
    const stats: CombatClassStats | undefined = this.classStats
    if (!this.config.useClassDamage || !stats) return 1
    if (input === 'secondary') return stats.secondaryDamage
    if (ability === 'drawn_shot' && stats.drawnShotDamage !== undefined) return stats.drawnShotDamage
    return stats.basicDamage
  }

  private damagePuppet(puppet: Puppet, attack: PlayerAttackSnapshot, position: Vec3, contactPosition = attack.target): void {
    if (attack.ability === 'drawn_shot') this.endAbility('consumed')
    const damage = Math.min(puppet.health, this.attackDamage(attack.input, attack.ability))
    puppet.health -= damage
    const data = {
      puppetId: puppet.id, kind: puppet.kind, health: puppet.health, maxHealth: puppet.maxHealth, damage,
      position, contactPosition, attackId: attack.id, id: attack.role, input: attack.input, ability: attack.ability
    }
    this.emit('puppet_hit', data)
    if (puppet.health > 0) return
    dropPuppet(puppet)
    this.emit('puppet_defeated', data)
    if (!this.bossGuardedBySummons) {
      this.hazards = []
      this.openKnot()
    }
  }

  private missPlayerAttack(reason: AttackMissReason): void {
    const attack = this.pendingAttack?.trace
    if (!attack) return
    this.pendingAttack = null
    this.emit('attack_miss', {
      attackId: attack.id, role: attack.role, input: attack.input, kind: attack.kind,
      reason, targetKind: attack.targetKind, position: playerAttackPosition(attack, this.elapsed)
    })
  }

  private canCut(reach: number): boolean {
    return this.started && this.knotOpen && !this.bossGuardedBySummons && !this.outcome && this.respawnRemaining <= 0 && reach > 0 && distance(this.player, this.knotPosition()) <= reach
  }

  private commitCut(input: KnotAttackInput, secondary?: SecondaryAbility, attack?: PlayerAttackSnapshot, contactPosition?: Vec3): boolean {
    const drawnShot = attack ? attack.ability === 'drawn_shot' : input === 'aimed' && this.drawnShotActive
    const ability = attack?.ability ?? (drawnShot ? 'drawn_shot' : secondary)
    if (input === 'auto') this.assisted = true
    const position = this.knotPosition()
    const damage = Math.min(this.formHealth, this.attackDamage(input, ability))
    this.formHealth -= damage
    this.bossDamageDealt += damage
    this.successfulCuts++
    this.emit('hit', {
      phase: this.phase, remaining: this.formHealth, health: this.formHealth, maxHealth: this.config.healthPerPhase[this.actIndex], damage,
      position, contactPosition: contactPosition ?? attack?.target ?? position,
      ...(this.selectedClass ? { id: this.selectedClass, input } : {}),
      ...(attack ? { attackId: attack.id } : {}),
      ...(ability ? { ability } : {})
    })
    if (drawnShot || this.classStats?.ability === 'arcane_bind') this.endAbility('consumed')
    this.knotOpen = false
    this.knotRemaining = 0
    this.autoAttackReadyAt = null
    if (this.failsafe) {
      if (this.formHealth === 0) this.beginEnding('assisted_clear')
      else {
        // Each rescue cut spends its opening. The next seal is immediately reachable.
        this.openingId++
        this.knotOpen = true
        this.knotRemaining = Infinity
      }
      return true
    }
    if (this.phase === 'onboarding') {
      const remainingHealth = this.formHealth
      this.enterPhase('f1')
      this.formHealth = remainingHealth
    }
    if (this.formHealth === 0) {
      if (this.phase === 'f4') this.beginEnding(this.assisted ? 'assisted_clear' : 'manual_clear')
      else {
        const next = PHASES[PHASES.indexOf(this.phase as CombatPhase) + 1]
        const transition = next === 'f2' ? 'pull_own_strings' : next === 'f3' ? 'controller_cracks' : 'cut_strings'
        this.enterPhase(next, next === 'f2' ? 1.5 : 3, transition)
      }
    } else this.beginCycle(false)
    return true
  }

  drainEvents(): GameEvent[] {
    const result = this.events
    this.events = []
    return result
  }

  get isComplete(): boolean { return this.complete }

  get snapshot(): EncounterSnapshot {
    const endingElapsed = this.outcomeElapsed === null ? 0 : this.elapsed - this.outcomeElapsed
    const attack = this.pendingAttack?.trace
    const visibleAct = this.formHandoff?.actIndex ?? this.actIndex
    const formHealth = this.formHandoff?.health ?? this.formHealth
    const maxFormHealth = this.config.healthPerPhase[visibleAct]
    return {
      phase: this.phase, cue: CUES[this.phase], transition: this.transition,
      elapsed: this.elapsed, phaseElapsed: this.phaseElapsed, health: this.health, maxHealth: this.maxHealth,
      selectedClass: this.selectedClass, classSelectionOpen: this.classSelectionOpen,
      classSelectionRemaining: this.classSelectionOpen ? Math.max(0, this.config.firstOpeningSeconds - this.phaseElapsed) : 0,
      knotReach: this.knotReach, proximityReach: this.proximityReach,
      ability: this.classStats?.ability ?? null, abilityAvailable: this.canUseAbility(),
      abilityCooldownRemaining: this.abilitySecondsUntil(this.abilityReadyAt),
      abilityActiveRemaining: this.abilitySecondsUntil(this.abilityActiveUntil),
      secondaryAbility: this.classStats?.secondaryAbility ?? null,
      secondaryAbilityReach: this.classStats?.knotReach ?? 0,
      secondaryAbilityAvailable: this.canStartPlayerAttack() && this.abilitySecondsUntil(this.secondaryReadyAt) === 0,
      secondaryAbilityCooldownRemaining: this.abilitySecondsUntil(this.secondaryReadyAt),
      autoAttackEnabled: this.autoAttackEnabled, practiceOpening: this.practiceOpening,
      attack: attack ? { ...attack, origin: copy(attack.origin), target: copy(attack.target) } : null,
      bossHealth: this.endingBossHealth ?? this.remainingBossHealth(),
      maxBossHealth: this.config.healthPerPhase.reduce((sum, health) => sum + health, 0), bossDamageDealt: this.bossDamageDealt,
      bossForm: PHASES[visibleAct], forcedTransition: this.transitionRemaining > 0 && !!this.formHandoff?.forced,
      bossGuardedBySummons: this.bossGuardedBySummons,
      formHealth, maxFormHealth, hitsRemaining: formHealth, phaseMaxHits: maxFormHealth, knotOpen: this.knotOpen,
      knotPosition: this.knotPosition(), knotWindowRemaining: Number.isFinite(this.knotRemaining) ? Math.max(0, this.knotRemaining) : Math.max(0, this.config.timeoutAt - this.elapsed),
      bossPosition: this.bossPosition(), assistance: this.assistance, climax: this.climax,
      failsafe: this.failsafe, victoryElapsed: endingElapsed, complete: this.complete,
      defeats: this.defeats, successfulCuts: this.successfulCuts, assisted: this.assisted,
      outcome: this.outcome, outcomeElapsed: this.outcomeElapsed, endingElapsed,
      respawning: this.respawnRemaining > 0, tethered: this.tethered,
      tetherPull: this.tethered ? this.config.tetherPull * (this.assistance > 0 ? 0.7 : 1) : 0,
      wrapProgress: this.wrapProgress,
      hazards: this.hazards.map(h => ({ ...h, from: copy(h.from), ...(h.to ? { to: copy(h.to) } : {}) })),
      puppets: this.puppets.map(p => ({
        id: p.id, kind: p.kind, position: copy(p.position), hitPosition: puppetHitPosition(p),
        health: p.health, maxHealth: p.maxHealth, fallen: p.fallen,
        attackable: this.config.combatSummonsEnabled && !p.fallen && this.transitionRemaining <= 0 && this.respawnRemaining <= 0 && !this.outcome,
        stunned: p.stunnedUntil > this.elapsed
      })),
      marks: this.marks.map(m => ({ ...m, position: copy(m.position) }))
    }
  }

  private remainingBossHealth(): number {
    return this.formHealth + this.config.healthPerPhase.slice(this.actIndex + 1).reduce((sum, health) => sum + health, 0)
  }

  private get classStats() { return this.selectedClass ? COMBAT_CLASSES[this.selectedClass] : undefined }
  private get maxHealth(): number { return this.classStats?.maxHealth ?? this.config.maxHealth }
  private get drawnShotActive(): boolean { return this.selectedClass === 'archer' && this.abilitySecondsUntil(this.abilityActiveUntil) > 0 }
  private get knotReach(): number {
    return this.drawnShotActive ? COMBAT_CLASSES.archer.drawnShotReach : this.classStats?.knotReach ?? this.config.knotReach
  }
  private get proximityReach(): number { return this.classStats?.proximityReach ?? this.config.knotReach }
  private get practiceOpening(): boolean { return this.config.practiceOnClassSelect && this.phase === 'onboarding' && this.knotOpen }
  private get classSelectionOpen(): boolean {
    return this.config.classSelectionEnabled && this.started && this.phase === 'onboarding' && this.selectedClass === null && !this.openedThisCycle
  }

  private selectClass(id: CombatClass, automatic: boolean): void {
    this.selectedClass = id
    if (this.respawnRemaining <= 0) this.health = this.maxHealth
    this.emit('class_selected', { id, automatic })
  }

  private selectDefaultClass(): void {
    if (this.config.classSelectionEnabled && this.selectedClass === null) this.selectClass('melee', true)
  }

  private abilitySecondsUntil(deadline: number): number {
    const secondsRemaining = deadline - this.elapsed
    return secondsRemaining > 1e-8 ? secondsRemaining : 0
  }

  private canUseAbility(): boolean {
    const ability = this.classStats?.ability
    if (!ability || (this.phase === 'onboarding' && !this.practiceOpening) || this.outcome || this.failsafe || this.respawnRemaining > 0 || this.transitionRemaining > 0 || this.abilitySecondsUntil(this.abilityReadyAt) > 0) return false
    return ability !== 'arcane_bind' || (this.knotOpen && !this.openingBound && distance(this.player, this.knotPosition()) <= this.knotReach)
  }

  private endAbility(reason: 'expired' | 'consumed' | 'interrupted'): void {
    if (this.abilityActiveUntil === 0) return
    this.abilityActiveUntil = 0
    this.emit('class_ability_end', { id: this.selectedClass, ability: this.classStats?.ability, reason })
  }

  private tick(dt: number): void {
    this.elapsed = Math.min(this.config.finishAt, this.elapsed + dt)
    this.phaseElapsed += dt
    if (this.abilityActiveUntil > 0 && this.abilitySecondsUntil(this.abilityActiveUntil) === 0) this.endAbility('expired')
    this.damageCooldown = Math.max(0, this.damageCooldown - dt)
    this.protectedRemaining = Math.max(0, this.protectedRemaining - dt)
    if (this.outcomeElapsed !== null) {
      if (this.elapsed >= this.outcomeElapsed + this.config.endingSeconds - 1e-8 || this.elapsed >= this.config.finishAt - 1e-8) this.finish()
      return
    }
    if (!this.climax && this.elapsed >= this.config.climaxAt - 1e-8) {
      this.climax = true
      this.assisted = true
      this.emit('climax')
      if (this.phase !== 'f4') this.enterPhase('f4', 3, 'cut_strings', true)
    }
    if (!this.failsafe && this.elapsed >= this.config.failsafeAt - 1e-8) this.enterFailsafe()
    if (this.elapsed >= this.config.timeoutAt - 1e-8 || this.elapsed >= this.config.finishAt - 1e-8) {
      this.beginEnding('timeout')
      return
    }
    if (this.failsafe) return
    this.tickRespawn(dt)
    if (this.outcome) return
    if (this.transitionRemaining > 0) {
      this.transitionRemaining = Math.max(0, this.transitionRemaining - dt)
      if (this.transitionRemaining <= 1e-8) {
        this.transitionRemaining = 0
        this.formHandoff = null
        this.transition = ''
      }
      this.hazards = []
      return
    }
    if (this.phase === 'onboarding') {
      const practiceExtension = this.openingBound ? COMBAT_CLASSES.mage.effectSeconds : 0
      const deadline = this.config.onboardingSeconds + practiceExtension
      if (!this.openedThisCycle && this.phaseElapsed >= this.config.firstOpeningSeconds - 1e-8) this.openKnot(this.config.onboardingSeconds - this.phaseElapsed)
      if (this.knotOpen) this.knotRemaining = Math.max(0, deadline - this.phaseElapsed)
      if (this.phaseElapsed >= deadline - 1e-8) { this.enterPhase('f1'); this.openKnot() }
      return
    }
    if (this.knotOpen) {
      this.hazards = []
      this.knotRemaining -= dt
      if (this.knotRemaining <= 1e-8) {
        this.knotOpen = false
        this.knotRemaining = 0
        if (this.classStats?.ability === 'arcane_bind') this.endAbility('interrupted')
        this.emit('miss', { phase: this.phase })
        this.recordFailure()
        this.beginCycle(true)
      }
      return
    }
    this.cycleElapsed += dt
    this.hazards = []
    if (this.phase === 'f1') this.tickF1()
    else if (this.phase === 'f2') this.tickF2(dt)
    else if (this.phase === 'f3') this.tickF3(dt)
    else this.tickF4()
    if (this.outcome) return
    if (this.knotOpen) { this.hazards = []; return }
    this.evaluateHazards()
    if (this.outcome) return
    if (this.phase !== 'f1' && !this.bossGuardedBySummons && this.cycleElapsed >= this.config.cycleSeconds) {
      this.emit('miss', { phase: this.phase, reason: 'cycle' })
      this.recordFailure()
      this.beginCycle(true)
    }
  }

  private enterPhase(phase: CombatPhase, transitionSeconds = 0, transition = '', forced = false): void {
    this.missPlayerAttack('cancelled')
    const previousHealth = this.health
    this.selectDefaultClass()
    if (this.phase !== phase) this.emit('phase_end', { phase: this.phase })
    this.formHandoff = transitionSeconds > 0 ? {
      actIndex: this.formHandoff?.actIndex ?? this.actIndex,
      health: this.formHandoff?.health ?? this.formHealth,
      forced
    } : null
    this.phase = phase
    this.phaseElapsed = 0
    this.actIndex = PHASES.indexOf(phase)
    this.formHealth = this.config.healthPerPhase[this.actIndex]
    this.health = this.maxHealth
    if (this.health > previousHealth) {
      this.emit('hero_healed', { previousHealth, health: this.health, maxHealth: this.maxHealth, amount: this.health - previousHealth, reason: 'phase' })
    }
    this.failures = 0
    this.assistance = 0
    this.respawnRemaining = 0
    this.protectedRemaining = this.config.respawnProtectionSeconds
    this.knotOpen = false
    this.knotRemaining = 0
    this.endAbility('interrupted')
    this.transitionRemaining = transitionSeconds
    this.transition = transition
    this.puppets = []
    this.marks = []
    this.beginCycle(false)
    if (phase === 'f3') this.createCompany()
    this.emit('phase', { phase, transition })
    this.emit('phase_start', { phase })
    if (phase === 'f1') this.emit('fight_start')
  }

  private beginCycle(retry: boolean): void {
    this.cycleNumber++
    this.cycleElapsed = 0
    this.openedThisCycle = false
    this.autoAttackReadyAt = null
    this.retry = retry
    this.hazards = []
    this.targets.clear()
    this.hitSources.clear()
    this.releaseTether()
    this.tetherCastAt = 0
    this.tetherTarget = null
    if (this.phase === 'f2' && (!this.config.combatSummonsEnabled || this.puppets.length === 0)) {
      this.puppets = this.puppets.filter(p => !p.fallen).slice(-1)
      this.spawnPuppet('rehearsal', { x: this.config.center.x + (this.cycleNumber % 2 ? 7 : -7), y: this.config.floorY, z: this.config.center.z + 7 })
    }
    if (this.phase === 'f3' && !this.config.combatSummonsEnabled && this.puppets.length > 0) this.resetCompany()
  }

  private tickF1(): void {
    // A missed opening gets one short, fully telegraphed pull instead of the full combo.
    // This brings the next opening close to 60% of the usual complete cycle without shortening warnings.
    if (this.retry) {
      const warning = this.warning(1.2)
      this.lineAttack('retry_pull', 0, warning, 0.4, 2, 8)
      const fullSequence = (this.warning(1.2) + 1) * 2 + this.warning(1) + 1.8
      const retryAt = Math.max(warning + 0.4 + 0.6, (fullSequence + this.config.windows[0]) * this.config.retryFactor)
      if (this.cycleElapsed >= retryAt) this.openKnot()
      return
    }
    const pullWarning = this.warning(1.2)
    const spinWarning = this.warning(1)
    const pullLength = pullWarning + 0.4 + 0.6
    this.lineAttack('pull1', 0, pullWarning, 0.4, 2, 8)
    this.lineAttack('pull2', pullLength, pullWarning, 0.4, 2, 8)
    this.circleAttack('spin', pullLength * 2, spinWarning, 1.2, 4)
    if (this.cycleElapsed >= pullLength * 2 + spinWarning + 1.2 + 0.6) this.openKnot()
  }

  private tripwires(): { id: string; from: Vec3; to: Vec3 }[] {
    const c = this.config.center
    const y = this.config.floorY + 0.4
    return [
      { id: 'tripwire_north', from: { x: c.x - 6, y, z: c.z + 4 }, to: { x: c.x + 6, y, z: c.z + 4 } },
      { id: 'tripwire_south', from: { x: c.x - 6, y, z: c.z - 4 }, to: { x: c.x + 6, y, z: c.z - 4 } },
      { id: 'tripwire_west', from: { x: c.x - 5, y, z: c.z - 4 }, to: { x: c.x - 5, y, z: c.z + 4 } }
    ]
  }

  private tickF2(dt: number): void {
    const wireWarning = this.warning(1)
    if (this.config.combatSummonsEnabled && !this.bossGuardedBySummons) {
      this.lineAttack('f2_pull', 0, wireWarning, 0.4, 2, 8)
      this.lineAttack('f2_pull_again', wireWarning + 1.3, wireWarning, 0.4, 2, 8)
      if (this.cycleElapsed >= wireWarning * 2 + 2.8) this.openKnot()
      return
    }
    for (const wire of this.tripwires()) this.hazards.push({ ...wire, kind: 'line', radius: 0, width: 0.3, telegraph: this.cycleElapsed < wireWarning, active: this.cycleElapsed >= wireWarning })
    this.lineAttack('f2_pull', 3.5, this.warning(1), 0.4, 2, 8)
    const speed = this.config.minionSpeed * (this.assistance > 0 ? 3 / 3.5 : 1)
    for (const puppet of this.puppets) {
      if (puppet.fallen || puppet.stunnedUntil > this.elapsed) continue
      if (this.elapsed - puppet.bornAt < this.warning(1.2)) continue
      const previous = copy(puppet.position)
      puppet.position = moveToward(puppet.position, this.player, speed * dt)
      const crossed = this.cycleElapsed >= wireWarning && this.tripwires().some(w => crossesSegment(previous, puppet.position, w.from, w.to))
      if (crossed && this.config.combatSummonsEnabled) {
        puppet.stunnedUntil = this.elapsed + PUPPET_STUN_SECONDS
        this.emit('puppet_caught', { id: puppet.id, kind: puppet.kind, stunSeconds: PUPPET_STUN_SECONDS })
        continue
      }
      if (!this.config.combatSummonsEnabled && (crossed || (this.assistance === 2 && this.cycleElapsed >= 4))) {
        dropPuppet(puppet)
        this.emit('puppet_caught', { id: puppet.id })
        this.openKnot()
        return
      }
      if (flatDistance(this.player, puppet.position) < 1 && this.player.y < this.config.floorY + 2) this.damage('puppet_contact', false)
      if (this.outcome) return
    }
  }

  private createCompany(): void {
    const c = this.config.center
    const kinds: PuppetKind[] = ['knight', 'princess', 'dragon']
    for (let i = 0; i < 3; i++) {
      const angle = -Math.PI / 2 + i * TAU / 3
      this.marks.push({ id: 'mark_' + kinds[i], position: { x: c.x + Math.cos(angle) * 3, y: this.config.floorY + 0.02, z: c.z + Math.sin(angle) * 3 }, called: false })
      this.spawnPuppet(kinds[i], { x: c.x + Math.cos(angle) * 8, y: this.config.floorY, z: c.z + Math.sin(angle) * 8 })
    }
  }

  private resetCompany(): void {
    for (const mark of this.marks) mark.called = false
    for (const puppet of this.puppets) { puppet.called = false; puppet.arrivedAt = null; puppet.fallen = false; puppet.health = puppet.maxHealth }
  }

  private tickF3(dt: number): void {
    const c = this.config.center
    const combatSummons = this.config.combatSummonsEnabled
    if (combatSummons && !this.bossGuardedBySummons) {
      const warning = this.warning(1)
      this.lineAttack('spear_0', 0, warning, 0.3, 1.4, 20)
      this.lineAttack('spear_1', warning + 1.6, warning, 0.3, 1.4, 20)
      if (this.cycleElapsed >= warning * 2 + 3.3) this.openKnot()
      return
    }
    const angle = (this.cycleNumber % 6) * Math.PI / 3
    this.hazards.push({ id: 'company_tripwire', kind: 'line', from: { x: c.x - Math.cos(angle) * 8, y: this.config.floorY + 0.4, z: c.z - Math.sin(angle) * 8 }, to: { x: c.x + Math.cos(angle) * 8, y: this.config.floorY + 0.4, z: c.z + Math.sin(angle) * 8 }, radius: 0, width: 0.3, active: this.cycleElapsed >= this.warning(1), telegraph: this.cycleElapsed < this.warning(1) })
    const spearIndex = Math.floor(this.cycleElapsed / 3.5)
    this.lineAttack('spear_' + spearIndex, spearIndex * 3.5, this.warning(1), 0.3, 1.4, 20)
    for (let i = 0; i < this.puppets.length; i++) {
      const puppet = this.puppets[i]
      const mark = this.marks[i]
      if (puppet.fallen) continue
      const steppedOnMark = Math.abs(this.player.y - this.config.floorY) <= 0.8 && flatDistance(this.player, mark.position) <= this.config.markerRadius
      if (!puppet.called && (steppedOnMark || (this.assistance === 2 && i < 2))) {
        puppet.called = true
        mark.called = true
        this.emit('mark', { id: mark.id })
      }
      if (puppet.called) {
        const destination = combatSummons ? { x: c.x + (mark.position.x - c.x) * .45, y: c.y, z: c.z + (mark.position.z - c.z) * .45 } : c
        puppet.position = moveToward(puppet.position, destination, this.config.minionSpeed * dt)
        if (puppet.arrivedAt === null && flatDistance(puppet.position, destination) < 0.2) {
          puppet.arrivedAt = this.elapsed
          this.emit('puppet_arrived', { id: puppet.id })
        }
      } else {
        const t = this.phaseElapsed * 0.45 + i * TAU / 3
        const path = { x: c.x + Math.sin(t) * 7, y: this.config.floorY, z: c.z + Math.sin(t * 2) * 5 }
        puppet.position = combatSummons ? moveToward(puppet.position, path, this.config.minionSpeed * dt) : path
      }
      if (!puppet.called && flatDistance(this.player, puppet.position) < 1 && this.player.y < this.config.floorY + 2) this.damage('company_contact', false)
      if (this.outcome) return
    }
    if (combatSummons) return
    const arrivals = this.puppets.map(p => p.arrivedAt).filter((t): t is number => t !== null)
    const window = this.assistance > 0 ? this.config.assistedArrivalWindowSeconds : this.config.arrivalWindowSeconds
    if (arrivalsInWindow(arrivals, 3, window)) {
      for (const puppet of this.puppets) dropPuppet(puppet)
      this.openKnot()
    } else if (arrivals.length > 0 && this.elapsed - Math.min(...arrivals) > window) {
      this.emit('marks_expired')
      this.resetCompany()
    }
  }

  private tickF4(): void {
    const boss = this.bossPosition()
    if (this.tethered) {
      if (flatDistance(this.player, boss) > this.config.maxTetherLength) { this.damage('leash_limit', false); this.releaseTether(); this.tetherCastAt = this.cycleElapsed + 3; return }
      if (flatDistance(this.player, boss) < 1.5) { this.damage('boss_contact', false); this.releaseTether(); this.tetherCastAt = this.cycleElapsed + 3; return }
      if (this.respawnRemaining > 0) { this.releaseTether(); return }
      const radius = flatDistance(this.player, this.config.center)
      if (radius > this.config.wrapRadius || radius < this.config.wrapInnerRadius) { this.resetWrap(); return }
      if (pointSegmentDistance(this.config.center, this.previousPlayer, this.player) < this.config.wrapInnerRadius) { this.resetWrap(); return }
      const angle = Math.atan2(this.player.z - this.config.center.z, this.player.x - this.config.center.x)
      if (this.wrapAngle !== null) this.wrapNet += angleDelta(this.wrapAngle, angle)
      this.wrapAngle = angle
      const target = TAU * ((this.climax || this.assistance === 2) ? this.config.assistedWrapTurns : this.config.wrapTurns)
      this.wrapProgress = clamp(Math.abs(this.wrapNet) / target, 0, 1)
      if (this.wrapProgress >= 1 - 1e-8) {
        this.tethered = false
        this.wrapAngle = null
        this.emit('wrapped')
        this.openKnot()
      }
      return
    }
    if (this.respawnRemaining > 0) return
    const warning = this.warning(1)
    if (this.cycleElapsed >= this.tetherCastAt) {
      if (!this.tetherTarget) { this.tetherTarget = copy(this.player); this.emit('tether_cast') }
      const attackId = 'tether_' + this.cycleNumber + '_' + this.tetherCastAt
      const active = this.cycleElapsed >= this.tetherCastAt + warning
      this.hazards.push({ id: attackId, kind: 'line', from: { ...boss, y: this.config.floorY + 1 }, to: { ...this.tetherTarget, y: this.config.floorY + 1 }, radius: 0, width: 1.4, active: false, telegraph: !active })
      if (active) {
        if (pointSegmentDistance(this.player, boss, this.tetherTarget) <= 1.2) {
          this.tethered = true
          this.resetWrap()
          this.emit('tether_attached')
        }
        this.tetherCastAt = this.cycleElapsed + 3
        this.tetherTarget = null
      }
    }
    if (!this.tethered && !this.climax && this.assistance !== 2) this.circleAttack('cord_sweep', 5, this.warning(1), 0.8, 5)
  }

  private warning(base: number): number { return Math.max(this.config.minimumWarningSeconds, base * (this.assistance > 0 ? 1.2 : 1)) }

  private lineAttack(id: string, start: number, warning: number, activeSeconds: number, width: number, length: number): void {
    if (this.cycleElapsed < start || this.cycleElapsed >= start + warning + activeSeconds) return
    if (!this.targets.has(id)) {
      const from = this.bossPosition()
      const d = flatDistance(from, this.player)
      const dx = d > 0.001 ? (this.player.x - from.x) / d : 0
      const dz = d > 0.001 ? (this.player.z - from.z) / d : -1
      this.targets.set(id, { from: { ...from, y: this.config.floorY + 0.05 }, to: { x: from.x + dx * length, y: this.config.floorY + 0.05, z: from.z + dz * length } })
      this.emit('telegraph', { id, phase: this.phase })
    }
    const target = this.targets.get(id)!
    this.hazards.push({ id: this.phase + '_' + this.cycleNumber + '_' + id, kind: 'line', from: copy(target.from), to: copy(target.to), radius: 0, width, active: this.cycleElapsed >= start + warning, telegraph: this.cycleElapsed < start + warning })
  }

  private circleAttack(id: string, start: number, warning: number, activeSeconds: number, radius: number): void {
    if (this.cycleElapsed < start || this.cycleElapsed >= start + warning + activeSeconds) return
    const key = this.phase + '_' + this.cycleNumber + '_' + id
    if (!this.targets.has(id)) { this.targets.set(id, { from: this.bossPosition(), to: this.bossPosition() }); this.emit('telegraph', { id, phase: this.phase }) }
    this.hazards.push({ id: key, kind: 'circle', from: { ...this.bossPosition(), y: this.config.floorY + 0.05 }, radius, width: 0.2, active: this.cycleElapsed >= start + warning, telegraph: this.cycleElapsed < start + warning })
  }

  private evaluateHazards(): void {
    if (this.respawnRemaining > 0) return
    const previous = distance(this.previousPlayer, this.player) > 4 ? this.player : this.previousPlayer
    for (const hazard of this.hazards) {
      if (!hazard.active) continue
      const tripwire = hazard.id.includes('tripwire')
      // The player transform is at the feet: jumping clears low wires and sweeps.
      const maxHeight = tripwire || hazard.id.includes('cord_sweep') ? 0.85 : 2.5
      const sweep = movementBelowHeight(previous, this.player, this.config.floorY + maxHeight)
      if (!sweep) continue
      const [from, to] = sweep
      const inside = hazard.kind === 'circle' ? pointSegmentDistance(hazard.from, from, to) <= hazard.radius
        : flatSegmentDistance(from, to, hazard.from, hazard.to!) <= hazard.width / 2 + 0.25
      if (inside) this.damage(hazard.id, !tripwire)
    }
  }

  private damage(source: string, once: boolean): void {
    if (this.outcome || this.failsafe || this.respawnRemaining > 0 || this.protectedRemaining > 0 || this.damageCooldown > 0) return
    if (once && this.hitSources.has(source)) return
    if (once) this.hitSources.add(source)
    this.damageCooldown = this.config.damageCooldownSeconds
    if (this.classStats?.ability === 'guard' && this.abilitySecondsUntil(this.abilityActiveUntil) > 0) {
      this.endAbility('consumed')
      this.emit('guard_blocked', { source })
      return
    }
    this.health = Math.max(0, this.health - 1)
    this.emit('damage', { source, health: this.health, maxHealth: this.maxHealth, damage: 1, position: copy(this.player) })
    if (this.health === 0) this.die(source)
  }

  private die(source: string): void {
    if (this.outcome || this.respawnRemaining > 0) return
    this.missPlayerAttack('cancelled')
    this.health = 0
    this.endAbility('interrupted')
    this.defeats++
    this.emit('death', { source, defeats: this.defeats })
    if (this.defeats >= this.config.defeatLimit) {
      this.beginEnding('defeat')
      return
    }
    this.respawnRemaining = this.config.respawnSeconds
    this.releaseTether()
    this.recordFailure()
  }

  private tickRespawn(dt: number): void {
    if (this.respawnRemaining > 0) {
      this.respawnRemaining = Math.max(0, this.respawnRemaining - dt)
      if (this.respawnRemaining <= 1e-8) {
        this.respawnRemaining = 0
        this.health = this.maxHealth
        this.protectedRemaining = this.config.respawnProtectionSeconds
        this.player = copy(this.config.spawn)
        this.previousPlayer = copy(this.player)
        this.emit('respawn', { position: copy(this.config.spawn) })
      }
      return
    }
    if (this.player.y < this.config.floorY - 1 && this.protectedRemaining <= 0) this.die('fall')
  }

  private recordFailure(): void {
    this.failures++
    const next: 0 | 1 | 2 = this.failures >= this.config.assistAfter[1] ? 2 : this.failures >= this.config.assistAfter[0] ? 1 : 0
    if (next > 0) this.assisted = true
    if (next !== this.assistance) { this.assistance = next; this.emit('assist', { level: next, phase: this.phase }) }
  }

  private openKnot(seconds?: number): void {
    if (this.knotOpen || this.outcome || this.bossGuardedBySummons) return
    this.openingId++
    this.selectDefaultClass()
    const phaseIndex = this.phase === 'onboarding' ? 0 : PHASES.indexOf(this.phase as CombatPhase)
    this.knotOpen = true
    this.openingBound = false
    this.openedThisCycle = true
    const assistExtra = this.phase === 'f1' ? this.assistance : this.assistance > 0 ? 1 : 0
    const climaxExtra = this.phase === 'f4' && (this.climax || this.assistance === 2) ? 2 - assistExtra : 0
    this.knotRemaining = seconds ?? (this.config.windows[phaseIndex] + assistExtra + climaxExtra)
    this.hazards = []
    this.tethered = false
    this.emit('open', { phase: this.phase, seconds: this.knotRemaining })
  }

  private enterFailsafe(): void {
    this.missPlayerAttack('cancelled')
    this.openingId++
    const wasRespawning = this.respawnRemaining > 0
    this.failsafe = true
    this.assisted = true
    if (this.phase !== 'f4') this.enterPhase('f4')
    this.transition = ''
    this.transitionRemaining = 0
    this.formHandoff = null
    this.hazards = []
    for (const puppet of this.puppets) dropPuppet(puppet)
    this.releaseTether()
    this.knotOpen = true
    this.knotRemaining = Infinity
    this.endAbility('interrupted')
    const needsMove = wasRespawning || distance(this.player, this.knotPosition()) > this.knotReach
    this.respawnRemaining = 0
    this.health = this.maxHealth
    this.emit('failsafe')
    if (needsMove) {
      this.player = copy(this.config.failsafePosition)
      this.previousPlayer = copy(this.player)
      this.emit('failsafe_tp', { position: copy(this.config.failsafePosition) })
    }
    this.emit('open', { phase: this.phase, failsafe: true })
  }

  private beginEnding(outcome: RunOutcome): void {
    if (this.outcome) return
    this.missPlayerAttack('cancelled')
    this.outcome = outcome
    this.outcomeElapsed = this.elapsed
    const success = outcome === 'manual_clear' || outcome === 'assisted_clear'
    this.endingBossHealth = success ? 0 : this.remainingBossHealth()
    this.phase = success ? 'victory' : outcome
    this.phaseElapsed = 0
    if (success) this.formHealth = 0
    this.knotOpen = false
    this.knotRemaining = 0
    this.abilityReadyAt = 0
    this.endAbility('interrupted')
    this.secondaryReadyAt = 0
    this.autoAttackReadyAt = null
    this.hazards = []
    this.respawnRemaining = 0
    this.transitionRemaining = 0
    this.transition = ''
    this.marks = []
    this.targets.clear()
    this.hitSources.clear()
    this.tetherTarget = null
    this.releaseTether()
    for (const puppet of this.puppets) dropPuppet(puppet)
    const data = { outcome, defeats: this.defeats, successfulCuts: this.successfulCuts, bossDamageDealt: this.bossDamageDealt }
    this.emit('outcome', data)
    this.emit(success ? 'victory' : outcome, data)
    if (this.config.endingSeconds <= 0 || this.elapsed >= this.config.finishAt - 1e-8) this.finish()
  }

  private finish(): void {
    if (this.complete) return
    this.complete = true
    this.hazards = []
    this.releaseTether()
    this.emit('complete', { total: this.elapsed, outcome: this.outcome })
  }

  private bossPosition(): Vec3 {
    const c = this.config.center
    if (this.phase === 'f3' && !this.knotOpen && !this.failsafe) return { x: c.x, y: this.config.floorY + 5, z: c.z }
    if (this.phase === 'f4' && !this.knotOpen && !this.failsafe) return { x: c.x, y: this.config.floorY, z: c.z + 8 }
    return { x: c.x, y: this.config.floorY, z: c.z }
  }

  private knotPosition(): Vec3 {
    const boss = this.bossPosition()
    if (this.knotOpen || this.failsafe || this.outcome) return { x: this.config.center.x, y: this.config.floorY + (this.phase === 'f4' || this.failsafe ? 1.2 : 1.3), z: this.config.center.z }
    return { x: boss.x, y: boss.y + this.config.restKnotHeight * (this.phase === 'f4' ? 1.5 : 1), z: boss.z }
  }

  private spawnPuppet(kind: PuppetKind, position: Vec3): void {
    const id = kind + '_' + this.cycleNumber + '_' + this.puppets.length
    const health = this.config.combatSummonsEnabled ? this.config.combatSummonHealth : 1
    this.puppets.push({ id, kind, position: copy(position), health, maxHealth: health, fallen: false, called: false, arrivedAt: null, bornAt: this.elapsed, stunnedUntil: 0 })
    this.emit('puppet_spawn', { id, kind })
  }

  private resetWrap(): void { this.wrapAngle = null; this.wrapNet = 0; this.wrapProgress = 0 }
  private releaseTether(): void { this.tethered = false; this.resetWrap() }
  private emit(type: string, data?: Record<string, unknown>): void { this.events.push({ type, elapsed: this.elapsed, ...(data ? { data } : {}) }) }
}

export type { AttackMissReason, AttackTarget, ClassAbility, CombatClass, CombatPhase, EncounterConfig, EncounterSnapshot, GameEvent, HazardSnapshot, KnotAttackInput, ManualKnotAttack, MarkSnapshot, Phase, PlayerAttackSnapshot, PuppetSnapshot, RunOutcome, SecondaryAbility, Vec3 } from './types'
