const cameraPreferenceKey = 'sealed.preferred-camera';

export function loadPreferredCamera(): string | null {
  return localStorage.getItem(cameraPreferenceKey);
}

export function savePreferredCamera(deviceId: string): void {
  localStorage.setItem(cameraPreferenceKey, deviceId);
}
