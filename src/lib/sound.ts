let audioContext: AudioContext | null = null;

export function playBeep(): void {
  const context = audioContext ??= new AudioContext();
  const play = () => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.12;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
  };

  if (context.state === 'suspended') {
    void context.resume()
      .then(play)
      .catch((reason: unknown) => {
        console.warn('Impossibile riprodurre il suono di conferma QR.', reason);
      });
    return;
  }
  play();
}
