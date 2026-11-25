import {
  ColliderLayer, Entity, GltfContainer, GltfContainerLoadingState, InputAction, LoadingState,
  MeshCollider, PointerEvents, TextShape, Transform, pointerEventsSystem
} from '@dcl/sdk/ecs'
import type { PBGltfContainer } from '@dcl/sdk/ecs'
import type { CombatClass, EncounterSnapshot, Vec3 } from './game/types'
import { COMBAT_CLASSES } from './game/classes'
import { byName, place, show } from './scene-bindings'
import { CLASS_NAMES } from './story'

const POINTER_REACH = 4.5
const NEAR_REACH = 2.7
const REVEAL_SECONDS = 0.55
const REVEAL_AFTER_SECONDS = 3
const REVEAL_WALK_METRES = 1.6
const CHOICE_IDS: readonly CombatClass[] = ['melee', 'mage', 'archer']
const CARDSHARP_FIGURE = 'assets/Models/class-cardsharp.glb'
const CAST_MANNEQUIN = 'assets/Models/rehearsal-puppet.glb'

interface Station {
  id: CombatClass
  stand: Entity
  target: Entity
  label: Entity
  figure: Entity
  figureModel: PBGltfContainer | null
  objects: Entity[]
  position: Vec3
  rise: number
  clickable: boolean
}

export class CastEntrance {
  private revealAt: number | null = null
  private closedAt: number | null = null
  private language: 'en' | 'es' | null = null
  private readonly stations: Station[]

  constructor(private readonly spawn: Vec3, private readonly select: (id: CombatClass) => boolean) {
    this.stations = CHOICE_IDS.map(id => {
      const stand = byName(`ClassStand_${id}`)
      const target = byName(`ClassChoice_${id}`)
      const label = byName(`ClassLabel_${id}`)
      const figure = byName(`ClassFigure_${id}`)
      const existingFigure = GltfContainer.getOrNull(figure)
      const figureModel = existingFigure ? { ...existingFigure } : null
      if (id === 'melee' && figureModel) {
        figureModel.src = CARDSHARP_FIGURE
        GltfContainer.getMutable(figure).src = figureModel.src
      }
      pointerEventsSystem.onPointerDown({
        entity: target,
        opts: { button: InputAction.IA_POINTER, maxPlayerDistance: POINTER_REACH, hoverText: `Choose ${CLASS_NAMES.en[id]}`, showFeedback: true, showHighlight: false }
      }, () => { if (this.stations.find(station => station.id === id)?.clickable) this.select(id) })
      return {
        id, stand, target, label, figure, figureModel,
        objects: [byName(`ClassPlinth_${id}`), byName(`ClassRim_${id}`), figure, label],
        position: { ...Transform.get(stand).position }, rise: -1, clickable: false
      }
    })
    this.reset()
  }

  get isRevealed(): boolean { return this.revealAt !== null }

  reset(): void {
    this.revealAt = null
    this.closedAt = null
    for (const station of this.stations) {
      this.setClickable(station, false)
      this.move(station, 0)
      if (station.figureModel && !GltfContainer.has(station.figure)) GltfContainer.create(station.figure, station.figureModel)
    }
  }

  chooseNearest(player: Vec3): boolean {
    let nearest: Station | undefined
    let distance = NEAR_REACH
    for (const station of this.stations) {
      if (!station.clickable || Math.abs(player.y - station.position.y) > 1.8) continue
      const metres = Math.hypot(player.x - station.position.x, player.z - station.position.z)
      if (metres < distance) { nearest = station; distance = metres }
    }
    return nearest !== undefined && this.select(nearest.id)
  }

  render(s: EncounterSnapshot, player: Vec3, language: 'en' | 'es'): void {
    if (s.classSelectionOpen && this.revealAt === null && (player.z - this.spawn.z >= REVEAL_WALK_METRES || s.elapsed >= REVEAL_AFTER_SECONDS)) {
      this.revealAt = s.elapsed
    }
    if (!s.classSelectionOpen && this.closedAt === null) this.closedAt = s.elapsed
    if (this.language !== language) {
      this.language = language
      for (const station of this.stations) {
        const name = CLASS_NAMES[language][station.id]
        const { maxHealth, knotReach } = COMBAT_CLASSES[station.id]
        const range = language === 'es' ? `${knotReach}`.replace('.', ',') : `${knotReach}`
        TextShape.getMutable(station.label).text = `${name.toUpperCase()}\n${maxHealth} ${language === 'es' ? 'PV' : 'HP'} · ${range} m`
        const pointer = PointerEvents.getMutable(station.target).pointerEvents[0]
        if (pointer?.eventInfo) pointer.eventInfo.hoverText = `${language === 'es' ? 'Elegir' : 'Choose'} ${name}`
      }
    }
    const reveal = this.revealAt === null ? 0 : smooth((s.elapsed - this.revealAt) / REVEAL_SECONDS)
    for (const station of this.stations) {
      if (station.figureModel?.src === CARDSHARP_FIGURE && GltfContainer.has(station.figure)) {
        const load = GltfContainerLoadingState.getOrNull(station.figure)?.currentState
        if (load === LoadingState.NOT_FOUND || load === LoadingState.FINISHED_WITH_ERROR) {
          station.figureModel.src = CAST_MANNEQUIN
          GltfContainer.getMutable(station.figure).src = CAST_MANNEQUIN
        }
      }
      const selectedPause = s.selectedClass === station.id ? 0.65 : 0
      const dismissed = this.closedAt === null ? 0 : smooth((s.elapsed - this.closedAt - selectedPause) / REVEAL_SECONDS)
      this.move(station, reveal * (1 - dismissed))
      this.setClickable(station, s.classSelectionOpen && reveal >= 0.8)
      if (this.closedAt !== null && (dismissed === 1 || this.revealAt === null) && GltfContainer.has(station.figure)) {
        GltfContainer.deleteFrom(station.figure)
      }
    }
  }

  private move(station: Station, rise: number): void {
    if (station.rise !== rise) {
      station.rise = rise
      place(station.stand, { ...station.position, y: station.position.y - 2.4 * (1 - rise) })
      for (const object of station.objects) show(object, rise > 0.01)
    }
  }

  private setClickable(station: Station, clickable: boolean): void {
    if (station.clickable === clickable) return
    station.clickable = clickable
    if (clickable) MeshCollider.setBox(station.target, ColliderLayer.CL_POINTER)
    else MeshCollider.deleteFrom(station.target)
  }
}

function smooth(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}
