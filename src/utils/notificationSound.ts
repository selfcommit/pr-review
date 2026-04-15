let audio: HTMLAudioElement | null = null

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio('/tng_chime_1.5sec.wav')
    audio.volume = 0.6
  }
  return audio
}

export function playChime(): void {
  try {
    const a = getAudio()
    a.currentTime = 0
    a.play().catch(() => {})
  } catch {
    // browser blocked autoplay
  }
}
