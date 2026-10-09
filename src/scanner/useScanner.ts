import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5QrcodeAdapter } from './Html5QrcodeAdapter';
import type { ScannerStats } from './QrScannerAdapter';
import { loadPreferredCamera, savePreferredCamera } from './cameraPrefs';
import { playBeep } from '../lib/sound';

export function useScanner() {
  const adapter = useRef(new Html5QrcodeAdapter()).current;
  const operation = useRef(Promise.resolve());
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState(loadPreferredCamera() ?? '');
  const [stats, setStats] = useState<ScannerStats>({
    videoWidth: 0, videoHeight: 0, fps: null, capabilityKeys: [], failedFrames: 0, lastDecodeAt: null,
  });
  const [decodedText, setDecodedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const lastDecode = useRef({ value: '', at: 0 });
  const autoStartRequested = useRef(false);

  const refreshCameras = useCallback(async () => {
    try {
      const list = await adapter.listCameras();
      setCameras(list);
      setSelectedCamera((current) => list.some((camera) => camera.deviceId === current) ? current : list[0]?.deviceId ?? '');
      setError(list.length === 0 ? 'Nessuna fotocamera disponibile.' : null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossibile elencare le fotocamere.');
    }
  }, [adapter]);

  const stop = useCallback(() => {
    operation.current = operation.current.then(async () => {
      await adapter.stop();
      setRunning(false);
    });
    return operation.current;
  }, [adapter]);

  const start = useCallback(() => {
    if (!selectedCamera) return Promise.resolve();
    operation.current = operation.current.then(async () => {
      if (running) return;
      setError(null);
      try {
        await adapter.start(selectedCamera, (value) => {
          const now = Date.now();
          if (lastDecode.current.value === value && now - lastDecode.current.at < 3000) return;
          lastDecode.current = { value, at: now };
          setStats((current) => ({ ...current, lastDecodeAt: now }));
          setDecodedText(value);
          playBeep();
        }, setStats);
        savePreferredCamera(selectedCamera);
        setRunning(true);
      } catch (reason) {
        setError(reason instanceof Error ? `Impossibile avviare la fotocamera: ${reason.message}` : `Impossibile avviare la fotocamera: ${String(reason)}`);
        await adapter.stop();
      }
    });
    return operation.current;
  }, [adapter, running, selectedCamera, stop]);

  useEffect(() => {
    void refreshCameras();
    return () => { void stop(); };
  }, [refreshCameras, stop]);

  useEffect(() => {
    if (cameras.length > 0 && selectedCamera && !autoStartRequested.current) {
      autoStartRequested.current = true;
      void start();
    }
  }, [cameras, selectedCamera, start]);

  return { cameras, selectedCamera, setSelectedCamera, stats, decodedText, setDecodedText, error, running, refreshCameras, start, stop, adapter };
}
