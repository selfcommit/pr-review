let audioCtx: AudioContext | null = null
let audioBuffer: AudioBuffer | null = null
let fallbackAudio: HTMLAudioElement | null = null
let unlocked = false

export function unlockAudio(): void {
  if (unlocked && audioCtx?.state === 'running') return

  try {
    if (!audioCtx) {
      audioCtx = new AudioContext()
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }
    unlocked = true

    if (!audioBuffer) {
      fetch('/tng_chime_1.5sec.wav')
        .then(r => r.arrayBuffer())
        .then(buf => audioCtx!.decodeAudioData(buf))
        .then(decoded => { audioBuffer = decoded })
        .catch(() => {})
    }
  } catch {
    unlocked = false
  }
}

export function playChime(): void {
  if (audioCtx && audioBuffer && audioCtx.state === 'running') {
    try {
      const source = audioCtx.createBufferSource()
      source.buffer = audioBuffer
      const gain = audioCtx.createGain()
      gain.gain.value = 0.6
      source.connect(gain)
      gain.connect(audioCtx.destination)
      source.start(0)
      return
    } catch {
      console.warn('Web Audio playback failed, falling back to HTMLAudioElement')
    }
  }

  try {
    if (!fallbackAudio) {
      fallbackAudio = new Audio('/tng_chime_1.5sec.wav')
      fallbackAudio.volume = 0.6
    }
    fallbackAudio.currentTime = 0
    fallbackAudio.play().catch(() => {
      console.warn('HTMLAudioElement playback blocked by browser autoplay policy')
    })
  } catch {
    console.warn('Audio playback unavailable')
  }
}
