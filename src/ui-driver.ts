import { isMobile } from '@dcl/sdk/platform'
import { engine, PointerLock } from '@dcl/sdk/ecs'
import { COMBAT_CLASSES } from './game/classes'
import type { CombatClassStats } from './game/classes'
import type { AttackTarget, ClassAbility, CombatClass, EncounterSnapshot, GameEvent } from './game/types'
import { state } from './ui/TheatreHud'
import type { SkillTone } from './ui/TheatreHud'
import { BOSS_FORM_NAMES, CLASS_NAMES, PUPPET_NAMES, STORY_CUES } from './story'
import type { RankView } from './ranking'

export type UiLanguage = 'en' | 'es'
export interface UiActions {
  restart: boolean
  ability: boolean
  power: boolean
  attack: boolean
  attackPuppet?: string
  language?: UiLanguage
  selectClass?: CombatClass
  autoAttack?: boolean
}

export interface UiCombatStatus {
  attackInReach: boolean
  attackDistance?: number
  powerInReach: boolean
  powerDistance?: number
  basicTarget?: string
  powerPuppet?: string
  puppetsInReach?: ReadonlySet<string>
  autoEnabled?: boolean
  autoInReach?: boolean
}

type Feedback = 'hit' | 'auto_hit' | 'damage' | 'healed' | 'blocked' | 'fall' | 'knockout' | 'closed' | 'range' | 'cooldown' | 'wait'
  | 'impact_blocked' | 'impact_closed' | 'impact_range' | 'impact_cancelled' | 'guarded' | 'busy' | 'already_bound' | 'no_target'
type FeedbackChannel = 'boss' | 'hero' | 'input' | 'basic' | 'power'
interface ImpactFeedback { value: Feedback; expiresAt: number; damage?: number; recovery?: number; target?: string }
interface SkillReadout { status: string; detail: string; tone: SkillTone }
let language: UiLanguage = 'en'
let feedback: Partial<Record<FeedbackChannel, ImpactFeedback>> = {}
let summonImpact: { id: string; expiresAt: number; damage?: number } | null = null
let lastElapsed = 0

const CUES: Record<UiLanguage, Record<string, string>> = STORY_CUES
const BOSS_ACTS = { f1: 'I', f2: 'II', f3: 'III', f4: 'IV' } as const

const CLASS_TRAITS: Record<UiLanguage, Record<CombatClass, string>> = {
  en: { melee: 'Marked cards', mage: 'Arcane spells', archer: 'Long-range bow' },
  es: { melee: 'Cartas marcadas', mage: 'Hechizos arcanos', archer: 'Arco de largo alcance' }
}

const ABILITY_NAMES: Record<UiLanguage, Record<ClassAbility, string>> = {
  en: { guard: 'WILD CARD', arcane_bind: 'ARCANE BIND', drawn_shot: 'DRAWN SHOT' },
  es: { guard: 'COMODÍN', arcane_bind: 'LAZO ARCANO', drawn_shot: 'TIRO TENSADO' }
}

const POWER_NAMES = {
  en: { shield_bash: 'MARKED HAND', arcane_burst: 'ARCANE BURST', piercing_arrow: 'PIERCING ARROW' },
  es: { shield_bash: 'MANO MARCADA', arcane_burst: 'DESCARGA ARCANA', piercing_arrow: 'FLECHA PERFORANTE' }
}

const FEEDBACK_LABELS: Record<UiLanguage, Record<Feedback, string>> = {
  en: { hit: 'Hit confirmed', auto_hit: 'Auto attack hit', damage: 'Damage', healed: 'New act', blocked: 'Hit absorbed', fall: 'You fell', knockout: 'Knocked out', closed: 'Wait for the knot to glow.',
    range: 'Move closer to your target.', cooldown: 'That power is recharging.', wait: 'Wait for combat to resume.',
    impact_blocked: 'An obstacle blocked the attack. Change your angle.', impact_closed: 'Knot closed. Strike during an opening.',
    impact_range: 'Your attack missed. Move closer.', impact_cancelled: 'Attack interrupted.', guarded: 'Defeat the summons shielding the boss.',
    busy: 'Wait for the current attack to land.', already_bound: 'Arcane Bind already extended this opening.',
    no_target: 'Aim at the glowing knot or a living puppet.' },
  es: { hit: 'Golpe confirmado', auto_hit: 'Impacto automático', damage: 'Daño', healed: 'Nuevo acto', blocked: 'Impacto absorbido', fall: 'Caíste', knockout: 'Noqueo', closed: 'Espera a que el nudo se ilumine.',
    range: 'Acércate al objetivo.', cooldown: 'Esa habilidad se está recargando.', wait: 'Espera a que vuelva el combate.',
    impact_blocked: 'Un obstáculo bloqueó el ataque. Cambia el ángulo.', impact_closed: 'Nudo cerrado. Ataca cuando se abra.',
    impact_range: 'El ataque no alcanzó su objetivo. Acércate.', impact_cancelled: 'Ataque interrumpido.', guarded: 'Derrota a las invocaciones que protegen a la jefa.',
    busy: 'Espera a que llegue el ataque actual.', already_bound: 'El lazo ya extendió esta apertura.',
    no_target: 'Apunta al nudo iluminado o a un títere vivo.' }
}

const MISS_FEEDBACK = {
  blocked: 'impact_blocked', closed: 'impact_closed', range: 'impact_range', cancelled: 'impact_cancelled', guarded: 'guarded', no_target: 'no_target'
} as const

const ATTACK_MISS_STATUS: Record<UiLanguage, Partial<Record<Feedback, string>>> = {
  en: { impact_blocked: 'BLOCKED', impact_range: 'MISSED', range: 'OUT OF REACH', impact_closed: 'KNOT CLOSED', closed: 'KNOT CLOSED',
    impact_cancelled: 'INTERRUPTED', guarded: 'SHIELDED', busy: 'WAIT', wait: 'WAIT', no_target: 'NO TARGET' },
  es: { impact_blocked: 'OBSTÁCULO', impact_range: 'FALLÓ', range: 'FUERA DE ALCANCE', impact_closed: 'NUDO CERRADO', closed: 'NUDO CERRADO',
    impact_cancelled: 'INTERRUMPIDO', guarded: 'PROTEGIDO', busy: 'ESPERA', wait: 'ESPERA', no_target: 'SIN OBJETIVO' }
}

function formatRange(metres: number): string {
  const value = String(metres)
  return `${language === 'es' ? value.replace('.', ',') : value} m`
}

function distanceDetail(distance: number | undefined, reach: number): string {
  const limit = `${language === 'es' ? 'Máx.' : 'Max'} ${formatRange(reach)}`
  if (distance === undefined || !Number.isFinite(distance)) return limit
  const precision = Math.abs(distance - reach) < .15 ? 100 : 10
  return `${formatRange(Math.round(distance * precision) / precision)} · ${limit}`
}

function classChoice(id: CombatClass): string {
  const spec: CombatClassStats = COMBAT_CLASSES[id]
  const es = language === 'es'
  const healthUnit = language === 'es' ? 'PV' : 'HP'
  const charged = spec.drawnShotDamage ? ` · F + ${es ? 'clic' : 'click'} ${spec.drawnShotDamage}` : ''
  return `${CLASS_TRAITS[language][id]} · ${spec.maxHealth} ${healthUnit} · ${formatRange(spec.knotReach)}\n${es ? 'Daño · Clic' : 'Damage · Click'} ${spec.basicDamage} · E ${spec.secondaryDamage}${charged}`
}

function classAttackHint(snapshot: EncounterSnapshot, mobile: boolean, inReach: boolean | undefined): string {
  const es = language === 'es'
  const reach = formatRange(snapshot.knotReach)
  if (snapshot.failsafe) return CUES[language].failsafe
  if (snapshot.selectedClass === 'melee') {
    if (inReach === false) return es ? `Acércate a ${reach} para lanzar una carta.` : `Get within ${reach} to throw a card.`
    return mobile ? (es ? 'Desde unos metros, toca Atacar al jefe o Mano marcada.' : 'From a few metres away, tap Attack Boss or Marked Hand.')
      : (es ? 'Desde unos metros, haz clic en el nudo o pulsa E.' : 'From a few metres away, click the knot or press E.')
  }
  if (snapshot.practiceOpening) {
    if (inReach === false) return es ? 'Acércate y prueba un ataque al nudo.' : 'Move closer and try an attack on the knot.'
    return mobile ? (es ? 'Toca Atacar al jefe o prueba una habilidad.' : 'Tap Attack Boss or try a power.')
      : (es ? 'Haz clic en el nudo o prueba E y F.' : 'Click the knot or try E and F.')
  }
  if (inReach === false) return es ? `Acércate a ${reach} del nudo.` : `Get within ${reach} of the knot.`
  return mobile ? (es ? 'Toca el nudo o Atacar al jefe.' : 'Tap the knot or Attack Boss.')
    : (es ? 'Apunta al nudo y haz clic para cortarlo.' : 'Aim at the knot and click to cut it.')
}

function abilityReadout(s: EncounterSnapshot, inReach?: boolean): SkillReadout {
  const es = language === 'es'
  const waiting = es ? 'ESPERA' : 'WAIT'
  if (!s.ability) return { status: '', detail: '', tone: 'waiting' }
  if (s.abilityActiveRemaining > 0) {
    const detail = s.ability === 'guard' ? (es ? 'Señuelo activo · 1 golpe' : 'Decoy active · 1 hit')
      : s.ability === 'arcane_bind' ? (es ? 'Apertura extendida' : 'Opening extended')
        : `${es ? 'Siguiente clic' : 'Next click'} · ${COMBAT_CLASSES.archer.drawnShotDamage} ${es ? 'PV' : 'HP'}`
    return { status: `${es ? 'ACTIVO' : 'ACTIVE'} · ${tenthsSeconds(s.abilityActiveRemaining)}`, detail, tone: 'active' }
  }
  if (s.abilityCooldownRemaining > 0) {
    return { status: `${es ? 'RECARGA' : 'COOLDOWN'} · ${countdownSeconds(s.abilityCooldownRemaining)} s`, detail: '', tone: 'cooldown' }
  }
  if (!s.abilityAvailable) {
    if (s.respawning || s.transition || s.failsafe || (s.phase === 'onboarding' && !s.practiceOpening)) {
      return { status: waiting, detail: s.failsafe ? (es ? 'Corta el nudo' : 'Cut the knot') : (es ? 'Al volver el combate' : 'When combat resumes'), tone: 'waiting' }
    }
    if (s.ability === 'arcane_bind') {
      if (s.bossGuardedBySummons) return { status: waiting, detail: es ? 'Derrota a los títeres' : 'Defeat the summons', tone: 'waiting' }
      if (!s.knotOpen) return { status: waiting, detail: es ? 'Hasta que se abra el nudo' : 'Until the knot opens', tone: 'waiting' }
      if (inReach === false) return { status: es ? 'ACÉRCATE' : 'MOVE CLOSER', detail: formatRange(s.knotReach), tone: 'waiting' }
      return { status: waiting, detail: es ? 'Próxima apertura' : 'Next opening', tone: 'waiting' }
    }
    return { status: waiting, detail: '', tone: 'waiting' }
  }
  const ready = es ? 'LISTO' : 'READY'
  const detail = s.ability === 'guard' ? (es ? 'Señuelo · bloquea 1 golpe' : 'Decoy · blocks 1 hit')
    : s.ability === 'arcane_bind' ? `${es ? 'Nudo abierto' : 'Open knot'} +${COMBAT_CLASSES.mage.effectSeconds} s`
      : `${es ? 'Siguiente clic' : 'Next click'} · ${COMBAT_CLASSES.archer.drawnShotDamage} ${es ? 'PV' : 'HP'}`
  const status = s.ability === 'drawn_shot' ? `${ready} · ${formatRange(COMBAT_CLASSES.archer.drawnShotReach)}` : ready
  return { status, detail, tone: 'ready' }
}

function countdownSeconds(seconds: number): number {
  return Math.max(1, Math.ceil(seconds - 1e-8))
}

function tenthsSeconds(seconds: number): string {
  const tenths = Math.max(1, Math.ceil(seconds * 10 - 1e-8))
  const result = (tenths / 10).toFixed(1)
  return `${language === 'es' ? result.replace('.', ',') : result} s`
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function getUiLanguage(): UiLanguage { return language }

export function consumeUiActions(): UiActions {
  const actions: UiActions = {
    restart: state.restartRequested, ability: state.abilityRequested,
    power: state.powerRequested, attack: state.attackRequested
  }
  if (state.selectClassRequested !== null) actions.selectClass = state.selectClassRequested
  if (state.puppetAttackRequested !== null) actions.attackPuppet = state.puppetAttackRequested
  if (state.autoAttackRequested !== null) actions.autoAttack = state.autoAttackRequested
  state.restartRequested = false
  state.abilityRequested = false
  state.powerRequested = false
  state.attackRequested = false
  state.selectClassRequested = null
  state.puppetAttackRequested = null
  state.autoAttackRequested = null
  if (state.languageRequested === 'en' || state.languageRequested === 'es') {
    language = state.languageRequested
    actions.language = language
    state.language = language
  }
  state.languageRequested = ''
  return actions
}

export function notifyUiEvent(event: GameEvent): void {
  let value: Feedback | undefined
  let channel: FeedbackChannel = 'hero'
  const eventDamage = event.data?.damage
  const input = event.data?.input
  const basicInput = input === 'aimed' || input === 'proximity'
  const powerInput = input === 'secondary'
  let damage = typeof eventDamage === 'number' && Number.isFinite(eventDamage) && eventDamage > 0 ? eventDamage : undefined
  let recovery: number | undefined
  switch (event.type) {
    case 'run_start':
    case 'start': feedback = {}; summonImpact = null; return
    case 'hit': channel = 'boss'; value = event.data?.input === 'auto' ? 'auto_hit' : 'hit'; break
    case 'puppet_hit':
    case 'puppet_defeated': {
      const id = event.data?.puppetId
      if (typeof id === 'string') summonImpact = { id, expiresAt: event.elapsed + 1.25, damage }
      const target = event.data?.kind
      if (basicInput || powerInput) {
        feedback[basicInput ? 'basic' : 'power'] = { value: 'hit', damage, target: typeof target === 'string' ? target : undefined, expiresAt: event.elapsed + 1.5 }
      }
      return
    }
    case 'damage': value = 'damage'; break
    case 'hero_healed': {
      const amount = event.data?.amount
      if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
        value = 'healed'
        recovery = amount
      }
      break
    }
    case 'guard_blocked': value = 'blocked'; break
    case 'death': {
      value = event.data?.source === 'fall' ? 'fall' : 'knockout'
      if (value === 'knockout' && feedback.hero?.value === 'damage' && feedback.hero.expiresAt > event.elapsed) damage = feedback.hero.damage
      break
    }
    case 'class_ability': delete feedback.input; return
    case 'attack_start': {
      delete feedback.input
      if (basicInput) delete feedback.basic
      if (powerInput) delete feedback.power
      return
    }
    case 'attack_miss': {
      channel = 'input'
      const reason = event.data?.reason
      if (reason === 'blocked' || reason === 'closed' || reason === 'range' || reason === 'cancelled' || reason === 'guarded' || reason === 'no_target') value = MISS_FEEDBACK[reason]
      break
    }
    case 'action_rejected': {
      channel = 'input'
      const reason = event.data?.reason
      if (reason === 'closed' || reason === 'range' || reason === 'cooldown' || reason === 'wait' || reason === 'guarded' || reason === 'busy' || reason === 'already_bound' || reason === 'no_target') value = reason
      break
    }
  }
  if (value) {
    const target = channel === 'boss' ? 'boss' : event.data?.targetKind
    const item = { value, damage: damage ?? (value === 'damage' ? 1 : undefined), recovery,
      target: typeof target === 'string' ? target : undefined, expiresAt: event.elapsed + (value === 'damage' ? 1 : 1.5) }
    feedback[channel] = item
    if (basicInput || (event.type === 'action_rejected' && event.data?.action === 'attack')) feedback.basic = item
    if (powerInput || (event.type === 'action_rejected' && event.data?.action === 'power' && value !== 'cooldown')) feedback.power = item
  }
}

function currentFeedback(channel: FeedbackChannel, elapsed: number): ImpactFeedback | undefined {
  const item = feedback[channel]
  return item && item.expiresAt > elapsed ? item : undefined
}

function damageText(damage: number): string {
  return `−${damage} ${language === 'es' ? 'PV' : 'HP'}`
}

function feedbackText(item: ImpactFeedback): string {
  const label = FEEDBACK_LABELS[language][item.value]
  if (item.recovery) return `+${item.recovery} ${language === 'es' ? 'PV' : 'HP'} · ${label}`
  return item.damage ? `${label} · ${damageText(item.damage)}` : label
}

function healthPercent(health: number, maxHealth: number): number {
  return 100 * Math.max(0, Math.min(1, health / Math.max(1, maxHealth)))
}

function updateBossUi(snapshot: EncounterSnapshot): void {
  const es = language === 'es'
  const { bossForm, phase, formHealth, maxFormHealth, elapsed } = snapshot
  const names = BOSS_FORM_NAMES[language]
  const form = names[bossForm]
  const incoming = phase === 'f2' || phase === 'f3' || phase === 'f4' ? names[phase] : ''
  const impact = currentFeedback('boss', elapsed)
  state.bossLabel = `${es ? 'ACTO' : 'ACT'} ${BOSS_ACTS[bossForm]} · ${form}`
  state.bossHealthLabel = es ? 'VIDA DEL JEFE POR ACTO' : 'BOSS HEALTH BY ACT'
  state.bossHealth = `${formHealth} / ${maxFormHealth} ${es ? 'PV' : 'HP'}`
  const percent = healthPercent(formHealth, maxFormHealth)
  state.bossHealthPercent = `${Math.round(percent)}%`
  state.bossFill = `${percent}%`
  state.bossChanging = !!snapshot.transition && !!incoming
  state.bossGuardedBySummons = snapshot.bossGuardedBySummons && !snapshot.outcome && !state.bossChanging
  state.bossExposed = snapshot.knotOpen && !snapshot.outcome && !state.bossChanging && !state.bossGuardedBySummons
  state.bossLostFill = `${!state.bossChanging && impact?.damage ? Math.min(100 - percent, healthPercent(impact.damage, maxFormHealth)) : 0}%`
  if (state.bossChanging) {
    delete feedback.boss
    state.bossStatus = snapshot.forcedTransition
      ? (es ? `Último acto → Entra ${incoming}` : `Final act → ${incoming} enters`)
      : (es ? `Cae ${form} → Entra ${incoming}` : `${form} down → ${incoming} enters`)
    state.bossFeedback = ''
    return
  }
  state.bossStatus = snapshot.outcome
    ? (phase === 'victory' ? (es ? 'FORMA VENCIDA' : 'FORM DEFEATED') : (es ? 'COMBATE TERMINADO' : 'FIGHT OVER'))
    : state.bossGuardedBySummons ? (es ? 'ESCUDO DE INVOCACIONES' : 'SHIELDED BY SUMMONS')
      : state.bossExposed ? (es ? 'NUDO EXPUESTO' : 'KNOT EXPOSED') : (es ? 'NUDO PROTEGIDO' : 'KNOT GUARDED')
  if (impact) state.bossFeedback = feedbackText(impact)
  else if (snapshot.attack?.targetKind === 'boss') {
    state.bossFeedback = elapsed < snapshot.attack.launchElapsed
      ? (es ? 'Preparando ataque…' : 'Preparing attack…')
      : (es ? 'Ataque en curso…' : 'Attack on its way…')
  } else state.bossFeedback = ''
}

function updateSummonUi(snapshot: EncounterSnapshot, mobile: boolean, combat?: UiCombatStatus): void {
  const es = language === 'es'
  state.summonTitle = es ? 'INVOCACIONES' : 'SUMMONS'
  state.summonHint = snapshot.respawning ? ''
    : mobile ? (es ? 'Toca para atacar' : 'Tap to attack') : (es ? 'Haz clic para atacar' : 'Click to attack')
  if (summonImpact && summonImpact.expiresAt <= snapshot.elapsed) summonImpact = null
  if (snapshot.outcome || snapshot.transition) {
    state.summons = []
    summonImpact = null
    return
  }
  state.summons = snapshot.puppets.filter(puppet => !puppet.fallen || summonImpact?.id === puppet.id).map(puppet => {
    const defeated = puppet.fallen || puppet.health <= 0
    const attackable = puppet.attackable && !defeated && !!snapshot.selectedClass && !snapshot.respawning
    const reachable = combat?.puppetsInReach?.has(puppet.id) !== false
    const aimed = attackable && combat?.basicTarget === puppet.id
    const impact = summonImpact?.id === puppet.id
    return {
      id: puppet.id, name: PUPPET_NAMES[language][puppet.kind], health: `${puppet.health} / ${puppet.maxHealth} ${es ? 'PV' : 'HP'}`,
      fill: `${healthPercent(puppet.health, puppet.maxHealth)}%`,
      attackable, ready: attackable && reachable && !snapshot.attack, impact, aimed,
      detail: impact && summonImpact?.damage ? damageText(summonImpact.damage) : defeated ? (es ? 'Derrotado' : 'Defeated')
        : aimed ? (es ? 'En la mira' : 'In your sights') : puppet.stunned ? (es ? 'Aturdido' : 'Stunned')
          : attackable && !reachable ? (es ? 'Acércate' : 'Move closer') : ''
    }
  })
}

export function updateUi(
  snapshot: EncounterSnapshot, debug: boolean, figuresRevealed: boolean, ranking: RankView,
  combat?: UiCombatStatus
): void {
  const es = language === 'es'
  const mobile = isMobile()
  if (lastElapsed > snapshot.elapsed) { feedback = {}; summonImpact = null }
  lastElapsed = snapshot.elapsed
  state.language = language
  state.mobile = mobile
  updateBossUi(snapshot)
  updateSummonUi(snapshot, mobile, combat)
  const heroFeedback = currentFeedback('hero', snapshot.elapsed)
  state.heroLabel = es ? 'TU VIDA' : 'YOUR HEALTH'
  state.heroStatus = `${es ? 'Caídas y noqueos' : 'Falls and knockouts'} · ${snapshot.defeats} / 3`
  state.heroFeedback = heroFeedback ? feedbackText(heroFeedback) : ''
  state.heroFeedbackIsDamage = heroFeedback?.value === 'damage' || heroFeedback?.value === 'fall' || heroFeedback?.value === 'knockout'
  state.healthText = `${Math.max(0, snapshot.health)} / ${snapshot.maxHealth} ${es ? 'PV' : 'HP'}`
  const heroPercent = healthPercent(snapshot.health, snapshot.maxHealth)
  state.heroHealthFill = `${heroPercent}%`
  state.heroLostHealth = `${heroFeedback?.damage ? Math.min(100 - heroPercent, healthPercent(heroFeedback.damage, snapshot.maxHealth)) : 0}%`
  state.knotTimerLabel = es ? 'TIEMPO PARA CORTAR' : 'TIME LEFT TO CUT'
  state.knotTime = state.bossExposed ? tenthsSeconds(snapshot.knotWindowRemaining) : ''
  state.knotTimeUrgent = snapshot.knotWindowRemaining <= 1
  const cue = snapshot.outcome ?? (snapshot.respawning ? 'respawning' : snapshot.failsafe ? 'failsafe' : snapshot.transition || (snapshot.knotOpen ? 'open' : snapshot.climax ? 'climax' : snapshot.cue))
  state.cue = CUES[language][cue] ?? CUES[language][snapshot.cue] ?? CUES[language].cut_knot
  if (state.bossExposed && !snapshot.respawning && snapshot.selectedClass) {
    state.cue = classAttackHint(snapshot, mobile, combat?.attackInReach)
  } else if (snapshot.phase === 'f4' && snapshot.tethered && !snapshot.respawning && !snapshot.transition) {
    state.cue = es ? 'Rodea la cruceta caída sin cruzar el centro.' : 'Circle the fallen controller. Stay outside its centre.'
  } else if (!state.bossGuardedBySummons && !snapshot.respawning && !snapshot.transition && (snapshot.phase === 'f2' || snapshot.phase === 'f3')) {
    state.cue = CUES[language].read_controller
  }
  state.encounterTitle = ''
  if (snapshot.classSelectionOpen && !snapshot.respawning) {
    state.encounterTitle = es ? 'ELIGE TU CLASE' : 'CHOOSE YOUR CLASS'
    if (!figuresRevealed) state.cue = CUES[language].choose_class
    else if (mobile) state.cue = es ? 'Elige abajo o toca una figura al acercarte.' : 'Choose below or approach and tap a figure.'
    else state.cue = es ? 'Elige abajo o acércate a una figura y pulsa E.' : 'Choose below or walk to a figure and press E.'
  } else if (snapshot.practiceOpening && !snapshot.outcome && !snapshot.respawning) {
    state.encounterTitle = es ? 'PRIMER GOLPE' : 'FIRST STRIKE'
    state.cue = CUES[language].first_hit
  } else if (snapshot.phase === 'f1' && snapshot.phaseElapsed < 2.5 && !snapshot.respawning) {
    state.encounterTitle = es ? 'COMBATE INICIADO' : 'COMBAT STARTED'
    if (!state.bossExposed) state.cue = CUES[language].fight_start
  }
  state.classChoicesVisible = snapshot.classSelectionOpen && !snapshot.respawning
  state.selectionCountdown = state.classChoicesVisible
    ? `${CLASS_NAMES[language].melee} ${es ? 'por defecto en' : 'selected in'} ${countdownSeconds(snapshot.classSelectionRemaining)} s`
    : ''
  state.meleeName = CLASS_NAMES[language].melee
  state.mageName = CLASS_NAMES[language].mage
  state.archerName = CLASS_NAMES[language].archer
  state.meleeChoice = classChoice('melee')
  state.mageChoice = classChoice('mage')
  state.archerChoice = classChoice('archer')
  state.classSelected = snapshot.selectedClass !== null
  state.className = snapshot.selectedClass ? CLASS_NAMES[language][snapshot.selectedClass].toUpperCase() : ''
  state.classRange = `${es ? 'Alcance' : 'Reach'} · ${formatRange(snapshot.knotReach)}`
  state.controlsVisible = snapshot.selectedClass !== null && !snapshot.outcome
  state.abilityVisible = state.controlsVisible && snapshot.ability !== null
  const abilityName = snapshot.ability === null ? '' : ABILITY_NAMES[language][snapshot.ability]
  state.abilityLabel = mobile ? abilityName : `F · ${abilityName}`
  const ability = abilityReadout(snapshot, combat?.attackInReach)
  state.abilityEnabled = ability.tone === 'ready'
  state.abilityStatus = ability.status
  state.abilityDetail = ability.detail
  state.abilityTone = ability.tone
  state.powerVisible = state.controlsVisible && snapshot.secondaryAbility !== null
  const name = snapshot.secondaryAbility ? POWER_NAMES[language][snapshot.secondaryAbility] : ''
  state.powerLabel = mobile ? name : `E · ${name}`
  const power = powerReadout(snapshot, combat)
  state.powerEnabled = power.tone === 'ready'
  state.powerStatus = power.status
  state.powerDetail = power.detail
  state.powerTone = power.tone
  state.attackEnabled = state.controlsVisible && !snapshot.respawning && !snapshot.attack && state.bossExposed && combat?.attackInReach !== false
  const attackLabel = es ? 'ATACAR AL JEFE' : 'ATTACK BOSS'
  state.attackLabel = mobile ? attackLabel : (es ? 'CLIC · ATAQUE BÁSICO' : 'CLICK · BASIC ATTACK')
  const basic = basicReadout(snapshot, combat)
  state.attackStatus = basic.status
  state.attackDetail = basic.detail
  state.attackTone = basic.tone
  state.autoEnabled = combat?.autoEnabled ?? snapshot.autoAttackEnabled
  state.autoLabel = es ? `AUTOATAQUE · ${state.autoEnabled ? 'SÍ' : 'NO'}` : `AUTO ATTACK · ${state.autoEnabled ? 'ON' : 'OFF'}`
  state.autoReady = state.autoEnabled && snapshot.successfulCuts > 0 && state.attackEnabled && !snapshot.failsafe && combat?.autoInReach === true
  const autoReach = snapshot.selectedClass ? formatRange(COMBAT_CLASSES[snapshot.selectedClass].autoAttackReach) : ''
  state.autoDetail = state.autoReady ? `${es ? 'Autoataque listo' : 'Auto attack ready'} · ${autoReach}`
    : state.autoEnabled && snapshot.successfulCuts === 0 ? (es ? 'Autoataque tras tu primer corte.' : 'Auto attack starts after your first cut.')
      : (es ? `Auto hasta ${autoReach}. Sus cortes cuentan como ayuda.` : `Auto within ${autoReach}. Auto cuts mark the run assisted.`)
  const pointerLock = !mobile ? PointerLock.getOrNull(engine.CameraEntity) : null
  state.cursorHint = ''
  if (!mobile && (state.classChoicesVisible || state.controlsVisible)) {
    if (pointerLock?.isPointerLocked) state.cursorHint = es ? 'Esc libera el cursor para los botones.' : 'Press Esc to use the buttons.'
    else if (state.controlsVisible) state.cursorHint = es ? 'Clic en la escena para usar E/F, o pulsa los botones.' : 'Click the scene to use E/F, or click the buttons.'
  }
  const inputFeedback = currentFeedback('input', snapshot.elapsed)
  state.feedback = inputFeedback && !snapshot.outcome && inputFeedback.value !== 'no_target' ? feedbackText(inputFeedback) : ''
  state.wrapVisible = snapshot.phase === 'f4' && !snapshot.failsafe && !snapshot.transition
  state.debugTop = (mobile ? 114 : 126) + 215 + (state.classChoicesVisible ? 198 : 0)
    + (state.controlsVisible ? 219 : 0) + (state.wrapVisible ? 45 : 0) + (state.knotTime ? 61 : 0) + (state.summons.length ? 99 : 0)
    + (state.encounterTitle ? 23 : 0)
  const progress = Math.max(0, Math.min(1, snapshot.wrapProgress))
  const wrapComplete = state.bossExposed && progress >= 1 - 1e-8
  state.wrapComplete = wrapComplete
  state.wrapLabel = wrapComplete ? (es ? 'Nudo expuesto, dispara ahora' : 'Knot exposed, shoot now')
    : snapshot.tethered ? (es ? 'ENREDA EL HILO' : 'WIND THE THREAD') : (es ? 'ESPERA EL HILO' : 'WAIT FOR THE THREAD')
  state.wrapText = `${wrapComplete ? 100 : Math.min(99, Math.round(progress * 100))}%`
  state.wrapWidth = `${wrapComplete ? 100 : progress * 100}%`
  state.debugVisible = debug
  state.debugText = `DEBUG ${formatTime(snapshot.elapsed)} / ${snapshot.phase}`
  state.complete = snapshot.complete
  state.finalSubtitle = es ? 'Fin de la función' : 'The performance is over'
  state.finalResult = snapshot.outcome === 'manual_clear' ? (es ? 'VICTORIA' : 'VICTORY')
    : snapshot.outcome === 'assisted_clear' ? (es ? 'VICTORIA ASISTIDA' : 'ASSISTED VICTORY')
      : snapshot.outcome === 'timeout' ? (es ? 'TIEMPO AGOTADO' : 'TIME RAN OUT')
        : es ? 'DERROTA' : 'DEFEAT'
  state.finalTimeLabel = snapshot.phase === 'victory' ? (es ? 'TIEMPO AL CORTE FINAL' : 'TIME TO FINAL CUT')
    : (es ? 'TIEMPO HASTA EL DESENLACE' : 'TIME TO OUTCOME')
  state.finalTime = snapshot.outcomeElapsed === null ? '—' : formatRankTime(snapshot.outcomeElapsed * 1000)
  state.finalTotal = `${es ? 'Duración con telón' : 'Total with curtain'} · ${formatTime(Math.round(snapshot.elapsed))}`
  state.finalDetail = CUES[language][snapshot.outcome ?? 'free']
  state.replayLabel = es ? 'REINTENTAR' : 'PLAY AGAIN'
  state.rankTitle = snapshot.selectedClass
    ? `${es ? 'CLASIFICACIÓN' : 'LEADERBOARD'} · ${CLASS_NAMES[language][snapshot.selectedClass].toUpperCase()}`
    : ''
  const rankStatus = {
    idle: '', loading: es ? 'Validando la partida…' : 'Validating run…',
    published: es ? 'Marca registrada.' : 'Score recorded.',
    unavailable: es ? 'Clasificación no disponible.' : 'Leaderboard unavailable.',
    unranked: es ? 'Partida fuera de clasificación.' : 'Unranked run.'
  }[ranking.status]
  const timing = []
  if (ranking.bestTimeMs) timing.push(`${es ? 'Récord personal' : 'Personal best'} ${formatRankTime(ranking.bestTimeMs)}`)
  const reading = ranking.tableUnavailable && ranking.status === 'published'
    ? (es ? 'La tabla no se pudo cargar.' : 'Could not load the table.') : ''
  state.rankStatus = [timing.join('  ·  '), [rankStatus, reading].filter(Boolean).join(' ')].filter(Boolean).join('\n')
  const rows = ranking.rows.map((row, index) => `${String(index + 1).padStart(2)}  ${row.alias}  ${formatRankTime(row.timeMs)}`)
  state.rankColumnOne = rows.slice(0, 5).join('\n')
  state.rankColumnTwo = rows.slice(5, 10).join('\n')
}

function attackTargetName(target: string | undefined): string {
  const es = language === 'es'
  if (target === 'boss') return es ? 'Nudo del jefe' : 'Boss knot'
  const names = PUPPET_NAMES[language]
  return target && Object.prototype.hasOwnProperty.call(names, target) ? names[target as Exclude<AttackTarget, 'boss'>] : ''
}

function basicReadout(snapshot: EncounterSnapshot, combat?: UiCombatStatus): SkillReadout {
  const es = language === 'es'
  const reach = distanceDetail(combat?.attackDistance, snapshot.knotReach)
  const waiting = es ? 'ESPERA' : 'WAIT'
  const attack = snapshot.attack
  if (attack?.kind === 'basic') {
    const preparing = snapshot.elapsed < attack.launchElapsed
    const status = preparing ? (es ? 'PREPARANDO' : 'WINDUP') : (es ? 'EN VUELO' : 'IN FLIGHT')
    const seconds = (preparing ? attack.launchElapsed : attack.impactElapsed) - snapshot.elapsed
    return { status: `${status} · ${tenthsSeconds(seconds)}`, detail: attackTargetName(attack.targetKind), tone: 'in_flight' }
  }
  if (snapshot.transition || snapshot.respawning) return { status: waiting, detail: es ? 'Al volver el combate' : 'When combat resumes', tone: 'waiting' }
  const result = currentFeedback('basic', snapshot.elapsed)
  if (result?.value === 'hit') {
    const status = es ? 'IMPACTO' : 'HIT'
    return { status: result.damage ? `${status} · ${damageText(result.damage)}` : status, detail: attackTargetName(result.target), tone: 'confirmed' }
  }
  const miss = result && ATTACK_MISS_STATUS[language][result.value]
  if (miss) {
    const missedTarget = result.target && result.target !== 'boss' ? attackTargetName(result.target) : reach
    const detail = result.value === 'no_target' ? (es ? 'Apunta al nudo o a un títere' : 'Aim at the knot or a puppet')
      : result.value === 'range' || result.value === 'impact_range' ? missedTarget
        : result.value === 'guarded' ? (es ? 'Ataca a las invocaciones' : 'Attack the summons') : ''
    return { status: miss, detail, tone: 'miss' }
  }
  if (attack) return { status: waiting, detail: es ? 'Otro ataque en curso' : 'Another attack in progress', tone: 'waiting' }
  const ready = es ? 'LISTO' : 'READY'
  const stats: CombatClassStats | undefined = snapshot.selectedClass ? COMBAT_CLASSES[snapshot.selectedClass] : undefined
  const damage = snapshot.ability === 'drawn_shot' && snapshot.abilityActiveRemaining > 0 ? stats?.drawnShotDamage : stats?.basicDamage
  const readyStatus = damage ? `${ready} · ${damage} ${es ? 'PV' : 'HP'}` : ready
  if (snapshot.bossGuardedBySummons) {
    const aimed = snapshot.puppets.find(puppet => puppet.id === combat?.basicTarget && puppet.attackable && !puppet.fallen)
    if (aimed) {
      const detail = attackTargetName(aimed.kind)
      if (combat?.puppetsInReach?.has(aimed.id) === false) {
        return { status: es ? 'FUERA DE ALCANCE' : 'OUT OF REACH', detail, tone: 'waiting' }
      }
      return { status: readyStatus, detail, tone: 'ready' }
    }
    return { status: es ? 'APUNTA A UN TÍTERE' : 'AIM AT A PUPPET', detail: es ? 'La jefa está protegida' : 'The boss is shielded', tone: 'waiting' }
  }
  if (!snapshot.knotOpen) return { status: es ? 'NUDO CERRADO' : 'KNOT CLOSED', detail: reach, tone: 'waiting' }
  if (combat?.attackInReach === false) return { status: es ? 'FUERA DE ALCANCE' : 'OUT OF REACH', detail: reach, tone: 'waiting' }
  return { status: readyStatus, detail: reach, tone: 'ready' }
}

function powerReadout(snapshot: EncounterSnapshot, combat?: UiCombatStatus): SkillReadout {
  const es = language === 'es'
  const attack = snapshot.attack
  const waiting = es ? 'ESPERA' : 'WAIT'
  if (!snapshot.secondaryAbility) return { status: '', detail: '', tone: 'waiting' }
  const reach = formatRange(snapshot.secondaryAbilityReach)
  const damage = snapshot.selectedClass ? `${es ? 'Daño' : 'Damage'} ${COMBAT_CLASSES[snapshot.selectedClass].secondaryDamage}` : ''
  if (attack?.kind === 'secondary') {
    const preparing = snapshot.elapsed < attack.launchElapsed
    const target = attackTargetName(attack.targetKind)
    const status = preparing ? (es ? 'PREPARANDO' : 'WINDUP') : (es ? 'EN VUELO' : 'IN FLIGHT')
    return { status: `${status} · ${tenthsSeconds((preparing ? attack.launchElapsed : attack.impactElapsed) - snapshot.elapsed)}`, detail: target, tone: 'in_flight' }
  }
  const result = currentFeedback('power', snapshot.elapsed)
  if (snapshot.secondaryAbilityCooldownRemaining > 0) {
    const detail = result?.value === 'hit' && result.damage
      ? `${damageText(result.damage)} · ${attackTargetName(result.target)}` : `${damage} · ${reach}`
    return { status: `${es ? 'RECARGA' : 'COOLDOWN'} · ${countdownSeconds(snapshot.secondaryAbilityCooldownRemaining)} s`, detail, tone: 'cooldown' }
  }
  if (attack) return { status: waiting, detail: es ? 'Otro ataque en curso' : 'Another attack in progress', tone: 'waiting' }
  if (snapshot.transition || snapshot.respawning) return { status: waiting, detail: es ? 'Al volver el combate' : 'When combat resumes', tone: 'waiting' }
  const miss = result && ATTACK_MISS_STATUS[language][result.value]
  if (miss) return { status: miss, detail: attackTargetName(result.target), tone: 'miss' }
  if (!snapshot.knotOpen && !snapshot.bossGuardedBySummons) {
    return { status: es ? 'NUDO CERRADO' : 'KNOT CLOSED', detail: es ? 'Hasta que se abra el nudo' : 'Until the knot opens', tone: 'waiting' }
  }
  if (combat?.powerInReach === false) return { status: es ? 'ACÉRCATE' : 'MOVE CLOSER', detail: distanceDetail(combat.powerDistance, snapshot.secondaryAbilityReach), tone: 'waiting' }
  if (!snapshot.secondaryAbilityAvailable) return { status: waiting, detail: '', tone: 'waiting' }
  const puppet = snapshot.puppets.find(item => item.id === combat?.powerPuppet && item.attackable)
  const label = puppet ? PUPPET_NAMES[language][puppet.kind]
    : snapshot.bossGuardedBySummons ? (es ? 'Invocaciones' : 'Summons') : (es ? 'Nudo' : 'Knot')
  return { status: `${es ? 'LISTO' : 'READY'} · ${reach}`, detail: `${label} · ${damage}`, tone: 'ready' }
}

function formatRankTime(ms: number): string {
  const whole = Math.round(ms)
  return `${formatTime(whole / 1000)}.${String(whole % 1000).padStart(3, '0')}`
}
