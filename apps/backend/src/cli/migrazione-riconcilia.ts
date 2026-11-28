/**
 * `node dist/cli/migrazione-riconcilia.js --tenant <uuid> --rapporto-sorgente <file.json>
 *   [--lotti <uuid>[,<uuid>...]] [--rapporto <uuid radice>] [--giacenze-attese <file.json>]
 *   [--seme <testo>] [--campione <N>] [--operatore <uuid utente>]`
 *
 * Riconciliazione di un import (I8): confronta il rapporto sorgente WinWaste (`migrazione:analizza`) con
 * i lotti caricati e produce un rapporto VERSIONATO con i confronti 1-5 e il campione a mano (6).
 * Gira sul server dentro l'immagine del backend, col SOLO client applicativo (RLS), un'azienda alla
 * volta. Sola lettura sui lotti: scrive solo le tre tabelle di riconciliazione.
 *
 * Senza `--lotti` si usano i lotti `COMPLETATO` dell'archivio del rapporto sorgente. Con `--rapporto` si
 * ricalcola un rapporto esistente (stessi lotti e stesso campione): se nulla e' cambiato non nasce una
 * versione nuova. `--giacenze-attese` e' un JSON `[{ "cer": "15 01 01", "kg": 720 }]` (da
 * `migrazione:prepara`); senza, il confronto 3 e' NON_VERIFICATO e resta una differenza da accettare.
 *
 * La verifica su RENTRI e' sempre in SOLA LETTURA (nessuna POST); questa CLI non ha credenziali RENTRI:
 * il confronto 5 resta NON_VERIFICATO finche' un chiamante con il client non la esegue.
 *
 * Codici di uscita: 0 rapporto generato (anche se non chiudibile: lo dice l'ultima riga); 1 errore
 * imprevisto; 2 input non valido o lotti inesistenti; 64 uso errato.
 * Output e log: solo codici, id tecnici, conteggi e totali. Mai valori dei record.
 */
import { NestFactory } from '@nestjs/core'
import { readFile } from 'fs/promises'
import { SorgenteRiconciliazione } from '../domain/migrazione/riconciliazione/confronti'
import { hashCanonico } from '../domain/migrazione/riconciliazione/hash-rapporto'
import { GiacenzaAttesa } from '../domain/migrazione/riconciliazione/tipi'
import { MigrazioneRiconciliaModule } from '../application/migrazione/riconciliazione/migrazione-riconcilia.module'
import {
  RapportoChiusoError,
  RapportoNonTrovatoError,
  VersioneCambiataError,
} from '../application/migrazione/riconciliazione/errori'
import { LottiNonTrovatiError } from '../application/migrazione/riconciliazione/leggi-destinazione'
import {
  RapportoLetto,
  RiconciliazioneService,
} from '../application/migrazione/riconciliazione/riconciliazione.service'

export interface UscitaCli {
  scrivi(messaggio: string): void
  errore(messaggio: string): void
}

export type ServizioRiconcilia = Pick<RiconciliazioneService, 'genera' | 'lottiCompletati'>

const USO =
  'uso: migrazione:riconcilia --tenant <uuid> --rapporto-sorgente <file.json> ' +
  '[--lotti <uuid,...>] [--rapporto <uuid>] [--giacenze-attese <file.json>] [--seme <testo>] ' +
  '[--campione <N>] [--operatore <uuid>]'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALORE = [
  '--tenant',
  '--rapporto-sorgente',
  '--lotti',
  '--rapporto',
  '--giacenze-attese',
  '--seme',
  '--campione',
  '--operatore',
]

export interface ArgomentiRiconcilia {
  tenant: string
  rapportoSorgente: string
  lotti?: string[]
  rapporto?: string
  giacenzeAttese?: string
  seme?: string
  campione?: number
  operatore?: string
}

export function leggiArgomenti(argv: readonly string[]): ArgomentiRiconcilia | null {
  const v: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (VALORE.includes(a) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      if (a in v) return null
      v[a] = argv[++i]
    } else return null
  }
  const tenant = v['--tenant']
  const sorgente = v['--rapporto-sorgente']
  if (!tenant || !UUID.test(tenant) || !sorgente) return null
  let lotti: string[] | undefined
  if (v['--lotti'] !== undefined) {
    lotti = v['--lotti'].split(',').map(x => x.trim().toLowerCase())
    if (lotti.length === 0 || lotti.some(l => !UUID.test(l))) return null
  }
  for (const k of ['--rapporto', '--operatore'])
    if (v[k] !== undefined && !UUID.test(v[k])) return null
  if (v['--rapporto'] !== undefined && lotti) return null // un ricalcolo usa i lotti del rapporto
  let campione: number | undefined
  if (v['--campione'] !== undefined) {
    campione = Number(v['--campione'])
    if (!Number.isInteger(campione) || campione < 0 || campione > 1000) return null
  }
  return {
    tenant: tenant.toLowerCase(),
    rapportoSorgente: sorgente,
    lotti,
    rapporto: v['--rapporto']?.toLowerCase(),
    giacenzeAttese: v['--giacenze-attese'],
    seme: v['--seme'],
    campione,
    operatore: v['--operatore']?.toLowerCase(),
  }
}

export class InputNonValidoError extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'InputNonValidoError'
  }
}

const array = (x: unknown): x is unknown[] => Array.isArray(x)

/** Il rapporto sorgente non e' fidato: si controlla la forma che i confronti leggono. */
export function validaRapportoSorgente(json: unknown): SorgenteRiconciliazione {
  const r = json as Record<string, any> | null
  const ok =
    r !== null &&
    typeof r === 'object' &&
    r.formato === 'winwaste-rapporto-sorgente/1' &&
    typeof r.archivio === 'string' &&
    /^WW\d{8}$/.test(r.archivio) &&
    array(r.confronto1?.movimentiPerOper) &&
    array(r.confronto1?.formulariPerStato) &&
    array(r.confronto2?.righe) &&
    array(r.confronto4?.registri) &&
    typeof r.confronto5?.renRegistrazioni?.presente === 'boolean'
  if (!ok) throw new InputNonValidoError('rapporto sorgente non valido (formato o campi mancanti)')
  return r as unknown as SorgenteRiconciliazione
}

export function validaGiacenzeAttese(json: unknown): GiacenzaAttesa[] {
  if (
    !array(json) ||
    json.some(
      g =>
        g === null ||
        typeof g !== 'object' ||
        typeof (g as any).cer !== 'string' ||
        typeof (g as any).kg !== 'number' ||
        !Number.isFinite((g as any).kg)
    )
  )
    throw new InputNonValidoError('giacenze attese non valide (atteso [{ "cer": "...", "kg": N }])')
  return json as GiacenzaAttesa[]
}

async function leggiJson(percorso: string): Promise<unknown> {
  let testo: string
  try {
    testo = await readFile(percorso, 'utf8')
  } catch {
    throw new InputNonValidoError('file non leggibile')
  }
  try {
    return JSON.parse(testo)
  } catch {
    throw new InputNonValidoError('il file non e un JSON valido')
  }
}

export function scriviRapporto(uscita: UscitaCli, r: RapportoLetto, nuova: boolean): void {
  uscita.scrivi(
    `rapporto ${r.radiceId} versione ${r.versione} ${r.stato}${nuova ? '' : ' (invariato)'}`
  )
  uscita.scrivi(`impronta: ${r.hashRapporto}`)
  uscita.scrivi(`lotti: ${r.lottiImportIds.join(',')}`)
  for (const c of r.esiti.confronti) {
    uscita.scrivi(`confronto ${c.numero} ${c.esito}${c.nota ? `: ${c.nota}` : ''}`)
    for (const v of c.voci) {
      if (v.esito !== 'DIFFERENZA') continue
      const acc = r.esiti.accettazioni[`${c.numero}:${v.chiave}`] ? ' (accettata)' : ''
      uscita.scrivi(
        `  DIFFERENZA ${c.numero}:${v.chiave} sorgente=${v.sorgente ?? '-'} destinazione=${v.destinazione ?? '-'}${acc}`
      )
    }
  }
  const k = r.esiti.campione
  uscita.scrivi(
    `campione (seme ${k.seme}): ${k.movimenti} movimenti e ${k.fir} FIR, ${r.valutazione.campioniSenzaEsito} senza esito`
  )
  uscita.scrivi(
    `chiudibile: ${r.valutazione.chiudibile ? 'si' : 'no'} (differenze aperte: ${r.valutazione.differenzeAperte.length})`
  )
}

export async function eseguiCli(
  argv: readonly string[],
  uscita: UscitaCli,
  servizio: ServizioRiconcilia
): Promise<number> {
  const args = leggiArgomenti(argv)
  if (!args) {
    uscita.errore(USO)
    return 64
  }
  try {
    const grezzo = await leggiJson(args.rapportoSorgente)
    const sorgente = validaRapportoSorgente(grezzo)
    const giacenzeAttese = args.giacenzeAttese
      ? validaGiacenzeAttese(await leggiJson(args.giacenzeAttese))
      : undefined
    const lottiIds = args.rapporto
      ? []
      : (args.lotti ?? (await servizio.lottiCompletati(args.tenant, sorgente.archivio)))
    if (!args.rapporto && lottiIds.length === 0) {
      uscita.errore(`nessun lotto COMPLETATO per l archivio ${sorgente.archivio}`)
      return 2
    }
    const esito = await servizio.genera({
      tenantId: args.tenant,
      lottiIds,
      sorgente,
      hashSorgente: hashCanonico(grezzo),
      giacenzeAttese,
      seme: args.seme,
      dimensioneCampione: args.campione,
      creatoDa: args.operatore ?? null,
      radiceId: args.rapporto,
    })
    scriviRapporto(uscita, esito.rapporto, esito.nuovaVersione)
    return 0
  } catch (e) {
    if (
      e instanceof InputNonValidoError ||
      e instanceof LottiNonTrovatiError ||
      e instanceof RapportoNonTrovatoError ||
      e instanceof RapportoChiusoError ||
      e instanceof VersioneCambiataError
    ) {
      uscita.errore(e.message)
      return 2
    }
    // Qualunque altro errore: solo il nome della classe, mai il messaggio (potrebbe portare valori).
    uscita.errore(`errore imprevisto: ${e instanceof Error ? e.name : 'sconosciuto'}`)
    return 1
  }
}

async function principale(): Promise<number> {
  if (!leggiArgomenti(process.argv.slice(2))) {
    process.stderr.write(`${USO}\n`)
    return 64
  }
  const app = await NestFactory.createApplicationContext(MigrazioneRiconciliaModule, {
    logger: false,
    abortOnError: false,
  })
  try {
    return await eseguiCli(
      process.argv.slice(2),
      { scrivi: m => process.stdout.write(`${m}\n`), errore: m => process.stderr.write(`${m}\n`) },
      app.get(RiconciliazioneService)
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
