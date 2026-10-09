export interface ScannerStats {
  videoWidth: number;
  videoHeight: number;
  fps: number | null;
  capabilityKeys: string[];
  failedFrames: number;
  lastDecodeAt: number | null;
}

export interface QrScannerAdapter {
  listCameras(): Promise<MediaDeviceInfo[]>;
  start(
    deviceId: string,
    onDecode: (decodedText: string) => void,
    onStats: (stats: ScannerStats) => void,
  ): Promise<void>;
  stop(): Promise<void>;
  scanFile(file: File): Promise<string>;
}
