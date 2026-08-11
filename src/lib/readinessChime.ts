export interface ReadinessChimeState {
  initialLoadComplete: boolean
  soundEnabled: boolean
  alreadyFired: boolean
}

// The load-time chime only fires when three things line up: the dashboard has
// finished its first load (so audio really does correspond to "ready for
// review requests"), the user's Notification Sound is on, and we have not
// already played the chime this page load.
export function shouldFireReadinessChime(state: ReadinessChimeState): boolean {
  if (!state.initialLoadComplete) return false
  if (!state.soundEnabled) return false
  if (state.alreadyFired) return false
  return true
}
