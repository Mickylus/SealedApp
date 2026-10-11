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

## Design mobile e Android

Il design di riferimento è stato ricreato come interfaccia mobile-first:

- Inventario con contatori per scaduti, in scadenza e contenitori ok
- Filtri Tutti, Frigo e Freezer
- Card contenitore con alimento, taglia, conservazione e giorni rimanenti
- Scanner QR dedicato
- Impostazioni e navigazione inferiore persistente

Il percorso consigliato per distribuire questa app su Android è **Capacitor**. Permette di riusare React e Vite, aggiungendo un progetto Android gestibile con Android Studio:

1. installare `@capacitor/core` e `@capacitor/cli`;
2. eseguire `npx cap init` e impostare `webDir` su `dist`;
3. aggiungere `@capacitor/android` con `npx cap add android`;
4. creare la build con `npm run build` e sincronizzarla con `npx cap sync android`;
5. aprire il progetto con `npx cap open android`;
6. configurare il permesso fotocamera nel manifest Android e generare APK/AAB da Android Studio.

Questa strada conserva la logica del database locale e consente di usare il plugin fotocamera di Capacitor se l'accesso browser alla webcam non fosse sufficiente su Android. Un'alternativa più impegnativa sarebbe una riscrittura nativa in Kotlin/Jetpack Compose; non è necessaria per il design attuale.

## Build APK Android

Il progetto Capacitor Android è nella cartella `android/`. Dopo aver installato
Android Studio con Android SDK, SDK Platform 36, Build Tools e un JDK compatibile,
imposta `JAVA_HOME` e `ANDROID_HOME` (o `ANDROID_SDK_ROOT`) e avvia:

```bash
npm run android:build
```

L'APK di debug viene generato in
`android/app/build/outputs/apk/debug/app-debug.apk`. Per aprirlo in Android
Studio usa `npx cap open android`.
