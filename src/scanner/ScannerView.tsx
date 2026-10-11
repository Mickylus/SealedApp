import { useEffect, useRef, useState } from 'react';
import { ScanDiagnostics } from './ScanDiagnostics';
import { useScanner } from './useScanner';
import { clearScans, getScans, saveScan, updateScan, type StoredScan } from '../database/scanDatabase';
import { getContainerType } from '../database/containerCatalog';
import foodsSeed from '../database/food.seed.json';

type Food = (typeof foodsSeed.foods)[number];
type FoodOverride = { fridgeDays?: number; freezerDays?: number; icon?: string; photo?: string };
type StorageMode = 'fridge' | 'freezer';
type Screen = 'home' | 'scanner' | 'settings' | 'foods' | 'detail' | 'new-container' | 'food-editor';
const today = () => new Date().toISOString().slice(0, 10);
const foodIcons: Record<string, string> = {
  raw: '🥩',
  cooked: '🍲',
  other: '🧀',
};

function getFood(id: string | undefined, overrides: Record<string, FoodOverride> = {}): Food | undefined {
  void overrides;
  return foodsSeed.foods.find((item) => item.id === id);
}

function getFoodIcon(food?: Food, override?: FoodOverride): string {
  if (!food) return '🍽️';
  if (override?.photo) return override.photo;
  if (override?.icon) return override.icon;
  if (/uova|uovo/i.test(food.id)) return '🥚';
  if (/pane/i.test(food.id)) return '🍞';
  if (/burro|formaggi/i.test(food.id)) return '🧀';
  if (/pesce|crostacei/i.test(food.category)) return '🐟';
  if (/frutta|verdur|insalata|pomodor/i.test(food.category)) return '🥦';
  if (/pasta|riso|zuppe|sughi|cotti/i.test(food.category)) return '🍲';
  if (/carne|salumi/i.test(food.category)) return '🥩';
  return foodIcons[food.state] ?? '🍽️';
}

function FoodVisual({ food, override }: { food?: Food; override?: FoodOverride }) {
  const icon = getFoodIcon(food, override);
  return icon.startsWith('data:image/') ? <img src={icon} alt="" /> : <>{icon}</>;
}

function getContainerCode(code: string): string {
  const normalized = decodeURIComponent(code).toUpperCase().replace(/\s/g, '');
  const marker = normalized.match(/(?:[?&]|^)CC=([A-Z0-9]+)/)?.[1];
  return getContainerType(code)?.code ?? marker?.slice(0, 4) ?? normalized.match(/[A-Z0-9]{4}/)?.[0] ?? code;
}

function ContainerIcon({ code, compact = false }: { code: string; compact?: boolean }) {
  const description = getContainerType(code)?.description ?? '';
  const isBag = /borsa|sacchetto/i.test(description);
  const size = description.match(/\b(XL|S|M|L)\b/i)?.[1]?.toUpperCase() ?? 'M';
  const color = /grigi/i.test(description) ? 'gray' : 'blue';
  return <span className={`container-mark${compact ? ' compact' : ''} ${isBag ? 'bag' : 'box'} ${color} size-${size.toLowerCase()}`} aria-label={`${isBag ? 'Sacchetto' : 'Contenitore'} ${size} ${color === 'gray' ? 'grigio' : 'blu'}`}><span aria-hidden="true" /></span>;
}

function getExpirationDate(container: StoredScan, overrides: Record<string, FoodOverride>): string | null {
  const food = getFood(container.foodId, overrides);
  const days = getFoodDays(food, container.storage ?? 'fridge', overrides[container.foodId ?? '']);
  if (!container.storedAt || days == null) return null;
  const date = new Date(`${container.storedAt}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('it-IT');
}

function getRemainingDays(container: StoredScan, overrides: Record<string, FoodOverride>): number | null {
  const food = getFood(container.foodId, overrides);
  const days = getFoodDays(food, container.storage ?? 'fridge', overrides[container.foodId ?? '']);
  if (!container.storedAt || days == null) return null;
  const date = new Date(`${container.storedAt}T00:00:00`);
  date.setDate(date.getDate() + days);
  return Math.ceil((date.getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86400000);
}

function getFoodDays(food: Food | undefined, storage: StorageMode, override?: FoodOverride): number | undefined {
  if (!food) return undefined;
  return storage === 'fridge'
    ? override?.fridgeDays ?? food.shelfLife.fridge?.normalDays
    : override?.freezerDays ?? food.shelfLife.freezer?.normalDays;
}

export function ScannerView() {
  const [screen, setScreen] = useState<Screen>('home');
  const [foodMode, setFoodMode] = useState<'assign' | 'catalog'>('assign');
  const [editingFoodId, setEditingFoodId] = useState<string | undefined>();
  const [foodOverrides, setFoodOverrides] = useState<Record<string, FoodOverride>>(() => {
    try {
      return JSON.parse(localStorage.getItem('sealed-food-overrides') ?? '{}') as Record<string, FoodOverride>;
    } catch {
      return {};
    }
  });
  const [foodDraft, setFoodDraft] = useState<FoodOverride>({});
  const foodPhotoInput = useRef<HTMLInputElement>(null);
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
  const [newContainerSize, setNewContainerSize] = useState<StoredScan['size']>('L');
  const importInput = useRef<HTMLInputElement>(null);
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
            if (isInUse && scannedContainer) {
              setSelectedContainerId(scannedContainer.id);
              setScreen('detail');
            } else if (scannedContainer) {
              setSelectedContainerId(scannedContainer.id);
              if (getContainerType(scannedContainer.code)) {
                setFoodMode('assign');
                setScreen('foods');
              } else {
                setNewContainerSize(scannedContainer.size ?? 'L');
                setScreen('new-container');
              }
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

  const exportBackup = async () => {
    try {
      const backup = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), scans: await getScans() }, null, 2);
      const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `sealed-backup-${today()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setDatabaseStatus('Backup esportato correttamente.');
    } catch (reason) {
      setDatabaseStatus(reason instanceof Error ? reason.message : 'Impossibile esportare il backup.');
    }
  };

  const importBackup = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { scans?: StoredScan[] };
      if (!Array.isArray(parsed.scans) || parsed.scans.some((scan) => typeof scan.code !== 'string')) {
        throw new Error('Il file selezionato non è un backup Sealed valido.');
      }
      for (const scan of parsed.scans) {
        await saveScan(scan.code);
        const current = (await getScans()).find((item) => item.code === scan.code);
        if (current?.id !== undefined) await updateScan(current.id, scan);
      }
      const scans = await getScans();
      setContainers(scans);
      setSavedScanCount(scans.length);
      setDatabaseStatus('Backup importato correttamente.');
    } catch (reason) {
      setDatabaseStatus(reason instanceof Error ? reason.message : 'Impossibile importare il backup.');
    }
  };

  const decodedContainer = containers.find((container) => container.code === scanner.decodedText);
  const saveFoodOverride = (id: string, override: FoodOverride) => {
    const next = { ...foodOverrides, [id]: override };
    setFoodOverrides(next);
    localStorage.setItem('sealed-food-overrides', JSON.stringify(next));
  };
  const activeContainers = containers.filter((container) => !container.status || container.status === 'active');
  const visibleContainers = activeContainers.filter((container) => filter === 'all' || (container.storage ?? 'fridge') === filter);
  const expiredCount = activeContainers.filter((container) => (getRemainingDays(container, foodOverrides) ?? 1) < 0).length;
  const expiringCount = activeContainers.filter((container) => {
    const days = getRemainingDays(container, foodOverrides);
    return days !== null && days >= 0 && days <= 2;
  }).length;

  return (
    <main className={`app-shell${screen === 'scanner' ? ' scanner-screen' : ''}`}>
      <header className="app-header">
        <div>
          <p className="eyebrow">SEALED</p>
          <h1>{screen === 'home' ? 'Inventario' : screen === 'scanner' ? 'Scansiona' : 'Impostazioni'}</h1>
          <p className="intro">{screen === 'home' ? `${activeContainers.length} contenitori in uso` : screen === 'scanner' ? 'Inquadra il QR sul coperchio' : screen === 'foods' ? (foodMode === 'catalog' ? 'Gestisci durate e icone' : 'Scegli il contenuto del contenitore') : screen === 'food-editor' ? 'Modifica alimento' : screen === 'detail' ? 'Dettaglio contenitore' : screen === 'new-container' ? 'Configura il nuovo contenitore' : 'Personalizza la tua esperienza'}</p>
        </div>
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
                  const food = getFood(container.foodId, foodOverrides);
                  const remaining = getRemainingDays(container, foodOverrides);
                  return <article className="container-item modern-item" key={container.id}>
                    <div className="food-mark" aria-label={getContainerType(container.code)?.description || 'Contenitore'}><ContainerIcon code={container.code} compact /></div>
                    <button className="container-main container-open" onClick={() => { setSelectedContainerId(container.id); setScreen('detail'); }}>
                      <strong>{food?.name || 'Alimento da configurare'}</strong>
                      <span>{getContainerType(container.code)?.description || 'Contenitore'} · {container.storage === 'freezer' ? 'Congelatore' : 'Frigorifero'}</span>
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
          <button className="back-button" onClick={() => setScreen(foodMode === 'catalog' ? 'settings' : 'home')}>‹ {foodMode === 'catalog' ? 'Impostazioni' : 'Torna all\'inventario'}</button>
          <h2>{foodMode === 'catalog' ? 'Catalogo alimenti' : 'Che cosa hai conservato?'}</h2>
          <p>{foodMode === 'catalog' ? 'Seleziona un alimento per modificare durata e icona.' : 'Scegli il cibo per calcolare automaticamente i giorni rimanenti.'}</p>
          <div className="food-options">{foodsSeed.foods.map((food) => {
            const effectiveFood = getFood(food.id, foodOverrides) ?? food;
            const override = foodOverrides[food.id];
            return <button key={food.id} className="food-option" onClick={() => {
              if (foodMode === 'catalog') {
                setEditingFoodId(food.id);
                setFoodDraft({ ...override });
                setScreen('food-editor');
                return;
              }
              const container = containers.find((item) => item.id === selectedContainerId);
              if (container) void updateContainer(container, { foodId: food.id, storedAt: container.storedAt ?? today(), storage: container.storage ?? 'fridge' });
              setScreen('detail');
            }}><span className="food-option-icon" aria-hidden="true"><FoodVisual food={effectiveFood} override={override} /></span><strong>{food.name}</strong></button>;
          })}</div>
        </section>
      ) : screen === 'food-editor' ? (
        <section className="food-page food-editor">
          {(() => {
            const food = getFood(editingFoodId, foodOverrides);
            if (!food || !editingFoodId) return <button className="back-button" onClick={() => setScreen('settings')}>‹ Impostazioni</button>;
            const override = foodOverrides[editingFoodId];
            return <>
              <button className="back-button" onClick={() => { setEditingFoodId(undefined); setScreen('foods'); }}>‹ Catalogo alimenti</button>
              <h2>{food.name}</h2>
              <p>Personalizza la durata e l'icona mostrata nell'app.</p>
              <div className="food-editor-preview"><span><FoodVisual food={food} override={foodDraft} /></span></div>
              <label>Durata in frigorifero (giorni)<input type="number" min="0" value={foodDraft.fridgeDays ?? food.shelfLife.fridge?.normalDays ?? ''} onChange={(event) => setFoodDraft((draft) => ({ ...draft, fridgeDays: Number(event.target.value) }))} /></label>
              <label>Durata nel congelatore (giorni)<input type="number" min="0" value={foodDraft.freezerDays ?? food.shelfLife.freezer?.normalDays ?? ''} onChange={(event) => setFoodDraft((draft) => ({ ...draft, freezerDays: Number(event.target.value) }))} /></label>
              <p className="editor-label">Icona predefinita</p>
              <div className="icon-picker">{['🥩', '🍗', '🐟', '🥦', '🍎', '🍞', '🥚', '🧀', '🍲', '🍚'].map((icon) => <button type="button" key={icon} className={foodDraft.icon === icon && !foodDraft.photo ? 'selected' : ''} onClick={() => setFoodDraft((draft) => ({ ...draft, icon, photo: undefined }))}>{icon}</button>)}</div>
              <button className="secondary" type="button" onClick={() => foodPhotoInput.current?.click()}>Carica una foto</button>
              <input ref={foodPhotoInput} className="visually-hidden" type="file" accept="image/*" onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setFoodDraft((draft) => ({ ...draft, photo: typeof reader.result === 'string' ? reader.result : undefined, icon: undefined }));
                reader.readAsDataURL(file);
                event.target.value = '';
              }} />
              {override?.photo || foodDraft.photo ? <button className="cancel-container-button" type="button" onClick={() => setFoodDraft((draft) => ({ ...draft, photo: undefined }))}>Rimuovi foto</button> : null}
              <button className="save-container-button" type="button" onClick={() => { saveFoodOverride(editingFoodId, foodDraft); setScreen('foods'); }}>Salva modifiche</button>
            </>;
          })()}
        </section>
      ) : screen === 'new-container' ? (
        <section className="new-container-page">
          {(() => {
            const container = containers.find((item) => item.id === selectedContainerId);
            if (!container) return <button className="back-button" onClick={() => setScreen('home')}>‹ Contenitori</button>;
            return <>
              <button className="back-button" onClick={() => setScreen('home')}>‹ Annulla</button>
              <p className="eyebrow">NUOVO CONTENITORE</p>
              <h2>Configura il tuo contenitore</h2>
              <p className="new-container-intro">Non riconosciamo questo codice. Scegli la misura per aggiungerlo al tuo inventario.</p>
              <div className="size-picker" role="radiogroup" aria-label="Misura del contenitore">
                {(['S', 'M', 'L', 'XL'] as const).map((size) => (
                  <button key={size} type="button" className={newContainerSize === size ? 'size-option active' : 'size-option'} onClick={() => setNewContainerSize(size)} aria-pressed={newContainerSize === size}>
                    <span className={`size-shape size-${size.toLowerCase()}`} aria-hidden="true" />
                    <strong>{size}</strong>
                  </button>
                ))}
              </div>
              <div className="unknown-container-card">
                <div><span>Codice contenitore</span><strong>{getContainerCode(container.code)}</strong></div>
                <div><span>Taglia scelta</span><strong>{newContainerSize}</strong></div>
                <div><span>Origine tag</span><strong>QR da confermare</strong></div>
              </div>
              <button className="save-container-button" onClick={() => {
                void updateContainer(container, { size: newContainerSize }).then(() => setScreen('home'));
              }}>Salva contenitore</button>
              <button className="cancel-container-button" onClick={() => setScreen('home')}>Annulla</button>
            </>;
          })()}
        </section>
      ) : screen === 'detail' ? (
        <section className="detail-page">
          {(() => {
            const container = containers.find((item) => item.id === selectedContainerId);
            if (!container) return <button className="back-button" onClick={() => setScreen('home')}>‹ Torna all'inventario</button>;
            const food = getFood(container.foodId, foodOverrides);
            return <><button className="back-button" onClick={() => setScreen('home')}>‹ Contenitori</button><div className="detail-container-heading"><div><h2>{food?.name || 'Contenitore'}</h2><p className="detail-status">{getRemainingDays(container, foodOverrides) === null ? 'Inserisci il cibo per calcolare la durata' : `Scade il ${getExpirationDate(container, foodOverrides)}`}</p></div></div><div className="detail-card"><div><span>Contenitore</span><strong>{getContainerType(container.code)?.description || 'Non riconosciuto'}</strong></div><div><span>Conservazione</span><select value={container.storage ?? 'fridge'} onChange={(event) => void updateContainer(container, { storage: event.target.value as StorageMode, storedAt: container.storedAt ?? today() })}><option value="fridge">Frigorifero</option><option value="freezer">Congelatore</option></select></div><div><span>Inserito il</span><input type="date" value={container.storedAt ?? today()} onChange={(event) => void updateContainer(container, { storedAt: event.target.value })} /></div><div><span>Codice contenitore</span><code>{getContainerCode(container.code)}</code></div></div><div className="release-actions"><button className="eat-button" onClick={() => void releaseContainer(container, 'consumed')}>✓ Mangiato</button><button className="discard-button" onClick={() => void releaseContainer(container, 'discarded')}>♧ Buttato</button></div><button className="food-change" onClick={() => { setFoodMode('assign'); setScreen('foods'); }}>Modifica alimento</button></>;
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
            {scanner.decodedText && <p className="success">Contenitore letto: <strong>{getFood(decodedContainer?.foodId, foodOverrides)?.name || scanner.decodedText}</strong></p>}
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
          <button className="settings-row" onClick={() => void exportBackup()}>↧ <span><strong>Esporta backup</strong><small>Scarica una copia dei tuoi dati</small></span><b>›</b></button>
          <button className="settings-row" onClick={() => importInput.current?.click()}>↥ <span><strong>Importa backup</strong><small>Ripristina i dati salvati</small></span><b>›</b></button>
          <input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importBackup(file);
            event.target.value = '';
          }} />
          <h2>CATALOGO</h2>
          <button className="settings-row" onClick={() => { setFoodMode('catalog'); setScreen('foods'); }}>☷ <span><strong>Catalogo alimenti</strong><small>{foodsSeed.foods.length} voci disponibili</small></span><b>›</b></button>
          <h2>SCANSIONE</h2>
          <button className="settings-row" onClick={() => setScreen('scanner')}>▣ <span><strong>Fotocamera</strong><small>Posteriore</small></span><b>›</b></button>
          <button className="settings-row" onClick={() => setShowDiagnostics((visible) => !visible)}>▥ <span><strong>Mostra diagnostica</strong><small>Risoluzione, fps e frame falliti</small></span><b>{showDiagnostics ? 'ON' : 'OFF'}</b></button>
          <ScanDiagnostics stats={scanner.stats} visible={showDiagnostics} />
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
