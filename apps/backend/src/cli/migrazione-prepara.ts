/**
 * `npm run migrazione:prepara -- <cartella-staging> --mappa <mappa-import.json> --destinazione <cartella> [--forza]`
 *
 * Sulla workstation: staging + mappa -> `<destinazione>/<archivio>/` (pacchetto `wasteflow-pacchetto/1`).
 * NON apre il database e non importa Prisma ne NestJS. Output: solo conteggi e codici.
 *
 * Codici di uscita: 0 ok; 1 pacchetto gia esistente senza `--forza`; 2 staging, mappa o pacchetto
 * rifiutati; 64 uso errato.
 */
import { access, readFile, rm } from 'fs/promises'
import { join, resolve } from 'path'
import { PacchettoError } from '../application/migrazione/pacchetto/errori-pacchetto'
import { improntaMappa, validaMappa } from '../application/migrazione/pacchetto/mappa-import'
import { preparaPacchetto } from '../application/migrazione/pacchetto/prepara-pacchetto'
import { apriStaging } from '../application/migrazione/staging/lettore-staging'
import { StagingError } from '../application/migrazione/staging/manifest'

export interface UscitaCli {
  scrivi(messaggio: string): void
  errore(messaggio: string): void
}

const USO =
  'uso: migrazione:prepara <cartella-staging> --mappa <file> --destinazione <cartella> [--forza]'

async function esiste(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export async function eseguiCli(argv: readonly string[], uscita: UscitaCli): Promise<number> {
  let staging: string | undefined
  let mappaFile: string | undefined
  let destinazione: string | undefined
  let forza = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--forza') forza = true
    else if (
      (a === '--mappa' || a === '--destinazione') &&
      i + 1 < argv.length &&
      !argv[i + 1].startsWith('--')
    ) {
      if (a === '--mappa') mappaFile = argv[++i]
      else destinazione = argv[++i]
    } else if (!a.startsWith('--') && staging === undefined) staging = a
    else {
      uscita.errore(USO)
      return 64
    }
  }
  if (!staging || !mappaFile || !destinazione) {
    uscita.errore(USO)
    return 64
  }
  try {
    let json: unknown
    try {
      json = JSON.parse(await readFile(mappaFile, 'utf8'))
    } catch {
      throw new PacchettoError('MAPPA_ASSENTE', 'la mappa non esiste o non e JSON valido')
    }
    const mappa = validaMappa(json)
    const sorgente = await apriStaging(staging)
    const cartella = join(resolve(destinazione), sorgente.archivio)
    if (await esiste(cartella)) {
      if (!forza) {
        uscita.errore('pacchetto gia esistente: usa --forza per sovrascriverlo')
        return 1
      }
      await rm(cartella, { recursive: true, force: true })
    }
    const rapporto = await preparaPacchetto(sorgente, mappa, cartella)
    uscita.scrivi(`archivio ${rapporto.manifest.archivio}: pacchetto scritto in ${cartella}`)
    uscita.scrivi(`impronta mappa: ${improntaMappa(mappa)}`)
    for (const f of rapporto.manifest.file) uscita.scrivi(`${f.ambito}/${f.fase}: ${f.righe} righe`)
    uscita.scrivi(`ditte agganciate a quelle gia presenti: ${rapporto.agganciate}`)
    for (const d of rapporto.duplicati)
      uscita.scrivi(`duplicato ${d.tabella ?? 'CLIFOR'} ${d.scartata} (tenuta ${d.tenuta})`)
    for (const s of rapporto.scarti)
      uscita.scrivi(`scarto ${s.tabella} ${s.codice}: ${s.conteggio}`)
    for (const a of rapporto.avvisi)
      uscita.scrivi(`avviso ${a.tabella} ${a.codice}: ${a.conteggio}`)
    for (const d of rapporto.differenzeGiascar)
      uscita.scrivi(`differenza-giascar ${d.cod} ${d.giascarKg} ${d.ricalcolatoKg}`)
    if (rapporto.differenzeGiascar.length > 0)
      uscita.scrivi(
        `ATTENZIONE: ${rapporto.differenzeGiascar.length} carichi con GIASCAR diverso dal ricalcolo da RELAZ ` +
          '(COD, GIASCAR, ricalcolato in kg): il residuo caricato e quello ricalcolato; ' +
          'le differenze vanno al cliente insieme al rapporto'
      )
    for (const d of rapporto.caricoAltraUl)
      uscita.scrivi(`carico-altra-ul ${d.cod} OPER ${d.oper} protocollo ${d.protocollo ?? '-'}`)
    if (rapporto.caricoAltraUl.length > 0)
      uscita.scrivi(
        `ATTENZIONE: ${rapporto.caricoAltraUl.length} carichi su un'altra unita locale (OPER 15, 24, 16, 26) ` +
          'esclusi dalla giacenza importata: inserirli a mano se servono'
      )
    for (const d of rapporto.firDigitali)
      uscita.scrivi(`fir-digitale ${d.numero} ${d.idRentri ?? '-'}`)
    for (const d of rapporto.firSenzaPeso)
      uscita.scrivi(`fir-senza-peso ${d.numero} ${d.produttoreKey ?? '-'}`)
    if (rapporto.firSenzaPeso.length > 0)
      uscita.scrivi(
        `ATTENZIONE: ${rapporto.firSenzaPeso.length} FIR in viaggio senza peso a destino bloccano il caricamento: ` +
          'completare i FIR in WinWaste prima dell estrazione e rifare lo staging e il pacchetto'
      )
    return 0
  } catch (e) {
    if (e instanceof PacchettoError || e instanceof StagingError) {
      uscita.errore(`rifiutato: ${e.message}`)
      return 2
    }
    throw e
  }
}

if (require.main === module) {
  eseguiCli(process.argv.slice(2), {
    scrivi: m => process.stdout.write(`${m}\n`),
    errore: m => process.stderr.write(`${m}\n`),
  }).then(
    codice => process.exit(codice),
    e => {
      process.stderr.write(`errore imprevisto: ${e instanceof Error ? e.name : 'sconosciuto'}\n`)
      process.exit(1)
    }
  )
}
