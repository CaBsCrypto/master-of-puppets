import { engine, Transform, type Entity } from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import type { EncounterSnapshot, GameEvent, Vec3 } from './game/types'
import { byName, combatPosition, place, show, tint, releasePrimitiveWhenHidden } from './scene-bindings'

const LIGHTS = [
  { r: 0.83, g: 0.50, b: 0.19 },
  { r: 0.94, g: 0.24, b: 0.12 },
  { r: 0.55, g: 0.66, b: 0.91 },
  { r: 0.86, g: 0.08, b: 0.28 }
]
const MARK_SECONDS = 1.3
const STAGE_SURFACE = 3.065

function smooth(seconds: number): number {
  const t = Math.max(0, Math.min(1, seconds))
  return t * t * (3 - 2 * t)
}

interface Banner { mount: Entity; parts: Entity[] }
interface DamageMark {
  strips: Entity[]
  start: number
  position: Vec3
  yaw: number
}

/** A local set follows the act and rising tension. The arena collider stays fixed. */
export class TheatreDressing {
  private readonly drapes = [byName('BackdropDrape0'), byName('BackdropDrape1')]
  private readonly banners: Banner[] = Array.from({ length: 3 }, (_, i) => ({
    mount: byName(`CompanyBanner${i}`),
    parts: [byName(`BannerCloth${i}`), byName(`BannerBar${i}`), byName(`BannerSeal${i}`)]
  }))
  private readonly lamps = Array.from({ length: 6 }, (_, i) => byName(`FootlightFlame${i}`))
  private readonly damageMarks: DamageMark[] = Array.from({ length: 2 }, () => ({
    strips: Array.from({ length: 3 }, () => {
      const entity = engine.addEntity()
      Transform.create(entity)
      releasePrimitiveWhenHidden(entity, 'box')
      show(entity, false)
      return entity
    }),
    start: -Infinity,
    position: { x: 16, y: STAGE_SURFACE, z: 16 },
    yaw: 0
  }))
  private nextMark = 0
  private act = 1
  private phaseAge = 0

  constructor() {
    this.banners.forEach(({ parts: [cloth, trim, seal] }, i) => {
      releasePrimitiveWhenHidden(cloth, 'box')
      releasePrimitiveWhenHidden(trim, 'box')
      releasePrimitiveWhenHidden(seal, i === 1 ? 'sphere' : 'box')
    })
  }

  reset(): void {
    this.act = 1
    this.phaseAge = 0
    this.nextMark = 0
    for (const mark of this.damageMarks) {
      mark.start = -Infinity
      mark.strips.forEach(strip => show(strip, false))
    }
  }

  onEvent(event: GameEvent): void {
    if (event.type !== 'damage' && event.type !== 'puppet_defeated') return
    const position = combatPosition(event.data?.position)
    if (!position || Math.hypot(position.x - 16, position.z - 16) > 13.35) return
    const mark = this.damageMarks[this.nextMark]
    this.nextMark = (this.nextMark + 1) % this.damageMarks.length
    mark.start = event.elapsed
    mark.position = { ...position, y: STAGE_SURFACE }
    mark.yaw = 14 + (event.elapsed * 71) % 150
  }

  render(s: EncounterSnapshot): void {
    this.renderDamageMarks(s.elapsed)
    if (!s.outcome) {
      this.act = s.phase === 'onboarding' ? 1 : Number(s.phase.slice(1))
      this.phaseAge = s.phaseElapsed
    }
    const { act, phaseAge } = this
    const reveal = smooth(phaseAge / 1.5)
    const drapeGap = act === 1 ? 4.05 : act === 2 ? 4.05 + 3.15 * reveal : 7.2 + (act === 4 ? 0.75 * reveal : 0)
    this.drapes.forEach((entity, i) => place(entity, { x: (i === 0 ? -1 : 1) * drapeGap, y: 4.5, z: 11.2 }))

    this.banners.forEach(({ mount, parts }, i) => {
      const visible = act >= 3
      const drop = act === 3 ? smooth((phaseAge - i * 0.24) / 1.4) : 1
      const closing = act === 4 ? smooth(phaseAge / 3) : 0
      place(mount, { x: -6 + i * 6, y: 10 - 4.0 * drop - 0.6 * closing, z: 11.55 })
      parts.forEach(entity => show(entity, visible))
    })

    const hue = LIGHTS[act - 1] ?? LIGHTS[0]
    const clockTension = Math.min(1, s.elapsed / 230)
    const pulse = act === 4 ? 0.78 + 0.1 * Math.sin(s.elapsed * 3.4) : 0.87 + 0.13 * clockTension
    const visibility = s.outcome ? 0.52 : s.failsafe ? 0.63 : pulse
    const step = Math.round(visibility * 20) / 20
    this.lamps.forEach((lamp, i) => {
      const reveal = s.transition ? smooth(phaseAge / .36) : 1
      const sweep = s.transition ? 1 - smooth(Math.abs(phaseAge - (.24 + i * .065)) / .22) : 0
      const level = step * (.22 + .78 * reveal)
      const gleam = Math.round(sweep * 12) / 24
      tint(lamp, {
        r: hue.r * level * (1 - gleam) + gleam,
        g: hue.g * level * (1 - gleam) + gleam * .91,
        b: hue.b * level * (1 - gleam) + gleam * .76
      })
    })
  }

  private renderDamageMarks(elapsed: number): void {
    for (const { strips, start, position, yaw } of this.damageMarks) {
      const age = elapsed - start
      if (age >= MARK_SECONDS) {
        strips.forEach(strip => show(strip, false))
        continue
      }
      const size = smooth(age / .12) * (1 - smooth((age - .75) / (MARK_SECONDS - .75)))
      const spark = 1 - smooth(age / .35)
      const level = Math.round(spark * 6) / 6
      strips.forEach((strip, i) => {
        const direction = yaw + i * 103
        const angle = direction * Math.PI / 180
        const offset = (.21 + i * .035) * size
        place(strip, {
          x: position.x + Math.sin(angle) * offset,
          y: position.y + .003 * i,
          z: position.z + Math.cos(angle) * offset
        }, { x: .024 + .04 * size, y: .008, z: .50 * size * (1 - i * .18) }, Quaternion.fromEulerDegrees(0, direction, 0))
        tint(strip, { r: .24 + .64 * level, g: .024 + .29 * level, b: .04 + .075 * level }, level > .25)
        show(strip, size > .02)
      })
    }
  }
}
