// Tipi minimi di Node per leggere, in una sola spec, il sorgente del service worker (`public/sw-campo.js`).
// Il file e' escluso dalla build dell'app (tsconfig.app.json) e non aggiunge dipendenze.
declare module 'node:fs' {
  export function readFileSync(percorso: string, codifica: 'utf8'): string;
}
declare module 'node:path' {
  export function join(...parti: string[]): string;
}
declare const process: { cwd(): string };
