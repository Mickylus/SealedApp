import { useEffect, useRef, useState } from 'react';
import { ScanDiagnostics } from './ScanDiagnostics';
import { useScanner } from './useScanner';
import { clearScans, getScans, saveScan, updateScan, type StoredScan } from '../database/scanDatabase';
import foodsSeed from '../database/foods.seed.json';

type Food = (typeof foodsSeed.foods)[number];
type StorageMode = 'fridge' | 'freezer';
const containerSizes: StoredScan['size'][] = ['S', 'M', 'L', 'XL'];
const today = () => new Date().toISOString().slice(0, 10);

function getFood(id?: string): Food | undefined {
  return foodsSeed.foods.find((food) => food.id === id);
}

function getExpirationDate(container: StoredScan): string | null {
  const food = getFood(container.foodId);
  const days = food?.shelfLife[container.storage ?? 'fridge']?.normalDays;
  if (!container.storedAt || days == null) return null;
  const date = new Date(`${container.storedAt}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('it-IT');
}

export function ScannerView() {
  const scanner = useScanner();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [flash, setFlash] = useState(false);
  const [lab, setLab] = useState({ active: false, attempts: 0, successes: 0, startedAt: 0, averageMs: 0 });
  const [savedScanCount, setSavedScanCount] = useState(0);
  const [databaseStatus, setDatabaseStatus] = useState('Database locale pronto.');
  const [containers, setContainers] = useState<StoredScan[]>([]);
  const labStart = useRef(0);
  const labLastDecode = useRef<number | null>(null);
  const persistedDecodeAt = useRef<number | null>(null);

  useEffect(() => {
    if (!lab.active) return;
    const attempts = lab.attempts + 1;
    const success = scanner.stats.lastDecodeAt !== null
      && scanner.stats.lastDecodeAt >= labStart.current
      && scanner.stats.lastDecodeAt !== labLastDecode.current;
    if (success) labLastDecode.current = scanner.stats.lastDecodeAt;
    const successes = lab.successes + (success ? 1 : 0);
    const elapsed = Date.now() - labStart.current;
    if (attempts >= 20) {
      setLab({ active: false, attempts, successes, startedAt: lab.startedAt, averageMs: successes ? elapsed / successes : 0 });
    } else {
      setLab((current) => ({ ...current, attempts, successes }));
    }
  }, [scanner.stats.lastDecodeAt, scanner.stats.failedFrames]); // A stats tick is one lab attempt.

  const startLab = () => {
    labStart.current = Date.now();
    labLastDecode.current = null;
    setLab({ active: true, attempts: 0, successes: 0, startedAt: Date.now(), averageMs: 0 });
  };

  useEffect(() => {
    if (!scanner.decodedText) return;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 220);
    return () => window.clearTimeout(timer);
  }, [scanner.decodedText]);

  useEffect(() => {
    void getScans()
      .then((scans) => {
        setContainers(scans);
        setSavedScanCount(scans.length);
      })
      .catch((reason: unknown) => setDatabaseStatus(reason instanceof Error ? reason.message : 'Database locale non disponibile.'));
  }, []);

  useEffect(() => {
    if (!scanner.decodedText || scanner.stats.lastDecodeAt === persistedDecodeAt.current) return;
    persistedDecodeAt.current = scanner.stats.lastDecodeAt;
    void saveScan(scanner.decodedText)
      .then(({ count, added }) => {
        setSavedScanCount(count);
        void getScans().then(setContainers);
        setDatabaseStatus(added
          ? `Nuovo contenitore salvato: ${count} codici unici.`
          : `Contenitore già presente: ${count} codici unici.`);
      })
      .catch((reason: unknown) => {
        setDatabaseStatus(reason instanceof Error ? reason.message : 'Impossibile salvare il codice nel database.');
      });
  }, [scanner.stats.lastDecodeAt, scanner.decodedText]);

  const clearDatabase = async () => {
    if (!window.confirm('Eliminare tutti i codici memorizzati nel database locale?')) return;
    try {
      await clearScans();
      setSavedScanCount(0);
      setContainers([]);
      setDatabaseStatus('Database locale svuotato.');
    } catch (reason) {
      setDatabaseStatus(reason instanceof Error ? reason.message : 'Impossibile svuotare il database locale.');
    }
  };

  const updateContainer = async (container: StoredScan, changes: Partial<StoredScan>) => {
    if (container.id === undefined) return;
    try {
      await updateScan(container.id, changes);
      setContainers(await getScans());
      setDatabaseStatus('Dati del contenitore aggiornati.');
    } catch (reason) {
      setDatabaseStatus(reason instanceof Error ? reason.message : 'Impossibile aggiornare il contenitore.');
    }
  };

  const decodedContainer = containers.find((container) => container.code === scanner.decodedText);

  return (
    <main className="app-shell">
      <header>
        <p className="eyebrow">SEALED</p>
        <h1>Scanner QR</h1>
        <p className="intro">Inquadra il codice sul coperchio del contenitore.</p>
      </header>
      <section className="scanner-card">
        <div id="sealed-reader" className={`reader${flash ? ' reader-flash' : ''}`} aria-label="Area di scansione" />
        <div className="controls">
          <label htmlFor="camera">Fotocamera</label>
          <select id="camera" value={scanner.selectedCamera} onChange={(event) => scanner.setSelectedCamera(event.target.value)} disabled={scanner.running}>
            {scanner.cameras.length === 0 && <option value="">Nessuna fotocamera rilevata</option>}
            {scanner.cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Fotocamera ${index + 1}`}</option>)}
          </select>
          <div className="button-row">
            {!scanner.running
              ? <button onClick={() => void scanner.start()} disabled={!scanner.selectedCamera}>Avvia fotocamera</button>
              : <button className="secondary" onClick={() => void scanner.stop()}>Ferma</button>}
            <button className="secondary" onClick={() => void scanner.refreshCameras()}>Aggiorna elenco</button>
          </div>
        </div>
        {scanner.error && <p className="error" role="alert">{scanner.error}</p>}
        {scanner.decodedText && <p className="success">Contenitore letto: <strong>{getFood(decodedContainer?.foodId)?.name || scanner.decodedText}</strong></p>}
      </section>
      <section className="tools">
        <button className="link-button" onClick={() => setShowDiagnostics((visible) => !visible)}>
          {showDiagnostics ? 'Nascondi diagnostica' : 'Mostra diagnostica'}
        </button>
        <button className="link-button" onClick={startLab} disabled={lab.active}>Avvia Scanner lab</button>
        {lab.active && <p>Analisi in corso: {lab.attempts}/20 tentativi</p>}
        {!lab.active && lab.attempts > 0 && <p>Scanner lab: {lab.successes}/20 successi ({Math.round(lab.successes / lab.attempts * 100)}%), tempo medio {Math.round(lab.averageMs)} ms.</p>}
      </section>
      <section className="storage-card">
        <h2>Database locale</h2>
        <p>I codici vengono memorizzati automaticamente nel browser, senza file o permessi.</p>
        <p role="status">{databaseStatus} Totale: {savedScanCount}.</p>
        <button className="secondary" onClick={() => void clearDatabase()} disabled={savedScanCount === 0}>
          Svuota database
        </button>
        <div className="container-list">
          <h3>Contenitori</h3>
          {containers.length === 0
            ? <p>Nessun contenitore memorizzato.</p>
            : containers.map((container) => (
              <article className="container-item" key={container.id}>
                <div>
                  <label>Dimensione
                    <select value={container.size ?? ''} onChange={(event) => void updateContainer(container, { size: event.target.value as StoredScan['size'] })}>
                      <option value="">Seleziona</option>
                      {containerSizes.map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                  </label>
                  <label>Alimento
                    <select
                      value={container.foodId ?? ''}
                      onChange={(event) => void updateContainer(container, {
                        foodId: event.target.value,
                        storedAt: container.storedAt ?? today(),
                        storage: container.storage ?? 'fridge',
                      })}
                    >
                      <option value="">Seleziona alimento</option>
                      {foodsSeed.foods.map((food) => <option key={food.id} value={food.id}>{food.name}</option>)}
                    </select>
                  </label>
                  <label>Conservazione
                    <select
                      value={container.storage ?? 'fridge'}
                      onChange={(event) => void updateContainer(container, {
                        storage: event.target.value as StorageMode,
                        storedAt: container.storedAt ?? today(),
                      })}
                    >
                      <option value="fridge">Frigorifero</option>
                      <option value="freezer">Congelatore</option>
                    </select>
                  </label>
                  <label>Inserito il
                    <input type="date" value={container.storedAt ?? today()} onChange={(event) => void updateContainer(container, { storedAt: event.target.value })} />
                  </label>
                  <code>{container.code}</code>
                  {getExpirationDate(container) && <span className="expiry">Scadenza: {getExpirationDate(container)}</span>}
                </div>
              </article>
            ))}
        </div>
      </section>
      <ScanDiagnostics stats={scanner.stats} visible={showDiagnostics} />
      <div id="sealed-file-reader" hidden />
    </main>
  );
}
