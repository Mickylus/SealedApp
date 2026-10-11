import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5QrcodeAdapter } from './Html5QrcodeAdapter';
import type { ScannerStats } from './QrScannerAdapter';
import { loadPreferredCamera, savePreferredCamera } from './cameraPrefs';
import { playBeep } from '../lib/sound';

export function useScanner(enabled = true) {
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
  const runningRef = useRef(false);
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

  const enqueue = useCallback((task: () => Promise<void>) => {
    operation.current = operation.current
      .catch((reason: unknown) => {
        console.warn('Scanner operation failed:', reason);
      })
      .then(task);
    return operation.current;
  }, []);

  const stop = useCallback(() => {
    return enqueue(async () => {
      await adapter.stop();
      runningRef.current = false;
      setRunning(false);
    });
  }, [adapter, enqueue]);

  const decode = useCallback((value: string) => {
    const decodedValue = value.trim();
    if (!decodedValue) return;
    const now = Date.now();
    if (lastDecode.current.value === decodedValue && now - lastDecode.current.at < 3000) return;
    lastDecode.current = { value: decodedValue, at: now };
    setStats((current) => ({ ...current, lastDecodeAt: now }));
    setDecodedText(decodedValue);
    void playBeep();
  }, []);

  const scanFile = useCallback(async (file: File) => {
    try {
      decode(await adapter.scanFile(file));
    } catch (reason) {
      setError(reason instanceof Error ? `Impossibile leggere la foto: ${reason.message}` : 'Impossibile leggere il QR dalla foto.');
    }
  }, [adapter, decode]);

  const start = useCallback(() => {
    if (!selectedCamera) return Promise.resolve();
    return enqueue(async () => {
      if (runningRef.current) return;
      setError(null);
      try {
        await adapter.start(selectedCamera, decode, (nextStats) => {
          setStats((current) => ({
            ...nextStats,
            lastDecodeAt: Math.max(nextStats.lastDecodeAt ?? 0, current.lastDecodeAt ?? 0) || null,
          }));
        });
        savePreferredCamera(selectedCamera);
        runningRef.current = true;
        setRunning(true);
      } catch (reason) {
        setError(reason instanceof Error ? `Impossibile avviare la fotocamera: ${reason.message}` : `Impossibile avviare la fotocamera: ${String(reason)}`);
        runningRef.current = false;
        setRunning(false);
        await adapter.stop();
      }
    });
  }, [adapter, decode, enqueue, selectedCamera]);

  useEffect(() => {
    if (!enabled) {
      autoStartRequested.current = false;
      void stop();
      return;
    }
    void refreshCameras();
    return () => { void stop(); };
  }, [enabled, refreshCameras, stop]);

  useEffect(() => {
    if (enabled && cameras.length > 0 && selectedCamera && !autoStartRequested.current) {
      autoStartRequested.current = true;
      void start();
    }
  }, [enabled, cameras, selectedCamera, start]);

  return { cameras, selectedCamera, setSelectedCamera, stats, decodedText, setDecodedText, decode, error, running, refreshCameras, start, stop, scanFile, adapter };
}
