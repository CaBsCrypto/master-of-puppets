import type { CombatClass, ClassAbility, SecondaryAbility } from './types'

export interface CombatClassStats {
  readonly maxHealth: number
  readonly basicDamage: number
  readonly secondaryDamage: number
  readonly drawnShotDamage?: number
  readonly knotReach: number
  readonly drawnShotReach?: number
  readonly proximityReach: number
  readonly ability: ClassAbility | null
  readonly cooldownSeconds: number
  readonly effectSeconds: number
  readonly secondaryAbility: SecondaryAbility
  readonly secondaryAbilityCooldownSeconds: number
  readonly autoAttackReach: number
}

export const COMBAT_CLASSES = {
  melee: {
    maxHealth: 5, basicDamage: 22, secondaryDamage: 35, knotReach: 9, proximityReach: 3.25, ability: 'guard', cooldownSeconds: 8, effectSeconds: 1,
    secondaryAbility: 'shield_bash', secondaryAbilityCooldownSeconds: 8, autoAttackReach: 5.5
  },
  mage: {
    maxHealth: 4, basicDamage: 21, secondaryDamage: 42, knotReach: 8, proximityReach: 4, ability: 'arcane_bind', cooldownSeconds: 12, effectSeconds: 2,
    secondaryAbility: 'arcane_burst', secondaryAbilityCooldownSeconds: 10, autoAttackReach: 5
  },
  archer: {
    maxHealth: 4, basicDamage: 24, secondaryDamage: 35, drawnShotDamage: 32, knotReach: 10, drawnShotReach: 11, proximityReach: 0, ability: 'drawn_shot', cooldownSeconds: 12, effectSeconds: 2,
    secondaryAbility: 'piercing_arrow', secondaryAbilityCooldownSeconds: 10, autoAttackReach: 7
  }
} as const satisfies Record<CombatClass, CombatClassStats>

export const MAX_AIMED_REACH = Math.max(...Object.values(COMBAT_CLASSES).map((stats: CombatClassStats) => stats.drawnShotReach ?? stats.knotReach))
