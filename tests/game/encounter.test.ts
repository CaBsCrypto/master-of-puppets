import assert from 'node:assert/strict'
import test from 'node:test'
import { Encounter } from '../../src/game/encounter'
import { DEFAULT_CONFIG, LIVE_ENCOUNTER_CONFIG } from '../../src/game/config'
import { angleDelta, arrivalsInWindow, crossesSegment, TAU } from '../../src/game/geometry'
import type { Vec3 } from '../../src/game/types'

const spawn = DEFAULT_CONFIG.spawn
const knotReach = { x: 16, y: 3.1, z: 13.5 }
const ring = (angle: number, radius = 3): Vec3 => ({ x: 16 + Math.cos(angle) * radius, y: 3.1, z: 16 + Math.sin(angle) * radius })
const near = (actual: number, expected: number, epsilon = 1e-6): void => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should be near ${expected}`)

function attach(encounter: Encounter, angle = 0): void {
  encounter.update(1.3, ring(angle))
  assert.equal(encounter.snapshot.tethered, true)
}

function completeOrbit(encounter: Encounter, direction: 1 | -1 = 1): void {
  for (let i = 1; i <= 97 && !encounter.snapshot.knotOpen; i++) encounter.update(0.04, ring(direction * i * TAU / 96))
}

test('inactive model stays still and snapshots cannot mutate model state', () => {
  const game = new Encounter()
  game.update(10, spawn)
  assert.equal(game.snapshot.elapsed, 0)
  const a = game.snapshot
  a.knotPosition.x = 900
  assert.notEqual(game.snapshot.knotPosition.x, 900)
  near(game.snapshot.knotPosition.y, DEFAULT_CONFIG.floorY + 3.45)
})

test('onboarding starts the common clock and gives a free, reachable first opening', () => {
  const game = new Encounter()
  game.start()
  game.update(6.05, knotReach)
  assert.equal(game.snapshot.phase, 'onboarding')
  assert.equal(game.snapshot.knotOpen, true)
  near(game.snapshot.knotPosition.y, 4.3)
  assert.equal(game.cutKnot(), true)
  assert.equal(game.snapshot.phase, 'f1')
  assert.equal(game.snapshot.hitsRemaining, 2)
  const events = game.drainEvents()
  assert.equal(events.filter(e => e.type === 'run_start').length, 1)
  assert.equal(events.filter(e => e.type === 'curtain_start').length, 1)
  assert.equal(events.find(e => e.type === 'run_start')!.elapsed, 0)
})

test('onboarding has a fifteen second ceiling and closed or distant knots cannot be cut', () => {
  const game = new Encounter()
  game.start()
  assert.equal(game.cutKnot(), false)
  game.update(15.05, spawn)
  assert.equal(game.snapshot.phase, 'f1')
  assert.equal(game.snapshot.knotOpen, true)
  assert.equal(game.cutKnot(), false)
  assert.equal(game.snapshot.hitsRemaining, 3)
  game.update(0.01, knotReach)
  assert.equal(game.cutKnot(), true)
  assert.equal(game.cutKnot(), false, 'one opening cannot accept multiple hits')
})

test('no-input run times out at 280 and completes the ending at 295', () => {
  const game = new Encounter()
  game.start()
  game.update(279.99, spawn)
  assert.equal(game.snapshot.outcome, null)
  assert.equal(game.snapshot.knotOpen, true)
  game.update(0.01, knotReach)
  assert.equal(game.snapshot.outcome, 'timeout')
  assert.equal(game.cutKnot(), false)
  assert.equal(game.snapshot.complete, false)
  game.update(15, spawn)
  const s = game.snapshot
  assert.equal(s.phase, 'timeout')
  assert.equal(s.complete, true)
  near(s.elapsed, 295)
  near(s.outcomeElapsed!, 280)
  near(s.endingElapsed, 15)
  assert.equal(s.successfulCuts, 0)
  assert.equal(s.hazards.length, 0)
  assert.equal(s.tethered, false)
  const events = game.drainEvents()
  for (const kind of ['climax', 'failsafe', 'failsafe_tp', 'outcome', 'timeout', 'complete']) assert.equal(events.filter(e => e.type === kind).length, 1, kind)
  near(events.find(e => e.type === 'climax')!.elapsed, 230)
  near(events.find(e => e.type === 'failsafe')!.elapsed, 265)
  near(events.find(e => e.type === 'timeout')!.elapsed, 280)
  assert.equal(events.some(e => e.type === 'victory'), false)
  game.update(100, spawn)
  near(game.snapshot.elapsed, 295)
  assert.equal(game.drainEvents().length, 0)
})

test('large dt is equivalent to small steps for guarantee transitions', () => {
  const a = new Encounter()
  const b = new Encounter()
  a.start()
  b.start()
  a.update(280, spawn)
  for (let i = 0; i < 2800; i++) b.update(0.1, spawn)
  assert.equal(a.snapshot.phase, b.snapshot.phase)
  assert.equal(a.snapshot.failsafe, b.snapshot.failsafe)
  assert.equal(a.snapshot.complete, b.snapshot.complete)
  near(a.snapshot.elapsed, b.snapshot.elapsed)
})

test('falling restores five lives in two seconds while preserving phase and hits', () => {
  const game = new Encounter()
  game.start('f2')
  game.update(1.05, spawn)
  game.update(0.01, { x: 16, y: 0, z: 2.8 })
  assert.equal(game.snapshot.health, 0)
  assert.equal(game.snapshot.respawning, true)
  const phase = game.snapshot.phase
  const hits = game.snapshot.hitsRemaining
  game.update(1.9, { x: 16, y: 0, z: 2.8 })
  assert.equal(game.snapshot.respawning, true)
  game.update(0.15, { x: 16, y: 0, z: 2.8 })
  assert.equal(game.snapshot.respawning, false)
  assert.equal(game.snapshot.health, 5)
  assert.equal(game.snapshot.phase, phase)
  assert.equal(game.snapshot.hitsRemaining, hits)
  const event = game.drainEvents().find(e => e.type === 'respawn')!
  assert.deepEqual(event.data!.position, spawn)
})

test('persistent tripwire damage is limited to one life per second', () => {
  const game = new Encounter({ maxHealth: 100, respawnProtectionSeconds: 0 })
  game.start('f2')
  const onWire = { x: 12, y: 3.1, z: 20 }
  game.update(1.05, onWire)
  assert.equal(game.snapshot.health, 99)
  game.update(0.5, onWire)
  assert.equal(game.snapshot.health, 99)
  game.update(0.6, onWire)
  assert.equal(game.snapshot.health, 98)
})

test('health knockout and falls count toward one third-defeat limit', () => {
  const game = new Encounter({ maxHealth: 1 })
  game.start('f2')
  const outside = { ...spawn, y: 0 }
  game.update(1.05, { x: 12, y: 3.1, z: 20 })
  assert.equal(game.snapshot.defeats, 1)
  assert.equal(game.snapshot.respawning, true)
  game.update(3.05, spawn)
  game.update(0.05, outside)
  assert.equal(game.snapshot.defeats, 2)
  assert.equal(game.snapshot.respawning, true)
  game.update(3.05, spawn)
  game.update(0.05, outside)
  const lost = game.snapshot
  assert.equal(lost.defeats, 3)
  assert.equal(lost.outcome, 'defeat')
  assert.equal(lost.phase, 'defeat')
  assert.equal(lost.health, 0)
  assert.equal(lost.respawning, false)
  assert.equal(lost.knotOpen, false)
  assert.equal(lost.abilityAvailable, false)
  assert.equal(lost.tethered, false)
  assert.equal(lost.hazards.length + lost.marks.length, 0)
  assert.equal(game.cutKnot(), false)
  assert.equal(game.useClassAbility(), false)
  game.update(30, outside)
  assert.equal(game.snapshot.complete, true)
  near(game.snapshot.elapsed, lost.outcomeElapsed! + 15)
  const events = game.drainEvents()
  assert.deepEqual(events.filter(e => e.type === 'death').map(e => e.data?.source), ['tripwire_north', 'fall', 'fall'])
  assert.equal(events.filter(e => e.type === 'respawn').length, 2)
  assert.deepEqual(events.slice(-3).map(e => e.type), ['outcome', 'defeat', 'complete'])
})

test('defeat count survives crossing into the next combat phase', () => {
  const game = new Encounter({ hitsPerPhase: [1, 3, 3, 1] })
  game.start()
  game.update(0.05, { ...spawn, y: 0 })
  game.update(6.1, spawn)
  game.update(0.05, knotReach)
  assert.equal(game.cutKnot(), true)
  assert.equal(game.snapshot.phase, 'f2')
  assert.equal(game.snapshot.defeats, 1)
})

test('jumping clears low wires', () => {
  const game = new Encounter({ maxHealth: 100, respawnProtectionSeconds: 0 })
  game.start('f2')
  game.update(2, { x: 12, y: 4.2, z: 20 })
  assert.equal(game.snapshot.health, 100)
})

test('hostile contact sweeps the feet across a wire without counting air or teleport crossings', () => {
  const scene = (y: number, before: number, after: number): number => {
    const game = new Encounter({ respawnProtectionSeconds: 0 })
    game.start('f2')
    game.update(1.05, { x: 12, y, z: before })
    game.update(0.05, { x: 12, y, z: after })
    return game.snapshot.health
  }
  assert.equal(scene(3.1, 19.4, 20.6), 4, 'a short pass through a live wire hits between frames')
  assert.equal(scene(4.2, 19.4, 20.6), 5, 'both airborne feet samples are above the wire')
  assert.equal(scene(3.1, 17.1, 22.1), 5, 'a teleport across the wire is not a physical hit')
})

test('missed openings activate assistance and a new phase clears it', () => {
  const game = new Encounter()
  game.start('f1')
  game.update(70, spawn)
  assert.equal(game.snapshot.assistance, 2)
  assert.ok(game.drainEvents().filter(e => e.type === 'assist').length >= 2)
  for (let i = 0; i < 500 && game.snapshot.phase === 'f1'; i++) {
    game.update(0.1, game.snapshot.knotOpen ? knotReach : spawn)
    if (game.snapshot.knotOpen) game.cutKnot()
  }
  assert.equal(game.snapshot.phase, 'f2')
  assert.equal(game.snapshot.assistance, 0)
  assert.equal(game.snapshot.assisted, true)
  assert.equal(game.snapshot.health, 5)
})

test('F2 opens when the chasing puppet is lured across a tripwire', () => {
  const game = new Encounter()
  game.start('f2')
  for (let i = 0; i < 100 && !game.snapshot.knotOpen; i++) game.update(0.05, spawn)
  assert.equal(game.snapshot.knotOpen, true)
  assert.ok(game.snapshot.puppets.some(p => p.fallen))
  assert.ok(game.drainEvents().some(e => e.type === 'puppet_caught'))
})

test('F3 distinct marks call all three puppets to one center, not to their marks', () => {
  const game = new Encounter()
  game.start('f3')
  const marks = game.snapshot.marks
  assert.equal(marks.length, 3)
  for (const mark of marks) game.update(0.1, { ...mark.position, y: 3.1 })
  game.update(3, spawn)
  assert.equal(game.snapshot.knotOpen, true)
  assert.equal(game.snapshot.marks.every(m => m.called), true)
  for (const puppet of game.snapshot.puppets) {
    near(puppet.position.x, 16, 0.2)
    near(puppet.position.z, 16, 0.2)
    assert.equal(puppet.fallen, true)
  }
  near(game.snapshot.bossPosition.y, 3)
  near(game.snapshot.knotPosition.y, 4.3)
})

test('arrival windows reject expired or incomplete gatherings', () => {
  assert.equal(arrivalsInWindow([2, 5, 8], 3, 6), true)
  assert.equal(arrivalsInWindow([2, 5, 8.01], 3, 6), false)
  assert.equal(arrivalsInWindow([2, 8], 3, 6), false)
  assert.equal(arrivalsInWindow([2, 5, 9], 3, 8), true)
})

test('F3 markers require feet near the stage and incomplete gatherings expire', () => {
  const game = new Encounter({ arrivalWindowSeconds: 0.5 })
  game.start('f3')
  const mark = game.snapshot.marks[0]
  game.update(0.1, { ...mark.position, y: 9 })
  assert.equal(game.snapshot.marks[0].called, false)
  game.update(0.1, { ...mark.position, y: 3.1 })
  assert.equal(game.snapshot.marks[0].called, true)
  game.update(4, spawn)
  assert.equal(game.snapshot.knotOpen, false)
  assert.equal(game.snapshot.marks[0].called, false)
  assert.ok(game.drainEvents().some(e => e.type === 'marks_expired'))
})

test('F4 accepts a full turn clockwise or counterclockwise', () => {
  for (const direction of [1, -1] as const) {
    const game = new Encounter()
    game.start('f4')
    attach(game)
    completeOrbit(game, direction)
    assert.equal(game.snapshot.knotOpen, true, `direction ${direction}`)
    assert.equal(game.snapshot.wrapProgress, 1)
    assert.equal(game.snapshot.tethered, false)
    near(game.snapshot.knotPosition.y, 4.2)
    game.update(0.01, knotReach)
    assert.equal(game.cutKnot(), true)
    assert.equal(game.snapshot.phase, 'victory')
    assert.equal(game.snapshot.hazards.length, 0)
  }
})

test('angular normalization crosses the -pi/pi boundary without adding a false turn', () => {
  near(angleDelta(Math.PI - 0.1, -Math.PI + 0.1), 0.2)
  near(angleDelta(-Math.PI + 0.1, Math.PI - 0.1), -0.2)
})

test('oscillation cannot win the wrap and reversing subtracts progress', () => {
  const game = new Encounter()
  game.start('f4')
  attach(game, Math.PI - 0.1)
  for (let i = 0; i < 160; i++) game.update(0.02, ring(Math.PI + (i % 2 === 0 ? 0.3 : -0.3)))
  assert.equal(game.snapshot.knotOpen, false)
  assert.ok(game.snapshot.wrapProgress < 0.15)
  assert.equal(game.snapshot.tethered, true)
})

test('teleporting, leaving the ring, and crossing its center reset winding', () => {
  const game = new Encounter()
  game.start('f4')
  attach(game)
  for (let i = 1; i <= 24; i++) game.update(0.04, ring(i * TAU / 96))
  assert.ok(game.snapshot.wrapProgress > 0.2)
  game.update(0.04, { x: 16, y: 3.1, z: 16 })
  assert.equal(game.snapshot.wrapProgress, 0)
  game.update(0.04, ring(0))
  game.update(0.04, ring(0, 6))
  assert.equal(game.snapshot.wrapProgress, 0)
  game.update(0.04, ring(Math.PI, 3))
  assert.equal(game.snapshot.wrapProgress, 0)
  assert.equal(game.snapshot.knotOpen, false)
})

test('a short chord through the center cannot count as an assisted half turn', () => {
  const game = new Encounter({ climaxAt: 0.01 })
  game.start('f4')
  game.update(1.3, ring(0, 1.3))
  assert.equal(game.snapshot.tethered, true)
  game.update(0.05, ring(Math.PI, 1.3))
  assert.equal(game.snapshot.wrapProgress, 0)
  assert.equal(game.snapshot.knotOpen, false)
})

test('failsafe cancels a pending respawn and accepts a final cut as assisted', () => {
  const game = new Encounter({ climaxAt: 2, failsafeAt: 4, timeoutAt: 6, finishAt: 21 })
  game.start('f1')
  game.update(2.1, spawn)
  game.update(1.8, { x: 16, y: 0, z: 2.8 })
  game.update(0.1, { x: 16, y: 0, z: 2.8 })
  assert.equal(game.snapshot.failsafe, true)
  assert.equal(game.snapshot.respawning, false)
  assert.equal(game.snapshot.health, 5)
  assert.equal(game.snapshot.hazards.length, 0)
  assert.equal(game.snapshot.tethered, false)
  assert.equal(game.cutKnot(), true)
  assert.equal(game.snapshot.outcome, 'assisted_clear')
  assert.equal(game.snapshot.successfulCuts, 1)
  game.update(16, knotReach)
  assert.equal(game.snapshot.complete, true)
  assert.equal(game.drainEvents().filter(e => e.type === 'timeout').length, 0)
})

test('the rescue keeps Titiritera seals already cut through the wrap mechanic', () => {
  const game = new Encounter(LIVE_ENCOUNTER_CONFIG)
  game.start('f4')
  for (let cut = 0; cut < 2; cut++) {
    attach(game)
    completeOrbit(game)
    game.update(0.01, knotReach)
    assert.ok(game.queueAttack())
    const attack = game.snapshot.attack!
    game.update(attack.impactElapsed - game.snapshot.elapsed, knotReach)
  }
  game.update(DEFAULT_CONFIG.failsafeAt - game.snapshot.elapsed, spawn)
  assert.equal(game.snapshot.failsafe, true)
  assert.equal(game.snapshot.bossForm, 'f4')
  assert.equal(game.snapshot.formHealth, 86)
  assert.equal(game.snapshot.successfulCuts, 2)
})

test('restart clears clock, assists, triggers, temporary entities and ending state', () => {
  const game = new Encounter()
  game.start()
  game.update(295, spawn)
  game.start()
  const s = game.snapshot
  assert.equal(s.phase, 'onboarding')
  assert.equal(s.elapsed, 0)
  assert.equal(s.health, 5)
  assert.equal(s.assistance, 0)
  assert.equal(s.assisted, false)
  assert.equal(s.defeats, 0)
  assert.equal(s.successfulCuts, 0)
  assert.equal(s.outcome, null)
  assert.equal(s.outcomeElapsed, null)
  assert.equal(s.climax, false)
  assert.equal(s.failsafe, false)
  assert.equal(s.complete, false)
  assert.equal(s.victoryElapsed, 0)
  assert.equal(s.hazards.length + s.puppets.length + s.marks.length, 0)
  assert.equal(s.tethered, false)
  assert.equal(s.wrapProgress, 0)
  assert.deepEqual(game.drainEvents().map(e => e.type), ['run_start', 'curtain_start'])
})

test('four phases can be won through their actual mechanics without a failsafe', () => {
  const game = new Encounter()
  game.start()
  for (let i = 0; i < 1200 && ['onboarding', 'f1', 'f2'].includes(game.snapshot.phase); i++) {
    game.update(0.1, game.snapshot.knotOpen ? knotReach : spawn)
    if (game.snapshot.knotOpen) game.cutKnot()
  }
  assert.equal(game.snapshot.phase, 'f3')
  game.update(3.1, spawn)
  for (let hit = 0; hit < 3; hit++) {
    for (const mark of game.snapshot.marks) game.update(0.1, { ...mark.position, y: 3.1 })
    for (let i = 0; i < 80 && !game.snapshot.knotOpen; i++) game.update(0.05, spawn)
    assert.equal(game.snapshot.knotOpen, true)
    game.update(0.01, knotReach)
    assert.equal(game.cutKnot(), true)
  }
  assert.equal(game.snapshot.phase, 'f4')
  game.update(3.1, ring(0))
  attach(game)
  completeOrbit(game)
  game.update(0.01, knotReach)
  assert.equal(game.cutKnot(), true)
  game.update(15, knotReach)
  assert.equal(game.snapshot.complete, true)
  assert.equal(game.snapshot.outcome, 'manual_clear')
  assert.equal(game.snapshot.successfulCuts, 10)
  assert.equal(game.snapshot.climax, false)
  assert.equal(game.snapshot.failsafe, false)
  assert.ok(game.snapshot.elapsed < 230)
})

test('tripwire crossing checks the finite segment, including fast crossings', () => {
  const a = { x: 0, y: 0, z: 0 }, b = { x: 5, y: 0, z: 0 }
  assert.equal(crossesSegment({ x: 2, y: 0, z: -3 }, { x: 2, y: 0, z: 3 }, a, b), true)
  assert.equal(crossesSegment({ x: 8, y: 0, z: -3 }, { x: 8, y: 0, z: 3 }, a, b), false)
  assert.equal(crossesSegment({ x: 2, y: 0, z: -3 }, { x: 3, y: 0, z: -2 }, a, b), false)
})
