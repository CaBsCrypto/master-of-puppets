export interface Vec3 { x: number; y: number; z: number }

export type CombatPhase = 'f1' | 'f2' | 'f3' | 'f4'
export type Phase = 'onboarding' | CombatPhase | 'victory' | 'defeat' | 'timeout'
export type RunOutcome = 'manual_clear' | 'assisted_clear' | 'defeat' | 'timeout'
export type PuppetKind = 'rehearsal' | 'knight' | 'princess' | 'dragon'
export type AttackTarget = 'boss' | PuppetKind
export type CombatClass = 'melee' | 'mage' | 'archer'
export type ClassAbility = 'guard' | 'arcane_bind' | 'drawn_shot'
export type SecondaryAbility = 'shield_bash' | 'arcane_burst' | 'piercing_arrow'
export type ManualKnotAttack = 'aimed' | 'proximity'
export type KnotAttackInput = ManualKnotAttack | 'secondary' | 'auto'
export type PlayerAttackKind = 'basic' | 'secondary' | 'auto'
export type AttackTrajectory = 'card' | 'arc' | 'arrow'
export type AttackMissReason = 'closed' | 'range' | 'blocked' | 'cancelled' | 'guarded'

export interface PlayerAttackSnapshot {
  id: number
  role: CombatClass
  kind: PlayerAttackKind
  input: KnotAttackInput
  trajectory: AttackTrajectory
  startElapsed: number
  launchElapsed: number
  impactElapsed: number
  origin: Vec3
  target: Vec3
  targetKind: AttackTarget
  arcHeight: number
  radius: number
  ability: ClassAbility | SecondaryAbility | null
}

export interface HazardSnapshot {
  id: string
  kind: 'line' | 'circle'
  from: Vec3
  to?: Vec3
  radius: number
  width: number
  active: boolean
  telegraph: boolean
}

export interface PuppetSnapshot {
  id: string
  position: Vec3
  hitPosition: Vec3
  kind: PuppetKind
  health: number
  maxHealth: number
  attackable: boolean
  stunned: boolean
  fallen: boolean
}

export interface MarkSnapshot { id: string; position: Vec3; called: boolean }

export interface GameEvent {
  type: string
  elapsed: number
  data?: Record<string, unknown>
}

export interface EncounterSnapshot {
  phase: Phase
  cue: string
  transition: string
  elapsed: number
  phaseElapsed: number
  health: number
  maxHealth: number
  selectedClass: CombatClass | null
  classSelectionOpen: boolean
  classSelectionRemaining: number
  knotReach: number
  proximityReach: number
  ability: ClassAbility | null
  abilityAvailable: boolean
  abilityCooldownRemaining: number
  abilityActiveRemaining: number
  secondaryAbility: SecondaryAbility | null
  secondaryAbilityReach: number
  secondaryAbilityAvailable: boolean
  secondaryAbilityCooldownRemaining: number
  autoAttackEnabled: boolean
  practiceOpening: boolean
  attack: PlayerAttackSnapshot | null
  bossHealth: number
  maxBossHealth: number
  bossDamageDealt: number
  bossForm: CombatPhase
  forcedTransition: boolean
  bossGuardedBySummons: boolean
  formHealth: number
  maxFormHealth: number
  /** @deprecated Use formHealth. */
  hitsRemaining: number
  /** @deprecated Use maxFormHealth. */
  phaseMaxHits: number
  knotOpen: boolean
  knotPosition: Vec3
  knotWindowRemaining: number
  bossPosition: Vec3
  assistance: 0 | 1 | 2
  climax: boolean
  failsafe: boolean
  victoryElapsed: number
  complete: boolean
  respawning: boolean
  defeats: number
  successfulCuts: number
  assisted: boolean
  outcome: RunOutcome | null
  outcomeElapsed: number | null
  endingElapsed: number
  tethered: boolean
  tetherPull: number
  wrapProgress: number
  hazards: HazardSnapshot[]
  puppets: PuppetSnapshot[]
  marks: MarkSnapshot[]
}

export interface EncounterConfig {
  classSelectionEnabled: boolean
  practiceOnClassSelect: boolean
  combatSummonsEnabled: boolean
  combatSummonHealth: number
  useClassDamage: boolean
  floorY: number
  center: Vec3
  spawn: Vec3
  failsafePosition: Vec3
  maxHealth: number
  respawnSeconds: number
  defeatLimit: number
  respawnProtectionSeconds: number
  damageCooldownSeconds: number
  onboardingSeconds: number
  firstOpeningSeconds: number
  healthPerPhase: readonly [number, number, number, number]
  windows: readonly [number, number, number, number]
  minimumWarningSeconds: number
  retryFactor: number
  climaxAt: number
  failsafeAt: number
  timeoutAt: number
  finishAt: number
  endingSeconds: number
  assistAfter: readonly [number, number]
  minionSpeed: number
  markerRadius: number
  arrivalWindowSeconds: number
  assistedArrivalWindowSeconds: number
  knotReach: number
  restKnotHeight: number
  wrapRadius: number
  wrapInnerRadius: number
  wrapTurns: number
  assistedWrapTurns: number
  tetherPull: number
  maxTetherLength: number
  cycleSeconds: number
}
