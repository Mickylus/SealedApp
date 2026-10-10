import { useEffect, useRef, useState } from 'react';
import { ScanDiagnostics } from './ScanDiagnostics';
import { useScanner } from './useScanner';
import { clearScans, getScans, saveScan, updateScan, type StoredScan } from '../database/scanDatabase';
import { getContainerType } from '../database/containerCatalog';
import foodsSeed from '../database/food.seed.json';

type Food = (typeof foodsSeed.foods)[number];
type StorageMode = 'fridge' | 'freezer';
type Screen = 'home' | 'scanner' | 'settings' | 'foods' | 'detail';
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

function getRemainingDays(container: StoredScan): number | null {
  const food = getFood(container.foodId);
  const days = food?.shelfLife[container.storage ?? 'fridge']?.normalDays;
  if (!container.storedAt || days == null) return null;
  const date = new Date(`${container.storedAt}T00:00:00`);
  date.setDate(date.getDate() + days);
  return Math.ceil((date.getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86400000);
}

export function ScannerView() {
  const [screen, setScreen] = useState<Screen>('home');
  const [filter, setFilter] = useState<'all' | StorageMode>('all');
  const [selectedContainerId, setSelectedContainerId] = useState<number | undefined>();
  const scanner = useScanner(screen === 'scanner');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [flash, setFlash] = useState(false);
  const [lab, setLab] = useState({ active: false, attempts: 0, successes: 0, startedAt: 0, averageMs: 0 });
  const [savedScanCount, setSavedScanCount] = useState(0);
  const [databaseStatus, setDatabaseStatus] = useState('Database locale pronto.');
  const [containers, setContainers] = useState<StoredScan[]>([]);
  const [manualCode, setManualCode] = useState('');
  const [showManualCode, setShowManualCode] = useState(false);
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
        return getScans().then(async (scans) => {
          let scannedContainer = scans.find((scan) => scan.code === scanner.decodedText);
          const isInUse = scannedContainer != null
            && (!scannedContainer.status || scannedContainer.status === 'active')
            && scannedContainer.foodId != null;

          if (scannedContainer && !isInUse && scannedContainer.id !== undefined) {
            await updateScan(scannedContainer.id, {
              foodId: undefined,
              storage: undefined,
              storedAt: undefined,
              expirationDate: undefined,
              status: 'active',
            });
            scans = await getScans();
            scannedContainer = scans.find((scan) => scan.code === scanner.decodedText);
          }

          setContainers(scans);
          if (!isInUse && scannedContainer) {
            setSelectedContainerId(scannedContainer.id);
            setScreen('foods');
          }
          return { added, count };
        });
      })
      .then(({ count, added }) => {
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

  const releaseContainer = async (container: StoredScan, status: 'consumed' | 'discarded') => {
    if (container.id === undefined) return;
    try {
      await updateScan(container.id, { status });
      const scans = await getScans();
      setContainers(scans);
      setSelectedContainerId(undefined);
      setScreen('home');
      setDatabaseStatus(status === 'consumed' ? 'Contenitore liberato: cibo mangiato.' : 'Contenitore liberato: cibo buttato.');
    } catch (reason) {
      setDatabaseStatus(reason instanceof Error ? reason.message : 'Impossibile liberare il contenitore.');
    }
  };

  const decodedContainer = containers.find((container) => container.code === scanner.decodedText);
  const activeContainers = containers.filter((container) => !container.status || container.status === 'active');
  const visibleContainers = activeContainers.filter((container) => filter === 'all' || (container.storage ?? 'fridge') === filter);
  const expiredCount = activeContainers.filter((container) => (getRemainingDays(container) ?? 1) < 0).length;
  const expiringCount = activeContainers.filter((container) => {
    const days = getRemainingDays(container);
    return days !== null && days >= 0 && days <= 2;
  }).length;

  return (
    <main className={`app-shell${screen === 'scanner' ? ' scanner-screen' : ''}`}>
      <header className="app-header">
        <div>
          <p className="eyebrow">SEALED</p>
          <h1>{screen === 'home' ? 'Inventario' : screen === 'scanner' ? 'Scansiona' : 'Impostazioni'}</h1>
          <p className="intro">{screen === 'home' ? `${activeContainers.length} contenitori in uso` : screen === 'scanner' ? 'Inquadra il QR sul coperchio' : screen === 'foods' ? 'Scegli il contenuto del contenitore' : screen === 'detail' ? 'Dettaglio contenitore' : 'Personalizza la tua esperienza'}</p>
        </div>
        <button className="qr-button" onClick={() => setScreen('scanner')} aria-label="Apri scanner QR">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 3h2v3h-2v-3Zm3-3h3v2h-3v-2Zm0 5h3v2h-3v-2Zm-3-5h2v2h-2v-2ZM7 7h1v1H7V7Zm10 0h1v1h-1V7ZM7 17h1v1H7v-1Z" /></svg>
        </button>
      </header>
      {screen === 'home' ? (
        <>
          <section className="stats-grid">
            <div className="stat-card danger"><strong>{expiredCount}</strong><span>Scaduti</span></div>
            <div className="stat-card caution"><strong>{expiringCount}</strong><span>In scadenza</span></div>
            <div className="stat-card good"><strong>{Math.max(0, savedScanCount - expiredCount - expiringCount)}</strong><span>Ok</span></div>
          </section>
          <div className="filter-row"><button className={filter === 'all' ? 'filter active' : 'filter'} onClick={() => setFilter('all')}>Tutti</button><button className={filter === 'fridge' ? 'filter active' : 'filter'} onClick={() => setFilter('fridge')}>Frigo</button><button className={filter === 'freezer' ? 'filter active' : 'filter'} onClick={() => setFilter('freezer')}>Freezer</button></div>
          <section className="storage-card">
            <div className="section-heading"><div><h2>I tuoi contenitori</h2><p>{databaseStatus}</p></div><button className="secondary" onClick={() => void clearDatabase()} disabled={savedScanCount === 0}>Svuota</button></div>
            <div className="container-list">
              {visibleContainers.length === 0
                ? <div className="empty-state"><span>✦</span><h3>Nessun contenitore ancora</h3><p>Scansiona il QR code di un contenitore per iniziare.</p></div>
                : visibleContainers.map((container) => {
                  const food = getFood(container.foodId);
                  const remaining = getRemainingDays(container);
                  return <article className="container-item modern-item" key={container.id}>
                    <div className="food-mark">{food?.name?.slice(0, 1) ?? '?'}</div>
                    <button className="container-main container-open" onClick={() => { setSelectedContainerId(container.id); setScreen('detail'); }}>
                      <strong>{food?.name || 'Alimento da configurare'}</strong>
                      <span>{getContainerType(container.code)?.description || 'Contenitore'} · {container.storage === 'freezer' ? 'Congelatore' : 'Frigorifero'}</span>
                      <code>{container.code}</code>
                    </button>
                    <div className={`days-left${remaining !== null && remaining <= 2 ? ' warning' : ''}`}>
                      <strong>{remaining ?? '—'}</strong><span>{remaining === 1 ? 'giorno' : 'giorni'}</span>
                    </div>
                    <span className="detail-arrow" aria-hidden="true">›</span>
                  </article>;
                })}
            </div>
          </section>
        </>
      ) : screen === 'foods' ? (
        <section className="food-page">
          <button className="back-button" onClick={() => setScreen('home')}>‹ Torna all'inventario</button>
          <h2>Che cosa hai conservato?</h2>
          <p>Scegli il cibo per calcolare automaticamente i giorni rimanenti.</p>
          <div className="food-options">{foodsSeed.foods.map((food) => <button key={food.id} className="food-option" onClick={() => {
            const container = containers.find((item) => item.id === selectedContainerId);
            if (container) void updateContainer(container, { foodId: food.id, storedAt: container.storedAt ?? today(), storage: container.storage ?? 'fridge' });
            setScreen('detail');
          }}><span>{food.name.slice(0, 1)}</span><strong>{food.name}</strong></button>)}</div>
        </section>
      ) : screen === 'detail' ? (
        <section className="detail-page">
          {(() => {
            const container = containers.find((item) => item.id === selectedContainerId);
            if (!container) return <button className="back-button" onClick={() => setScreen('home')}>‹ Torna all'inventario</button>;
            const food = getFood(container.foodId);
            return <><button className="back-button" onClick={() => setScreen('home')}>‹ Contenitori</button><h2>{food?.name || 'Contenitore'}</h2><p className="detail-status">{getRemainingDays(container) === null ? 'Inserisci il cibo per calcolare la durata' : `Scade il ${getExpirationDate(container)}`}</p><div className="detail-card"><div><span>Contenitore</span><strong>{getContainerType(container.code)?.description || 'Non riconosciuto'}</strong></div><div><span>Conservazione</span><select value={container.storage ?? 'fridge'} onChange={(event) => void updateContainer(container, { storage: event.target.value as StorageMode, storedAt: container.storedAt ?? today() })}><option value="fridge">Frigorifero</option><option value="freezer">Congelatore</option></select></div><div><span>Inserito il</span><input type="date" value={container.storedAt ?? today()} onChange={(event) => void updateContainer(container, { storedAt: event.target.value })} /></div><div><span>QR</span><code>{container.code}</code></div></div><div className="release-actions"><button className="eat-button" onClick={() => void releaseContainer(container, 'consumed')}>✓ Mangiato</button><button className="discard-button" onClick={() => void releaseContainer(container, 'discarded')}>♧ Buttato</button></div><button className="food-change" onClick={() => setScreen('foods')}>Modifica alimento</button></>;
          })()}
        </section>
      ) : (
        screen === 'scanner' ? <>
          <section className="scanner-card scanner-viewport">
            <div className="scanner-topbar">
              <button className="scanner-icon-button" onClick={() => setScreen('home')} aria-label="Chiudi scanner">×</button>
              <strong>Scansiona</strong>
              <button className="scanner-icon-button" aria-label="Illuminazione">ϟ</button>
            </div>
            <p className="camera-status">1080p · 30 fps · Fotocamera posteriore</p>
            <div id="sealed-reader" className={`reader${flash ? ' reader-flash' : ''}`} aria-label="Area di scansione" />
            <div className="scan-guide"><strong>Inquadra il QR sul coperchio</strong><span>Tieni il contenitore a 25–40 cm, con luce diffusa e senza riflessi sul QR.</span></div>
            {scanner.error && <p className="error" role="alert">{scanner.error}</p>}
            {scanner.decodedText && <p className="success">Contenitore letto: <strong>{getFood(decodedContainer?.foodId)?.name || scanner.decodedText}</strong></p>}
            <section className="scanner-actions" aria-label="Altre modalità di scansione">
              <p>Non hai il QR a portata di mano?</p>
              <div className="scanner-action-row">
                <button className="scanner-action" type="button" onClick={() => setShowManualCode((visible) => !visible)}>
                  <span aria-hidden="true">⌨</span> Inserisci codice
                </button>
                <label className="scanner-action" htmlFor="qr-photo">
                  <span aria-hidden="true">▧</span> Da foto
                </label>
                <input id="qr-photo" className="visually-hidden" type="file" accept="image/*" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void scanner.scanFile(file);
                  event.target.value = '';
                }} />
              </div>
              {showManualCode && <form className="manual-code-form" onSubmit={(event) => {
                event.preventDefault();
                scanner.decode(manualCode);
                setManualCode('');
                setShowManualCode(false);
              }}>
                <label htmlFor="manual-code">Codice del contenitore</label>
                <div>
                  <input id="manual-code" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="es. 4MQZS" autoFocus />
                  <button type="submit" disabled={!manualCode.trim()}>Conferma</button>
                </div>
              </form>}
            </section>
          </section>
        </> : <section className="settings-list">
          <h2>DATI</h2>
          <button className="settings-row" onClick={() => setDatabaseStatus('Backup locale disponibile nel browser.')}>↧ <span><strong>Esporta backup</strong><small>Salva i tuoi dati localmente</small></span><b>›</b></button>
          <button className="settings-row" onClick={() => setDatabaseStatus('Importazione disponibile prossimamente.')}>↥ <span><strong>Importa backup</strong><small>Ripristina i dati salvati</small></span><b>›</b></button>
          <h2>CATALOGO</h2>
          <button className="settings-row" onClick={() => setScreen('foods')}>☷ <span><strong>Catalogo alimenti</strong><small>{foodsSeed.foods.length} voci disponibili</small></span><b>›</b></button>
          <h2>SCANSIONE</h2>
          <button className="settings-row" onClick={() => setScreen('scanner')}>▣ <span><strong>Fotocamera</strong><small>Posteriore</small></span><b>›</b></button>
          <button className="settings-row" onClick={() => setShowDiagnostics((visible) => !visible)}>▥ <span><strong>Mostra diagnostica</strong><small>Risoluzione, fps e frame falliti</small></span><b>{showDiagnostics ? 'ON' : 'OFF'}</b></button>
          <button className="settings-row" onClick={startLab}>⌗ <span><strong>Scanner lab</strong><small>Misura la qualità della scansione</small></span><b>›</b></button>
          <p className="disclaimer">Le durate sono stime prudenti, non garanzie di sicurezza alimentare. I dati restano solo su questo dispositivo.</p>
        </section>
      )}
      <nav className={`bottom-nav${screen === 'scanner' ? ' hidden' : ''}`} aria-label="Navigazione principale">
        <button className={screen === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('home')}><span>☷</span>Inventario</button>
        <button className="nav-scan" onClick={() => setScreen('scanner')} aria-label="Scansiona">⌗</button>
        <button className={screen === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('settings')}><span>☷</span>Impostazioni</button>
      </nav>
      <div id="sealed-file-reader" hidden />
    </main>
  );
}
