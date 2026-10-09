export interface ScanRecord {
  code: string;
  scannedAt: string;
}

interface JsonArchive {
  version: 1;
  scans: ScanRecord[];
}

interface WritableFile {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface JsonFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableFile>;
}

interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<JsonFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<JsonFileHandle>;
}

const filePickerTypes = [{
  description: 'Archivio JSON',
  accept: { 'application/json': ['.json'] },
}];

function parseArchive(content: string): JsonArchive {
  if (!content.trim()) return { version: 1, scans: [] };
  const parsed: unknown = JSON.parse(content);
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !Array.isArray((parsed as { scans?: unknown }).scans)
  ) {
    throw new Error('Il file selezionato non contiene un archivio JSON valido.');
  }
  return { version: 1, scans: (parsed as { scans: ScanRecord[] }).scans };
}

export class JsonStore {
  private handle: JsonFileHandle | null = null;
  private archive: JsonArchive = { version: 1, scans: [] };

  get fileName(): string | null {
    return this.handle?.name ?? null;
  }

  async openFile(): Promise<string> {
    const pickerWindow = window as FilePickerWindow;
    if (!pickerWindow.showOpenFilePicker) {
      throw new Error('Questo browser non supporta la scrittura diretta dei file.');
    }
    const [handle] = await pickerWindow.showOpenFilePicker({
      multiple: false,
      types: filePickerTypes,
    });
    if (!handle) throw new Error('Nessun file selezionato.');
    this.handle = handle;
    this.archive = parseArchive(await handle.getFile().then((file) => file.text()));
    return handle.name;
  }

  async createFile(): Promise<string> {
    const pickerWindow = window as FilePickerWindow;
    if (!pickerWindow.showSaveFilePicker) {
      throw new Error('Questo browser non supporta la scrittura diretta dei file.');
    }
    const handle = await pickerWindow.showSaveFilePicker({
      suggestedName: 'sealed-scans.json',
      types: filePickerTypes,
    });
    this.handle = handle;
    this.archive = { version: 1, scans: [] };
    await this.write();
    return handle.name;
  }

  async append(code: string): Promise<number> {
    if (!this.handle) throw new Error('Seleziona prima un archivio JSON.');
    this.archive.scans.push({ code, scannedAt: new Date().toISOString() });
    await this.write();
    return this.archive.scans.length;
  }

  private async write(): Promise<void> {
    if (!this.handle) throw new Error('Seleziona prima un archivio JSON.');
    const writable = await this.handle.createWritable();
    try {
      await writable.write(`${JSON.stringify(this.archive, null, 2)}\n`);
    } finally {
      await writable.close();
    }
  }
}
