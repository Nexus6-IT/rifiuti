/**
 * Registro delle risorse create durante una run E2E, consumato dal teardown
 * (vedi e2e/scripts/verifica-residuo.ts, agganciato come globalTeardown in
 * playwright.config.ts).
 *
 * Il registro deve sopravvivere al confine di processo: ogni worker
 * Playwright è un processo Node separato da quello che esegue il
 * globalTeardown, quindi un semplice array in memoria non basta — ogni
 * `registra()` persiste anche su file (append-only, una riga JSON per
 * risorsa) sotto e2e/.artifacts/, che `ripulisci()` rilegge e consuma a
 * prescindere da quale processo l'abbia chiamata.
 */

import fs from 'node:fs'
import path from 'node:path'
import { apiDelete, ApiClientError } from '../utils/api-client'
import { esentaDallaBlacklist } from '../utils/blacklist'
import { eliminaFirConPrefisso } from '../utils/db-locale'
import { runId } from '../utils/run-id'

export type TipoRisorsa = 'produttore' | 'trasportatore' | 'destinatario' | 'fir'

interface RisorsaRegistrata {
  tipo: TipoRisorsa
  id: string
}

const ARTIFACTS_DIR = path.join(__dirname, '..', '.artifacts')

function percorsoRegistro(): string {
  return path.join(ARTIFACTS_DIR, `registro-${runId()}.jsonl`)
}

// Mappa tipo -> segmento della rotta REST di registry. "fir" non ha un
// endpoint di cancellazione HTTP (il ciclo di vita FIR conosce solo
// l'annulla irreversibile, già in blacklist): viene ripulito a livello di
// database, vedi utils/db-locale.ts e la sezione dedicata in `ripulisci`.
const PERCORSO_API: Record<Exclude<TipoRisorsa, 'fir'>, string> = {
  produttore: 'produttori',
  trasportatore: 'trasportatori',
  destinatario: 'destinatari',
}

/**
 * Registra una risorsa creata in questo run: viene tracciata per il
 * teardown ed esentata dal guardrail DELETE /registry/* (vedi
 * utils/blacklist.ts `esentaDallaBlacklist`) per la durata del processo
 * corrente.
 */
export function registra(tipo: TipoRisorsa, id: string): void {
  esentaDallaBlacklist(id)
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  const riga = JSON.stringify({ tipo, id } satisfies RisorsaRegistrata)
  fs.appendFileSync(percorsoRegistro(), riga + '\n', 'utf-8')
}

function leggiRegistro(): RisorsaRegistrata[] {
  const percorso = percorsoRegistro()
  if (!fs.existsSync(percorso)) return []
  const contenuto = fs.readFileSync(percorso, 'utf-8')
  return contenuto
    .split('\n')
    .map(riga => riga.trim())
    .filter(riga => riga.length > 0)
    .map(riga => JSON.parse(riga) as RisorsaRegistrata)
}

/**
 * Quante risorse sono registrate (e non ancora ripulite) per la run
 * corrente, in qualunque processo siano state registrate. Usata dal
 * globalTeardown per decidere se c'è qualcosa da fare (vedi
 * utils/decisione-teardown.ts).
 */
export function contaRisorseRegistrate(): number {
  return leggiRegistro().length
}

/**
 * Ripulisce tutte le risorse registrate in questo run, in qualunque
 * processo siano state registrate (vedi persistenza su file sopra).
 *
 * Idempotente: se il file del registro non esiste, o è già vuoto (run già
 * ripulita, o run morta prima di registrare qualunque cosa), non fa nulla e
 * non fallisce — può girare più volte di seguito senza errori.
 *
 * Ogni cancellazione fallita (diversa da "già cancellata", 404) finisce in
 * `residue` invece di far esplodere l'intera pulizia: un residuo è una
 * segnalazione esplicita, non un crash che nasconde le cancellazioni
 * riuscite delle altre risorse.
 *
 * I FIR (nessun endpoint HTTP di cancellazione) vengono raccolti a parte e
 * ripuliti in blocco a livello di database (utils/db-locale.ts), che
 * verifica autonomamente il vincolo "solo ciò che porta il prefisso della
 * run" — non basta che l'id sia registrato qui.
 */
export async function ripulisci(token: string): Promise<{ rimosse: number; residue: string[] }> {
  const risorse = leggiRegistro()
  let rimosse = 0
  const residue: string[] = []
  const idFir: string[] = []

  for (const risorsa of risorse) {
    if (risorsa.tipo === 'fir') {
      idFir.push(risorsa.id)
      continue
    }

    esentaDallaBlacklist(risorsa.id)
    try {
      await apiDelete(`/registry/${PERCORSO_API[risorsa.tipo]}/${risorsa.id}`, token)
      rimosse++
    } catch (errore) {
      if (errore instanceof ApiClientError && errore.status === 404) {
        // Già cancellata (es. teardown rieseguito dopo una run morta a
        // metà, o cancellata dal test stesso): non è un residuo.
        rimosse++
        continue
      }
      residue.push(`${risorsa.tipo}:${risorsa.id}`)
    }
  }

  if (idFir.length > 0) {
    const esitoFir = await eliminaFirConPrefisso(idFir)
    rimosse += esitoFir.rimossi
    residue.push(...esitoFir.residue)
  }

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  fs.writeFileSync(percorsoRegistro(), '', 'utf-8')

  return { rimosse, residue }
}
