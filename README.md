# Sealed

Sealed è una web app locale per registrare gli alimenti nei contenitori Zwilling Fresh & Save.

## Avvio

Richiede Node.js 18 o superiore.

```bash
npm install
npm run dev
```

Apri l'indirizzo mostrato da Vite (normalmente `http://localhost:5173`) e consenti l'accesso alla fotocamera.

## Fase 0

La prima fase contiene lo scanner QR con selezione della fotocamera, preferenza locale dell'ultima fotocamera, diagnostica tecnica e Scanner lab per 20 tentativi. Il codice letto viene mostrato senza ancora salvarlo: dominio, catalogo e persistenza IndexedDB saranno aggiunti nelle fasi successive.
