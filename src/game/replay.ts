import { Encounter } from './encounter'
import { LIVE_ENCOUNTER_CONFIG } from './config'
import type { AttackTarget, CombatClass, EncounterSnapshot, GameEvent, KnotAttackInput, Vec3 } from './types'

export const REPLAY_VERSION = 9
export const REPLAY_HZ = 30
export const MAX_REPLAY_FRAMES = 295 * REPLAY_HZ
export const RANKED_TETHER_MODE = 'force'

export const ReplayActions = {
  chooseMelee: 1,
  chooseMage: 2,
  chooseArcher: 3,
  aimedCut: 4,
  proximityCut: 8,
  ability: 16,
  secondaryAbility: 32,
  toggleAutoAttack: 64
} as const

export type ReplayFrame = readonly [xCm: number, yCm: number, zCm: number, actions: number]

export interface ReplayFrameContext {
  index: number
  frame: ReplayFrame
  position: Vec3
  previousPosition: Vec3 | null
  previousEvents: readonly GameEvent[]
  snapshot: EncounterSnapshot
}

export interface ReplayOptions {
  acceptFrame?: (context: ReplayFrameContext) => boolean
}

export interface ReplayStepResult {
  chosen: boolean
  attack: KnotAttackInput | null
  ability: boolean
}

// The first two bits encode the class, five bits encode inputs, and the upper field encodes the attack target.
const CLASS_MASK = 3
const TARGET_SHIFT = 7
const TARGETS = ['boss', 'rehearsal', 'knight', 'princess', 'dragon'] as const
const MAX_ACTIONS = (TARGETS.length << TARGET_SHIFT) - 1
const TARGETED_INPUTS = ReplayActions.aimedCut | ReplayActions.proximityCut | ReplayActions.secondaryAbility
const MAX_COORDINATE_CM = 32767
const CHOICES: readonly (CombatClass | null)[] = [null, 'melee', 'mage', 'archer']

export function replayAttackTarget(target: AttackTarget): number {
  const code = TARGETS.indexOf(target)
  if (code < 0) throw new RangeError('Invalid replay attack target')
  return code << TARGET_SHIFT
}

export function encodeReplayFrame(position: Vec3, actions = 0): ReplayFrame {
  const frame: ReplayFrame = [Math.round(position.x * 100), Math.round(position.y * 100), Math.round(position.z * 100), actions]
  validateFrame(frame)
  // JSON has one zero, so normalize any -0 from rounding before recording.
  return [frame[0] || 0, frame[1] || 0, frame[2] || 0, frame[3] || 0]
}

export function decodeReplayFrame(frame: ReplayFrame): Vec3 {
  validateFrame(frame)
  return framePosition(frame)
}

export function createReplayEncounter(): Encounter {
  const encounter = new Encounter(LIVE_ENCOUNTER_CONFIG)
  encounter.start()
  return encounter
}

export function stepReplay(encounter: Encounter, frame: ReplayFrame): ReplayStepResult {
  return stepAtPosition(encounter, decodeReplayFrame(frame), frame[3])
}

export function replayEncounter(frames: readonly ReplayFrame[], { acceptFrame }: ReplayOptions = {}): EncounterSnapshot {
  if (!Array.isArray(frames) || frames.length > MAX_REPLAY_FRAMES) throw new RangeError('Invalid number of replay frames')
  const encounter = createReplayEncounter()
  let previousPosition: Vec3 | null = null
  let previousEvents = encounter.drainEvents()
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]
    const position = decodeReplayFrame(frame)
    if (encounter.isComplete) throw new RangeError(`Replay continued past completion at frame ${index}`)
    if (acceptFrame && !acceptFrame({ index, frame, position: { ...position }, previousPosition, previousEvents, snapshot: encounter.snapshot })) {
      throw new RangeError(`Replay frame ${index} rejected`)
    }
    stepAtPosition(encounter, position, frame[3])
    previousPosition = position
    previousEvents = encounter.drainEvents()
  }
  return encounter.snapshot
}

function validateFrame(frame: ReplayFrame): void {
  if (!Array.isArray(frame) || frame.length !== 4) throw new RangeError('Invalid replay frame')
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isInteger(frame[axis]) || Math.abs(frame[axis]) > MAX_COORDINATE_CM) throw new RangeError('Invalid replay coordinate')
  }
  if (!Number.isInteger(frame[3]) || frame[3] < 0 || frame[3] > MAX_ACTIONS) throw new RangeError('Invalid replay actions')
  if ((frame[3] >> TARGET_SHIFT) !== 0 && (frame[3] & TARGETED_INPUTS) === 0) throw new RangeError('Invalid replay actions without attack input')
}

function framePosition([x, y, z]: ReplayFrame): Vec3 {
  return { x: x / 100, y: y / 100, z: z / 100 }
}

function stepAtPosition(encounter: Encounter, position: Vec3, actions: number): ReplayStepResult {
  encounter.update(1 / REPLAY_HZ, position)
  const selectedClass = CHOICES[actions & CLASS_MASK]
  const chosen = selectedClass !== null && encounter.chooseClass(selectedClass)
  const ability = (actions & ReplayActions.ability) !== 0 && encounter.useClassAbility()
  const target = TARGETS[actions >> TARGET_SHIFT]
  let attack: KnotAttackInput | null = null
  if (actions & ReplayActions.secondaryAbility) {
    if (encounter.queueAttack('secondary', target)) attack = 'secondary'
  } else if ((actions & ReplayActions.aimedCut) && encounter.queueAttack('aimed', target)) attack = 'aimed'
  else if ((actions & ReplayActions.proximityCut) && encounter.queueAttack('proximity', target)) attack = 'proximity'
  if (actions & ReplayActions.toggleAutoAttack) encounter.toggleAutoAttack()
  if (encounter.resolveAutoAttack(attack === null && !ability)) attack = 'auto'
  return { chosen, attack, ability }
}
