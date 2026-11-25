/** @jsx ReactEcs.createElement */
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import type { CombatClass } from '../game/types'
import { useInteraction } from './interaction'

export type SkillTone = 'ready' | 'waiting' | 'in_flight' | 'active' | 'cooldown' | 'confirmed' | 'miss'

const SKILL_STATUS_COLORS = {
  ready: { r: .63, g: .95, b: .76, a: 1 },
  waiting: { r: .95, g: .83, b: .68, a: 1 },
  in_flight: { r: 1, g: .77, b: .46, a: 1 },
  active: { r: .95, g: .78, b: 1, a: 1 },
  cooldown: { r: .85, g: .74, b: .95, a: 1 },
  confirmed: { r: .72, g: 1, b: .79, a: 1 },
  miss: { r: 1, g: .70, b: .47, a: 1 }
}

interface SummonStatus {
  id: string
  name: string
  health: string
  fill: `${number}%`
  detail: string
  attackable: boolean
  ready: boolean
  impact: boolean
  aimed: boolean
}

export interface State {
  language: string
  mobile: boolean
  languageRequested: string
  restartRequested: boolean
  abilityRequested: boolean
  powerRequested: boolean
  attackRequested: boolean
  puppetAttackRequested: string | null
  selectClassRequested: CombatClass | null
  autoAttackRequested: boolean | null
  classSelected: boolean
  className: string
  classRange: string
  classChoicesVisible: boolean
  selectionCountdown: string
  meleeName: string
  mageName: string
  archerName: string
  meleeChoice: string
  mageChoice: string
  archerChoice: string
  abilityVisible: boolean
  abilityEnabled: boolean
  abilityLabel: string
  abilityStatus: string
  abilityTone: SkillTone
  abilityDetail: string
  controlsVisible: boolean
  powerVisible: boolean
  powerEnabled: boolean
  powerLabel: string
  powerStatus: string
  powerTone: SkillTone
  powerDetail: string
  attackEnabled: boolean
  attackLabel: string
  attackStatus: string
  attackDetail: string
  attackTone: SkillTone
  autoEnabled: boolean
  autoLabel: string
  autoReady: boolean
  autoDetail: string
  cursorHint: string
  feedback: string
  bossLabel: string
  bossHealthLabel: string
  bossHealth: string
  bossHealthPercent: string
  bossFill: `${number}%`
  bossLostFill: `${number}%`
  bossStatus: string
  bossChanging: boolean
  bossExposed: boolean
  bossGuardedBySummons: boolean
  bossFeedback: string
  summonTitle: string
  summonHint: string
  summons: SummonStatus[]
  heroLabel: string
  heroStatus: string
  heroFeedback: string
  heroFeedbackIsDamage: boolean
  healthText: string
  heroHealthFill: `${number}%`
  heroLostHealth: `${number}%`
  knotTimerLabel: string
  knotTime: string
  knotTimeUrgent: boolean
  encounterTitle: string
  cue: string
  wrapLabel: string
  wrapText: string
  wrapWidth: `${number}%`
  wrapVisible: boolean
  wrapComplete: boolean
  debugVisible: boolean
  debugText: string
  debugTop: number
  complete: boolean
  finalSubtitle: string
  finalResult: string
  finalTime: string
  finalTimeLabel: string
  finalTotal: string
  finalDetail: string
  replayLabel: string
  rankTitle: string
  rankStatus: string
  rankColumnOne: string
  rankColumnTwo: string
}

export const state: State = {
  language: 'en', mobile: false, languageRequested: '', restartRequested: false,
  abilityRequested: false, powerRequested: false, attackRequested: false,
  puppetAttackRequested: null,
  selectClassRequested: null, autoAttackRequested: null,
  classSelected: false, className: '', classRange: '', classChoicesVisible: false, selectionCountdown: '',
  meleeName: 'Cardsharp', mageName: 'Mage', archerName: 'Archer',
  meleeChoice: '', mageChoice: '', archerChoice: '',
  abilityVisible: false, abilityEnabled: false, abilityLabel: '', abilityStatus: '', abilityTone: 'waiting', abilityDetail: '',
  controlsVisible: false, powerVisible: false, powerEnabled: false, powerLabel: '', powerStatus: '', powerTone: 'waiting', powerDetail: '',
  attackEnabled: false, attackLabel: 'CLICK · BASIC ATTACK', attackStatus: '', attackDetail: '', attackTone: 'waiting',
  autoEnabled: false, autoLabel: 'AUTO ATTACK · OFF', autoReady: false, autoDetail: '', cursorHint: '',
  feedback: '',
  bossLabel: 'ACT I · Rehearsal', bossHealthLabel: 'BOSS HEALTH BY ACT', bossHealth: '100 / 100 HP', bossHealthPercent: '100%',
  bossFill: '100%', bossLostFill: '0%', bossStatus: 'KNOT GUARDED',
  bossChanging: false, bossExposed: false, bossGuardedBySummons: false, bossFeedback: '',
  summonTitle: 'SUMMONS', summonHint: '', summons: [],
  heroLabel: 'YOUR HEALTH', heroStatus: 'Falls and knockouts · 0 / 3', heroFeedback: '', heroFeedbackIsDamage: false,
  healthText: '5 / 5 HP', heroHealthFill: '100%', heroLostHealth: '0%',
  knotTimerLabel: 'TIME LEFT TO CUT', knotTime: '', knotTimeUrgent: false,
  encounterTitle: '', cue: 'Cut the red knot when it hangs exposed.',
  wrapLabel: 'WIND THE THREAD', wrapText: '0%', wrapWidth: '0%', wrapVisible: false, wrapComplete: false,
  debugVisible: false, debugText: 'DEBUG 0:00', debugTop: 472, complete: false,
  finalSubtitle: 'Fin de la función', finalTime: '—', finalTimeLabel: 'TIME TO OUTCOME', finalTotal: '',
  finalDetail: 'A final cut. No strings left to pull.', replayLabel: 'PLAY AGAIN',
  finalResult: '', rankTitle: '', rankStatus: '', rankColumnOne: '', rankColumnTwo: ''
}

type UiAction = { state: State; props: Parameters<typeof TheatreHud>[0]; value?: unknown }

/** @ui-action */
function chooseEnglish({ state }: UiAction) { state.languageRequested = 'en' }
/** @ui-action */
function chooseSpanish({ state }: UiAction) { state.languageRequested = 'es' }
/** @ui-action */
function playAgain({ state }: UiAction) { state.restartRequested = true }
/** @ui-action */
function pressAbility({ state }: UiAction) { state.abilityRequested = true }
/** @ui-action */
function pressPower({ state }: UiAction) { state.powerRequested = true }
/** @ui-action */
function pressBasic({ state }: UiAction) {
  if (!state.bossGuardedBySummons) {
    state.attackRequested = true
    return
  }
  const aimed = state.summons.find(puppet => puppet.aimed && puppet.ready)
  if (aimed) state.puppetAttackRequested = aimed.id
}
/** @ui-action */
function attackPuppet({ state, value }: UiAction) {
  if (typeof value === 'string') state.puppetAttackRequested = value
}
/** @ui-action */
function chooseCardsharp({ state }: UiAction) { state.selectClassRequested = 'melee' }
/** @ui-action */
function chooseMage({ state }: UiAction) { state.selectClassRequested = 'mage' }
/** @ui-action */
function chooseArcher({ state }: UiAction) { state.selectClassRequested = 'archer' }
/** @ui-action */
function toggleAutoAttack({ state }: UiAction) { state.autoAttackRequested = !state.autoEnabled }

function useRoleButton() {
  return useInteraction({
    base: { uiTransform: { width: '100%', height: 58, margin: { top: 4 }, justifyContent: 'center', padding: { left: 12, right: 8 }, borderWidth: 1, borderColor: { r: .33, g: .23, b: .18, a: 1 } }, uiBackground: { color: { r: .14, g: .085, b: .075, a: 1 } } },
    hover: { uiBackground: { color: { r: .29, g: .15, b: .12, a: 1 } } },
    press: { uiBackground: { color: { r: .38, g: .14, b: .17, a: 1 } } }
  })
}

export function TheatreHud(props: {}) {
  const englishButton = useInteraction({
    base: { uiTransform: { width: 54, height: 48, alignItems: 'center', justifyContent: 'center' }, uiBackground: { color: { r: 0.12, g: 0.1, b: 0.09, a: 1 } } },
    active: { uiBackground: { color: { r: 0.4, g: 0.1, b: 0.15, a: 1 } } },
    hover: { uiBackground: { color: { r: 0.49, g: 0.15, b: 0.2, a: 1 } } },
    press: { uiBackground: { color: { r: 0.27, g: 0.06, b: 0.1, a: 1 } } }
  }, state.language === 'en')
  const spanishButton = useInteraction({
    base: { uiTransform: { width: 54, height: 48, margin: { left: 4 }, alignItems: 'center', justifyContent: 'center' }, uiBackground: { color: { r: 0.12, g: 0.1, b: 0.09, a: 1 } } },
    active: { uiBackground: { color: { r: 0.4, g: 0.1, b: 0.15, a: 1 } } },
    hover: { uiBackground: { color: { r: 0.49, g: 0.15, b: 0.2, a: 1 } } },
    press: { uiBackground: { color: { r: 0.27, g: 0.06, b: 0.1, a: 1 } } }
  }, state.language === 'es')
  const chosenClass = useInteraction({
    base: { uiTransform: { width: '100%', height: 28, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' } },
    active: { uiTransform: { display: 'none' } }
  }, state.classSelected !== true)
  const choices = useInteraction({
    base: { uiTransform: { width: '100%', flexDirection: 'column', pointerFilter: 'none' } },
    active: { uiTransform: { display: 'none' } }
  }, state.classChoicesVisible !== true)
  const cardsharpButton = useRoleButton()
  const mageButton = useRoleButton()
  const archerButton = useRoleButton()
  const ability = useInteraction({
    base: { uiTransform: { width: '100%', height: 43, flexDirection: 'row', alignItems: 'center', margin: { top: 5 }, pointerFilter: 'none' } },
    active: { uiTransform: { display: 'none' } }
  }, state.abilityVisible !== true)
  const abilityButton = useInteraction({
    base: { onMouseDown: () => pressAbility({ state, props }), uiTransform: { width: '100%', height: 43, flexDirection: 'row', alignItems: 'center', padding: { left: 9, right: 9 }, pointerFilter: 'block', borderWidth: 1, borderColor: { r: .49, g: .29, b: .43, a: 1 } }, uiBackground: { color: { r: .27, g: .135, b: .275, a: 1 } } },
    active: { uiBackground: { color: { r: .16, g: .10, b: .16, a: 1 } } },
    hover: { uiBackground: { color: { r: .35, g: .17, b: .35, a: 1 } } },
    press: { uiBackground: { color: { r: .20, g: .09, b: .24, a: 1 } } }
  }, !state.abilityEnabled && state.abilityTone !== 'active')
  const powerButton = useInteraction({
    base: { onMouseDown: () => pressPower({ state, props }), uiTransform: { width: '100%', height: 43, flexDirection: 'row', alignItems: 'center', padding: { left: 9, right: 9 }, pointerFilter: 'block', borderWidth: 1, borderColor: { r: .60, g: .36, b: .29, a: 1 } }, uiBackground: { color: { r: .37, g: .16, b: .12, a: 1 } } },
    active: { uiBackground: { color: { r: .19, g: .115, b: .10, a: 1 } } },
    hover: { uiBackground: { color: { r: .48, g: .24, b: .16, a: 1 } } },
    press: { uiBackground: { color: { r: .24, g: .10, b: .09, a: 1 } } }
  }, !state.powerEnabled && state.powerTone !== 'in_flight')
  const attackButton = useInteraction({
    base: { onMouseDown: () => pressBasic({ state, props }), uiTransform: { width: '100%', height: 47, flexDirection: 'row', alignItems: 'center', padding: { left: 9, right: 9 }, pointerFilter: 'block', borderWidth: 1, borderColor: { r: .85, g: .48, b: .42, a: 1 } }, uiBackground: { color: { r: .57, g: .095, b: .16, a: 1 } } },
    active: { uiBackground: { color: { r: .23, g: .115, b: .126, a: 1 } } },
    hover: { uiBackground: { color: { r: .60, g: .17, b: .21, a: 1 } } },
    press: { uiBackground: { color: { r: .40, g: .08, b: .14, a: 1 } } }
  }, !state.attackEnabled && state.attackTone !== 'ready' && state.attackTone !== 'in_flight' && state.attackTone !== 'confirmed')
  const autoButton = useInteraction({
    base: { uiTransform: { width: '49%', height: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: { r: .37, g: .29, b: .24, a: 1 } }, uiBackground: { color: { r: .14, g: .095, b: .085, a: 1 } } },
    active: { uiBackground: { color: state.autoReady ? { r: .24, g: .42, b: .27, a: 1 } : { r: .20, g: .25, b: .19, a: 1 } } },
    hover: { uiBackground: { color: { r: .26, g: .22, b: .18, a: 1 } } },
    press: { uiBackground: { color: { r: .13, g: .21, b: .16, a: 1 } } }
  }, state.autoEnabled)
  const winding = useInteraction({
    base: { uiTransform: { width: '100%', height: 40, flexDirection: 'column', margin: { top: 8 }, pointerFilter: 'none' } },
    active: { uiTransform: { display: 'none' } }
  }, state.wrapVisible !== true)
  const debugPanel = useInteraction({
    base: { uiTransform: { width: 220, height: 28, positionType: 'absolute', position: { right: 40, top: state.debugTop } }, uiBackground: { color: { r: 0.08, g: 0.06, b: 0.05, a: 0.95 } } },
    active: { uiTransform: { display: 'none' } }
  }, state.debugVisible !== true)
  const ending = useInteraction({
    base: { uiTransform: { width: '92%', maxWidth: 580, height: state.rankColumnOne ? 543 : 434, alignItems: 'center', flexDirection: 'column', padding: { top: 18, left: 18, right: 18, bottom: 18 }, borderWidth: 1, borderColor: { r: 0.65, g: 0.47, b: 0.27, a: 1 } }, uiBackground: { color: { r: 0.075, g: 0.045, b: 0.04, a: 0.98 } } },
    active: { uiTransform: { display: 'none' } }
  }, state.complete !== true)
  const replay = useInteraction({
    base: { uiTransform: { width: 264, height: 56, justifyContent: 'center', alignItems: 'center', margin: { top: 20 }, borderWidth: 1, borderColor: { r: 0.78, g: 0.42, b: 0.38, a: 1 } }, uiBackground: { color: { r: 0.46, g: 0.08, b: 0.15, a: 1 } } },
    hover: { uiBackground: { color: { r: 0.61, g: 0.11, b: 0.2, a: 1 } } },
    press: { uiBackground: { color: { r: 0.3, g: 0.04, b: 0.09, a: 1 } } }
  })
  const bossAccent = state.bossChanging || state.bossGuardedBySummons ? { r: 1, g: .82, b: .51, a: 1 }
    : state.bossExposed ? { r: 1, g: .69, b: .68, a: 1 } : { r: .79, g: .66, b: .61, a: 1 }

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ display: state.complete ? 'none' : 'flex', width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', positionType: 'absolute', position: { top: state.mobile ? 10 : 21, left: 0 }, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ width: state.mobile ? '90%' : '49%', maxWidth: 560, padding: { top: 7, left: 14, right: 14, bottom: 6 }, flexDirection: 'column', borderWidth: 1, borderColor: state.bossChanging || state.bossExposed || state.bossGuardedBySummons ? bossAccent : { r: .58, g: .29, b: .31, a: 1 }, pointerFilter: 'none' }} uiBackground={{ color: { r: .075, g: .035, b: .047, a: .95 } }}>
          <UiEntity uiTransform={{ width: '100%', height: 46, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' }}>
            <UiEntity uiTransform={{ width: '60%', height: 46, flexDirection: 'column', pointerFilter: 'none' }}>
              <Label value={state.bossHealthLabel} fontSize={state.mobile ? 11 : 13} textAlign="middle-left" textWrap="nowrap" color={{ r: 1, g: .57, b: .58, a: 1 }} uiTransform={{ width: '100%', height: 18, pointerFilter: 'none' }} />
              <Label value={state.bossLabel} font="serif" fontSize={state.mobile ? 17 : 21} textAlign="middle-left" textWrap="nowrap" color={{ r: 1, g: .85, b: .77, a: 1 }} uiTransform={{ width: '100%', height: 28, pointerFilter: 'none' }} />
            </UiEntity>
            <UiEntity uiTransform={{ width: '40%', height: 46, flexDirection: 'column', pointerFilter: 'none' }}>
              <Label value={state.bossHealthPercent} font="monospace" fontSize={26} textAlign="middle-right" textWrap="nowrap" color={{ r: 1, g: .91, b: .85, a: 1 }} uiTransform={{ width: '100%', height: 28, pointerFilter: 'none' }} />
              <Label value={state.bossHealth} font="monospace" fontSize={13} textAlign="middle-right" textWrap="nowrap" color={{ r: .94, g: .77, b: .71, a: 1 }} uiTransform={{ width: '100%', height: 18, pointerFilter: 'none' }} />
            </UiEntity>
          </UiEntity>
          <UiEntity uiTransform={{ width: '100%', height: 11, flexDirection: 'row', margin: { top: 3 }, pointerFilter: 'none' }} uiBackground={{ color: { r: .27, g: .14, b: .16, a: 1 } }}>
            <UiEntity uiTransform={{ width: state.bossFill, height: 11, pointerFilter: 'none' }} uiBackground={{ color: { r: .82, g: .20, b: .31, a: 1 } }} />
            <UiEntity uiTransform={{ width: state.bossLostFill, height: 11, pointerFilter: 'none' }} uiBackground={{ color: { r: 1, g: .57, b: .34, a: 1 } }} />
          </UiEntity>
          <UiEntity uiTransform={{ width: '100%', height: 23, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Label value={state.bossStatus} fontSize={state.bossChanging ? 15 : 13} textAlign="middle-left" textWrap="nowrap" color={bossAccent} uiTransform={{ width: state.bossChanging || state.bossGuardedBySummons ? '100%' : '50%', height: 23 }} />
            <Label value={state.bossFeedback} fontSize={state.mobile ? 11 : 13} textAlign="middle-right" textWrap="wrap" color={{ r: 1, g: .72, b: .61, a: 1 }} uiTransform={{ width: '50%', height: 23, display: state.bossChanging || state.bossGuardedBySummons ? 'none' : 'flex' }} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
      <UiEntity uiTransform={{ display: state.complete ? 'none' : 'flex', width: state.mobile ? '90%' : 392, maxWidth: 392, positionType: 'absolute', position: { top: state.mobile ? 114 : 126, right: state.mobile ? '5%' : 36 }, flexDirection: 'column', padding: { top: 14, left: 18, right: 18, bottom: 14 }, borderWidth: 1, borderColor: { r: 0.42, g: 0.3, b: 0.2, a: 0.85 }, pointerFilter: 'none' }} uiBackground={{ color: { r: 0.055, g: 0.04, b: 0.035, a: 0.95 } }}>
        <UiEntity uiTransform={{ width: '100%', height: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Label value="MASTER OF PUPPETS" font="serif" fontSize={state.mobile ? 16 : 21} textWrap="wrap" textAlign="middle-left" color={{ r: 0.93, g: 0.85, b: 0.69, a: 1 }} uiTransform={{ width: 0, flexGrow: 1, height: 48 }} />
          <UiEntity uiTransform={{ width: 112, height: 48, flexDirection: 'row' }}>
            <UiEntity {...englishButton} onMouseDown={() => chooseEnglish({ state, props })}><Label value="EN" fontSize={16} textWrap="nowrap" color={{ r: 0.96, g: 0.89, b: 0.77, a: 1 }} uiTransform={{ width: 54, height: 48 }} /></UiEntity>
            <UiEntity {...spanishButton} onMouseDown={() => chooseSpanish({ state, props })}><Label value="ES" fontSize={16} textWrap="nowrap" color={{ r: 0.96, g: 0.89, b: 0.77, a: 1 }} uiTransform={{ width: 54, height: 48 }} /></UiEntity>
          </UiEntity>
        </UiEntity>
        <UiEntity {...chosenClass}>
          <Label value={state.className} fontSize={15} textWrap="nowrap" textAlign="middle-left" color={{ r: 0.94, g: 0.7, b: 0.42, a: 1 }} uiTransform={{ width: '44%', height: 28 }} />
          <Label value={state.classRange} fontSize={14} textWrap="nowrap" textAlign="middle-right" color={{ r: 0.8, g: 0.71, b: 0.59, a: 1 }} uiTransform={{ width: '56%', height: 28 }} />
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: 3, bottom: 6 }, padding: { left: 8, right: 8 }, borderWidth: 1, borderColor: { r: .24, g: .48, b: .41, a: 1 }, pointerFilter: 'none' }} uiBackground={{ color: { r: .06, g: .13, b: .115, a: 1 } }}>
          <UiEntity uiTransform={{ width: '100%', height: 29, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' }}>
            <Label value={state.heroLabel} fontSize={17} textWrap="nowrap" textAlign="middle-left" color={{ r: .62, g: .91, b: .80, a: 1 }} uiTransform={{ width: '53%', height: 29, pointerFilter: 'none' }} />
            <Label value={state.healthText} font="monospace" fontSize={19} textWrap="nowrap" textAlign="middle-right" color={{ r: .87, g: .97, b: .92, a: 1 }} uiTransform={{ width: '47%', height: 29, pointerFilter: 'none' }} />
          </UiEntity>
          <UiEntity uiTransform={{ width: '100%', height: 9, flexDirection: 'row', pointerFilter: 'none' }} uiBackground={{ color: { r: .13, g: .24, b: .21, a: 1 } }}>
            <UiEntity uiTransform={{ width: state.heroHealthFill, height: 9, pointerFilter: 'none' }} uiBackground={{ color: { r: .36, g: .79, b: .69, a: 1 } }} />
            <UiEntity uiTransform={{ width: state.heroLostHealth, height: 9, pointerFilter: 'none' }} uiBackground={{ color: { r: 1, g: .55, b: .37, a: 1 } }} />
          </UiEntity>
          <UiEntity uiTransform={{ width: '100%', height: 23, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' }}>
            <Label value={state.heroStatus} fontSize={11} textWrap="nowrap" textAlign="middle-left" color={{ r: .79, g: .82, b: .74, a: 1 }} uiTransform={{ width: '57%', height: 23, pointerFilter: 'none' }} />
            <Label value={state.heroFeedback} fontSize={12} textWrap="nowrap" textAlign="middle-right" color={state.heroFeedbackIsDamage ? { r: 1, g: .70, b: .52, a: 1 } : { r: .66, g: .94, b: .79, a: 1 }} uiTransform={{ width: '43%', height: 23, pointerFilter: 'none' }} />
          </UiEntity>
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: 61, display: state.knotTime ? 'flex' : 'none', flexDirection: 'row', alignItems: 'center', padding: { left: 10, right: 10 }, borderWidth: 1, borderColor: { r: .72, g: .33, b: .35, a: 1 }, pointerFilter: 'none' }} uiBackground={{ color: state.knotTimeUrgent ? { r: .36, g: .07, b: .11, a: 1 } : { r: .25, g: .087, b: .11, a: 1 } }}>
          <Label value={state.knotTimerLabel} fontSize={15} textAlign="middle-left" textWrap="nowrap" color={{ r: 1, g: .72, b: .67, a: 1 }} uiTransform={{ width: '62%', height: 50 }} />
          <Label value={state.knotTime} font="monospace" fontSize={30} textAlign="middle-right" textWrap="nowrap" color={{ r: 1, g: .94, b: .82, a: 1 }} uiTransform={{ width: '38%', height: 52 }} />
        </UiEntity>
        <Label value={state.encounterTitle} fontSize={16} textWrap="nowrap" textAlign="middle-left" color={{ r: 1, g: .77, b: .47, a: 1 }} uiTransform={{ width: '100%', height: 23, display: state.encounterTitle ? 'flex' : 'none', margin: { top: 5 }, pointerFilter: 'none' }} />
        <Label value={state.cue} fontSize={18} textWrap="wrap" textAlign="top-left" color={{ r: 0.95, g: 0.87, b: 0.72, a: 1 }} uiTransform={{ width: '100%', height: 47, margin: { top: state.encounterTitle ? 2 : 6 }, pointerFilter: 'none' }} />
        <UiEntity {...winding}>
          <UiEntity uiTransform={{ width: '100%', height: 20, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Label value={state.wrapLabel} fontSize={state.mobile ? 12 : 14} textWrap="nowrap" textAlign="middle-left" color={state.wrapComplete ? SKILL_STATUS_COLORS.ready : SKILL_STATUS_COLORS.waiting} uiTransform={{ width: '78%', height: 20 }} />
            <Label value={state.wrapText} fontSize={14} textWrap="nowrap" textAlign="middle-right" color={state.wrapComplete ? SKILL_STATUS_COLORS.ready : SKILL_STATUS_COLORS.waiting} uiTransform={{ width: '22%', height: 20 }} />
          </UiEntity>
          <UiEntity uiTransform={{ width: '100%', height: 5, margin: { top: 7 } }} uiBackground={{ color: { r: 0.2, g: 0.12, b: 0.1, a: 1 } }}>
            <UiEntity uiTransform={{ width: state.wrapWidth, height: 5 }} uiBackground={{ color: state.wrapComplete ? SKILL_STATUS_COLORS.ready : { r: 0.87, g: 0.18, b: 0.27, a: 1 } }} />
          </UiEntity>
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', display: state.summons.length ? 'flex' : 'none', flexDirection: 'column', margin: { bottom: 10 }, pointerFilter: 'none' }}>
          <UiEntity uiTransform={{ width: '100%', height: 24, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' }}>
            <Label value={state.summonTitle} fontSize={14} textWrap="nowrap" textAlign="middle-left" color={{ r: 1, g: .80, b: .49, a: 1 }} uiTransform={{ width: '50%', height: 24, pointerFilter: 'none' }} />
            <Label value={state.summonHint} fontSize={12} textWrap="nowrap" textAlign="middle-right" color={{ r: .91, g: .79, b: .62, a: 1 }} uiTransform={{ width: '50%', height: 24, pointerFilter: 'none' }} />
          </UiEntity>
          <UiEntity uiTransform={{ width: '100%', height: 65, flexDirection: 'row', pointerFilter: 'none' }}>
            {state.summons.map((puppet, index) => (
              <UiEntity key={puppet.id} onMouseDown={puppet.attackable ? () => attackPuppet({ state, props, value: puppet.id }) : undefined}
                uiTransform={{ width: 0, flexGrow: 1, height: 65, flexDirection: 'column', alignItems: 'center', borderWidth: 1,
                  borderColor: puppet.aimed ? { r: 1, g: .81, b: .49, a: 1 }
                    : puppet.ready ? { r: .76, g: .55, b: .27, a: 1 } : { r: .37, g: .29, b: .22, a: 1 },
                  margin: { right: index + 1 < state.summons.length ? 4 : 0 }, pointerFilter: puppet.attackable ? 'block' : 'none' }}
                uiBackground={{ color: puppet.impact ? { r: .41, g: .23, b: .11, a: 1 }
                  : puppet.ready ? { r: .23, g: .15, b: .09, a: 1 } : { r: .13, g: .10, b: .08, a: 1 } }}>
                <Label value={puppet.name} fontSize={13} textWrap="nowrap" color={{ r: 1, g: .87, b: .64, a: 1 }} uiTransform={{ width: '100%', height: 20, pointerFilter: 'none' }} />
                <Label value={puppet.health} font="monospace" fontSize={13} textWrap="nowrap" color={{ r: 1, g: .94, b: .79, a: 1 }} uiTransform={{ width: '100%', height: 18, pointerFilter: 'none' }} />
                <UiEntity uiTransform={{ width: '82%', height: 5, pointerFilter: 'none' }} uiBackground={{ color: { r: .24, g: .17, b: .12, a: 1 } }}>
                  <UiEntity uiTransform={{ width: puppet.fill, height: 5, pointerFilter: 'none' }} uiBackground={{ color: { r: .92, g: .64, b: .28, a: 1 } }} />
                </UiEntity>
                <Label value={puppet.detail} fontSize={11} textWrap="nowrap" color={{ r: .94, g: .77, b: .59, a: 1 }} uiTransform={{ width: '100%', height: 19, pointerFilter: 'none' }} />
              </UiEntity>
            ))}
          </UiEntity>
        </UiEntity>
        <UiEntity {...choices}>
          <UiEntity {...cardsharpButton} onMouseDown={() => chooseCardsharp({ state, props })}>
            <Label value={state.meleeName} fontSize={17} textAlign="middle-left" color={{ r: .96, g: .77, b: .49, a: 1 }} uiTransform={{ width: '100%', height: 22, pointerFilter: 'none' }} />
            <Label value={state.meleeChoice} fontSize={12} textWrap="wrap" textAlign="middle-left" color={{ r: .89, g: .81, b: .69, a: 1 }} uiTransform={{ width: '100%', height: 33, pointerFilter: 'none' }} />
          </UiEntity>
          <UiEntity {...mageButton} onMouseDown={() => chooseMage({ state, props })}>
            <Label value={state.mageName} fontSize={17} textAlign="middle-left" color={{ r: .59, g: .91, b: .84, a: 1 }} uiTransform={{ width: '100%', height: 22, pointerFilter: 'none' }} />
            <Label value={state.mageChoice} fontSize={12} textWrap="wrap" textAlign="middle-left" color={{ r: .89, g: .81, b: .69, a: 1 }} uiTransform={{ width: '100%', height: 33, pointerFilter: 'none' }} />
          </UiEntity>
          <UiEntity {...archerButton} onMouseDown={() => chooseArcher({ state, props })}>
            <Label value={state.archerName} fontSize={17} textAlign="middle-left" color={{ r: .86, g: .78, b: 1, a: 1 }} uiTransform={{ width: '100%', height: 22, pointerFilter: 'none' }} />
            <Label value={state.archerChoice} fontSize={12} textWrap="wrap" textAlign="middle-left" color={{ r: .89, g: .81, b: .69, a: 1 }} uiTransform={{ width: '100%', height: 33, pointerFilter: 'none' }} />
          </UiEntity>
          <Label value={state.selectionCountdown} fontSize={13} textAlign="middle-left" color={{ r: .82, g: .72, b: .62, a: 1 }} uiTransform={{ width: '100%', height: 24, margin: { top: 5 } }} />
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: 47, display: state.controlsVisible ? 'flex' : 'none', pointerFilter: 'none' }}>
          <UiEntity {...attackButton}>
            <Label value={state.attackLabel} fontSize={13} textAlign="middle-left" textWrap="wrap" color={{ r: 1, g: .92, b: .85, a: 1 }} uiTransform={{ width: '46%', height: 43, pointerFilter: 'none' }} />
            <UiEntity uiTransform={{ width: '54%', height: 43, flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
              <Label value={state.attackStatus} fontSize={state.mobile ? 11 : 13} textAlign="middle-right" textWrap="nowrap" color={SKILL_STATUS_COLORS[state.attackTone]} uiTransform={{ width: '100%', height: 19, pointerFilter: 'none' }} />
              <Label value={state.attackDetail} fontSize={11} textWrap="wrap" textAlign="middle-right" color={{ r: .96, g: .87, b: .75, a: 1 }} uiTransform={{ width: '100%', height: 22, display: state.attackDetail ? 'flex' : 'none', pointerFilter: 'none' }} />
            </UiEntity>
          </UiEntity>
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: 43, display: state.powerVisible ? 'flex' : 'none', flexDirection: 'row', alignItems: 'center', margin: { top: 5 }, pointerFilter: 'none' }}>
          <UiEntity {...powerButton}>
            <Label value={state.powerLabel} fontSize={13} textAlign="middle-left" textWrap="wrap" color={{ r: 1, g: .88, b: .78, a: 1 }} uiTransform={{ width: '46%', height: 41, pointerFilter: 'none' }} />
            <UiEntity uiTransform={{ width: '54%', height: 41, flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
              <Label value={state.powerStatus} fontSize={state.mobile ? 11 : 13} textAlign="middle-right" textWrap="nowrap" color={SKILL_STATUS_COLORS[state.powerTone]} uiTransform={{ width: '100%', height: 18, pointerFilter: 'none' }} />
              <Label value={state.powerDetail} fontSize={11} textWrap="wrap" textAlign="middle-right" color={{ r: .92, g: .82, b: .70, a: 1 }} uiTransform={{ width: '100%', height: 20, display: state.powerDetail ? 'flex' : 'none', pointerFilter: 'none' }} />
            </UiEntity>
          </UiEntity>
        </UiEntity>
        <UiEntity {...ability}>
          <UiEntity {...abilityButton}>
            <Label value={state.abilityLabel} fontSize={13} textAlign="middle-left" textWrap="wrap" color={{ r: .97, g: .87, b: 1, a: 1 }} uiTransform={{ width: '46%', height: 41, pointerFilter: 'none' }} />
            <UiEntity uiTransform={{ width: '54%', height: 41, flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
              <Label value={state.abilityStatus} fontSize={state.mobile ? 11 : 13} textAlign="middle-right" textWrap="nowrap" color={SKILL_STATUS_COLORS[state.abilityTone]} uiTransform={{ width: '100%', height: 18, pointerFilter: 'none' }} />
              <Label value={state.abilityDetail} fontSize={11} textWrap="wrap" textAlign="middle-right" color={{ r: .92, g: .82, b: .70, a: 1 }} uiTransform={{ width: '100%', height: 20, display: state.abilityDetail ? 'flex' : 'none', pointerFilter: 'none' }} />
            </UiEntity>
          </UiEntity>
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: 42, display: state.controlsVisible ? 'flex' : 'none', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', margin: { top: 5 }, pointerFilter: 'none' }}>
          <UiEntity {...autoButton} onMouseDown={() => toggleAutoAttack({ state, props })}>
            <Label value={state.autoLabel} fontSize={12} textWrap="nowrap" color={{ r: .93, g: .86, b: .75, a: 1 }} uiTransform={{ width: '100%', height: 41, pointerFilter: 'none' }} />
          </UiEntity>
          <Label value={state.autoDetail} fontSize={11} textWrap="wrap" textAlign="middle-left" color={state.autoReady ? { r: .65, g: .93, b: .75, a: 1 } : { r: .82, g: .73, b: .62, a: 1 }} uiTransform={{ width: '47%', height: 39, pointerFilter: 'none' }} />
        </UiEntity>
        <Label value={state.feedback} fontSize={15} textWrap="wrap" textAlign="middle-left" color={{ r: .98, g: .75, b: .48, a: 1 }} uiTransform={{ width: '100%', height: 40, display: state.feedback ? 'flex' : 'none', margin: { top: 4 }, pointerFilter: 'none' }} />
        <Label value={state.cursorHint} fontSize={12} textWrap="wrap" textAlign="middle-left" color={{ r: .77, g: .69, b: .60, a: 1 }} uiTransform={{ width: '100%', height: 29, display: state.cursorHint ? 'flex' : 'none', margin: { top: 3 }, pointerFilter: 'none' }} />
      </UiEntity>
      <UiEntity {...debugPanel}>
        <Label value={state.debugText} font="monospace" fontSize={14} textWrap="nowrap" textAlign="middle-right" color={{ r: 0.82, g: 0.72, b: 0.49, a: 1 }} uiTransform={{ width: 210, height: 28 }} />
      </UiEntity>
      <UiEntity {...ending}>
        <Label value="GAME OVER" font="serif" fontSize={44} textWrap="nowrap" color={{ r: 0.91, g: 0.77, b: 0.51, a: 1 }} uiTransform={{ width: '100%', height: 56 }} />
        <Label value={state.finalSubtitle} font="serif" fontSize={24} textWrap="nowrap" color={{ r: 0.89, g: 0.78, b: 0.62, a: 1 }} uiTransform={{ width: '100%', height: 34 }} />
        <Label value={state.finalResult} fontSize={18} color={{ r: 0.96, g: 0.8, b: 0.55, a: 1 }} uiTransform={{ width: '100%', height: 28 }} />
        <Label value={state.finalTimeLabel} fontSize={12} textWrap="nowrap" color={{ r: 0.63, g: 0.47, b: 0.3, a: 1 }} uiTransform={{ width: '100%', height: 20 }} />
        <Label value={state.finalTime} font="serif" fontSize={38} textWrap="nowrap" color={{ r: 0.98, g: 0.92, b: 0.8, a: 1 }} uiTransform={{ width: '100%', height: 48 }} />
        <Label value={state.finalTotal} fontSize={13} textWrap="nowrap" color={{ r: 0.79, g: 0.69, b: 0.57, a: 1 }} uiTransform={{ width: '100%', height: 18 }} />
        <Label value={state.finalDetail} fontSize={16} textWrap="wrap" color={{ r: 0.79, g: 0.69, b: 0.57, a: 1 }} uiTransform={{ width: '100%', height: 40 }} />
        <Label value={state.rankTitle} fontSize={15} color={{ r: 0.89, g: 0.73, b: 0.52, a: 1 }} uiTransform={{ width: '100%', height: 27 }} />
        <Label value={state.rankStatus} fontSize={14} textWrap="wrap" uiTransform={{ width: '100%', height: 36 }} />
        <UiEntity uiTransform={{ display: state.rankColumnOne ? 'flex' : 'none', flexDirection: 'row', width: '100%', height: 109 }}>
          <Label value={state.rankColumnOne} font="monospace" fontSize={14} textAlign="top-left" uiTransform={{ width: '50%', height: 109 }} />
          <Label value={state.rankColumnTwo} font="monospace" fontSize={14} textAlign="top-left" uiTransform={{ width: '50%', height: 109 }} />
        </UiEntity>
        <UiEntity {...replay} onMouseDown={() => playAgain({ state, props })}>
          <Label value={state.replayLabel} fontSize={18} textWrap="nowrap" color={{ r: 0.99, g: 0.9, b: 0.76, a: 1 }} uiTransform={{ width: 264, height: 56 }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
