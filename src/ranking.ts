import { getHeaders } from '~system/SignedFetch'
import { RANKED_TETHER_MODE, REPLAY_VERSION, type ReplayFrame } from './game/replay'
import type { CombatClass, EncounterSnapshot } from './game/types'
import { RANKING_URL, TETHER_MODE } from './settings'

export interface RankRow { alias: string; timeMs: number }
export type RankStatus = 'idle' | 'loading' | 'published' | 'unavailable' | 'unranked'
export interface RankView { status: RankStatus; rows: RankRow[]; bestTimeMs?: number; tableUnavailable?: boolean }
interface RunTicket { id: string; bests: unknown }

export class Ranking {
  private frames: ReplayFrame[] = []
  private run: Promise<RunTicket | null> = Promise.resolve(null)
  private current = 0
  private eligible = false
  view: RankView = { status: 'idle', rows: [] }

  start(normal: boolean): void {
    this.current++
    this.frames = []
    this.view = { status: 'idle', rows: [] }
    this.eligible = normal && !!RANKING_URL && TETHER_MODE === RANKED_TETHER_MODE
    this.run = this.eligible
      ? post('/runs', { version: REPLAY_VERSION }).then(result => typeof result.id === 'string' ? { id: result.id, bests: result.bests } : null).catch(() => null)
      : Promise.resolve(null)
  }

  record(frame: ReplayFrame): void { if (this.eligible) this.frames.push(frame) }
  invalidate(): void { this.eligible = false; this.frames = [] }

  finish(snapshot: EncounterSnapshot): void {
    const role = snapshot.selectedClass
    if (!role) return
    if (!RANKING_URL) { this.view = { status: 'unavailable', rows: [] }; return }
    const generation = this.current
    const frames = this.frames
    const eligible = this.eligible && snapshot.outcome === 'manual_clear'
    this.invalidate()
    this.view = { status: 'loading', rows: [] }
    void this.report(role, eligible, frames).then(view => {
      if (generation === this.current) this.view = view
    }).catch(() => {
      if (generation === this.current) this.view = { status: 'unavailable', rows: [] }
    })
  }

  private async report(role: CombatClass, eligible: boolean, frames: ReplayFrame[]): Promise<RankView> {
    let status: RankStatus = 'unranked'
    const ticket = await this.run
    let bestTimeMs = bestFor(ticket?.bests, role)
    if (eligible) {
      try {
        if (ticket) {
          const submit = () => post(`/runs/${encodeURIComponent(ticket.id)}/finish`, { frames })
          const result = await submit().catch(error => error instanceof NetworkError ? submit() : Promise.reject(error))
          status = result.status === 'accepted' ? 'published' : 'unranked'
          bestTimeMs = bestFor(result.bests, role) ?? bestTimeMs
        } else status = 'unavailable'
      } catch { status = 'unavailable' }
    }
    try {
      const response = await fetch(`${RANKING_URL}/leaderboard?role=${role}`, { timeout: 4_500 })
      if (!response.ok) throw new NetworkError('Could not read leaderboard')
      const data: { rows?: RankRow[] } = await response.json()
      return { status, rows: (data.rows ?? []).slice(0, 10), bestTimeMs }
    } catch {
      return { status: status === 'published' ? status : 'unavailable', rows: [], bestTimeMs, tableUnavailable: true }
    }
  }
}

class NetworkError extends Error {}

function bestFor(value: unknown, role: CombatClass): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const time = (value as Partial<Record<CombatClass, unknown>>)[role]
  return typeof time === 'number' && Number.isFinite(time) && time > 0 ? time : undefined
}

async function post(path: string, body: object): Promise<Record<string, unknown>> {
  const url = `${RANKING_URL}${path}`
  const method = 'POST'
  const { headers } = await getHeaders({ url, init: { method, headers: {} } })
  const response = await fetch(url, {
    method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: 4_500
  }).catch(() => { throw new NetworkError('Ranking unreachable') })
  if (!response.ok) {
    if (response.status >= 500) throw new NetworkError('Ranking server unavailable')
    throw new Error(`Ranking response ${response.status}`)
  }
  return response.json()
}
