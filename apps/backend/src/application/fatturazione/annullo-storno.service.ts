// Annullo dell'ultimo numero e nota di credito di storno (fase 4.4b1, Task 20, spec §5.5 e §5.6).
//
// Ordine dei lock (spec §8, mai invertito): numerazione FOR UPDATE -> documento FOR UPDATE ->
// testate e righe dei legami FOR UPDATE per id (`bloccaRigheLegame`) -> marcatori DELETE. Non si
// prende MAI il lock del registro, il lock consultivo per radice o `impostazioni_fatturazione FOR
// UPDATE` (S5). Una contesa di lock (55P03, P2028, 40P01) esce come 409 `OPERAZIONE_CONCORRENTE`.
//
// Il documento sotto lock rende l'annullo sicuro contro l'emissione dell'XML (Task 23): se
// `emesso_il` e' gia' stato scritto, `annullabilita` risponde `EMESSO` prima di qualunque
// scrittura, mai un errore del trigger.
//
// Ordine di scrittura dello storno (trigger delle figlie): TD04 in BOZZA con `elaborazione_id` NULL
// -> righe, riepiloghi e rate -> promozione a DEFINITIVO col numero successivo. `riga_legame_id`
// resta NULL (Q1): una conferma della 4.3 con cambio di elenco non incontra mai una FK verso le
// righe del legame.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { traduciErrorePrisma, type DescrizioneEntita } from '../clienti/anagrafica-versionata'
import { bloccaRigheLegame } from '../legami-movimento/lock-legame'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { eViolazioneUnica } from './anteprima'
import { conJoinLineari } from './piani-query'
import {
  annullabilita,
  DocumentiFatturaService,
  type DocumentoDettaglio,
  type MotivoNonAnnullabile,
} from './documenti-fattura.service'
import {
  bloccaNumerazioni,
  chiaveNumerazione,
  eDataIso,
  numeroTesto,
  oggiRoma,
  rilasciaUltimo,
  riservaNumeri,
} from './numerazione'

/** = Task 14 (Q33). */
export type MotivoNonStornabile = 'NON_DEFINITIVO' | 'NOTA_DI_CREDITO'

export interface RichiestaAnnullo {
  motivo: string
  versione: number
}

export interface RichiestaStorno {
  motivo: string
  /** `AAAA-MM-GG`, non futura sul giorno italiano. */
  dataDocumento: string
  rifatturabile: boolean
  versione: number
}

const ENTITA: DescrizioneEntita = {
  prefisso: 'DOCUMENTO_FATTURA',
  soggetto: 'Il documento',
  femminile: false,
}

const MESSAGGI_ANNULLO: Readonly<Record<MotivoNonAnnullabile, string>> = {
  NON_DEFINITIVO: 'Si può annullare solo un documento definitivo.',
  NOTA_DI_CREDITO: 'Una nota di credito non si annulla: si corregge con un nuovo documento.',
  STORNATO: 'Il documento ha già una nota di credito di storno: non si può annullare.',
  EMESSO: 'Il documento è già stato emesso: usa la nota di credito di storno.',
  NON_ULTIMO: "Si può annullare solo l'ultimo numero emesso: usa la nota di credito di storno.",
}

const MESSAGGI_STORNO: Readonly<Record<MotivoNonStornabile, string>> = {
  NON_DEFINITIVO: 'Si può stornare solo un documento definitivo.',
  NOTA_DI_CREDITO: 'Una nota di credito non si storna.',
}

/** Indice unico parziale dello storno (migration 4.4a): un solo TD04 non annullato per origine. */
const VINCOLO_UN_STORNO = 'documenti_fattura_un_storno'

/**
 * m1: solo il 23505 dell'indice dello storno vale `STORNO_GIA_PRESENTE`. Il nome del vincolo sta in
 * `meta.target` (P2002) o nel messaggio del raw (P2010); senza nome (con la RLS Prisma puo`
 * riportare `target: null`) non si decide e l'errore resta interno.
 */
// Nota (m3 della revisione): il formato del messaggio P2010 e` verificato solo con un errore
// costruito a mano. Nella pratica il ramo non si raggiunge (`haStorno` sotto lock risponde prima);
// se Prisma cambiasse formato l'errore resterebbe interno (fail-closed).
function eViolazioneUnStorno(err: unknown): boolean {
  if (!eViolazioneUnica(err)) return false
  const meta = (err as Prisma.PrismaClientKnownRequestError).meta as
    | { target?: unknown; message?: unknown }
    | undefined
  const target = meta?.target
  if (Array.isArray(target) ? target.includes(VINCOLO_UN_STORNO) : target === VINCOLO_UN_STORNO) {
    return true
  }
  const messaggio = typeof meta?.message === 'string' ? meta.message : ''
  return new RegExp(`unique constraint \\\\?"${VINCOLO_UN_STORNO}\\\\?"`).test(messaggio)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MOTIVO_MAX = 200

const dataIt = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

const documentoNonTrovato = () =>
  new NotFoundException({ error: 'DOCUMENTO_NON_TROVATO', message: 'Documento non trovato.' })

const versioneSuperata = () =>
  new ConflictException({
    error: 'VERSIONE_SUPERATA',
    message:
      'Il documento è stato modificato nel frattempo: ricarica per vedere i dati aggiornati.',
  })

function motivoValido(motivo: unknown): string {
  const m = typeof motivo === 'string' ? motivo.trim() : ''
  if (m.length < 1 || m.length > MOTIVO_MAX) {
    throw new BadRequestException({
      error: 'MOTIVO_NON_VALIDO',
      message: `Il motivo è obbligatorio e al massimo di ${MOTIVO_MAX} caratteri.`,
    })
  }
  return m
}

function versioneValida(versione: unknown): number {
  if (typeof versione !== 'number' || !Number.isInteger(versione) || versione < 1) {
    throw new BadRequestException({
      error: 'VERSIONE_NON_VALIDA',
      message: 'La versione del documento non è valida.',
    })
  }
  return versione
}

/**
 * Passo 7 del §5.5: i legami delle righe del documento tornano `CONFERMATO`, con `fatturato_il`,
 * `documento_id`, `riferimento_fattura`, scostamento (segnalazione e gestione) azzerati e
 * `movimento_vigente_id := movimento_fatturato_id`. Un legame ha piu' righe nel documento (CER e V,
 * Q42): la sorgente e' `SELECT DISTINCT legame_id, movimento_fatturato_id`, cosi' ogni legame si
 * ripristina una volta sola. Restituisce il numero di legami ripristinati; se non coincide con
 * quello dei legami citati dal documento e' un difetto (errore interno, la transazione si
 * annulla). Va chiamata con i legami gia' bloccati `FOR UPDATE`.
 */
export async function ripristinaLegamiDelDocumento(
  tx: Prisma.TransactionClient,
  tenantId: string,
  documentoId: string
): Promise<number> {
  return conJoinLineari(tx, async () => {
    const [attesi] = await tx.$queryRaw<{ legami: number; coppie: number }[]>`
      SELECT count(DISTINCT legame_id)::int AS legami,
             count(DISTINCT (legame_id, movimento_fatturato_id))::int AS coppie
      FROM righe_documento_fattura
      WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${documentoId}::uuid
        AND legame_id IS NOT NULL AND movimento_fatturato_id IS NOT NULL`
    const [citati] = await tx.$queryRaw<{ legami: number }[]>`
      SELECT count(DISTINCT legame_id)::int AS legami FROM righe_documento_fattura
      WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${documentoId}::uuid
        AND legame_id IS NOT NULL`
    if (attesi.legami !== citati.legami || attesi.coppie !== attesi.legami) {
      throw new Error('Ripristino dei legami: righe del documento senza movimento fatturato.')
    }
    const ripristinati = await tx.$executeRaw`
      UPDATE legami_movimento l
      SET stato = 'CONFERMATO', fatturato_il = NULL, documento_id = NULL,
          riferimento_fattura = NULL, scostamento_dopo_fattura = false, scostamento_il = NULL,
          scostamento_gestito_il = NULL, scostamento_gestito_da = NULL, scostamento_nota = NULL,
          movimento_vigente_id = u.movimento_fatturato_id, versione = l.versione + 1,
          updated_at = now()
      FROM (SELECT DISTINCT legame_id, movimento_fatturato_id FROM righe_documento_fattura
            WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${documentoId}::uuid
              AND legame_id IS NOT NULL AND movimento_fatturato_id IS NOT NULL) u
      WHERE l.tenant_id = ${tenantId}::uuid AND l.id = u.legame_id
        AND l.documento_id = ${documentoId}::uuid AND l.stato = 'FATTURATO'`
    if (ripristinati !== attesi.legami) {
      throw new Error('Ripristino dei legami: un legame del documento non e fatturato.')
    }
    return ripristinati
  })
}

interface DocumentoBloccato {
  id: string
  stato: 'BOZZA' | 'DEFINITIVO' | 'ANNULLATO'
  tipoDocumento: string
  registroIvaId: string
  anno: number
  numero: number | null
  numeroTesto: string | null
  dataDocumento: string
  totaleDocumento: string
  emessoIl: string | null
  versione: number
}

@Injectable()
export class AnnulloStornoService {
  /** Orologio sostituibile nei test (giorno italiano per `DATA_FUTURA`). */
  orologio: () => Date = () => new Date()

  constructor(
    private readonly prisma: PrismaService,
    private readonly documenti: DocumentiFatturaService
  ) {}

  async annulla(
    tenantId: string,
    utenteId: string,
    documentoId: string,
    b: RichiestaAnnullo
  ): Promise<DocumentoDettaglio> {
    const motivo = motivoValido(b.motivo)
    const versione = versioneValida(b.versione)
    if (!UUID.test(documentoId)) throw documentoNonTrovato()
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          // 1. Lettura semplice per ricavare (registro, anno): serve a bloccare la numerazione
          // PRIMA del documento (ordine dei lock).
          const prima = await this.leggiCoppia(tx, tenantId, documentoId)
          const numerazioni = await bloccaNumerazioni(tx, tenantId, [
            { registroIvaId: prima.registroIvaId, anno: prima.anno },
          ])
          // 2. Documento FOR UPDATE e controlli SOTTO lock.
          const d = await this.bloccaDocumento(tx, tenantId, documentoId)
          const haStorno = await this.haStorno(tx, tenantId, documentoId)
          const ammesso = annullabilita({
            stato: d.stato,
            tipoDocumento: d.tipoDocumento,
            emessoIl: d.emessoIl,
            numero: d.numero,
            ultimoNumero:
              numerazioni.get(chiaveNumerazione(d.registroIvaId, d.anno))?.ultimoNumero ?? 0,
            haStorno,
          })
          if (!ammesso.annullabile) {
            const motivoNo = ammesso.motivo as MotivoNonAnnullabile
            throw new ConflictException({
              error: 'ANNULLO_NON_AMMESSO',
              message: MESSAGGI_ANNULLO[motivoNo],
              details: { motivo: motivoNo },
            })
          }
          // m2: la coppia si controlla solo sul DEFINITIVO (immutabile). Una BOZZA puo` averla
          // cambiata (ricalcolo) e ha gia` risposto NON_DEFINITIVO qui sopra.
          this.controllaCoppia(d, prima)
          if (d.versione !== versione) throw versioneSuperata()

          // 3. Testate e righe dei legami FOR UPDATE per id.
          await this.bloccaLegamiDelDocumento(tx, tenantId, documentoId)

          // 4. Difesa: il numero torna alla serie col documento ancora DEFINITIVO e non emesso.
          await rilasciaUltimo(tx, tenantId, {
            registroIvaId: d.registroIvaId,
            anno: d.anno,
            numero: d.numero as number,
            documentoId,
          })
          const annullati = await tx.$executeRaw`
            UPDATE documenti_fattura
            SET stato = 'ANNULLATO', annullato_il = now(), annullato_da = ${utenteId}::uuid,
                motivo_annullo = ${motivo}, versione = versione + 1, updated_at = now()
            WHERE tenant_id = ${tenantId}::uuid AND id = ${documentoId}::uuid
              AND stato = 'DEFINITIVO' AND emesso_il IS NULL`
          if (annullati !== 1) throw new Error('Annullo: documento non annullato.')

          // 5. Marcatori e legami.
          await tx.$executeRaw`
            DELETE FROM marcatori_addebiti_fatturati
            WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${documentoId}::uuid`
          const legami = await ripristinaLegamiDelDocumento(tx, tenantId, documentoId)

          // 6. Audit: solo id, numeri e importi (il motivo e' testo libero e sta sul documento).
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'DOCUMENTO_FATTURA_ANNULLATO',
              description: 'Documento di fatturazione annullato',
              metadata: {
                documentoId,
                registroIvaId: d.registroIvaId,
                anno: d.anno,
                numero: d.numeroTesto,
                totale: d.totaleDocumento,
                legami,
              } as Prisma.InputJsonValue,
            },
          })
          return this.documenti.dettaglioInTx(tx, tenantId, documentoId)
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => traduciErrorePrisma(err, ENTITA, {}))
    )
  }

  async storna(
    tenantId: string,
    utenteId: string,
    documentoId: string,
    b: RichiestaStorno
  ): Promise<DocumentoDettaglio> {
    const motivo = motivoValido(b.motivo)
    const versione = versioneValida(b.versione)
    if (typeof b.dataDocumento !== 'string' || !eDataIso(b.dataDocumento)) {
      throw new BadRequestException({
        error: 'DATA_NON_VALIDA',
        message: 'La data del documento deve essere nel formato AAAA-MM-GG.',
      })
    }
    if (b.dataDocumento > oggiRoma(this.orologio())) {
      throw new BadRequestException({
        error: 'DATA_FUTURA',
        message: 'La data del documento non può essere futura.',
      })
    }
    if (typeof b.rifatturabile !== 'boolean') {
      throw new BadRequestException({
        error: 'RIFATTURABILE_NON_VALIDO',
        message: 'Indica se il documento è rifatturabile.',
      })
    }
    if (!UUID.test(documentoId)) throw documentoNonTrovato()
    const dataDocumento = b.dataDocumento
    const annoStorno = Number(dataDocumento.slice(0, 4))
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const prima = await this.leggiCoppia(tx, tenantId, documentoId)
          // 1. Numerazione della serie del NUOVO documento (registro dell'origine, anno della
          // data dello storno).
          await bloccaNumerazioni(tx, tenantId, [
            { registroIvaId: prima.registroIvaId, anno: annoStorno },
          ])
          // 2. Origine FOR UPDATE e controlli sotto lock.
          const o = await this.bloccaDocumento(tx, tenantId, documentoId)
          if (o.stato !== 'DEFINITIVO') {
            throw this.stornoNonAmmesso('NON_DEFINITIVO')
          }
          if (o.tipoDocumento === 'TD04') throw this.stornoNonAmmesso('NOTA_DI_CREDITO')
          // m2: il registro si controlla solo sul DEFINITIVO (immutabile): una BOZZA spostata da
          // un ricalcolo ha gia` risposto NON_DEFINITIVO.
          if (o.registroIvaId !== prima.registroIvaId) {
            throw new Error('Storno: il registro del documento e cambiato durante la lettura.')
          }
          if (await this.haStorno(tx, tenantId, documentoId)) {
            throw new ConflictException({
              error: 'STORNO_GIA_PRESENTE',
              message: 'Il documento ha già una nota di credito di storno.',
            })
          }
          if (o.versione !== versione) throw versioneSuperata()
          if (dataDocumento < o.dataDocumento) {
            throw new ConflictException({
              error: 'DATA_ANTERIORE_ULTIMA_FATTURA',
              message: `La data della nota di credito è anteriore a quella del documento stornato (${dataIt(o.dataDocumento)}).`,
              details: { ultimaData: o.dataDocumento },
            })
          }

          // 3. Legami FOR UPDATE.
          const legameIds = await this.bloccaLegamiDelDocumento(tx, tenantId, documentoId)

          // 4. Numero successivo (409 `DATA_ANTERIORE_ULTIMA_FATTURA` se la data e' anteriore a
          // `ultima_data` della serie). Suffisso della serie: decisione 20.
          const [riservato] = await riservaNumeri(tx, tenantId, [
            { registroIvaId: o.registroIvaId, anno: annoStorno, quanti: 1, dataDocumento },
          ])
          const numero = riservato.da
          const testo = numeroTesto(numero, riservato.suffisso)

          // 5. TD04 in BOZZA, figlie, promozione a DEFINITIVO.
          const stornoId = await this.creaStorno(tx, tenantId, o, dataDocumento, annoStorno, motivo)
          await tx.$executeRaw`
            UPDATE documenti_fattura
            SET stato = 'DEFINITIVO', numero = ${numero}::int, numero_testo = ${testo},
                definito_da = ${utenteId}::uuid, definito_il = now(), versione = versione + 1,
                updated_at = now()
            WHERE tenant_id = ${tenantId}::uuid AND id = ${stornoId}::uuid AND stato = 'BOZZA'`

          // 6. Legami e marcatori dell'origine.
          if (b.rifatturabile) {
            await tx.$executeRaw`
              DELETE FROM marcatori_addebiti_fatturati
              WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${documentoId}::uuid`
            await ripristinaLegamiDelDocumento(tx, tenantId, documentoId)
          } else if (legameIds.length > 0) {
            // I legami restano FATTURATO; lo scostamento ancora aperto si segna gestito (S20).
            await conJoinLineari(tx, () =>
              this.segnaScostamentiGestiti(
                tx,
                tenantId,
                utenteId,
                documentoId,
                legameIds,
                `storno documento ${o.numeroTesto ?? ''}`.trim()
              )
            )
          }

          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'DOCUMENTO_FATTURA_STORNATO',
              description: 'Nota di credito di storno emessa',
              metadata: {
                documentoOrigineId: documentoId,
                documentoId: stornoId,
                registroIvaId: o.registroIvaId,
                anno: annoStorno,
                numero: testo,
                totale: o.totaleDocumento,
                rifatturabile: b.rifatturabile,
              } as Prisma.InputJsonValue,
            },
          })
          return this.documenti.dettaglioInTx(tx, tenantId, stornoId)
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => {
          if (eViolazioneUnStorno(err)) {
            throw new ConflictException({
              error: 'STORNO_GIA_PRESENTE',
              message: 'Il documento ha già una nota di credito di storno.',
            })
          }
          return traduciErrorePrisma(err, ENTITA, {})
        })
    )
  }

  // ---------------------------------------------------------------------------------------------

  private stornoNonAmmesso(motivo: MotivoNonStornabile): ConflictException {
    return new ConflictException({
      error: 'STORNO_NON_AMMESSO',
      message: MESSAGGI_STORNO[motivo],
      details: { motivo },
    })
  }

  /** Lettura semplice: (registro, anno) del documento. 404 se non c'e' o e' di un'altra azienda. */
  private async leggiCoppia(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentoId: string
  ): Promise<{ registroIvaId: string; anno: number }> {
    const righe = await tx.$queryRaw<{ registroIvaId: string; anno: number }[]>`
      SELECT registro_iva_id::text AS "registroIvaId", anno::int AS anno
      FROM documenti_fattura
      WHERE tenant_id = ${tenantId}::uuid AND id = ${documentoId}::uuid`
    if (righe.length === 0) throw documentoNonTrovato()
    return righe[0]
  }

  private async bloccaDocumento(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentoId: string
  ): Promise<DocumentoBloccato> {
    const righe = await tx.$queryRaw<DocumentoBloccato[]>`
      SELECT id::text AS id, stato::text AS stato, tipo_documento AS "tipoDocumento",
             registro_iva_id::text AS "registroIvaId", anno::int AS anno, numero::int AS numero,
             numero_testo AS "numeroTesto", data_documento::text AS "dataDocumento",
             totale_documento::text AS "totaleDocumento",
             to_char(emesso_il, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "emessoIl",
             versione::int AS versione
      FROM documenti_fattura
      WHERE tenant_id = ${tenantId}::uuid AND id = ${documentoId}::uuid
      FOR UPDATE`
    if (righe.length === 0) throw documentoNonTrovato()
    return righe[0]
  }

  /** Un documento non in bozza non cambia coppia; se e' cambiata la lettura era superata. */
  private controllaCoppia(
    d: DocumentoBloccato,
    prima: { registroIvaId: string; anno: number }
  ): void {
    if (d.registroIvaId !== prima.registroIvaId || d.anno !== prima.anno) {
      throw new Error('Il registro o l anno del documento sono cambiati durante la lettura.')
    }
  }

  private async haStorno(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentoId: string
  ): Promise<boolean> {
    const [r] = await tx.$queryRaw<{ esiste: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM documenti_fattura
        WHERE tenant_id = ${tenantId}::uuid AND documento_origine_id = ${documentoId}::uuid
          AND tipo_documento = 'TD04' AND stato <> 'ANNULLATO') AS esiste`
    return r.esiste
  }

  /**
   * Testate e righe dei legami citati dal documento, FOR UPDATE per id. `enable_nestloop` torna al
   * valore letto prima (Q39). Restituisce gli id dei legami.
   */
  private async bloccaLegamiDelDocumento(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentoId: string
  ): Promise<string[]> {
    const righe = await tx.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT legame_id::text AS id FROM righe_documento_fattura
      WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${documentoId}::uuid
        AND legame_id IS NOT NULL
      ORDER BY 1`
    const ids = righe.map(r => r.id)
    if (ids.length > 0) await conJoinLineari(tx, () => bloccaRigheLegame(tx, tenantId, ids))
    return ids
  }

  /** Lo scostamento aperto dei legami `FATTURATO` del documento si segna gestito (S20). */
  private async segnaScostamentiGestiti(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    documentoId: string,
    legameIds: readonly string[],
    nota: string
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE legami_movimento l
      SET scostamento_gestito_il = now(), scostamento_gestito_da = ${utenteId}::uuid,
          scostamento_nota = ${nota.slice(0, 200)}, versione = l.versione + 1, updated_at = now()
      FROM unnest(${[...legameIds]}::uuid[]) AS chiesti(chiesto)
      WHERE l.tenant_id = ${tenantId}::uuid AND l.id = chiesto
        AND l.documento_id = ${documentoId}::uuid AND l.stato = 'FATTURATO'
        AND l.scostamento_dopo_fattura AND l.scostamento_gestito_il IS NULL`
  }

  /**
   * Il TD04 in BOZZA con le stesse righe (stessi tipi, P6), gli stessi riepiloghi e le stesse
   * rate dell'origine. `elaborazione_id` NULL, `riga_legame_id` NULL (Q1). Importi positivi: il
   * segno lo da' il tipo documento. Il motivo scritto dall'utente va nella fotografia
   * (`motivoStorno`, testo libero: mai nell'audit). Restituisce l'id.
   */
  private async creaStorno(
    tx: Prisma.TransactionClient,
    tenantId: string,
    o: DocumentoBloccato,
    dataDocumento: string,
    anno: number,
    motivo: string
  ): Promise<string> {
    const [nuovo] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO documenti_fattura
        (tenant_id, elaborazione_id, stato, tipo_documento, registro_iva_id, anno, data_documento,
         cliente_id, cliente_fatturazione_id, contratto_id, elenco_id, periodo_dal, periodo_al,
         formato_trasmissione, codice_destinatario, pec_destinatario, esigibilita_iva,
         totale_imponibile, totale_iva, totale_documento, netto_a_pagare, bollo_dovuto,
         importo_bollo, fotografia, documento_origine_id, errori, avvisi, escluso_da_definitiva,
         updated_at)
      SELECT x.tenant_id, NULL, 'BOZZA'::stato_documento_fattura, 'TD04', x.registro_iva_id,
             ${anno}::int, ${dataDocumento}::date, x.cliente_id, x.cliente_fatturazione_id,
             x.contratto_id, x.elenco_id, x.periodo_dal, x.periodo_al, x.formato_trasmissione,
             x.codice_destinatario, x.pec_destinatario, x.esigibilita_iva, x.totale_imponibile,
             x.totale_iva, x.totale_documento, x.netto_a_pagare, x.bollo_dovuto, x.importo_bollo,
             x.fotografia || jsonb_build_object('motivoStorno', ${motivo}::text), x.id, ARRAY[]::text[], x.avvisi, false, now()
      FROM documenti_fattura x
      WHERE x.tenant_id = ${tenantId}::uuid AND x.id = ${o.id}::uuid
      RETURNING id::text AS id`
    const nuovoId = nuovo.id

    const righe = await tx.$executeRaw`
      INSERT INTO righe_documento_fattura
        (tenant_id, documento_id, numero_linea, tipo_riga, legame_id, riga_legame_id,
         movimento_fatturato_id, riga_addebito_id, centro_ricavo_codice, categoria_codice,
         descrizione, data_movimento, cer_code,
         numero_fir, quantita, unita_misura, prezzo_unitario, sconto, importo_lordo,
         importo_sconto, prezzo_totale, codice_iva_id, aliquota_iva, natura_iva, updated_at)
      SELECT r.tenant_id, ${nuovoId}::uuid, r.numero_linea, r.tipo_riga, r.legame_id, NULL,
             r.movimento_fatturato_id, r.riga_addebito_id, r.centro_ricavo_codice,
             r.categoria_codice, r.descrizione, r.data_movimento,
             r.cer_code, r.numero_fir, r.quantita, r.unita_misura, r.prezzo_unitario, r.sconto,
             r.importo_lordo, r.importo_sconto, r.prezzo_totale, r.codice_iva_id, r.aliquota_iva,
             r.natura_iva, now()
      FROM righe_documento_fattura r
      WHERE r.tenant_id = ${tenantId}::uuid AND r.documento_id = ${o.id}::uuid
      ORDER BY r.numero_linea`
    const riepiloghi = await tx.$executeRaw`
      INSERT INTO riepiloghi_iva_documento
        (tenant_id, documento_id, aliquota, natura, imponibile, imposta, esigibilita,
         riferimento_normativo, updated_at)
      SELECT r.tenant_id, ${nuovoId}::uuid, r.aliquota, r.natura, r.imponibile, r.imposta,
             r.esigibilita, r.riferimento_normativo, now()
      FROM riepiloghi_iva_documento r
      WHERE r.tenant_id = ${tenantId}::uuid AND r.documento_id = ${o.id}::uuid`
    const rate = await tx.$executeRaw`
      INSERT INTO rate_documento_fattura
        (tenant_id, documento_id, ordine, modalita, data_scadenza, importo, istituto, iban, abi,
         cab, bic, updated_at)
      SELECT r.tenant_id, ${nuovoId}::uuid, r.ordine, r.modalita, r.data_scadenza, r.importo,
             r.istituto, r.iban, r.abi, r.cab, r.bic, now()
      FROM rate_documento_fattura r
      WHERE r.tenant_id = ${tenantId}::uuid AND r.documento_id = ${o.id}::uuid`

    const [attese] = await tx.$queryRaw<{ righe: number; riepiloghi: number; rate: number }[]>`
      SELECT (SELECT count(*) FROM righe_documento_fattura
              WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${o.id}::uuid)::int AS righe,
             (SELECT count(*) FROM riepiloghi_iva_documento
              WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${o.id}::uuid)::int AS riepiloghi,
             (SELECT count(*) FROM rate_documento_fattura
              WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${o.id}::uuid)::int AS rate`
    if (righe !== attese.righe || riepiloghi !== attese.riepiloghi || rate !== attese.rate) {
      throw new Error('Storno: copia incompleta di righe, riepiloghi o rate.')
    }
    return nuovoId
  }
}
