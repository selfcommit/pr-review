let audioCtx: AudioContext | null = null
let audioBuffer: AudioBuffer | null = null
let fallbackAudio: HTMLAudioElement | null = null
let unlocked = false
let primed = false
let bufferLoading = false
let bufferLoadPromise: Promise<AudioBuffer | null> | null = null
let pendingChime = false
let pendingChimeTimer: ReturnType<typeof setTimeout> | null = null
let keepaliveInterval: ReturnType<typeof setInterval> | null = null
let primingPromise: Promise<boolean> | null = null

const PENDING_TTL_MS = 10_000
const AUDIO_SRC = '/tng_chime_1.5sec.wav'
const KEEPALIVE_INTERVAL_MS = 25_000

function ensureFallbackAudio(): HTMLAudioElement | null {
  if (fallbackAudio) return fallbackAudio
  try {
    fallbackAudio = new Audio(AUDIO_SRC)
    fallbackAudio.volume = 0.6
    fallbackAudio.preload = 'auto'
    fallbackAudio.muted = false
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

function loadBuffer(): Promise<AudioBuffer | null> {
  if (audioBuffer) return Promise.resolve(audioBuffer)
  if (bufferLoadPromise) return bufferLoadPromise
  if (!audioCtx) return Promise.resolve(null)
  bufferLoading = true
  bufferLoadPromise = fetch(AUDIO_SRC)
    .then(r => r.arrayBuffer())
    .then(buf => audioCtx!.decodeAudioData(buf))
    .then(decoded => {
      audioBuffer = decoded
      return decoded
    })
    .catch(() => null)
    .finally(() => {
      bufferLoading = false
    })
  return bufferLoadPromise
}

ensureFallbackAudio()

export function preWarmAudio(): void {
  const ctx = ensureAudioContext()
  if (ctx) {
    loadBuffer()
  }
  ensureFallbackAudio()
}

export async function unlockAudio(): Promise<void> {
  const ctx = ensureAudioContext()
  if (ctx && ctx.state === 'suspended') {
    await ctx.resume().catch(() => {})
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
    el.muted = false
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

function startKeepalive(): void {
  if (keepaliveInterval) return
  if (!audioCtx) return
  keepaliveInterval = setInterval(() => {
    if (!audioCtx || audioCtx.state !== 'running') return
    try {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      gain.gain.value = 0.001
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start()
      osc.stop(audioCtx.currentTime + 0.002)
    } catch {}
  }, KEEPALIVE_INTERVAL_MS)
}

export function stopKeepalive(): void {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval)
    keepaliveInterval = null
  }
}

function playSilentTest(): boolean {
  if (!audioCtx || audioCtx.state !== 'running') return false
  try {
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    gain.gain.value = 0
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + 0.001)
    return true
  } catch {
    return false
  }
}

export function primeAudio(): Promise<boolean> {
  if (primed) return Promise.resolve(true)
  if (primingPromise) return primingPromise

  primingPromise = (async () => {
    const ctx = ensureAudioContext()
    if (!ctx) return false

    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {})
    }
    unlocked = true

    await loadBuffer()
    ensureFallbackAudio()

    const ok = playSilentTest()
    if (ok) {
      primed = true
      startKeepalive()
    }
    return ok
  })().finally(() => {
    primingPromise = null
  })

  return primingPromise
}

export function isPrimed(): boolean {
  return primed
}

export async function playChime(): Promise<boolean> {
  const ctx = ensureAudioContext()
  if (ctx && ctx.state === 'suspended') {
    await ctx.resume().catch(() => {})
  }

  if (playViaWebAudio()) {
    clearPendingChime()
    return true
  }

  if (ctx && !audioBuffer) {
    const buf = await loadBuffer()
    if (buf && playViaWebAudio()) {
      clearPendingChime()
      return true
    }
    const ok = await playViaFallback()
    if (ok) {
      clearPendingChime()
      return true
    }
    queuePendingChime()
    return false
  }

  const ok = await playViaFallback()
  if (ok) {
    clearPendingChime()
    return true
  }
  queuePendingChime()
  return false
}

export async function flushPendingChime(): Promise<void> {
  if (!pendingChime) return
  const ctx = ensureAudioContext()
  if (ctx && ctx.state === 'suspended') {
    await ctx.resume().catch(() => {})
  }
  if (playViaWebAudio()) {
    clearPendingChime()
    return
  }
  const ok = await playViaFallback()
  if (ok) clearPendingChime()
}

export function isAudioUnlocked(): boolean {
  return unlocked && audioCtx?.state === 'running'
}

export function isAudioContextUsable(): boolean {
  return !!audioCtx && audioCtx.state === 'running'
}

export function isBufferReady(): boolean {
  return !!audioBuffer
}

export function isBufferLoading(): boolean {
  return bufferLoading
}

export function playRemovalTone(): boolean {
  const ctx = ensureAudioContext()
  if (!ctx || ctx.state !== 'running') return false
  try {
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, now)
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.15)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.3, now)
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.25)
    return true
  } catch {
    return false
  }
}
