import { existsSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'

/** Vero se `percorso` sta dentro un repository git (cerca `.git` risalendo). */
export function dentroUnRepository(percorso: string): boolean {
  let corrente = resolve(percorso)
  for (;;) {
    if (existsSync(join(corrente, '.git'))) return true
    const padre = dirname(corrente)
    if (padre === corrente) return false
    corrente = padre
  }
}

export function destinazioneAmmessa(out: string): boolean {
  const p = resolve(out)
  return !dentroUnRepository(p) || p.split(sep).includes('staging-winwaste')
}
