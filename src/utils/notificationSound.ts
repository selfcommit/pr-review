let audioCtx: AudioContext | null = null
let audioBuffer: AudioBuffer | null = null
let fallbackAudio: HTMLAudioElement | null = null
let unlocked = false
let bufferLoading = false
let pendingChime = false
let pendingChimeTimer: ReturnType<typeof setTimeout> | null = null

const PENDING_TTL_MS = 60_000
const AUDIO_SRC = '/tng_chime_1.5sec.wav'

function ensureFallbackAudio(): HTMLAudioElement | null {
  if (fallbackAudio) return fallbackAudio
  try {
    fallbackAudio = new Audio(AUDIO_SRC)
    fallbackAudio.volume = 0.6
    fallbackAudio.preload = 'auto'
    try { fallbackAudio.load() } catch {}
    return fallbackAudio
  } catch {
    return null
  }
}

function ensureAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx
  try {
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    if (!Ctor) return null
    audioCtx = new Ctor()
    return audioCtx
  } catch {
    return null
  }
}

function loadBuffer(): void {
  if (audioBuffer || bufferLoading || !audioCtx) return
  bufferLoading = true
  fetch(AUDIO_SRC)
    .then(r => r.arrayBuffer())
    .then(buf => audioCtx!.decodeAudioData(buf))
    .then(decoded => { audioBuffer = decoded })
    .catch(() => {})
    .finally(() => { bufferLoading = false })
}

ensureFallbackAudio()

export function unlockAudio(): void {
  const ctx = ensureAudioContext()
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  if (ctx) {
    unlocked = true
    loadBuffer()
  }
  ensureFallbackAudio()
}

function playViaWebAudio(): boolean {
  if (!audioCtx || !audioBuffer) return false
  if (audioCtx.state !== 'running') return false
  try {
    const source = audioCtx.createBufferSource()
    source.buffer = audioBuffer
    const gain = audioCtx.createGain()
    gain.gain.value = 0.6
    source.connect(gain)
    gain.connect(audioCtx.destination)
    source.start(0)
    return true
  } catch {
    return false
  }
}

function playViaFallback(): Promise<boolean> {
  const el = ensureFallbackAudio()
  if (!el) return Promise.resolve(false)
  try {
    el.currentTime = 0
    const p = el.play()
    if (p && typeof p.then === 'function') {
      return p.then(() => true).catch(() => false)
    }
    return Promise.resolve(true)
  } catch {
    return Promise.resolve(false)
  }
}

function queuePendingChime(): void {
  pendingChime = true
  if (pendingChimeTimer) clearTimeout(pendingChimeTimer)
  pendingChimeTimer = setTimeout(() => {
    pendingChime = false
    pendingChimeTimer = null
  }, PENDING_TTL_MS)
}

function clearPendingChime(): void {
  pendingChime = false
  if (pendingChimeTimer) {
    clearTimeout(pendingChimeTimer)
    pendingChimeTimer = null
  }
}

export function playChime(): void {
  const ctx = ensureAudioContext()
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  if (ctx && !audioBuffer) {
    loadBuffer()
  }

  if (playViaWebAudio()) return

  playViaFallback().then(ok => {
    if (!ok) {
      queuePendingChime()
    }
  })
}

export function flushPendingChime(): void {
  if (!pendingChime) return
  const ctx = ensureAudioContext()
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  if (playViaWebAudio()) {
    clearPendingChime()
    return
  }
  playViaFallback().then(ok => {
    if (ok) clearPendingChime()
  })
}

export function isAudioUnlocked(): boolean {
  return unlocked && audioCtx?.state === 'running'
}
