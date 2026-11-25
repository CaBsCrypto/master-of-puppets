import { AudioSource, Entity } from '@dcl/sdk/ecs'
import { byName } from './scene-bindings'
import type { EncounterSnapshot } from './game/types'

const score = ['musicbox-loop', 'plot-drums', 'company-strings'] as const
const names = ['telegraph', 'wood-hit', 'knot-open', 'knot-cut', 'damage', 'fall', 'strings-break', 'three-knocks', 'curtain', 'applause', 'finale', 'archer-draw', 'controller-fall', ...score] as const
export type SoundName = typeof names[number]
const sources = new Map<SoundName, Entity>()
const levels = [0, 0, 0]
let scorePlaying = false
let duckUntil = 0
export function setupAudio(): void { for (const name of names) sources.set(name, byName(`Sound_${name}`)) }
export function sound(name: SoundName, volume?: number): void {
  const entity = sources.get(name)
  if (entity === undefined) return
  const audio = AudioSource.getMutable(entity)
  audio.playing = false
  AudioSource.playSound(entity, audio.audioClipUrl, true)
  if (volume !== undefined) AudioSource.getMutable(entity).volume = volume
}
export function music(playing: boolean): void {
  scorePlaying = playing
  duckUntil = 0
  score.forEach((name, i) => {
    const entity = sources.get(name)
    levels[i] = 0
    if (entity === undefined) return
    const audio = AudioSource.getMutable(entity)
    audio.volume = 0
    audio.playing = playing
  })
}

export function duckMusic(elapsed: number): void { duckUntil = Math.max(duckUntil, elapsed + 0.95) }

export function renderScore(s: EncounterSnapshot, dt: number): void {
  if (!scorePlaying) return
  const tension = Math.min(1, s.elapsed / 230)
  const company = s.phase === 'f3'
  const lastAct = s.phase === 'f4'
  const targets = [lastAct ? 0.043 : 0.135, s.phase === 'f2' ? 0.09 : company ? 0.11 : 0, company ? 0.127 : lastAct ? 0.052 : 0]
  const duck = s.elapsed < duckUntil ? 0.43 : s.failsafe ? 0.5 : 0.9 + 0.18 * tension
  let blend = 1 - Math.exp(-Math.max(0, dt) * (s.elapsed < duckUntil ? 19 : 5))
  if (lastAct && s.transition === 'cut_strings') blend = Math.max(blend, 0.22)
  score.forEach((name, i) => {
    levels[i] += (targets[i] * duck - levels[i]) * blend
    const volume = Math.round(levels[i] * 250) / 250
    const entity = sources.get(name)
    if (entity !== undefined && AudioSource.get(entity).volume !== volume) AudioSource.getMutable(entity).volume = volume
  })
}

export function stopAudio(): void {
  scorePlaying = false
  for (const e of sources.values()) AudioSource.getMutable(e).playing = false
}
