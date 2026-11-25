import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_CONFIG, LIVE_ENCOUNTER_CONFIG } from '../../src/game/config'
import { COMBAT_CLASSES } from '../../src/game/classes'
import {
  createReplayEncounter, decodeReplayFrame, encodeReplayFrame, MAX_REPLAY_FRAMES,
  ReplayActions, replayAttackTarget, replayEncounter, REPLAY_HZ, REPLAY_VERSION, stepReplay
} from '../../src/game/replay'
import type { ReplayFrame, ReplayFrameContext } from '../../src/game/replay'
import type { Vec3 } from '../../src/game/types'

function recordedRun() {
  const live = createReplayEncounter()
  const frames: ReplayFrame[] = []
  function record(position: Vec3, actions = 0) {
    const frame = encodeReplayFrame(position, actions)
    frames.push(frame)
    return stepReplay(live, frame)
  }
  function resolve(position: Vec3): void {
    for (let i = 0; i < REPLAY_HZ && live.snapshot.attack; i++) record(position)
    assert.equal(live.snapshot.attack, null)
  }
  function waitForOpening(position: Vec3): void {
    for (let i = 0; i < 8 * REPLAY_HZ && !live.snapshot.knotOpen; i++) record(position)
    assert.equal(live.snapshot.knotOpen, true)
  }
  return { live, frames, record, resolve, waitForOpening }
}

test('replay gives E priority over a simultaneous click and preserves its applied damage', () => {
  const { live, frames, record, resolve, waitForOpening } = recordedRun()
  const near = DEFAULT_CONFIG.failsafePosition
  const attack = ReplayActions.aimedCut | ReplayActions.secondaryAbility | ReplayActions.proximityCut
  assert.deepEqual(record(DEFAULT_CONFIG.spawn, ReplayActions.chooseMage), { chosen: true, attack: null, ability: false })
  assert.deepEqual(record(near, attack), { chosen: false, attack: 'secondary', ability: false })
  assert.equal(live.snapshot.selectedClass, 'mage')
  assert.equal(live.snapshot.successfulCuts, 0)
  assert.equal(live.snapshot.formHealth, 100)
  assert.equal(record(near, attack).attack, null, 'windup blocks a second attack')
  resolve(near)
  assert.equal(live.snapshot.successfulCuts, 1)
  assert.equal(live.snapshot.formHealth, 58)
  waitForOpening(near)
  assert.equal(live.snapshot.abilityAvailable, true)
  assert.deepEqual(record(near, ReplayActions.aimedCut | ReplayActions.ability), { chosen: false, attack: 'aimed', ability: true })
  resolve(near)
  assert.equal(live.snapshot.successfulCuts, 2)
  const hits = live.drainEvents().filter(event => event.type === 'hit')
  assert.equal(hits.length, 2)
  assert.deepEqual(hits.map(event => event.data?.damage), [42, 21])
  assert.deepEqual(hits[0].data?.position, { x: 16, y: 4.3, z: 16 })
  assert.deepEqual(replayEncounter(frames), live.snapshot)
})

test('replay applies F before a click in the same frame and spends the draw only on impact', () => {
  assert.equal(REPLAY_VERSION, 9)
  const { live, frames, record, resolve, waitForOpening } = recordedRun()
  const near = DEFAULT_CONFIG.failsafePosition
  const extraRange = { x: 16, y: 3.1, z: 5.5 }
  assert.equal(record(DEFAULT_CONFIG.spawn, ReplayActions.chooseArcher).chosen, true)
  assert.equal(record(near, ReplayActions.aimedCut).attack, 'aimed')
  resolve(near)
  waitForOpening(extraRange)
  assert.deepEqual(record(extraRange, ReplayActions.aimedCut | ReplayActions.ability), { chosen: false, attack: 'aimed', ability: true })
  assert.equal(live.snapshot.attack?.ability, 'drawn_shot')
  assert.equal(live.snapshot.knotReach, 11)
  resolve(extraRange)
  assert.equal(live.snapshot.knotReach, 10)
  assert.equal(live.snapshot.successfulCuts, 2)
  assert.equal(live.snapshot.formHealth, 44)
  const charged = live.drainEvents().filter(event => event.type === 'hit').at(-1)
  assert.equal(charged?.data?.ability, 'drawn_shot')
  assert.equal(charged?.data?.damage, 32)
  assert.deepEqual(replayEncounter(frames), live.snapshot)
})

test('replay preserves explicit summon targets, their health and the boss guard', () => {
  const { live, frames, record, resolve, waitForOpening } = recordedRun()
  const near = DEFAULT_CONFIG.failsafePosition
  const spawn = DEFAULT_CONFIG.spawn
  const aimed = ReplayActions.aimedCut
  record(spawn, ReplayActions.chooseMelee)
  const basicDamage = COMBAT_CLASSES.melee.basicDamage
  const cuts = Math.ceil(LIVE_ENCOUNTER_CONFIG.healthPerPhase[0] / basicDamage)
  for (let cut = 0; cut < cuts; cut++) {
    waitForOpening(spawn)
    assert.equal(record(near, aimed).attack, 'aimed')
    resolve(near)
  }
  assert.equal(live.snapshot.phase, 'f2')
  while (live.snapshot.transition) record(spawn)
  const puppet = live.snapshot.puppets[0]
  const position = { ...puppet.position, y: 3.1, z: puppet.position.z - 3 }
  assert.equal(record(position, aimed | replayAttackTarget('knight')).attack, null)
  assert.equal(record(position, aimed | replayAttackTarget('rehearsal')).attack, 'aimed')
  assert.equal(live.snapshot.attack?.targetKind, 'rehearsal')
  resolve(position)
  assert.equal(live.snapshot.puppets[0].health, LIVE_ENCOUNTER_CONFIG.combatSummonHealth - basicDamage)
  assert.equal(live.snapshot.bossGuardedBySummons, true)
  assert.equal(live.snapshot.successfulCuts, cuts)
  assert.deepEqual(replayEncounter(frames), live.snapshot)
})

test('replay records auto opt-in, waits for approach, defers to manual input and latches assisted only after an auto strike', () => {
  const { live, frames, record, resolve, waitForOpening } = recordedRun()
  const belowKnot = { x: 16, y: 3.1, z: 14 }
  const spawn = DEFAULT_CONFIG.spawn
  record(spawn, ReplayActions.chooseMelee | ReplayActions.toggleAutoAttack)
  assert.equal(live.snapshot.autoAttackEnabled, true)
  for (let i = 0; i < 2 * REPLAY_HZ; i++) assert.equal(record(belowKnot).attack, null)
  assert.equal(live.snapshot.practiceOpening, true)
  assert.equal(record(belowKnot, ReplayActions.aimedCut).attack, 'aimed')
  resolve(belowKnot)
  assert.equal(live.snapshot.secondaryAbilityCooldownRemaining, 0)
  waitForOpening(spawn)
  for (let i = 0; i < 30; i++) assert.equal(record(belowKnot).attack, null)
  assert.equal(record(spawn).attack, null, 'leaving range clears the grace timer')
  for (let i = 0; i < 36; i++) assert.equal(record(belowKnot).attack, null)
  assert.equal(record(belowKnot, ReplayActions.secondaryAbility).attack, 'secondary', 'E wins the step when grace expires')
  resolve(belowKnot)
  assert.equal(live.snapshot.assisted, false)
  waitForOpening(spawn)
  for (let i = 0; i < 36; i++) assert.equal(record(belowKnot).attack, null)
  assert.equal(record(belowKnot).attack, 'auto')
  assert.equal(live.snapshot.assisted, false)
  resolve(belowKnot)
  assert.equal(live.snapshot.successfulCuts, 3)
  assert.equal(live.snapshot.assisted, true)
  assert.deepEqual(live.drainEvents().filter(event => event.type === 'hit').map(event => event.data?.input), ['aimed', 'secondary', 'auto'])
  assert.deepEqual(replayEncounter(frames), live.snapshot)
  live.start()
  assert.equal(live.snapshot.autoAttackEnabled, false)
})

test('replay validation receives previous accepted position and prior authorized warp events', () => {
  const fall = encodeReplayFrame({ ...DEFAULT_CONFIG.spawn, y: 0 })
  const spawn = encodeReplayFrame(DEFAULT_CONFIG.spawn)
  const frames = [...Array<ReplayFrame>(2 * REPLAY_HZ + 1).fill(fall), spawn]
  let warp: ReplayFrameContext | undefined
  const state = replayEncounter(frames, {
    acceptFrame(context) {
      if (context.index === 0) assert.equal(context.previousPosition, null)
      if (context.previousEvents.some(event => event.type === 'respawn')) warp = context
      return true
    }
  })
  assert.equal(state.defeats, 1)
  assert.ok(warp)
  assert.deepEqual(warp.previousPosition, { ...DEFAULT_CONFIG.spawn, y: 0 })
  assert.deepEqual(warp.position, DEFAULT_CONFIG.spawn)
  assert.deepEqual(warp.previousEvents.find(event => event.type === 'respawn')?.data?.position, DEFAULT_CONFIG.spawn)
  assert.throws(() => replayEncounter([fall], { acceptFrame: () => false }), /frame 0 rejected/)
})

test('replay rejects malformed coordinates, unknown actions and frames after completion', () => {
  assert.deepEqual(encodeReplayFrame({ x: -0.001, y: 3.104, z: 16.009 }), [0, 310, 1601, 0])
  assert.throws(() => decodeReplayFrame([1.2, 0, 0, 0]), /coordinate/)
  assert.throws(() => decodeReplayFrame([0, 0, 0, 128]), /actions/)
  assert.throws(() => decodeReplayFrame([0, 0, 0, (5 << 7) | ReplayActions.aimedCut]), /actions/)
  assert.throws(() => decodeReplayFrame([0, 0, 0, 1, 2] as unknown as ReplayFrame), /frame/)
  const spawn = encodeReplayFrame(DEFAULT_CONFIG.spawn)
  assert.throws(() => replayEncounter(Array<ReplayFrame>(MAX_REPLAY_FRAMES + 1).fill(spawn)), /number/)
  const fall = encodeReplayFrame({ ...DEFAULT_CONFIG.spawn, y: 0 })
  assert.throws(() => replayEncounter(Array<ReplayFrame>(MAX_REPLAY_FRAMES).fill(fall)), /past completion/)
})

test('a fixed-step no-input recording ends exactly at the replay frame cap', () => {
  const spawn = encodeReplayFrame(DEFAULT_CONFIG.spawn)
  const beforeTimeout = replayEncounter(Array<ReplayFrame>(280 * REPLAY_HZ - 1).fill(spawn))
  assert.equal(beforeTimeout.outcome, null)
  const timeout = replayEncounter(Array<ReplayFrame>(280 * REPLAY_HZ).fill(spawn))
  assert.equal(timeout.outcome, 'timeout')
  assert.equal(timeout.complete, false)
  const ending = replayEncounter(Array<ReplayFrame>(MAX_REPLAY_FRAMES).fill(spawn))
  assert.equal(ending.outcome, 'timeout')
  assert.equal(ending.complete, true)
  assert.ok(Math.abs(ending.elapsed - 295) < 1e-8)
})
