/**
 * `node dist/cli/migrazione-riacquisisci-fir.js --tenant <uuid> --pacchetto <cartella> --utente <uuid>
 *   [--esegui] [--pausa-ms N] [--massimo N]`
 *
 * Riacquisisce da RENTRI i FIR DIGITALI elencati nel pacchetto (fase `fir-digitali`), che non si
 * copiano da WinWaste (Q5 del 14/11). SOLA LETTURA verso l'ente: mai `creaFormulario`, mai
 * `acquisisciVisibilita`. Un FIR riacquisito nasce senza provenienza e non bloccato.
 *
 * Senza `--esegui` e' una SIMULAZIONE: non si contatta RENTRI e non si scrive nulla. Limite di
 * frequenza: `--pausa-ms` fra due chiamate (default 3000, minimo 1000), `--massimo` FIR per
 * esecuzione (default 25, massimo 500); si ferma al primo errore transitorio dell'ente.
 *
 * Codici di uscita: 0 ok; 1 esecuzione interrotta dall'ente o FIR falliti; 2 pacchetto rifiutato o
 * utente non abilitato; 64 uso errato. Output: solo numeri di FIR, esiti e conteggi.
 */
import { NestFactory } from '@nestjs/core'
import { PacchettoError } from '../application/migrazione/pacchetto/errori-pacchetto'
import { apriPacchetto } from '../application/migrazione/pacchetto/lettore-pacchetto'
import { RiacquisizioneFirModule } from '../application/migrazione/riacquisizione/riacquisizione-fir.module'
import {
  RiacquisisciFirService,
  UtenteNonAbilitatoError,
} from '../application/migrazione/riacquisizione/riacquisisci-fir.service'

export interface UscitaCli {
  scrivi(messaggio: string): void
  errore(messaggio: string): void
}

export type ServizioRiacquisizione = Pick<RiacquisisciFirService, 'esegui'>

const USO =
  'uso: migrazione:riacquisisci-fir --tenant <uuid> --pacchetto <cartella> --utente <uuid> ' +
  '[--esegui] [--pausa-ms <N>] [--massimo <N>]'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALORE = ['--tenant', '--pacchetto', '--utente', '--pausa-ms', '--massimo']
export const PAUSA_MS_DEFAULT = 3000
export const PAUSA_MS_MINIMA = 1000
export const MASSIMO_DEFAULT = 25
export const MASSIMO_LIMITE = 500

export interface Argomenti {
  tenant: string
  pacchetto: string
  utente: string
  esegui: boolean
  pausaMs: number
  massimo: number
}

export function leggiArgomenti(argv: readonly string[]): Argomenti | null {
  const valori: Record<string, string> = {}
  let esegui = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--esegui') esegui = true
    else if (VALORE.includes(a) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      if (a in valori) return null
      valori[a] = argv[++i]
    } else return null
  }
  const { '--tenant': tenant, '--pacchetto': pacchetto, '--utente': utente } = valori
  if (!tenant || !UUID.test(tenant) || !pacchetto || !utente || !UUID.test(utente)) return null
  const intero = (nome: string, predefinito: number, min: number, max: number): number | null => {
    if (!(nome in valori)) return predefinito
    const n = Number(valori[nome])
    return Number.isInteger(n) && n >= min && n <= max ? n : null
  }
  const pausaMs = intero('--pausa-ms', PAUSA_MS_DEFAULT, PAUSA_MS_MINIMA, 3_600_000)
  const massimo = intero('--massimo', MASSIMO_DEFAULT, 1, MASSIMO_LIMITE)
  if (pausaMs === null || massimo === null) return null
  return {
    tenant: tenant.toLowerCase(),
    pacchetto,
    utente: utente.toLowerCase(),
    esegui,
    pausaMs,
    massimo,
  }
}

export async function eseguiCli(
  argv: readonly string[],
  uscita: UscitaCli,
  servizio: ServizioRiacquisizione
): Promise<number> {
  const args = leggiArgomenti(argv)
  if (!args) {
    uscita.errore(USO)
    return 64
  }
  try {
    const pacchetto = await apriPacchetto(args.pacchetto)
    if (pacchetto.mappa.tenantId !== args.tenant) {
      uscita.errore('la mappa del pacchetto appartiene a un altra azienda')
      return 2
    }
    uscita.scrivi(
      args.esegui ? 'modalita: ESECUZIONE (sola lettura su RENTRI)' : 'modalita: SIMULAZIONE'
    )
    const r = await servizio.esegui({
      tenantId: args.tenant,
      userId: args.utente,
      pacchetto,
      esegui: args.esegui,
      pausaMs: args.pausaMs,
      massimo: args.massimo,
    })
    for (const e of r.esiti)
      uscita.scrivi(`${e.numeroFir} ${e.esito}${e.codice ? ` ${e.codice}` : ''}`)
    for (const [esito, n] of Object.entries(r.conteggi)) uscita.scrivi(`${esito}: ${n}`)
    if (r.conteggi.INTERROTTO_CREDENZIALE)
      uscita.errore('interrotto: credenziale RENTRI assente o rifiutata (401), il resto e RINVIATO')
    else if (r.interrotto) uscita.errore("interrotto: l'ente ha risposto con un errore transitorio")
    const falliti =
      (r.conteggi.FALLITO ?? 0) +
      (r.conteggi.VISIBILITA_NON_ACQUISITA ?? 0) +
      (r.conteggi.NON_TROVATO_SU_RENTRI ?? 0)
    return r.interrotto || falliti > 0 ? 1 : 0
  } catch (e) {
    if (e instanceof PacchettoError) {
      uscita.errore(`pacchetto rifiutato: ${e.message}`)
      return 2
    }
    if (e instanceof UtenteNonAbilitatoError) {
      uscita.errore(e.message)
      return 2
    }
    uscita.errore(`errore imprevisto: ${e instanceof Error ? e.name : 'sconosciuto'}`)
    return 1
  }
}

async function principale(): Promise<number> {
  if (!leggiArgomenti(process.argv.slice(2))) {
    process.stderr.write(`${USO}\n`)
    return 64
  }
  const app = await NestFactory.createApplicationContext(RiacquisizioneFirModule, {
    logger: false,
    abortOnError: false,
  })
  try {
    return await eseguiCli(
      process.argv.slice(2),
      { scrivi: m => process.stdout.write(`${m}\n`), errore: m => process.stderr.write(`${m}\n`) },
      app.get(RiacquisisciFirService)
    )
  } finally {
    await app.close()
  }
}

if (require.main === module) {
  principale().then(
    codice => process.exit(codice),
    e => {
      process.stderr.write(`errore imprevisto: ${e instanceof Error ? e.name : 'sconosciuto'}\n`)
      process.exit(1)
    }
  )
}
