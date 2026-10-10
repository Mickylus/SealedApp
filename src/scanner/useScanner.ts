import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5QrcodeAdapter } from './Html5QrcodeAdapter';
import type { ScannerStats } from './QrScannerAdapter';
import { loadPreferredCamera, savePreferredCamera } from './cameraPrefs';
import { playBeep } from '../lib/sound';

export function useScanner(active: boolean) {
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
  }, [adapter, selectedCamera, stop]);

  useEffect(() => {
    void refreshCameras();
    return () => { void stop(); };
  }, [refreshCameras, stop]);

  useEffect(() => {
    if (!active || !selectedCamera) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (!cancelled) void start();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      void stop();
    };
  }, [active, selectedCamera, start, stop]);

  return { cameras, selectedCamera, setSelectedCamera, stats, decodedText, setDecodedText, error, running, refreshCameras, start, stop, adapter };
}
