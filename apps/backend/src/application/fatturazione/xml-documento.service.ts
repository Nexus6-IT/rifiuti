// XML del documento, progressivo del file ed emissione (fase 4.4b2, Task 23, spec §7.2).
//
// Prima richiesta di un documento DEFINITIVO:
//   - transazione A: SOLO `contatori_file_fatturapa FOR UPDATE` (nient'altro) -> nuovo progressivo;
//   - transazione B: il documento `FOR UPDATE` (nient'altro prima), poi genera, valida contro
//     l'XSD e salva `xml`, `xml_sha256`, `xml_generato_il`, `progressivo_file` ed `emesso_il`.
// Il progressivo della A che non viene salvato (richiesta parallela arrivata seconda, XML non
// valido) resta inutilizzato: e' il nome di un file, non un numero fiscale (Q23).
// Un XML non passa MAI al salvataggio senza la validazione contro l'XSD. `confermaEmissione` non si
// inventa: arriva dal chiamante. Solo i DEFINITIVO ricevono l'XML (Q7).
//
// Ordine dei lock: la A e la B sono transazioni distinte e mai annidate; la B prende solo righe di
// `documenti_fattura` (in ordine di id), quindi non si incrocia con l'annullo
// (numerazione -> documento) ne' con la definitiva.
import { createHash } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import JSZip from 'jszip'
import {
  datiFatturaDaDocumento,
  serializzaFattura,
} from '../../domain/fatturazione/xml/serializza-fattura'
import type {
  DocumentoPerXml,
  FotografiaDocumento,
  RataCalcolata,
  RigaDocumentoCalcolata,
  RiepilogoIvaCalcolato,
} from '../../domain/fatturazione/tipi'
import { validaFatturaPA, validaFatturePA } from '../../infrastructure/fatturapa/valida-xsd'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { traduciErrorePrisma, type DescrizioneEntita } from '../clienti/anagrafica-versionata'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { DocumentiFatturaService, type DocumentoDettaglio } from './documenti-fattura.service'

/** Q24: oltre, 400 `TROPPI_DOCUMENTI`. Il CSV resta a 5000. */
export const TETTO_DOCUMENTI_XML_ZIP = 500

/** Documenti per transazione B dello zip: tiene corti i lock e la memoria. */
const DOCUMENTI_PER_BLOCCO = 50
const DIMENSIONE_LETTURA = 100
const MASSIMO_PROGRESSIVO = 36 ** 5 - 1
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ENTITA: DescrizioneEntita = {
  prefisso: 'DOCUMENTO_FATTURA',
  soggetto: 'Il documento',
  femminile: false,
}

/** 1 -> `00001`, 35 -> `0000Z`, 36 -> `00010`. Oltre 36^5 - 1 (o non intero, o < 1) e' un errore. */
export function progressivoBase36(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > MASSIMO_PROGRESSIVO) {
    throw new RangeError('Progressivo del file fuori dall’intervallo ammesso.')
  }
  return n.toString(36).toUpperCase().padStart(5, '0')
}

export interface FileXml {
  nomeFile: string
  contenuto: Buffer
  sha256: string
}

interface DocumentoLetto {
  id: string
  stato: 'BOZZA' | 'DEFINITIVO' | 'ANNULLATO'
  versione: number
  numeroTesto: string | null
  emessoIl: Date | null
  xml: Buffer | null
  xmlSha256: string | null
  progressivoFile: string | null
  partitaIva: string
  /** Presente solo se serve generare (DEFINITIVO senza XML). */
  perXml: DocumentoPerXml | null
}

interface TestataXmlLetta {
  id: string
  stato: 'BOZZA' | 'DEFINITIVO' | 'ANNULLATO'
  versione: number
  tipoDocumento: 'TD01' | 'TD04' | 'TD24'
  formato: 'FPR12' | 'FPA12'
  codiceDestinatario: string | null
  pec: string | null
  data: string
  numeroTesto: string | null
  totale: string
  bolloDovuto: boolean
  importoBollo: string | null
  esigibilita: 'I' | 'D' | 'S'
  fotografia: FotografiaDocumento
  origineId: string | null
  xml: Uint8Array | null
  xmlSha256: string | null
  progressivoFile: string | null
  emessoIl: Date | null
}

const documentoNonTrovato = () =>
  new NotFoundException({ error: 'DOCUMENTO_NON_TROVATO', message: 'Documento non trovato.' })

const nonDisponibile = (stato: 'BOZZA' | 'ANNULLATO') =>
  new ConflictException({
    error: 'XML_NON_DISPONIBILE',
    message:
      stato === 'ANNULLATO'
        ? "Un documento annullato non ha l'XML."
        : "Un documento in bozza non ha l'XML: si genera solo dopo la definitiva.",
  })

const confermaRichiesta = () =>
  new BadRequestException({
    error: 'CONFERMA_EMISSIONE_RICHIESTA',
    message: "Scaricare l'XML emette il documento: conferma l'emissione per continuare.",
  })

const versioneSuperata = () =>
  new ConflictException({
    error: 'VERSIONE_SUPERATA',
    message:
      'Il documento è stato modificato nel frattempo: ricarica per vedere i dati aggiornati.',
  })

function xmlNonValido(errori: string[], indice?: number): UnprocessableEntityException {
  return new UnprocessableEntityException({
    error: 'XML_NON_VALIDO',
    message:
      indice === undefined
        ? "L'XML del documento non è conforme allo schema FatturaPA: nulla è stato emesso."
        : `L'XML del documento n. ${indice} della selezione non è conforme allo schema FatturaPA: nulla è stato emesso.`,
    details: { ...(indice === undefined ? {} : { indice }), errori },
  })
}

/**
 * Stato cambiato sotto i piedi in un punto che il lock rende irraggiungibile in pratica: si
 * risponde 409 come per ogni contesa, mai un 500 generico; l'utente ripete la richiesta.
 */
const operazioneConcorrente = () =>
  new ConflictException({
    error: 'OPERAZIONE_CONCORRENTE',
    message: 'Il documento è cambiato nel frattempo: ripeti l’operazione.',
  })

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

@Injectable()
export class XmlDocumentoService {
  private readonly logger = new Logger(XmlDocumentoService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly documenti: DocumentiFatturaService
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Un documento
  // ---------------------------------------------------------------------------------------------

  async xml(
    tenantId: string,
    utenteId: string,
    documentoId: string,
    b: { confermaEmissione: boolean }
  ): Promise<FileXml> {
    if (!UUID.test(documentoId)) throw documentoNonTrovato()
    return nelContestoTenant(tenantId, async () => {
      // Lettura semplice: scarta subito i casi che non devono consumare un progressivo.
      const prima = await this.prisma.$transaction(tx =>
        this.leggi(tx, tenantId, [documentoId], { lock: false, dati: false })
      )
      if (prima.length === 0) throw documentoNonTrovato()
      const p = prima[0]
      if (p.stato !== 'DEFINITIVO') throw nonDisponibile(p.stato)
      if (p.xml !== null) return this.comeFile(p)
      if (p.emessoIl === null && !b.confermaEmissione) throw confermaRichiesta()

      // Transazione A: solo il contatore.
      const numero = await this.riservaProgressivi(tenantId, 1)

      // Transazione B: il documento sotto lock.
      return this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const [d] = await this.leggi(tx, tenantId, [documentoId], { lock: true, dati: true })
          if (!d) throw documentoNonTrovato()
          if (d.stato !== 'DEFINITIVO') throw nonDisponibile(d.stato)
          // Una richiesta parallela ha gia' scritto: stessi byte, nessun progressivo nuovo.
          if (d.xml !== null) return this.comeFile(d)
          if (d.emessoIl === null && !b.confermaEmissione) throw confermaRichiesta()
          const progressivo = progressivoBase36(numero)
          const xml = await this.generaEValida([d], [progressivo], [undefined])
          const contenuto = xml[0]
          await this.salva(tx, tenantId, [
            { id: d.id, contenuto, progressivo, emesso: d.emessoIl === null },
          ])
          await this.auditEmissione(tx, tenantId, utenteId, [
            ...(d.emessoIl === null ? [{ id: d.id, numero: d.numeroTesto, progressivo }] : []),
          ])
          return {
            nomeFile: nomeFile(d.partitaIva, progressivo),
            contenuto,
            sha256: sha256(contenuto),
          }
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => traduciErrorePrisma(err, ENTITA, {}))
    })
  }

  /**
   * «Segna come emesso» (Q22): scrive `emesso_il` senza generare l'XML. Da quel momento l'annullo
   * risponde `EMESSO`. Idempotente se il documento e' gia' emesso.
   */
  async segnaEmesso(
    tenantId: string,
    utenteId: string,
    documentoId: string,
    versione: number
  ): Promise<DocumentoDettaglio> {
    if (!UUID.test(documentoId)) throw documentoNonTrovato()
    if (!Number.isInteger(versione) || versione < 1) {
      throw new BadRequestException({
        error: 'VERSIONE_NON_VALIDA',
        message: 'La versione del documento non è valida.',
      })
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const [d] = await this.leggi(tx, tenantId, [documentoId], { lock: true, dati: false })
          if (!d) throw documentoNonTrovato()
          if (d.stato !== 'DEFINITIVO') {
            throw new ConflictException({
              error: 'EMISSIONE_NON_AMMESSA',
              message:
                d.stato === 'ANNULLATO'
                  ? 'Un documento annullato non si emette.'
                  : 'Si può emettere solo un documento definitivo.',
              details: { motivo: d.stato },
            })
          }
          if (d.emessoIl === null) {
            if (d.versione !== versione) throw versioneSuperata()
            await tx.$executeRaw`
              UPDATE documenti_fattura
              SET emesso_il = now(), versione = versione + 1, updated_at = now()
              WHERE tenant_id = ${tenantId}::uuid AND id = ${documentoId}::uuid
                AND stato = 'DEFINITIVO' AND emesso_il IS NULL`
            await tx.activityLog.create({
              data: {
                tenantId,
                userId: utenteId,
                action: 'DOCUMENTO_FATTURA_EMESSO',
                description: 'Documento di fatturazione segnato come emesso',
                metadata: {
                  documentoId,
                  numero: d.numeroTesto,
                  dati: false,
                } as Prisma.InputJsonValue,
              },
            })
          }
          return this.documenti.dettaglioInTx(tx, tenantId, documentoId)
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => traduciErrorePrisma(err, ENTITA, {}))
    )
  }

  // ---------------------------------------------------------------------------------------------
  // Molti documenti (zip)
  // ---------------------------------------------------------------------------------------------

  /**
   * Fase 1: legge, genera e valida TUTTO senza scrivere (422 con la posizione del documento che
   * fallisce, nulla emesso). Fase 2: una transazione A per i progressivi dell'intero zip, poi una
   * transazione B ogni `DOCUMENTI_PER_BLOCCO` documenti. Gli ANNULLATO si saltano e si contano.
   */
  async zip(
    tenantId: string,
    utenteId: string,
    documentoIds: string[],
    b: { confermaEmissione: boolean }
  ): Promise<{ contenuto: Buffer; saltati: number }> {
    const ids = [...new Set(documentoIds)]
    if (ids.length > TETTO_DOCUMENTI_XML_ZIP) {
      throw new BadRequestException({
        error: 'TROPPI_DOCUMENTI',
        message: `Al massimo ${TETTO_DOCUMENTI_XML_ZIP} documenti per l'archivio XML: restringi i filtri.`,
        details: { massimo: TETTO_DOCUMENTI_XML_ZIP },
      })
    }
    if (ids.some(id => !UUID.test(id))) throw documentoNonTrovato()
    return nelContestoTenant(tenantId, async () => {
      // --- Fase 1: sola lettura, a blocchi, in uno snapshot.
      const letti = await this.prisma.$transaction(
        async tx => {
          const tutti: DocumentoLetto[] = []
          for (let da = 0; da < ids.length; da += DIMENSIONE_LETTURA) {
            tutti.push(
              ...(await this.leggi(tx, tenantId, ids.slice(da, da + DIMENSIONE_LETTURA), {
                lock: false,
                dati: true,
              }))
            )
          }
          return tutti
        },
        { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
      const perId = new Map(letti.map(d => [d.id, d]))
      const selezione = ids.map(id => {
        const d = perId.get(id)
        if (!d) throw documentoNonTrovato()
        return d
      })
      const bozza = selezione.find(d => d.stato === 'BOZZA')
      if (bozza) throw nonDisponibile('BOZZA')
      const validi = selezione.filter(d => d.stato === 'DEFINITIVO')
      const daGenerare = validi.filter(d => d.xml === null)
      if (!b.confermaEmissione && validi.some(d => d.emessoIl === null && d.xml === null)) {
        throw confermaRichiesta()
      }
      // Validazione dell'intera selezione con un progressivo provvisorio della stessa forma.
      const posizione = new Map(ids.map((id, i) => [id, i + 1]))
      await this.generaEValida(
        daGenerare,
        daGenerare.map(() => '00001'),
        daGenerare.map(d => posizione.get(d.id))
      )

      // --- Fase 2: scritture. Un commit per blocco, di proposito: lo zip non e' atomico. Se un
      // blocco fallisce (lock timeout o altro), i blocchi gia' committati restano emessi e
      // l'utente riceve l'errore senza zip. Ripetere la richiesta e' sicuro e completa il lavoro:
      // i documenti con XML tornano con gli stessi byte e nome file, senza progressivo nuovo
      // (la A riserva solo per quelli ancora senza XML). Un'unica transazione tratterrebbe i
      // lock di 500 documenti per l'intera durata.
      const primo =
        daGenerare.length > 0 ? await this.riservaProgressivi(tenantId, daGenerare.length) : 0
      const progressivoDi = new Map(daGenerare.map((d, i) => [d.id, primo + i]))
      const file: FileXml[] = []
      let saltati = selezione.length - validi.length
      for (let da = 0; da < validi.length; da += DOCUMENTI_PER_BLOCCO) {
        const blocco = validi.slice(da, da + DOCUMENTI_PER_BLOCCO)
        const bloccoIds = blocco.map(d => d.id)
        const esito = await this.prisma
          .$transaction(async tx => {
            await impostaTimeoutLock(tx)
            const sotto = await this.leggi(tx, tenantId, bloccoIds, { lock: true, dati: true })
            const perIdSotto = new Map(sotto.map(d => [d.id, d]))
            const risultato: FileXml[] = []
            let annullati = 0
            const nuovi: DocumentoLetto[] = []
            for (const originale of blocco) {
              const d = perIdSotto.get(originale.id)
              if (!d || d.stato !== 'DEFINITIVO') {
                annullati++
                continue
              }
              if (d.xml !== null) risultato.push(this.comeFile(d))
              else nuovi.push(d)
            }
            if (nuovi.length > 0) {
              const progressivi = nuovi.map(d => {
                const n = progressivoDi.get(d.id)
                if (n === undefined) {
                  // Documento diventato senza XML dopo la fase 1: impossibile (l'XML non si toglie).
                  throw operazioneConcorrente()
                }
                return progressivoBase36(n)
              })
              const xml = await this.generaEValida(
                nuovi,
                progressivi,
                nuovi.map(d => posizione.get(d.id))
              )
              await this.salva(
                tx,
                tenantId,
                nuovi.map((d, i) => ({
                  id: d.id,
                  contenuto: xml[i],
                  progressivo: progressivi[i],
                  emesso: d.emessoIl === null,
                }))
              )
              await this.auditEmissione(
                tx,
                tenantId,
                utenteId,
                nuovi
                  .map((d, i) => ({ d, i }))
                  .filter(({ d }) => d.emessoIl === null)
                  .map(({ d, i }) => ({
                    id: d.id,
                    numero: d.numeroTesto,
                    progressivo: progressivi[i],
                  }))
              )
              nuovi.forEach((d, i) =>
                risultato.push({
                  nomeFile: nomeFile(d.partitaIva, progressivi[i]),
                  contenuto: xml[i],
                  sha256: sha256(xml[i]),
                })
              )
            }
            return { file: risultato, annullati }
          }, OPZIONI_TRANSAZIONE_SCRITTURA)
          .catch(err => traduciErrorePrisma(err, ENTITA, {}))
        file.push(...esito.file)
        saltati += esito.annullati
      }
      const archivio = new JSZip()
      for (const f of file) archivio.file(f.nomeFile, f.contenuto)
      const contenuto = await archivio.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
      return { contenuto, saltati }
    })
  }

  // ---------------------------------------------------------------------------------------------
  // Interni
  // ---------------------------------------------------------------------------------------------

  /**
   * Transazione A: SOLO il contatore dell'azienda. Riserva `n` progressivi consecutivi e ritorna
   * il primo. Il commit rilascia subito il lock: un'altra azienda non e' mai bloccata (riga per
   * `tenant_id`).
   */
  private async riservaProgressivi(tenantId: string, n: number): Promise<number> {
    const primo = await this.prisma
      .$transaction(async tx => {
        await impostaTimeoutLock(tx)
        await tx.$executeRaw`
          INSERT INTO contatori_file_fatturapa (tenant_id, ultimo, updated_at)
          VALUES (${tenantId}::uuid, 0, now())
          ON CONFLICT (tenant_id) DO NOTHING`
        const [{ ultimo }] = await tx.$queryRaw<{ ultimo: number }[]>`
          SELECT ultimo::int AS ultimo FROM contatori_file_fatturapa
          WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
        await tx.$executeRaw`
          UPDATE contatori_file_fatturapa SET ultimo = ultimo + ${n}::int, updated_at = now()
          WHERE tenant_id = ${tenantId}::uuid`
        return ultimo + 1
      }, OPZIONI_TRANSAZIONE_SCRITTURA)
      .catch(err => traduciErrorePrisma(err, ENTITA, {}))
    if (primo + n - 1 > MASSIMO_PROGRESSIVO) {
      throw new ConflictException({
        error: 'PROGRESSIVO_FILE_ESAURITO',
        message: 'I progressivi dei file XML sono esauriti.',
      })
    }
    return primo
  }

  /**
   * Genera l'XML di ciascun documento col suo progressivo e lo valida a lotto contro l'XSD.
   * Un documento che non passa -> 422 (con la sua posizione nella selezione, se nota). Il log
   * riporta solo l'id del documento e i messaggi dell'XSD, che non contengono i valori dei campi.
   */
  private async generaEValida(
    documenti: DocumentoLetto[],
    progressivi: string[],
    posizioni: (number | undefined)[]
  ): Promise<Buffer[]> {
    if (documenti.length === 0) return []
    const testi: string[] = []
    for (let i = 0; i < documenti.length; i++) {
      const d = documenti[i]
      // Irraggiungibile: `leggi` carica i dati di ogni DEFINITIVO senza XML, che sono i soli passati qui.
      if (d.perXml === null) throw operazioneConcorrente()
      try {
        testi.push(serializzaFattura(datiFatturaDaDocumento(d.perXml, progressivi[i])))
      } catch (err) {
        const campo = (err as { campo?: unknown }).campo
        this.logger.warn(`XML non generabile per il documento ${d.id}`)
        throw xmlNonValido(
          [
            typeof campo === 'string'
              ? `Elemento ${campo}: obbligatorio e vuoto`
              : 'Dati incompleti',
          ],
          posizioni[i]
        )
      }
    }
    const esiti =
      documenti.length === 1 ? [await validaFatturaPA(testi[0])] : await validaFatturePA(testi)
    // Il documento da indicare: il primo con errori propri; se nessuno li ha, il primo invalido.
    const primoInvalido = esiti.findIndex(e => !e.valido)
    if (primoInvalido >= 0) {
      const proprio = esiti.findIndex(e => !e.valido && e.attribuibile === true)
      const i = proprio >= 0 ? proprio : primoInvalido
      this.logger.warn(`XML non conforme all'XSD per il documento ${documenti[i].id}`)
      // La posizione si riporta se almeno un file ha errori propri, se qualche altro file del lotto
      // è valido, o se il lotto è un file solo. Se TUTTO il lotto è invalido per soli errori
      // generali (es. XML non ben formato), l'errore non è attribuibile a un file: fail-closed.
      const attribuibile = proprio >= 0 || esiti.some(e => e.valido) || esiti.length === 1
      throw xmlNonValido(esiti[i].errori, attribuibile ? posizioni[i] : undefined)
    }
    return testi.map(t => Buffer.from(t, 'utf8'))
  }

  /** UPDATE unico per il blocco. L'`emesso_il` si scrive solo se nullo (`COALESCE`). */
  private async salva(
    tx: Prisma.TransactionClient,
    tenantId: string,
    righe: { id: string; contenuto: Buffer; progressivo: string; emesso: boolean }[]
  ): Promise<void> {
    if (righe.length === 0) return
    const ids = righe.map(r => r.id)
    const esadecimali = righe.map(r => r.contenuto.toString('hex'))
    const impronte = righe.map(r => sha256(r.contenuto))
    const progressivi = righe.map(r => r.progressivo)
    const aggiornati = await tx.$executeRaw`
      UPDATE documenti_fattura d
      SET xml = decode(v.xml_hex, 'hex'), xml_sha256 = v.sha, progressivo_file = v.prog,
          xml_generato_il = now(), emesso_il = COALESCE(d.emesso_il, now()),
          versione = d.versione + 1, updated_at = now()
      FROM (
        SELECT * FROM unnest(${ids}::uuid[], ${esadecimali}::text[], ${impronte}::text[],
                             ${progressivi}::text[]) AS t(id, xml_hex, sha, prog)
      ) v
      WHERE d.tenant_id = ${tenantId}::uuid AND d.id = v.id
        AND d.stato = 'DEFINITIVO' AND d.xml IS NULL`
    if (aggiornati !== righe.length) throw operazioneConcorrente()
  }

  /** Un solo audit per documento, alla sua prima emissione; mai dati personali. */
  private async auditEmissione(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    emessi: { id: string; numero: string | null; progressivo: string }[]
  ): Promise<void> {
    if (emessi.length === 0) return
    await tx.activityLog.createMany({
      data: emessi.map(e => ({
        tenantId,
        userId: utenteId,
        action: 'DOCUMENTO_FATTURA_EMESSO',
        description: 'Documento di fatturazione emesso con XML',
        metadata: {
          documentoId: e.id,
          numero: e.numero,
          progressivoFile: e.progressivo,
          dati: true,
        } as Prisma.InputJsonValue,
      })),
    })
  }

  private comeFile(d: DocumentoLetto): FileXml {
    if (d.xml === null || d.progressivoFile === null) {
      throw operazioneConcorrente()
    }
    return {
      nomeFile: nomeFile(d.partitaIva, d.progressivoFile),
      contenuto: d.xml,
      sha256: d.xmlSha256 ?? sha256(d.xml),
    }
  }

  /**
   * Letture per insieme (`ids.length` <= 100): una query per tabella, mai una per documento.
   * Con `lock` i documenti si bloccano `FOR UPDATE` in ordine di id. I dati per l'XML (righe,
   * riepiloghi, rate) si leggono solo per i DEFINITIVO ancora senza XML.
   */
  private async leggi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ids: readonly string[],
    o: { lock: boolean; dati: boolean }
  ): Promise<DocumentoLetto[]> {
    if (ids.length === 0) return []
    const lista = [...ids]
    const blocca = o.lock ? Prisma.sql`FOR UPDATE` : Prisma.empty
    const testate = await tx.$queryRaw<TestataXmlLetta[]>`
      SELECT d.id::text AS id, d.stato::text AS stato, d.versione::int AS versione,
             d.tipo_documento AS "tipoDocumento", d.formato_trasmissione AS formato,
             d.codice_destinatario AS "codiceDestinatario", d.pec_destinatario AS pec,
             d.data_documento::text AS data, d.numero_testo AS "numeroTesto",
             d.totale_documento::text AS totale, d.bollo_dovuto AS "bolloDovuto",
             d.importo_bollo::text AS "importoBollo",
             CASE d.esigibilita_iva::text WHEN 'IMMEDIATA' THEN 'I' WHEN 'DIFFERITA' THEN 'D'
               ELSE 'S' END AS esigibilita,
             d.fotografia AS fotografia, d.documento_origine_id::text AS "origineId",
             d.xml AS xml, d.xml_sha256 AS "xmlSha256", d.progressivo_file AS "progressivoFile",
             d.emesso_il AS "emessoIl"
      FROM documenti_fattura d
      WHERE d.tenant_id = ${tenantId}::uuid AND d.id = ANY(${lista}::uuid[])
      ORDER BY d.id ${blocca}`
    const daGenerare = testate.filter(t => t.stato === 'DEFINITIVO' && t.xml === null)
    const dettagli = new Map<string, DocumentoDettaglio>()
    if (o.dati && daGenerare.length > 0) {
      for (const d of await this.documenti.dettagliInTx(
        tx,
        tenantId,
        daGenerare.map(t => t.id)
      )) {
        dettagli.set(d.id, d)
      }
    }
    const origineIds = [
      ...new Set(daGenerare.flatMap(t => (t.origineId !== null ? [t.origineId] : []))),
    ]
    const origini = new Map<string, { numeroTesto: string; dataDocumento: string }>()
    if (o.dati && origineIds.length > 0) {
      const righe = await tx.$queryRaw<{ id: string; numeroTesto: string; data: string }[]>`
        SELECT id::text AS id, numero_testo AS "numeroTesto", data_documento::text AS data
        FROM documenti_fattura
        WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${origineIds}::uuid[])`
      for (const r of righe)
        origini.set(r.id, { numeroTesto: r.numeroTesto, dataDocumento: r.data })
    }
    return testate.map(t => {
      let perXml: DocumentoPerXml | null = null
      const dettaglio = dettagli.get(t.id)
      if (dettaglio) {
        const origine = t.origineId !== null ? origini.get(t.origineId) : undefined
        perXml = {
          testata: {
            tipoDocumento: t.tipoDocumento,
            formatoTrasmissione: t.formato,
            codiceDestinatario: t.codiceDestinatario ?? '',
            pecDestinatario: t.pec,
            dataDocumento: t.data,
            numeroTesto: t.numeroTesto ?? '',
            totaleDocumento: t.totale,
            bolloDovuto: t.bolloDovuto,
            importoBollo: t.importoBollo,
            esigibilita: t.esigibilita,
            condizioniPagamento:
              dettaglio.rate.length === 0 ? null : dettaglio.rate.length > 1 ? 'TP01' : 'TP02',
            origine: origine ?? null,
          },
          righe: dettaglio.righe.map(
            r =>
              ({
                ...r,
                rigaLegameId: null,
                codiceIvaId: '',
              }) as unknown as RigaDocumentoCalcolata
          ),
          riepiloghi: dettaglio.riepiloghi as RiepilogoIvaCalcolato[],
          rate: dettaglio.rate as RataCalcolata[],
          fotografia: t.fotografia,
        }
      }
      return {
        id: t.id,
        stato: t.stato,
        versione: t.versione,
        numeroTesto: t.numeroTesto,
        emessoIl: t.emessoIl,
        xml: t.xml === null ? null : Buffer.from(t.xml),
        xmlSha256: t.xmlSha256,
        progressivoFile: t.progressivoFile,
        partitaIva: t.fotografia?.cedente?.partitaIva ?? '',
        perXml,
      }
    })
  }
}

function nomeFile(partitaIva: string, progressivo: string): string {
  return `IT${partitaIva}_${progressivo}.xml`
}
