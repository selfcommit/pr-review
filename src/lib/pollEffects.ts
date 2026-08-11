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

  for (const raw of result.newPRs) {
    const pr = mapItem(raw)
    notifications.push({ prId: pr.id, text: `${pr.repository.full_name}: ${pr.title}` })
    highlightedIds.push(pr.id)
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
    nextItems = nextItems.map(item => {
      const upd = updatedMap.get(item.id as number)
      return upd ? { ...item, ...upd } : item
    })
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
