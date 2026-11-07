// Export dei documenti di fatturazione (fase 4.4b2, Task 24 e 23). Il CSV e' uno zip con
// `testate.csv` e `righe.csv`; `XML_ZIP` (Task 23) e' uno zip di fatture XML, tetto di 500, e
// EMETTE i documenti (serve `confermaEmissione`). Gli adattatori contabili sono dei Task 29-30:
// fino ad allora ogni altro formato risponde 400 `ADATTATORE_SCONOSCIUTO`.
//
// Letture per insieme, mai per documento: una query seleziona (e conta) i documenti, poi i
// dettagli si leggono in un passaggio con `DocumentiFatturaService.dettagliInTx` (una query per
// tabella e per blocco). Tetto di 5000 documenti. Il CSV e' in sola lettura: non rende «emesso» il
// documento (S18), non prende lock e non scrive altro che l'audit.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import JSZip from 'jszip'
import type { FotografiaDocumento } from '../../domain/fatturazione/tipi'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { DocumentiFatturaService } from './documenti-fattura.service'
import { TETTO_DOCUMENTI_XML_ZIP, XmlDocumentoService } from './xml-documento.service'
import { righeCsv, testateCsv, type DocumentoPerExport } from './export-csv'
import { eDataIso } from './numerazione'
import { conJoinLineari } from './piani-query'

/** Scelta di piano (P7): oltre, 400 `TROPPI_DOCUMENTI` e l'utente divide con i filtri. */
export const TETTO_DOCUMENTI_CSV = 5000

export interface SelezioneExport {
  registroIvaId?: string
  anno?: number
  numeroDa?: number
  numeroA?: number
  dataDa?: string
  dataA?: string
  clienteId?: string
  documentoIds?: string[]
  elaborazioneId?: string
}

export interface RichiestaExport {
  formato: string
  selezione: SelezioneExport
  confermaEmissione?: boolean
}

export interface EsitoExport {
  nomeFile: string
  contentType: string
  contenuto: Buffer
  /** Annullati esclusi da `XML_ZIP` (Task 23); sempre 0 per il CSV, che li esporta con lo stato. */
  saltati: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FORMATO_CSV = 'CSV'
const FORMATO_XML_ZIP = 'XML_ZIP'

function filtroNonValido(message: string): BadRequestException {
  return new BadRequestException({ error: 'FILTRO_NON_VALIDO', message })
}

/** Controlli sulla selezione, tutti prima di toccare il database. */
function validaSelezione(s: SelezioneExport, tetto: number): void {
  for (const id of [s.registroIvaId, s.clienteId, s.elaborazioneId]) {
    if (id !== undefined && !UUID.test(id))
      throw filtroNonValido('Un filtro per identificativo non è valido.')
  }
  if (s.anno !== undefined && (!Number.isInteger(s.anno) || s.anno < 2000 || s.anno > 2100)) {
    throw filtroNonValido("L'anno del filtro non è valido.")
  }
  for (const n of [s.numeroDa, s.numeroA]) {
    if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 2_147_483_647)) {
      throw filtroNonValido('Il numero del filtro non è valido.')
    }
  }
  if (s.numeroDa !== undefined && s.numeroA !== undefined && s.numeroDa > s.numeroA) {
    throw filtroNonValido("L'intervallo dei numeri non è valido.")
  }
  for (const d of [s.dataDa, s.dataA]) {
    if (d !== undefined && !eDataIso(d)) {
      throw new BadRequestException({
        error: 'DATA_NON_VALIDA',
        message: 'Le date del filtro devono essere nel formato AAAA-MM-GG.',
      })
    }
  }
  if (s.dataDa !== undefined && s.dataA !== undefined && s.dataDa > s.dataA) {
    throw new BadRequestException({
      error: 'DATA_NON_VALIDA',
      message: 'La data iniziale è successiva a quella finale.',
    })
  }
  if (s.documentoIds !== undefined) {
    if (!Array.isArray(s.documentoIds))
      throw filtroNonValido('La lista dei documenti non è valida.')
    if (s.documentoIds.length > tetto) throw troppiDocumenti(tetto)
    if (s.documentoIds.some(id => typeof id !== 'string' || !UUID.test(id))) {
      throw filtroNonValido('Un identificativo di documento non è valido.')
    }
  }
}

function troppiDocumenti(tetto: number): BadRequestException {
  return new BadRequestException({
    error: 'TROPPI_DOCUMENTI',
    message: `Al massimo ${tetto} documenti per esportazione: restringi i filtri.`,
    details: { massimo: tetto },
  })
}

interface DocumentoSelezionato {
  id: string
  numero: number | null
  anno: number
  registroCodice: string
  fotografia: FotografiaDocumento
}

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documenti: DocumentiFatturaService,
    private readonly xml: XmlDocumentoService
  ) {}

  async esporta(tenantId: string, utenteId: string, b: RichiestaExport): Promise<EsitoExport> {
    // Il formato si controlla per primo; gli adattatori contabili li collegano i Task 29-30.
    if (b.formato === FORMATO_XML_ZIP) return this.esportaXmlZip(tenantId, utenteId, b)
    if (b.formato !== FORMATO_CSV) {
      throw new BadRequestException({
        error: 'ADATTATORE_SCONOSCIUTO',
        message: 'Il formato di esportazione non è disponibile.',
      })
    }
    const selezione = b.selezione ?? {}
    validaSelezione(selezione, TETTO_DOCUMENTI_CSV)
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(
        async tx => {
          const selezionati = await this.seleziona(tx, tenantId, selezione, {
            tetto: TETTO_DOCUMENTI_CSV,
            senzaBozze: false,
          })
          // Un solo passaggio per tabella su tutti i documenti (lista lunga: `IN (SELECT unnest)`
          // col nested loop spento): a blocchi di 100 ogni blocco rileggeva le righe dell'intero
          // tenant quando le statistiche sono vecchie.
          const dettagli = await this.documenti.dettagliInTx(
            tx,
            tenantId,
            selezionati.map(s => s.id)
          )
          const perId = new Map(dettagli.map(d => [d.id, d]))
          const perExport: DocumentoPerExport[] = []
          for (const s of selezionati) {
            const documento = perId.get(s.id)
            if (documento) {
              perExport.push({
                documento,
                numero: s.numero,
                anno: s.anno,
                registroCodice: s.registroCodice,
                fotografia: s.fotografia,
              })
            }
          }
          const contenuto = await this.comprimi(perExport)
          const conBozze = perExport.some(p => p.documento.stato === 'BOZZA')
          // Audit: solo formato e conteggio (mai importi, nomi o filtri con dati personali).
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'DOCUMENTI_FATTURA_ESPORTATI',
              description: 'Documenti di fatturazione esportati',
              metadata: { formato: FORMATO_CSV, documenti: perExport.length, anteprima: conBozze },
            },
          })
          return {
            nomeFile: nomeFile(conBozze),
            contentType: 'application/zip',
            contenuto,
            saltati: 0,
          }
        },
        { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
    )
  }

  /**
   * `XML_ZIP`: seleziona i documenti (mai le bozze, tetto 500), poi `XmlDocumentoService.zip`
   * genera, valida ed emette. Audit dell'export con formato e conteggi (mai filtri o nomi).
   */
  private async esportaXmlZip(
    tenantId: string,
    utenteId: string,
    b: RichiestaExport
  ): Promise<EsitoExport> {
    const selezione = b.selezione ?? {}
    validaSelezione(selezione, TETTO_DOCUMENTI_XML_ZIP)
    const ids = await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(
        async tx =>
          (
            await this.seleziona(tx, tenantId, selezione, {
              tetto: TETTO_DOCUMENTI_XML_ZIP,
              senzaBozze: true,
            })
          ).map(d => d.id),
        { timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
    )
    const { contenuto, saltati } = await this.xml.zip(tenantId, utenteId, ids, {
      confermaEmissione: b.confermaEmissione === true,
    })
    // Audit dell'export in una transazione propria, dopo l'emissione: l'emissione ha gia' il suo
    // audit atomico con la scrittura (`DOCUMENTO_FATTURA_EMESSO`); questo registra solo la
    // consegna del file. Se fallisse non deve disfare documenti gia' emessi ne' far perdere lo zip.
    await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(tx =>
        tx.activityLog.create({
          data: {
            tenantId,
            userId: utenteId,
            action: 'DOCUMENTI_FATTURA_ESPORTATI',
            description: 'Documenti di fatturazione esportati',
            metadata: { formato: FORMATO_XML_ZIP, documenti: ids.length - saltati, saltati },
          },
        })
      )
    )
    return {
      nomeFile: `fatture-XML-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.zip`,
      contentType: 'application/zip',
      contenuto,
      saltati,
    }
  }

  /**
   * Documenti da esportare, nell'ordine anno, registro, numero. Senza `elaborazioneId` solo
   * `DEFINITIVO` e `ANNULLATO`: le bozze si esportano solo da un'elaborazione. Il conteggio
   * precede la lettura dei dati: oltre il tetto 400 senza caricare nulla.
   */
  private async seleziona(
    tx: Prisma.TransactionClient,
    tenantId: string,
    s: SelezioneExport,
    o: { tetto: number; senzaBozze: boolean }
  ): Promise<DocumentoSelezionato[]> {
    if (s.elaborazioneId !== undefined) {
      // Un'elaborazione inesistente o di un'altra azienda non e' «nessun documento»: e' un errore.
      const trovata = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM "elaborazioni_fatturazione"
        WHERE tenant_id = ${tenantId}::uuid AND id = ${s.elaborazioneId}::uuid`
      if (trovata.length === 0) {
        throw new NotFoundException({
          error: 'ELABORAZIONE_NON_TROVATA',
          message: 'Elaborazione non trovata.',
        })
      }
    }
    const condizioni: Prisma.Sql[] = [Prisma.sql`d.tenant_id = ${tenantId}::uuid`]
    if (s.elaborazioneId !== undefined) {
      condizioni.push(Prisma.sql`d.elaborazione_id = ${s.elaborazioneId}::uuid`)
    }
    if (s.elaborazioneId === undefined || o.senzaBozze) {
      condizioni.push(Prisma.sql`d.stato IN ('DEFINITIVO', 'ANNULLATO')`)
    }
    if (s.registroIvaId !== undefined)
      condizioni.push(Prisma.sql`d.registro_iva_id = ${s.registroIvaId}::uuid`)
    if (s.anno !== undefined) condizioni.push(Prisma.sql`d.anno = ${s.anno}::int`)
    if (s.numeroDa !== undefined) condizioni.push(Prisma.sql`d.numero >= ${s.numeroDa}::int`)
    if (s.numeroA !== undefined) condizioni.push(Prisma.sql`d.numero <= ${s.numeroA}::int`)
    if (s.dataDa !== undefined) condizioni.push(Prisma.sql`d.data_documento >= ${s.dataDa}::date`)
    if (s.dataA !== undefined) condizioni.push(Prisma.sql`d.data_documento <= ${s.dataA}::date`)
    if (s.clienteId !== undefined)
      condizioni.push(Prisma.sql`d.cliente_fatturazione_id = ${s.clienteId}::uuid`)
    const lista = s.documentoIds !== undefined
    if (lista) {
      // Lista lunga: una sola forma, `IN (SELECT unnest(..))` col nested loop spento (4.4b1, T27a).
      condizioni.push(Prisma.sql`d.id IN (SELECT unnest(${s.documentoIds}::uuid[]))`)
    }
    const dove = Prisma.join(condizioni, ' AND ')
    const leggi = async (): Promise<DocumentoSelezionato[]> => {
      const [{ totale }] = await tx.$queryRaw<{ totale: number }[]>`
        SELECT count(*)::int AS totale FROM "documenti_fattura" d WHERE ${dove}`
      if (totale > o.tetto) throw troppiDocumenti(o.tetto)
      return tx.$queryRaw<DocumentoSelezionato[]>`
        SELECT d.id::text AS id, d.numero::int AS numero, d.anno::int AS anno,
               COALESCE(ri.codice, '') AS "registroCodice", d.fotografia AS fotografia
        FROM "documenti_fattura" d
        LEFT JOIN "registri_iva" ri ON ri.id = d.registro_iva_id AND ri.tenant_id = d.tenant_id
        WHERE ${dove}
        ORDER BY d.anno, ri.codice, d.numero NULLS LAST, d.data_documento, d.id`
    }
    return lista ? conJoinLineari(tx, leggi) : leggi()
  }

  private async comprimi(documenti: readonly DocumentoPerExport[]): Promise<Buffer> {
    const zip = new JSZip()
    zip.file('testate.csv', testateCsv(documenti))
    zip.file('righe.csv', righeCsv(documenti))
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  }
}

function nomeFile(anteprima: boolean): string {
  const oggi = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return anteprima ? `fatture-ANTEPRIMA-${oggi}.zip` : `fatture-${oggi}.zip`
}
