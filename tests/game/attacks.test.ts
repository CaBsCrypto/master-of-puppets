import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlayerAttack, playerAttackPosition, sweptAttackContact } from '../../src/game/attacks'
import { COMBAT_CLASSES } from '../../src/game/classes'
import { DEFAULT_CONFIG, LIVE_ENCOUNTER_CONFIG } from '../../src/game/config'
import { Encounter } from '../../src/game/encounter'
import type { CombatClass, EncounterConfig, Vec3 } from '../../src/game/types'

const near = { x: 16, y: 3.1, z: 13.5 }
const far = DEFAULT_CONFIG.spawn

function practice(role: CombatClass, position: Vec3 = near, config: Partial<EncounterConfig> = {}): Encounter {
  const game = new Encounter({ ...LIVE_ENCOUNTER_CONFIG, ...config })
  game.start()
  game.update(0.05, position)
  assert.equal(game.chooseClass(role), true)
  return game
}

test('only physical impact spends the opening and applies the class damage', () => {
  const game = practice('melee')
  assert.equal(game.snapshot.bossHealth, 460)
  assert.equal(game.snapshot.maxBossHealth, 460)
  assert.equal(game.snapshot.maxFormHealth, 100)
  assert.ok(game.queueAttack())
  const attack = game.snapshot.attack!
  assert.equal(attack.trajectory, 'card')
  assert.deepEqual(playerAttackPosition(attack, attack.startElapsed), attack.origin)
  assert.equal(game.queueAttack('secondary'), false)
  assert.equal(game.cutKnot(), false)
  game.update(0.30, near)
  assert.equal(game.snapshot.successfulCuts, 0)
  assert.ok(game.snapshot.attack)
  assert.equal(game.snapshot.bossHealth, 460)
  game.update(0.04, near)
  assert.equal(game.snapshot.attack, null)
  assert.equal(game.snapshot.successfulCuts, 1)
  assert.equal(game.snapshot.bossHealth, 438)
  assert.equal(game.snapshot.bossDamageDealt, 22)
  assert.equal(game.snapshot.formHealth, 78)
  const events = game.drainEvents()
  const hit = events.find(event => event.type === 'hit')!
  assert.equal(hit.data?.attackId, attack.id)
  assert.ok(hit.elapsed >= attack.impactElapsed - 1e-8)
  assert.equal(hit.data?.damage, 22)
  assert.equal(hit.data?.health, 78)
  assert.equal(hit.data?.maxHealth, 100)
  assert.deepEqual(hit.data?.contactPosition, attack.target)
  assert.equal(events.filter(event => event.type === 'hit').length, 1)
})

test('air attacks have a reachable endpoint, and an in-range arrow can hit after the archer moves', () => {
  const game = practice('archer', far)
  assert.ok(game.queueAttack())
  assert.ok(game.snapshot.attack!.target.z < game.snapshot.knotPosition.z)
  game.update(0.55, near)
  assert.equal(game.snapshot.bossHealth, 460, 'moving into range does not change old aim')
  assert.equal(game.drainEvents().find(event => event.type === 'attack_miss')?.data?.reason, 'range')
  assert.ok(game.queueAttack())
  const trace = game.snapshot.attack!
  assert.equal(trace.trajectory, 'arrow')
  game.update(.20, near)
  game.update(.35, far)
  assert.equal(game.snapshot.bossHealth, 436)
  assert.deepEqual(game.drainEvents().find(event => event.type === 'hit')?.data?.contactPosition, trace.target)
})

test('a Cartista card travels up to 9 metres and can hit after launch even when the player retreats', () => {
  const atReach = { ...near, z: 7.15 }
  const game = practice('melee', atReach)
  assert.equal(game.snapshot.knotReach, 9)
  assert.ok(game.queueAttack())
  const attack = game.snapshot.attack!
  assert.equal(attack.trajectory, 'card')
  game.update(.20, atReach)
  game.update(.35, far)
  assert.equal(game.snapshot.bossHealth, 438)
  assert.deepEqual(game.drainEvents().find(event => event.type === 'hit')?.data?.contactPosition, attack.target)
})

test('Cartista Mano marcada spends cooldown only on contact', () => {
  const powerReach = { ...near, z: 7.25 }
  const beyond = { ...near, z: 6.75 }
  const game = practice('melee', beyond)
  assert.equal(game.snapshot.secondaryAbilityReach, 9)
  assert.ok(game.queueAttack('secondary'))
  game.update(.71, beyond)
  assert.equal(game.snapshot.bossHealth, 460)
  assert.equal(game.drainEvents().find(event => event.type === 'attack_miss')?.data?.reason, 'range')
  assert.equal(game.snapshot.secondaryAbilityCooldownRemaining, 0)
  game.update(.01, powerReach)
  assert.ok(game.queueAttack('secondary'))
  assert.equal(game.snapshot.attack!.trajectory, 'card')
  assert.equal(game.snapshot.secondaryAbilityCooldownRemaining, 0)
  game.update(.71, powerReach)
  assert.equal(game.snapshot.bossHealth, 425)
  assert.ok(game.snapshot.secondaryAbilityCooldownRemaining > 7.9)
})

test('basic attacks and E hit from the same outer edge for all three classes', () => {
  for (const role of ['melee', 'mage', 'archer'] as const) {
    const stats = COMBAT_CLASSES[role]
    const floorEdge = Math.sqrt(stats.knotReach ** 2 - (4.3 - near.y) ** 2)
    const inside = { ...near, z: 16 - floorEdge + .02 }
    const outside = { ...near, z: 16 - floorEdge - .02 }
    for (const [input, expected] of [['aimed', stats.basicDamage], ['secondary', stats.secondaryDamage]] as const) {
      const game = practice(role, outside)
      assert.equal(game.snapshot.knotReach, game.snapshot.secondaryAbilityReach)
      assert.ok(game.queueAttack(input))
      game.update(.8, outside)
      assert.equal(game.snapshot.phase, 'onboarding')
      assert.equal(game.snapshot.formHealth, 100)
      assert.equal(game.drainEvents().find(event => event.type === 'attack_miss')?.data?.reason, 'range')
      game.update(.01, inside)
      assert.ok(game.queueAttack(input))
      game.update(.8, inside)
      assert.equal(game.snapshot.phase, 'f1')
      assert.equal(game.snapshot.formHealth, 100 - expected)
      const events = game.drainEvents()
      assert.equal(events.find(event => event.type === 'hit')?.data?.damage, expected)
      assert.equal(events.filter(event => event.type === 'fight_start').length, 1)
    }
  }
})

test('a strike wound up against armor cannot hit a newly exposed knot', () => {
  const game = practice('melee')
  assert.ok(game.queueAttack())
  game.update(.35, near)
  assert.equal(game.snapshot.phase, 'f1')
  game.update(6.96, near)
  assert.equal(game.snapshot.knotOpen, false)
  assert.ok(game.queueAttack())
  game.update(.37, near)
  assert.equal(game.snapshot.knotOpen, true)
  assert.equal(game.snapshot.bossHealth, 438)
  assert.equal(game.drainEvents().find(event => event.type === 'attack_miss')?.data?.reason, 'closed')
})

test('a swept contact before the knot deadline counts even when the frame continues past it', () => {
  const game = practice('melee', near, { windows: [.5, 3, 3, 6] })
  assert.ok(game.queueAttack())
  game.update(.35, near)
  for (let step = 0; step < 160 && !game.snapshot.knotOpen; step++) game.update(.05, far)
  assert.ok(game.snapshot.knotOpen)
  game.update(game.snapshot.knotWindowRemaining - .32, near)
  const deadline = game.snapshot.elapsed + game.snapshot.knotWindowRemaining
  assert.ok(game.queueAttack())
  assert.ok(game.snapshot.attack!.impactElapsed < deadline)
  game.update(.35, near)
  assert.equal(game.snapshot.formHealth, 56)
  const events = game.drainEvents()
  assert.ok(events.filter(event => event.type === 'hit').at(-1)!.elapsed < deadline)
  assert.equal(events.some(event => event.type === 'miss'), false)
})

test('a column stops the actual arrow path with its contact point and consumes no E cooldown', () => {
  const game = practice('archer', { x: 30, y: 3.1, z: 16 })
  assert.ok(game.queueAttack('secondary'))
  const attack = game.snapshot.attack!
  assert.equal(attack.ability, 'piercing_arrow')
  assert.ok(Math.abs(attack.target.x - (28.57 + attack.radius)) < 1e-6)
  game.update(.54, near)
  const miss = game.drainEvents().find(event => event.type === 'attack_miss')!
  assert.equal(miss.data?.reason, 'blocked')
  assert.deepEqual(miss.data?.position, attack.target)
  assert.equal(game.snapshot.bossHealth, 460)
  assert.equal(game.snapshot.secondaryAbilityCooldownRemaining, 0)
})

test('a projectile clips the edge of a column only when its swept radius reaches the obstruction', () => {
  function shot(z: number) {
    return createPlayerAttack({
      id: 1, role: 'archer', input: 'secondary', elapsed: 0, player: { x: 30, y: 3.1, z }, reach: 10,
      target: { x: 24, y: 4.15, z }, targetKind: 'rehearsal', protection: null, ability: 'piercing_arrow', theatreColumns: true
    })
  }
  const grazing = shot(16.52)
  assert.equal(grazing.miss, 'blocked')
  assert.ok(Math.abs(grazing.attack.target.x - (28.57 + Math.sqrt(grazing.attack.radius ** 2 - .05 ** 2))) < 1e-6)
  assert.equal(shot(16.55).miss, null)
})

test('a projectile and moving body can touch between samples even when both endpoint distances miss', () => {
  const { attack } = createPlayerAttack({
    id: 1, role: 'archer', input: 'aimed', elapsed: 0, player: { x: 0, y: 3.1, z: 0 }, reach: 9,
    target: { x: 6, y: 4.15, z: 0 }, targetKind: 'rehearsal', protection: null, ability: null, theatreColumns: false
  })
  const contact = sweptAttackContact(attack, attack.launchElapsed, attack.impactElapsed,
    { x: 3, y: 4.15, z: -1 }, { x: 3, y: 4.15, z: 1 }, .65)
  assert.ok(contact)
  assert.ok(contact.elapsed > attack.launchElapsed && contact.elapsed < attack.impactElapsed)
  assert.ok(contact.position.x > 2 && contact.position.x < 3)
})

test('Mage projectiles meet moving hitboxes along the visible arc, not the straight chord', () => {
  const { attack } = createPlayerAttack({
    id: 1, role: 'mage', input: 'aimed', elapsed: 0, player: { x: 0, y: 3.1, z: 0 }, reach: 8,
    target: { x: 8, y: 4.15, z: 0 }, targetKind: 'rehearsal', protection: null, ability: null, theatreColumns: false
  })
  const middle = (attack.launchElapsed + attack.impactElapsed) / 2
  const apex = playerAttackPosition(attack, middle)
  const before = { ...apex, z: -1 }
  const after = { ...apex, z: 1 }
  const contact = sweptAttackContact(attack, attack.launchElapsed, attack.impactElapsed, before, after, .25)
  assert.ok(contact)
  assert.ok(contact.elapsed < middle)
  assert.ok(contact.position.y > attack.origin.y + 1)
  assert.equal(sweptAttackContact(attack, attack.launchElapsed, attack.impactElapsed,
    { ...before, y: attack.origin.y }, { ...after, y: attack.origin.y }, .25), null)
})

test('Mage arc and E cooldown follow the delayed contact from the captured launch', () => {
  const game = practice('mage')
  assert.ok(game.queueAttack('secondary'))
  const attack = game.snapshot.attack!
  assert.equal(attack.trajectory, 'arc')
  assert.ok(Math.abs(attack.launchElapsed - attack.startElapsed - .34) < 1e-8)
  const middle = (attack.launchElapsed + attack.impactElapsed) / 2
  assert.ok(playerAttackPosition(attack, middle).y > Math.max(attack.origin.y, attack.target.y))
  assert.equal(game.snapshot.secondaryAbilityCooldownRemaining, 0)
  game.update(.25, near)
  assert.equal(game.snapshot.secondaryAbilityCooldownRemaining, 0)
  game.update(.26, far)
  assert.ok(game.snapshot.secondaryAbilityCooldownRemaining > 9.9)
  assert.equal(game.snapshot.abilityCooldownRemaining, 0)
  assert.equal(game.snapshot.bossHealth, 418)
})

test('a shot leads a moving puppet and its defeat removes the boss guard without damaging the boss', () => {
  const game = new Encounter(LIVE_ENCOUNTER_CONFIG)
  game.start('f2')
  const position = { x: 20, y: 3.1, z: 18 }
  const born = game.snapshot.puppets[0]
  const bossHealth = game.snapshot.bossHealth
  assert.equal(born.attackable, true)
  assert.equal(born.health, 40)
  assert.equal(born.maxHealth, 40)
  assert.equal(game.snapshot.bossGuardedBySummons, true)
  game.update(1.35, position)
  assert.notDeepEqual(game.snapshot.puppets[0].position, born.position)
  assert.ok(game.queueAttack('secondary', 'boss'))
  game.update(.55, position)
  assert.equal(game.drainEvents().find(event => event.type === 'attack_miss')?.data?.reason, 'guarded')
  assert.equal(game.snapshot.bossHealth, bossHealth)
  assert.equal(game.snapshot.secondaryAbilityCooldownRemaining, 0)
  assert.equal(game.cutKnot(), false)
  assert.equal(game.snapshot.puppets[0].stunned, false)
  assert.ok(game.queueAttack('aimed', 'rehearsal'))
  const stagedShot = game.snapshot.attack!
  assert.equal(stagedShot.targetKind, 'rehearsal')
  assert.equal(game.queueAttack('aimed', 'rehearsal'), false)
  game.update(.55, position)
  assert.equal(game.snapshot.puppets[0].health, 18)
  assert.equal(game.snapshot.bossGuardedBySummons, true)
  assert.equal(game.snapshot.knotOpen, false)
  const flight = game.drainEvents()
  const release = flight.find(event => event.type === 'attack_release')!
  assert.notDeepEqual(release.data?.target, stagedShot.target)
  const hits = flight.filter(event => event.type === 'puppet_hit')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].data?.puppetId, born.id)
  assert.equal(hits[0].data?.damage, 22)
  assert.ok(game.queueAttack('secondary', 'rehearsal'))
  game.update(.55, position)
  assert.equal(game.snapshot.puppets[0].health, 0)
  assert.equal(game.snapshot.puppets[0].attackable, false)
  assert.equal(game.snapshot.puppets[0].fallen, true)
  assert.ok(game.snapshot.secondaryAbilityCooldownRemaining > 0)
  assert.equal(game.snapshot.bossGuardedBySummons, false)
  assert.equal(game.snapshot.knotOpen, true)
  assert.equal(game.snapshot.successfulCuts, 0)
  assert.equal(game.snapshot.bossHealth, bossHealth)
  assert.equal(game.queueAttack('aimed', 'rehearsal'), false)
  const defeated = game.drainEvents().filter(event => event.type === 'puppet_defeated')
  assert.equal(defeated.length, 1)
  assert.equal(defeated[0].data?.damage, 18)
  assert.ok(game.queueAttack())
  game.update(.55, position)
  assert.equal(game.snapshot.formHealth, 88)
  game.update(5, far)
  assert.equal(game.snapshot.knotOpen, true)
  assert.equal(game.snapshot.puppets[0].id, born.id)
  assert.equal(game.snapshot.puppets[0].fallen, true)
})

test('the wire stuns the rehearsal puppet without damaging it or opening the knot', () => {
  const game = new Encounter(LIVE_ENCOUNTER_CONFIG)
  game.start('f2')
  const position = { x: 16, y: 3.1, z: 10.25 }
  for (let i = 0; i < 100 && !game.snapshot.puppets[0].stunned; i++) game.update(.05, position)
  const stunned = game.snapshot.puppets[0]
  assert.equal(stunned.stunned, true)
  assert.equal(stunned.health, 40)
  assert.equal(stunned.attackable, true)
  assert.equal(game.snapshot.knotOpen, false)
  assert.ok(game.snapshot.bossGuardedBySummons)
  game.update(1.5, position)
  assert.deepEqual(game.snapshot.puppets[0].position, stunned.position)
  game.update(1.25, position)
  assert.equal(game.snapshot.puppets[0].stunned, false)
  assert.notDeepEqual(game.snapshot.puppets[0].position, stunned.position)
})

test('the Company marks gather three distinct selectable puppets and all must fall', () => {
  const game = new Encounter(LIVE_ENCOUNTER_CONFIG)
  game.start('f3')
  assert.deepEqual(game.snapshot.puppets.map(puppet => [puppet.kind, puppet.health]), [['knight', 40], ['princess', 40], ['dragon', 40]])
  for (const mark of game.snapshot.marks) game.update(.1, { ...mark.position, y: 3.1 })
  const position = { x: 21, y: 3.1, z: 15.7 }
  game.update(3, position)
  const puppets = game.snapshot.puppets
  assert.equal(game.snapshot.marks.filter(mark => mark.called).length, 3)
  assert.equal(game.drainEvents().filter(event => event.type === 'puppet_arrived').length, 3)
  assert.equal(new Set(puppets.map(puppet => JSON.stringify(puppet.position))).size, 3)
  for (const [index, puppet] of puppets.entries()) {
    for (const remaining of [18, 0]) {
      assert.ok(game.queueAttack('aimed', puppet.kind))
      game.update(.55, position)
      assert.equal(game.snapshot.puppets[index].health, remaining)
      assert.equal(game.snapshot.bossGuardedBySummons, index !== 2 || remaining !== 0)
      assert.equal(game.snapshot.successfulCuts, 0)
    }
  }
  assert.equal(game.snapshot.knotOpen, true)
  assert.equal(game.snapshot.formHealth, 120)
  assert.ok(game.queueAttack())
  game.update(.55, position)
  assert.equal(game.snapshot.formHealth, 98)
  game.update(5.4, far)
  assert.equal(game.snapshot.knotOpen, true)
  assert.deepEqual(game.snapshot.puppets.map(puppet => puppet.id), puppets.map(puppet => puppet.id))
  assert.ok(game.snapshot.puppets.every(puppet => puppet.fallen))
})

test('the timed transition removes the active wave and cancels its pending attack', () => {
  const game = new Encounter({ ...LIVE_ENCOUNTER_CONFIG, climaxAt: .2 })
  game.start('f2')
  const target = game.snapshot.puppets[0].position
  const position = { ...target, y: 3.1, z: target.z - 3 }
  game.update(.05, position)
  assert.ok(game.queueAttack('aimed', 'rehearsal'))
  game.update(.20, position)
  const state = game.snapshot
  assert.equal(state.phase, 'f4')
  assert.equal(state.assisted, true)
  assert.equal(state.puppets.length, 0)
  assert.equal(state.bossGuardedBySummons, false)
  assert.equal(state.attack, null)
  const events = game.drainEvents()
  assert.equal(events.find(event => event.type === 'attack_miss')?.data?.reason, 'cancelled')
  assert.equal(events.some(event => event.type === 'puppet_defeated'), false)
})

test('respawn preserves a wounded wave while replay clears it', () => {
  const game = new Encounter(LIVE_ENCOUNTER_CONFIG)
  game.start('f2')
  const target = game.snapshot.puppets[0]
  const position = { ...target.position, y: 3.1, z: target.position.z - 3 }
  game.update(1.3, position)
  assert.ok(game.queueAttack('aimed', 'rehearsal'))
  game.update(.55, position)
  assert.equal(game.snapshot.puppets[0].health, 18)
  game.update(.05, { ...far, y: 0 })
  assert.equal(game.snapshot.respawning, true)
  assert.equal(game.snapshot.puppets[0].attackable, false)
  assert.ok(game.snapshot.bossGuardedBySummons)
  assert.equal(game.queueAttack('aimed', 'rehearsal'), false)
  game.update(2.05, far)
  assert.equal(game.snapshot.respawning, false)
  assert.equal(game.snapshot.puppets[0].attackable, true)
  assert.equal(game.snapshot.puppets[0].health, 18)
  assert.equal(game.snapshot.puppets[0].id, target.id)
  game.start()
  assert.equal(game.snapshot.puppets.length, 0)
  assert.equal(game.snapshot.bossGuardedBySummons, false)
})

test('phase jumps and knockouts cancel pending attacks; boss health survives defeat', () => {
  const timed = practice('melee', near, { climaxAt: .20 })
  assert.ok(timed.queueAttack())
  timed.update(.25, near)
  assert.equal(timed.snapshot.phase, 'f4')
  assert.equal(timed.snapshot.bossHealth, 130)
  assert.equal(timed.snapshot.bossForm, 'f1')
  assert.equal(timed.snapshot.formHealth, 100)
  assert.equal(timed.snapshot.forcedTransition, true)
  assert.equal(timed.snapshot.attack, null)
  assert.equal(timed.drainEvents().find(event => event.type === 'attack_miss')?.data?.reason, 'cancelled')

  const game = practice('melee')
  assert.ok(game.queueAttack())
  game.update(.35, near)
  game.update(7.25, near)
  assert.ok(game.queueAttack())
  const fallen = { ...near, y: 0 }
  game.update(.05, fallen)
  assert.equal(game.snapshot.attack, null)
  assert.equal(game.drainEvents().find(event => event.type === 'attack_miss')?.data?.reason, 'cancelled')
  for (let defeat = 2; defeat <= 3; defeat++) {
    game.update(3.15, DEFAULT_CONFIG.spawn)
    game.update(.05, fallen)
  }
  assert.equal(game.snapshot.outcome, 'defeat')
  assert.equal(game.snapshot.bossHealth, 438)
  assert.equal(game.snapshot.bossForm, 'f1')
  assert.equal(game.snapshot.formHealth, 78)
  assert.equal(game.snapshot.maxFormHealth, 100)
  assert.equal(game.snapshot.health, 0)
})

test('the fifth impact empties the outgoing form until the transformation completes', () => {
  const game = practice('melee')
  for (let cut = 1; cut <= 5; cut++) {
    assert.ok(game.queueAttack())
    game.update(.35, near)
    assert.equal(game.snapshot.formHealth, Math.max(0, 100 - 22 * cut))
    assert.equal(game.snapshot.bossForm, 'f1')
    if (cut < 5) {
      game.update(7.25, far)
      game.update(.05, near)
    }
  }
  assert.equal(game.snapshot.phase, 'f2')
  assert.equal(game.snapshot.transition, 'pull_own_strings')
  assert.equal(game.snapshot.puppets.length, 1)
  assert.equal(game.snapshot.puppets[0].attackable, false)
  assert.equal(game.snapshot.forcedTransition, false)
  assert.equal(game.snapshot.bossHealth, 360)
  assert.equal(game.snapshot.bossDamageDealt, 100)
  assert.equal(game.snapshot.maxFormHealth, 100)
  assert.equal(game.drainEvents().filter(event => event.type === 'hit').at(-1)?.data?.damage, 12)
  assert.equal(game.queueAttack(), false)
  game.update(1.4, near)
  assert.equal(game.snapshot.bossForm, 'f1')
  assert.equal(game.snapshot.formHealth, 0)
  game.update(.10, near)
  assert.equal(game.snapshot.transition, '')
  assert.equal(game.snapshot.bossForm, 'f2')
  assert.equal(game.snapshot.formHealth, 110)
  assert.equal(game.snapshot.puppets[0].attackable, true)
  assert.equal(game.snapshot.hazards.length, 0)
})

test('clearing a form explicitly reports healing without changing boss damage', () => {
  const game = new Encounter({ ...LIVE_ENCOUNTER_CONFIG, healthPerPhase: [22, 110, 120, 130] })
  game.start('f1')
  game.update(1.7, near)
  assert.equal(game.snapshot.health, 4)
  game.update(5.6, far)
  assert.ok(game.snapshot.knotOpen)
  game.update(.01, near)
  assert.ok(game.queueAttack())
  game.update(.35, near)
  assert.equal(game.snapshot.health, 5)
  assert.equal(game.snapshot.formHealth, 0)
  assert.equal(game.snapshot.bossDamageDealt, 22)
  assert.deepEqual(game.drainEvents().find(event => event.type === 'hero_healed')?.data, {
    previousHealth: 4, health: 5, maxHealth: 5, amount: 1, reason: 'phase'
  })
})

test('the 4:25 rescue preserves Titiritera health for consecutive manual strikes', () => {
  const game = practice('melee')
  game.update(229.9, far)
  assert.equal(game.snapshot.forcedTransition, false)
  game.update(.10, near)
  assert.equal(game.snapshot.forcedTransition, true)
  assert.equal(game.snapshot.bossForm, 'f1')
  assert.equal(game.snapshot.formHealth, 100)
  game.update(35, near)
  assert.equal(game.snapshot.failsafe, true)
  assert.equal(game.snapshot.bossForm, 'f4')
  assert.equal(game.snapshot.formHealth, 130)
  game.toggleAutoAttack()
  for (let cut = 1; cut <= 6; cut++) {
    assert.equal(game.snapshot.knotOpen, true)
    assert.equal(game.resolveAutoAttack(), false)
    assert.ok(game.queueAttack())
    game.update(.35, near)
    assert.equal(game.snapshot.formHealth, Math.max(0, 130 - 22 * cut))
    assert.equal(game.snapshot.bossHealth, game.snapshot.formHealth)
  }
  assert.equal(game.snapshot.outcome, 'assisted_clear')
  assert.ok(game.snapshot.outcomeElapsed! < 280)
  assert.equal(game.snapshot.successfulCuts, 6)
  assert.equal(game.snapshot.bossDamageDealt, 130)
  game.update(30, near)
  assert.equal(game.snapshot.complete, true)
  assert.ok(game.snapshot.elapsed <= 295)
})

test('timeout during a late rescue strike preserves its uncut seals and ends at 4:55', () => {
  const game = practice('melee')
  game.update(265, far)
  for (let cut = 0; cut < 2; cut++) {
    assert.ok(game.queueAttack())
    game.update(.35, near)
  }
  game.update(279.9 - game.snapshot.elapsed, near)
  assert.equal(game.snapshot.formHealth, 86)
  assert.ok(game.queueAttack())
  game.update(30, near)
  assert.equal(game.snapshot.outcome, 'timeout')
  assert.equal(game.snapshot.bossForm, 'f4')
  assert.equal(game.snapshot.formHealth, 86)
  assert.equal(game.snapshot.bossHealth, 86)
  assert.equal(game.snapshot.attack, null)
  assert.equal(game.snapshot.elapsed, 295)
})
