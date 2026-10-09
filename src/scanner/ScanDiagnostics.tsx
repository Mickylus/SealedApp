import type { ScannerStats } from './QrScannerAdapter';

export function ScanDiagnostics({ stats, visible }: { stats: ScannerStats; visible: boolean }) {
  if (!visible) return null;
  return (
    <section className="diagnostics" aria-label="Diagnostica scanner">
      <h2>Diagnostica</h2>
      <dl>
        <div><dt>Video</dt><dd>{stats.videoWidth || '—'} × {stats.videoHeight || '—'}</dd></div>
        <div><dt>FPS</dt><dd>{stats.fps?.toFixed(1) ?? '—'}</dd></div>
        <div><dt>Frame falliti</dt><dd>{stats.failedFrames}</dd></div>
        <div><dt>Ultimo decode</dt><dd>{stats.lastDecodeAt ? new Date(stats.lastDecodeAt).toLocaleTimeString('it-IT') : '—'}</dd></div>
        <div><dt>Capability</dt><dd>{stats.capabilityKeys.length ? stats.capabilityKeys.join(', ') : '—'}</dd></div>
      </dl>
    </section>
  );
}
