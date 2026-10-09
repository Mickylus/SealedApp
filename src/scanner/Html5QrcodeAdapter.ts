import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import type { QrScannerAdapter, ScannerStats } from './QrScannerAdapter';

const scannerConfig = {
  fps: 10,
  formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
  experimentalFeatures: { useBarCodeDetectorIfSupported: true },
};

export class Html5QrcodeAdapter implements QrScannerAdapter {
  private scanner: Html5Qrcode | null = null;
  private failedFrames = 0;
  private lastDecodeAt: number | null = null;
  private statsTimer: number | null = null;

  async listCameras(): Promise<MediaDeviceInfo[]> {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        throw new Error('Il browser non supporta l’accesso alla fotocamera.');
      }

      let devices = await navigator.mediaDevices.enumerateDevices();
      let cameras = devices
        .filter((device) => device.kind === 'videoinput')
        .map((device) => ({
          deviceId: device.deviceId,
          groupId: device.groupId,
          kind: device.kind,
          label: device.label,
          toJSON: () => device.toJSON(),
        }));

      if (cameras.length === 0 || cameras.every((camera) => !camera.label)) {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true });
        permissionStream.getTracks().forEach((track) => track.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
        cameras = devices
          .filter((device) => device.kind === 'videoinput')
          .map((device) => ({
            deviceId: device.deviceId,
            groupId: device.groupId,
            kind: device.kind,
            label: device.label,
            toJSON: () => device.toJSON(),
          }));
      }

      if (cameras.length === 0) {
        throw new Error('Nessuna webcam collegata o disponibile.');
      }

      return cameras;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Nessuna webcam')) throw error;
      throw new Error(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Accesso alla fotocamera negato. Consenti la fotocamera nelle impostazioni del browser.'
          : error instanceof DOMException && error.name === 'NotReadableError'
            ? 'La fotocamera è occupata da un’altra applicazione.'
            : error instanceof DOMException && error.name === 'SecurityError'
              ? 'La fotocamera richiede una pagina sicura (HTTPS o localhost).'
              : error instanceof Error
                ? error.message
                : 'Nessuna fotocamera disponibile o impossibile accedere alla fotocamera.',
      );
    }
  }

  async start(
    deviceId: string,
    onDecode: (decodedText: string) => void,
    onStats: (stats: ScannerStats) => void,
  ): Promise<void> {
    if (this.scanner) return;
    const scanner = new Html5Qrcode('sealed-reader');
    this.scanner = scanner;
    this.failedFrames = 0;
    const successCallback = (decodedText: string) => {
      this.lastDecodeAt = Date.now();
      onDecode(decodedText);
    };
    const errorCallback = () => {
      this.failedFrames += 1;
    };
    await scanner.start(deviceId, scannerConfig, successCallback, errorCallback);
    const video = document.querySelector<HTMLVideoElement>('#sealed-reader video');
    const track = video?.srcObject instanceof MediaStream
      ? video.srcObject.getVideoTracks()[0]
      : undefined;
    if (track) {
      try {
        await track.applyConstraints({
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        });
      } catch {
        // The camera remains usable when it cannot provide Full HD.
      }
    }
    this.statsTimer = window.setInterval(() => {
      const video = document.querySelector<HTMLVideoElement>('#sealed-reader video');
      const track = video?.srcObject instanceof MediaStream
        ? video.srcObject.getVideoTracks()[0]
        : undefined;
      const settings = track?.getSettings();
      const capabilities = track?.getCapabilities();
      onStats({
        videoWidth: settings?.width ?? video?.videoWidth ?? 0,
        videoHeight: settings?.height ?? video?.videoHeight ?? 0,
        fps: settings?.frameRate ?? null,
        capabilityKeys: capabilities ? Object.keys(capabilities) : [],
        failedFrames: this.failedFrames,
        lastDecodeAt: this.lastDecodeAt,
      });
    }, 500);
  }

  async stop(): Promise<void> {
    if (this.statsTimer !== null) window.clearInterval(this.statsTimer);
    this.statsTimer = null;
    const scanner = this.scanner;
    this.scanner = null;
    if (scanner?.isScanning) await scanner.stop();
    scanner?.clear();
  }

  async scanFile(file: File): Promise<string> {
    const scanner = new Html5Qrcode('sealed-file-reader');
    try {
      return await scanner.scanFile(file, true);
    } finally {
      await scanner.clear();
    }
  }
}
