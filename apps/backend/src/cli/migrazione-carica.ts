/**
 * `node dist/cli/migrazione-carica.js --tenant <uuid> --pacchetto <cartella> --ambito <AMBITO>
 *   [--operatore <uuid utente>] [--verifica] [--dimensione-blocco N]`
 *
 * Gira sul server, dentro l'immagine del backend (compilato in `dist/cli/`, senza ts-node), col
 * SOLO client applicativo (RLS). Un'azienda alla volta. Il pacchetto non e' fidato: viene verificato
 * (impronte, righe, mappa) e ogni record e' rivalidato lato server.
 *
 * `--operatore`: l'utente dell'azienda a cui si attribuisce il lotto. Obbligatorio per l'ambito FIR
 * (`firs.producer_user_id` e' una FK a `users`); verificato contro l'azienda.
 *
 * `--verifica`: solo letture (transazione read-only). Elenca i bloccanti e non scrive nulla.
 *
 * Codici di uscita: 0 ok (verifica: nessun bloccante); 1 caricamento fallito o errore imprevisto
 * (il lotto, se aperto, e' `FALLITO`); 2 pacchetto rifiutato, record non validi o bloccanti in
 * verifica; 64 uso errato.
 *
 * Output e log: solo codici, id tecnici e conteggi. Mai valori dei record.
 */
import { NestFactory } from '@nestjs/core'
import { LottoGiaInCorsoError } from '../application/migrazione/caricamento/errori'
import { FaseCaricamentoFallitaError } from '../application/migrazione/caricamento/carica-ambito'
import {
  AmbitoNonCaricabileError,
  BloccantiVerificaError,
  CaricaPacchettoService,
  NullaDaCaricareError,
  RuoloNonApplicativoError,
} from '../application/migrazione/caricamento/carica-pacchetto.service'
import { apriPacchetto } from '../application/migrazione/pacchetto/lettore-pacchetto'
import { PacchettoError } from '../application/migrazione/pacchetto/errori-pacchetto'
import {
  AMBITI_PACCHETTO,
  AmbitoPacchetto,
} from '../application/migrazione/pacchetto/manifest-pacchetto'
import { MigrazioneModule } from '../application/migrazione/migrazione.module'

export interface UscitaCli {
  scrivi(messaggio: string): void
  errore(messaggio: string): void
}

export type ServizioCarica = Pick<
  CaricaPacchettoService,
  'verifica' | 'carica' | 'verificaRuoloApplicativo'
>

const USO =
  'uso: migrazione:carica --tenant <uuid> --pacchetto <cartella> --ambito <' +
  `${AMBITI_PACCHETTO.join('|')}> [--operatore <uuid>] [--verifica] [--dimensione-blocco <N>]`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALORE = ['--tenant', '--pacchetto', '--ambito', '--operatore', '--dimensione-blocco']

interface Argomenti {
  tenant: string
  pacchetto: string
  ambito: AmbitoPacchetto
  operatore?: string
  verifica: boolean
  dimensioneBlocco?: number
}

export function leggiArgomenti(argv: readonly string[]): Argomenti | null {
  const valori: Record<string, string> = {}
  let verifica = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--verifica') {
      verifica = true
    } else if (VALORE.includes(a) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      if (a in valori) return null
      valori[a] = argv[++i]
    } else {
      return null
    }
  }
  const { '--tenant': tenant, '--pacchetto': pacchetto, '--ambito': ambito } = valori
  if (!tenant || !UUID.test(tenant) || !pacchetto) return null
  if (!ambito || !(AMBITI_PACCHETTO as readonly string[]).includes(ambito)) return null
  const operatore = valori['--operatore']
  if (operatore !== undefined && !UUID.test(operatore)) return null
  let dimensioneBlocco: number | undefined
  if ('--dimensione-blocco' in valori) {
    dimensioneBlocco = Number(valori['--dimensione-blocco'])
    if (!Number.isInteger(dimensioneBlocco) || dimensioneBlocco < 1 || dimensioneBlocco > 5000)
      return null
  }
  return {
    tenant: tenant.toLowerCase(),
    pacchetto,
    ambito: ambito as AmbitoPacchetto,
    operatore: operatore?.toLowerCase(),
    verifica,
    dimensioneBlocco,
  }
}

/** Elenchi di identificativi dei bloccanti (numero FIR e chiave CLIFOR), con l'indicazione da seguire. */
function scriviElenchi(
  uscita: UscitaCli,
  elenchi: Readonly<Record<string, readonly string[]>> | undefined
): void {
  for (const [codice, voci] of Object.entries(elenchi ?? {})) {
    for (const v of voci) uscita.errore(`${codice} ${v}`)
    if (codice === 'FIR_IN_VIAGGIO_SENZA_PESO')
      uscita.errore(
        'completare i FIR in WinWaste prima dell estrazione, poi rifare staging e pacchetto'
      )
  }
}

export async function eseguiCli(
  argv: readonly string[],
  uscita: UscitaCli,
  servizio: ServizioCarica
): Promise<number> {
  const args = leggiArgomenti(argv)
  if (!args) {
    uscita.errore(USO)
    return 64
  }
  try {
    await servizio.verificaRuoloApplicativo()
    const pacchetto = await apriPacchetto(args.pacchetto)
    const richiesta = {
      tenantId: args.tenant,
      pacchetto,
      ambito: args.ambito,
      dimensioneBlocco: args.dimensioneBlocco,
      avviatoDa: args.operatore ?? null,
    }
    if (args.verifica) {
      const rapporto = await servizio.verifica(richiesta)
      for (const [k, v] of Object.entries(rapporto.informazioni)) uscita.scrivi(`${k}: ${v}`)
      for (const b of rapporto.bloccanti) uscita.errore(`BLOCCANTE ${b.codice}: ${b.conteggio}`)
      scriviElenchi(uscita, rapporto.elenchi)
      if (rapporto.bloccanti.length > 0) return 2
      uscita.scrivi('verifica: nessun bloccante')
      return 0
    }
    const esito = await servizio.carica(richiesta)
    const c = esito.conteggi
    uscita.scrivi(`lotto ${esito.lottoId} completato`)
    // Da conservare col rapporto di destinazione: legano il lotto allo staging e alla mappa anche
    // dopo la cancellazione del pacchetto (`hash_staging` del lotto = hashManifest).
    uscita.scrivi(`hashStaging: ${pacchetto.manifest.hashStaging}`)
    uscita.scrivi(`hashMappa: ${pacchetto.manifest.hashMappa}`)
    uscita.scrivi(`hashManifest: ${pacchetto.hashManifest}`)
    uscita.scrivi(
      `lette: ${c.lette}; inserite: ${c.inserite}; saltate: ${c.saltate}; blocchi: ${c.blocchi}`
    )
    return 0
  } catch (e) {
    if (e instanceof PacchettoError) {
      uscita.errore(`pacchetto rifiutato: ${e.message}`)
      return 2
    }
    if (e instanceof BloccantiVerificaError) {
      for (const b of e.bloccanti) uscita.errore(`BLOCCANTE ${b.codice}: ${b.conteggio}`)
      scriviElenchi(uscita, e.elenchi)
      return 2
    }
    if (e instanceof NullaDaCaricareError) {
      uscita.scrivi(e.message)
      return 0
    }
    if (e instanceof AmbitoNonCaricabileError) {
      uscita.errore(e.message)
      return 2
    }
    if (e instanceof RuoloNonApplicativoError) {
      uscita.errore(e.message)
      return 1
    }
    if (e instanceof LottoGiaInCorsoError) {
      uscita.errore(e.message)
      return 1
    }
    if (e instanceof FaseCaricamentoFallitaError) {
      uscita.errore(`${e.message} (lotto ${e.lottoId} FALLITO)`)
      return 1
    }
    // Qualunque altro errore: solo il nome della classe, mai il messaggio (potrebbe portare valori).
    uscita.errore(`errore imprevisto: ${e instanceof Error ? e.name : 'sconosciuto'}`)
    return 1
  }
}

async function principale(): Promise<number> {
  // Uso errato: si risponde prima di aprire il contesto (e quindi il database).
  if (!leggiArgomenti(process.argv.slice(2))) {
    process.stderr.write(`${USO}\n`)
    return 64
  }
  // Logger di Nest spento e niente abort: un errore di avvio arriva qui e si stampa solo per nome.
  const app = await NestFactory.createApplicationContext(MigrazioneModule, {
    logger: false,
    abortOnError: false,
  })
  try {
    return await eseguiCli(
      process.argv.slice(2),
      { scrivi: m => process.stdout.write(`${m}\n`), errore: m => process.stderr.write(`${m}\n`) },
      app.get(CaricaPacchettoService)
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
