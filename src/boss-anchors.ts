import { BOSS_ANCHOR_SAMPLES } from './boss-anchor-samples'
import type { Vec3 } from './game/types'

export type BossAnchors = readonly [handL: Vec3, handR: Vec3, kneeL: Vec3, kneeR: Vec3]

const SAMPLES = new Map(Object.entries(BOSS_ANCHOR_SAMPLES))
const VALUES_PER_POSE = 12

export function sampleBossAnchors(clip: string, elapsed: number, loop: boolean): BossAnchors {
  const { duration, points } = SAMPLES.get(clip) ?? BOSS_ANCHOR_SAMPLES.idle
  const seconds = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0
  const time = loop ? seconds % duration : Math.min(seconds, duration)
  const last = points.length / VALUES_PER_POSE - 1
  const frame = time / duration * last
  const lower = Math.floor(frame)
  const upper = Math.min(lower + 1, last)
  const fraction = frame - lower

  function axis(offset: number): number {
    const first = points[lower * VALUES_PER_POSE + offset]
    const second = points[upper * VALUES_PER_POSE + offset]
    return (first + (second - first) * fraction) / 1000
  }

  function position(offset: number): Vec3 {
    return { x: axis(offset), y: axis(offset + 1), z: axis(offset + 2) }
  }

  return [position(0), position(3), position(6), position(9)]
}
