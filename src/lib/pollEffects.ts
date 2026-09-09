import { isOverdue } from '../utils/time'
import { mapItem } from '../types/pullRequest'

export interface PollInput {
  updatedPRs: Array<Record<string, unknown>>
  removedPRIds: number[]
  removalReasons?: Record<number, string>
  newPRs: Array<Record<string, unknown>>
  reviewTimestamps: Record<number, string>
  visibleIds?: number[]
}

export interface PollState {
  items: Array<Record<string, unknown>>
  reviewTimestamps: Record<number, string>
  overdueNotified: ReadonlySet<number>
}

export interface PollNotification {
  prId: number
  text: string
}

export interface PollEffects {
  nextItems: Array<Record<string, unknown>>
  nextTimestamps: Record<number, string>
  notifications: PollNotification[]
  highlightedIds: number[]
  playRemovalChime: boolean
  statsIncrements: Record<string, number>
  overdueNotifiedAdditions: number[]
  overdueNotifiedRemovals: number[]
}

const TRACKED_STATS = new Set(['approved', 'changes_requested', 'commented'])

export function computePollEffects(state: PollState, result: PollInput): PollEffects {
  const notifications: PollNotification[] = []
  const highlightedIds: number[] = []
  const announced = new Set<number>()
  const knownIds = new Set(state.items.map(it => it.id as number))

  const announceFreshArrival = (raw: Record<string, unknown>) => {
    const prId = raw.id as number
    if (announced.has(prId)) return
    announced.add(prId)
    // Don't notify for items the user cannot yet act on (drafts) or that are
    // already hidden behind a filter (team already approved). The card still
    // enters the list so toggling those filters shows it without a delay.
    if (raw.draft === true || raw.team_approval_required === false) return
    const pr = mapItem(raw)
    notifications.push({ prId, text: `${pr.repository.full_name}: ${pr.title}` })
    highlightedIds.push(prId)
  }

  for (const raw of result.newPRs) {
    announceFreshArrival(raw)
  }
  // A brand-new review request that the server has previously written to its
  // snapshot cache lands in updatedPRs, not newPRs. If our on-screen list has
  // never seen the id, treat it as a fresh arrival so the card renders and
  // the chime fires — otherwise the badge ticks up but the card is missing.
  for (const raw of result.updatedPRs) {
    if (!knownIds.has(raw.id as number)) {
      announceFreshArrival(raw)
    }
  }

  const overdueNotifiedAdditions: number[] = []
  for (const item of state.items) {
    const prId = item.id as number
    if (state.overdueNotified.has(prId)) continue
    const oldTs = state.reviewTimestamps[prId]
    if (!oldTs) continue
    if (isOverdue(oldTs)) continue
    const newTs = result.reviewTimestamps[prId] || oldTs
    if (isOverdue(newTs) && !highlightedIds.includes(prId)) {
      const pr = mapItem(item)
      notifications.push({ prId, text: `${pr.repository.full_name}: ${pr.title} (now 24h+)` })
      highlightedIds.push(prId)
      overdueNotifiedAdditions.push(prId)
    }
  }

  let nextItems: Array<Record<string, unknown>> = state.items

  if (result.newPRs.length > 0) {
    nextItems = [...result.newPRs, ...nextItems]
  }

  if (result.updatedPRs.length > 0) {
    const updatedMap = new Map(result.updatedPRs.map(pr => [pr.id as number, pr]))
    const seen = new Set<number>()
    nextItems = nextItems.map(item => {
      const id = item.id as number
      const upd = updatedMap.get(id)
      if (!upd) return item
      seen.add(id)
      return { ...item, ...upd }
    })
    const orphanArrivals = result.updatedPRs.filter(pr => !seen.has(pr.id as number))
    if (orphanArrivals.length > 0) {
      nextItems = [...orphanArrivals, ...nextItems]
    }
  }

  const currentIdsBeforeRemoval = new Set(state.items.map(it => it.id as number))
  const reasons = result.removalReasons || {}
  const newlyReviewedOnScreen: number[] = []

  if (result.removedPRIds.length > 0) {
    const removedSet = new Set(result.removedPRIds)
    for (const id of result.removedPRIds) {
      if (reasons[id] && currentIdsBeforeRemoval.has(id)) {
        newlyReviewedOnScreen.push(id)
      }
    }
    nextItems = nextItems.filter(item => !removedSet.has(item.id as number))
  }

  const statsIncrements: Record<string, number> = {}
  for (const id of newlyReviewedOnScreen) {
    const reason = reasons[id]
    if (TRACKED_STATS.has(reason)) {
      statsIncrements[reason] = (statsIncrements[reason] || 0) + 1
    }
  }

  if (Array.isArray(result.visibleIds)) {
    const visibleSet = new Set(result.visibleIds)
    const filtered = nextItems.filter(item => visibleSet.has(item.id as number))
    if (filtered.length !== nextItems.length) {
      nextItems = filtered
    }
  }

  const nextTimestamps = Object.keys(result.reviewTimestamps).length > 0
    ? { ...state.reviewTimestamps, ...result.reviewTimestamps }
    : state.reviewTimestamps

  return {
    nextItems,
    nextTimestamps,
    notifications,
    highlightedIds,
    playRemovalChime: newlyReviewedOnScreen.length > 0,
    statsIncrements,
    overdueNotifiedAdditions,
    overdueNotifiedRemovals: [...result.removedPRIds],
  }
}
