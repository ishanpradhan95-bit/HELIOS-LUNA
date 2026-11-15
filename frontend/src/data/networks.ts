import type { Station } from '../math/analysis';
import dsn from './stations.json';

/** Ground networks. DSN from stations.json; ESA Estrack deep-space antennas at published (approximate) positions. */
export const ESTRACK: Station[] = [
  { id: 'DSA-1', name: 'New Norcia', lat: -31.0482, lon: 116.1914, heightM: 252 },
  { id: 'DSA-2', name: 'Cebreros', lat: 40.4527, lon: -4.3676, heightM: 794 },
  { id: 'DSA-3', name: 'Malargüe', lat: -35.776, lon: -69.3983, heightM: 1550 },
];
export const DSN: Station[] = dsn.stations;
export type Network = 'dsn' | 'estrack' | 'both' | 'custom';
export const NETWORKS: { id: Network; name: string }[] = [
  { id: 'dsn', name: 'NASA Deep Space Network' },
  { id: 'estrack', name: 'ESA Estrack deep-space' },
  { id: 'both', name: 'DSN + Estrack' },
  { id: 'custom', name: 'Custom stations' },
];
/** At most 8 stations: the per-step link state is an 8-bit mask. */
export function stationsFor(n: Network, custom: Station[]): Station[] {
  const l = n === 'dsn' ? DSN : n === 'estrack' ? ESTRACK : n === 'both' ? [...DSN, ...ESTRACK] : custom;
  return (l.length ? l : DSN).slice(0, 8);
}
