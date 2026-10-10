export interface ContainerType {
  code: string;
  description: string;
}

export const containerCatalog: ContainerType[] = [
  { code: '1M3J', description: 'Borsa L' },
  { code: '52WS', description: 'Borsa M' },
  { code: '6KND', description: 'Borsa S' },
  { code: '17F9', description: 'Ciotola L' },
  { code: '3XD9', description: 'Scatola L verde' },
  { code: '0D36', description: 'Scatola M grigia' },
  { code: '23KQ', description: 'Scatola M verde' },
  { code: '31ZD', description: 'Scatola S grigia' },
  { code: '0UNL', description: 'Ciotola S' },
  { code: '40KW', description: 'Scatola L verde' },
  { code: '23KP', description: 'Scatola M verde' },
  { code: '1DHZ', description: 'Ciotola M' },
  { code: '0KDV', description: 'Scatola M verde' },
];

export function getContainerType(code: string): ContainerType | undefined {
  const normalized = decodeURIComponent(code).toUpperCase().replace(/\s/g, '');
  const marker = normalized.match(/(?:[?&]|^)CC=([A-Z0-9]+)/)?.[1];
  const candidate = marker ?? normalized;
  return containerCatalog.find((container) => candidate === container.code || candidate.includes(container.code));
}
