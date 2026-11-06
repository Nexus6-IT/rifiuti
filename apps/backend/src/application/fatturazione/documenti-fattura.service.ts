// Lista, dettaglio e mappatura dei documenti di fatturazione nelle viste del frontend (4.4b1,
// Task 17b). Solo letture: nessun lock, nessuna scrittura. Le chiavi delle risposte sono quelle di
// `fe/features/fatturazione/fatturazione.model.ts` (DocumentoRiga, DocumentoDettaglio,
// RigaDocumentoVista, RiepilogoIvaVista, RataVista, Pagina): nessun id interno e nessun tenantId.
//
// Per insieme di documenti una query per tabella (testate, clienti, contratti, registri, storni,
// numerazioni), mai una per documento: `= ANY(ids)` su una tabella sola, tenant sempre dalla
// richiesta. Il numero di query non dipende dal numero di documenti.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  MESSAGGI_AVVISO,
  MESSAGGI_ERRORE,
  STATI_DOCUMENTO,
  type AvvisoDocumento,
  type ErroreDocumento,
  type StatoDocumento,
} from '../../domain/fatturazione/codici'
import type { FotografiaSalvata } from '../../domain/fatturazione/tipi'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { eDataIso } from './numerazione'

/** Q9, nell'ordine di controllo. */
export type MotivoNonAnnullabile =
  | 'NON_DEFINITIVO'
  | 'NOTA_DI_CREDITO'
  | 'STORNATO'
  | 'EMESSO'
  | 'NON_ULTIMO'

export interface SegnalazioneVista {
  codice: string
  messaggio: string
  dettaglio?: string
}

export interface DocumentoRiga {
  id: string
  stato: StatoDocumento
  tipoDocumento: string
  numeroTesto: string | null
  dataDocumento: string
  cliente: { id: string; denominazione: string }
  contratto: { id: string; numero: string }
  registro: { id: string; codice: string }
  totaleImponibile: string
  totaleIva: string
  totaleDocumento: string
  errori: SegnalazioneVista[]
  avvisi: SegnalazioneVista[]
  esclusoDaDefinitiva: boolean
  emessoIl: string | null
  annullabile: boolean
  motivoNonAnnullabile: MotivoNonAnnullabile | null
  stornabile: boolean
}

export interface RigaDocumentoVista {
  numeroLinea: number
  tipoRiga: string
  legameId: string | null
  rigaAddebitoId: string | null
  descrizione: string
  dataMovimento: string | null
  cerCode: string | null
  numeroFir: string | null
  quantita: string | null
  unitaMisura: string | null
  prezzoUnitario: string
  sconto: string | null
  importoLordo: string
  importoSconto: string
  prezzoTotale: string
  aliquotaIva: string
  naturaIva: string | null
}

export interface RiepilogoIvaVista {
  aliquota: string
  natura: string | null
  imponibile: string
  imposta: string
  esigibilita: 'I' | 'D' | 'S'
  riferimentoNormativo: string | null
}

export interface RataVista {
  ordine: number
  modalita: string
  dataScadenza: string
  importo: string
  istituto: string | null
  iban: string | null
  abi: string | null
  cab: string | null
  bic: string | null
}

export interface DocumentoDettaglio extends DocumentoRiga {
  righe: RigaDocumentoVista[]
  riepiloghi: RiepilogoIvaVista[]
  rate: RataVista[]
  nettoAPagare: string
  bolloDovuto: boolean
  importoBollo: string | null
  versione: number
  documentoOrigineId: string | null
  stornoId: string | null
  xmlGenerato: boolean
}

export interface Pagina<T> {
  elementi: T[]
  totale: number
  pagina: number
  dimensione: number
}

export interface FiltriDocumenti {
  registroIvaId?: string
  anno?: number
  stato?: StatoDocumento
  clienteId?: string
  dataDa?: string
  dataA?: string
  elaborazioneId?: string
  conErrori?: boolean
}

export const DIMENSIONE_MASSIMA_PAGINA = 100
/**
 * Pagina massima delle liste: con dimensione 100 lo scarto resta <= 1e7, ben dentro l'int di
 * `OFFSET ...::int` (oltre, Postgres risponde `integer out of range` e l'utente vedrebbe un 500).
 */
export const MAX_PAGINA = 100_000

export interface DatiAnnullabilita {
  stato: StatoDocumento
  tipoDocumento: string
  emessoIl: Date | string | null
  numero: number | null
  ultimoNumero: number
  /** Esiste un TD04 con `documento_origine_id` = id e stato diverso da ANNULLATO. */
  haStorno: boolean
}

/** Funzione pura: il primo motivo che vale, nell'ordine di Q9. */
export function annullabilita(d: DatiAnnullabilita): {
  annullabile: boolean
  motivo: MotivoNonAnnullabile | null
} {
  const motivo: MotivoNonAnnullabile | null =
    d.stato !== 'DEFINITIVO'
      ? 'NON_DEFINITIVO'
      : d.tipoDocumento === 'TD04'
        ? 'NOTA_DI_CREDITO'
        : d.haStorno
          ? 'STORNATO'
          : d.emessoIl !== null
            ? 'EMESSO'
            : d.numero !== d.ultimoNumero
              ? 'NON_ULTIMO'
              : null
  return { annullabile: motivo === null, motivo }
}

type Db = Prisma.TransactionClient

interface TestataLetta {
  id: string
  stato: StatoDocumento
  tipoDocumento: string
  registroIvaId: string
  anno: number
  numero: number | null
  numeroTesto: string | null
  dataDocumento: string
  clienteId: string
  contrattoId: string
  totaleImponibile: string
  totaleIva: string
  totaleDocumento: string
  nettoAPagare: string
  bolloDovuto: boolean
  importoBollo: string | null
  versione: number
  documentoOrigineId: string | null
  erroriColonna: string[]
  avvisiColonna: string[]
  esclusoDaDefinitiva: boolean
  emessoIl: string | null
  xmlGenerato: boolean
  segnalazioni: FotografiaSalvata['segnalazioni'] | null
}

function vistaSegnalazioni(
  salvate: ReadonlyArray<{ codice: string; dettaglio?: string }> | undefined,
  colonna: readonly string[],
  messaggi: Readonly<Record<string, string>>
): SegnalazioneVista[] {
  // Fonte: la fotografia (ha il dettaglio); senza di essa si ripiega sulla colonna `text[]`.
  const sorgente = Array.isArray(salvate)
    ? salvate
    : colonna.map(codice => ({ codice, dettaglio: undefined }))
  return sorgente.map(s => ({
    codice: s.codice,
    messaggio: messaggi[s.codice] ?? s.codice,
    ...(s.dettaglio !== undefined && s.dettaglio !== null ? { dettaglio: s.dettaglio } : {}),
  }))
}

@Injectable()
export class DocumentiFatturaService {
  constructor(private readonly prisma: PrismaService) {}

  async lista(
    tenantId: string,
    q: FiltriDocumenti & { pagina: number; dimensione: number }
  ): Promise<Pagina<DocumentoRiga>> {
    if (
      !Number.isInteger(q.pagina) ||
      q.pagina < 1 ||
      !Number.isInteger(q.dimensione) ||
      q.dimensione < 1 ||
      q.dimensione > DIMENSIONE_MASSIMA_PAGINA ||
      q.pagina > MAX_PAGINA
    ) {
      throw new BadRequestException({
        error: 'PAGINAZIONE_NON_VALIDA',
        message: `La pagina va da 1 a ${MAX_PAGINA} e la dimensione da 1 a ${DIMENSIONE_MASSIMA_PAGINA}.`,
      })
    }
    if (q.anno !== undefined && (!Number.isInteger(q.anno) || q.anno < 2000 || q.anno > 2100)) {
      throw new BadRequestException({
        error: 'FILTRO_NON_VALIDO',
        message: "L'anno del filtro non è valido.",
      })
    }
    if (q.stato !== undefined && !(STATI_DOCUMENTO as readonly string[]).includes(q.stato)) {
      throw new BadRequestException({
        error: 'FILTRO_NON_VALIDO',
        message: 'Lo stato del filtro non è valido.',
      })
    }
    for (const id of [q.registroIvaId, q.clienteId, q.elaborazioneId]) {
      if (id !== undefined && !UUID.test(id)) {
        throw new BadRequestException({
          error: 'FILTRO_NON_VALIDO',
          message: 'Un filtro per identificativo non è valido.',
        })
      }
    }
    for (const data of [q.dataDa, q.dataA]) {
      if (data !== undefined && !eDataIso(data)) {
        throw new BadRequestException({
          error: 'DATA_NON_VALIDA',
          message: 'Le date del filtro devono essere nel formato AAAA-MM-GG.',
        })
      }
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const condizioni: Prisma.Sql[] = [Prisma.sql`d.tenant_id = ${tenantId}::uuid`]
        if (q.registroIvaId !== undefined)
          condizioni.push(Prisma.sql`d.registro_iva_id = ${q.registroIvaId}::uuid`)
        if (q.anno !== undefined) condizioni.push(Prisma.sql`d.anno = ${q.anno}::int`)
        if (q.stato !== undefined)
          condizioni.push(Prisma.sql`d.stato = ${q.stato}::stato_documento_fattura`)
        if (q.clienteId !== undefined)
          condizioni.push(Prisma.sql`d.cliente_fatturazione_id = ${q.clienteId}::uuid`)
        if (q.dataDa !== undefined)
          condizioni.push(Prisma.sql`d.data_documento >= ${q.dataDa}::date`)
        if (q.dataA !== undefined) condizioni.push(Prisma.sql`d.data_documento <= ${q.dataA}::date`)
        if (q.elaborazioneId !== undefined)
          condizioni.push(Prisma.sql`d.elaborazione_id = ${q.elaborazioneId}::uuid`)
        if (q.conErrori === true) condizioni.push(Prisma.sql`cardinality(d.errori) > 0`)
        if (q.conErrori === false) condizioni.push(Prisma.sql`cardinality(d.errori) = 0`)
        const dove = Prisma.join(condizioni, ' AND ')
        const [{ totale }] = await tx.$queryRaw<{ totale: number }[]>`
          SELECT count(*)::int AS totale FROM "documenti_fattura" d WHERE ${dove}`
        const ids = await tx.$queryRaw<{ id: string }[]>`
          SELECT d.id::text AS id FROM "documenti_fattura" d WHERE ${dove}
          ORDER BY d.data_documento DESC, d.anno DESC, d.numero DESC NULLS FIRST,
                   d.created_at DESC, d.id
          LIMIT ${q.dimensione}::int OFFSET ${(q.pagina - 1) * q.dimensione}::int`
        const elementi = await this.righeInTx(
          tx,
          tenantId,
          ids.map(r => r.id)
        )
        return { elementi, totale, pagina: q.pagina, dimensione: q.dimensione }
      })
    )
  }

  async dettaglio(tenantId: string, id: string): Promise<DocumentoDettaglio> {
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(tx => this.dettaglioInTx(tx, tenantId, id))
    )
  }

  /** 404 `DOCUMENTO_NON_TROVATO` se non c'e' (o e' di un'altra azienda). */
  async dettaglioInTx(tx: Db, tenantId: string, id: string): Promise<DocumentoDettaglio> {
    if (!UUID.test(id)) throw documentoNonTrovato()
    const contesto = await this.leggiContesto(tx, tenantId, [id])
    const t = contesto.testate[0]
    if (!t) throw documentoNonTrovato()
    const riga = this.mappa(t, contesto)
    const righe = await tx.$queryRaw<RigaDocumentoVista[]>`
      SELECT numero_linea::int AS "numeroLinea", tipo_riga::text AS "tipoRiga",
             legame_id::text AS "legameId", riga_addebito_id::text AS "rigaAddebitoId",
             descrizione, data_movimento::text AS "dataMovimento", cer_code AS "cerCode",
             numero_fir AS "numeroFir", quantita::text AS quantita, unita_misura AS "unitaMisura",
             prezzo_unitario::text AS "prezzoUnitario", sconto,
             importo_lordo::text AS "importoLordo", importo_sconto::text AS "importoSconto",
             prezzo_totale::text AS "prezzoTotale", aliquota_iva::text AS "aliquotaIva",
             natura_iva AS "naturaIva"
      FROM "righe_documento_fattura"
      WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${id}::uuid
      ORDER BY numero_linea, id`
    const riepiloghi = await tx.$queryRaw<RiepilogoIvaVista[]>`
      SELECT aliquota::text AS aliquota, natura, imponibile::text AS imponibile,
             imposta::text AS imposta,
             CASE esigibilita WHEN 'IMMEDIATA' THEN 'I' WHEN 'DIFFERITA' THEN 'D' ELSE 'S' END
               AS esigibilita,
             riferimento_normativo AS "riferimentoNormativo"
      FROM "riepiloghi_iva_documento"
      WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${id}::uuid
      ORDER BY aliquota DESC, natura NULLS FIRST, esigibilita, id`
    const rate = await tx.$queryRaw<RataVista[]>`
      SELECT ordine::int AS ordine, modalita, data_scadenza::text AS "dataScadenza",
             importo::text AS importo, istituto, iban, abi, cab, bic
      FROM "rate_documento_fattura"
      WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${id}::uuid
      ORDER BY ordine, id`
    return {
      ...riga,
      righe: righe.map(r => ({ ...r })),
      riepiloghi: riepiloghi.map(r => ({ ...r })),
      rate: rate.map(r => ({ ...r })),
      nettoAPagare: t.nettoAPagare,
      bolloDovuto: t.bolloDovuto,
      importoBollo: t.importoBollo,
      versione: t.versione,
      documentoOrigineId: t.documentoOrigineId,
      stornoId: contesto.storni.get(t.id) ?? null,
      xmlGenerato: t.xmlGenerato,
    }
  }

  /**
   * Le viste di lista dei documenti indicati, nell'ordine degli id (quelli non trovati o di
   * un'altra azienda mancano). `ids.length` ≤ 100.
   */
  async righeInTx(tx: Db, tenantId: string, ids: readonly string[]): Promise<DocumentoRiga[]> {
    if (ids.length === 0) return []
    if (ids.length > DIMENSIONE_MASSIMA_PAGINA) {
      throw new BadRequestException({
        error: 'TROPPI_DOCUMENTI',
        message: `Al massimo ${DIMENSIONE_MASSIMA_PAGINA} documenti per volta.`,
      })
    }
    const contesto = await this.leggiContesto(tx, tenantId, ids)
    const perId = new Map(contesto.testate.map(t => [t.id, t]))
    return ids.flatMap(id => {
      const t = perId.get(id)
      return t ? [this.mappa(t, contesto)] : []
    })
  }

  // ---------------------------------------------------------------------------------------------

  /** Testate, clienti, contratti, registri, storni e numerazioni: una query ciascuno. */
  private async leggiContesto(tx: Db, tenantId: string, ids: readonly string[]) {
    const lista = [...ids]
    const testate = await tx.$queryRaw<TestataLetta[]>`
      SELECT d.id::text AS id, d.stato::text AS stato, d.tipo_documento AS "tipoDocumento",
             d.registro_iva_id::text AS "registroIvaId", d.anno::int AS anno, d.numero::int AS numero,
             d.numero_testo AS "numeroTesto", d.data_documento::text AS "dataDocumento",
             d.cliente_fatturazione_id::text AS "clienteId", d.contratto_id::text AS "contrattoId",
             d.totale_imponibile::text AS "totaleImponibile", d.totale_iva::text AS "totaleIva",
             d.totale_documento::text AS "totaleDocumento", d.netto_a_pagare::text AS "nettoAPagare",
             d.bollo_dovuto AS "bolloDovuto", d.importo_bollo::text AS "importoBollo",
             d.versione::int AS versione, d.documento_origine_id::text AS "documentoOrigineId",
             COALESCE(d.errori, ARRAY[]::text[]) AS "erroriColonna",
             COALESCE(d.avvisi, ARRAY[]::text[]) AS "avvisiColonna",
             d.escluso_da_definitiva AS "esclusoDaDefinitiva",
             to_char(d.emesso_il, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "emessoIl",
             (d.xml IS NOT NULL) AS "xmlGenerato",
             d.fotografia -> 'segnalazioni' AS segnalazioni
      FROM "documenti_fattura" d
      WHERE d.tenant_id = ${tenantId}::uuid AND d.id = ANY(${lista}::uuid[])`
    if (testate.length === 0) {
      return {
        testate,
        clienti: new Map<string, string>(),
        contratti: new Map<string, string>(),
        registri: new Map<string, string>(),
        storni: new Map<string, string>(),
        ultimi: new Map<string, number>(),
      }
    }
    const clientiIds = [...new Set(testate.map(t => t.clienteId))]
    const contrattiIds = [...new Set(testate.map(t => t.contrattoId))]
    const registriIds = [...new Set(testate.map(t => t.registroIvaId))]
    const clienti = await tx.$queryRaw<{ id: string; denominazione: string }[]>`
      SELECT c.id::text AS id, dt.ragione_sociale AS denominazione
      FROM "clienti" c
      JOIN "ditte" dt ON dt.id = c.ditta_id AND dt.tenant_id = c.tenant_id
      WHERE c.tenant_id = ${tenantId}::uuid AND c.id = ANY(${clientiIds}::uuid[])`
    const contratti = await tx.$queryRaw<{ id: string; numero: string }[]>`
      SELECT id::text AS id, numero FROM "contratti_cliente"
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${contrattiIds}::uuid[])`
    const registri = await tx.$queryRaw<{ id: string; codice: string }[]>`
      SELECT id::text AS id, codice FROM "registri_iva"
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${registriIds}::uuid[])`
    const storni = await tx.$queryRaw<{ origine: string; id: string }[]>`
      SELECT documento_origine_id::text AS origine, id::text AS id FROM "documenti_fattura"
      WHERE tenant_id = ${tenantId}::uuid AND documento_origine_id = ANY(${lista}::uuid[])
        AND tipo_documento = 'TD04' AND stato <> 'ANNULLATO'`
    // Ultimo numero della coppia (registro, anno), letto senza lock: serve solo a dire se un
    // definitivo e' l'ultimo; l'annullo vero rilegge sotto lock.
    const ultimi = await tx.$queryRaw<{ registro: string; anno: number; ultimo: number }[]>`
      SELECT registro_iva_id::text AS registro, anno::int AS anno, ultimo_numero::int AS ultimo
      FROM "numerazioni_fattura"
      WHERE tenant_id = ${tenantId}::uuid AND registro_iva_id = ANY(${registriIds}::uuid[])`
    return {
      testate,
      clienti: new Map(clienti.map(c => [c.id, c.denominazione])),
      contratti: new Map(contratti.map(c => [c.id, c.numero])),
      registri: new Map(registri.map(r => [r.id, r.codice])),
      storni: new Map(storni.map(s => [s.origine, s.id])),
      ultimi: new Map(ultimi.map(u => [`${u.registro}:${u.anno}`, u.ultimo])),
    }
  }

  private mappa(
    t: TestataLetta,
    c: Awaited<ReturnType<DocumentiFatturaService['leggiContesto']>>
  ): DocumentoRiga {
    const haStorno = c.storni.has(t.id)
    const { annullabile, motivo } = annullabilita({
      stato: t.stato,
      tipoDocumento: t.tipoDocumento,
      emessoIl: t.emessoIl,
      numero: t.numero,
      ultimoNumero: c.ultimi.get(`${t.registroIvaId}:${t.anno}`) ?? 0,
      haStorno,
    })
    return {
      id: t.id,
      stato: t.stato,
      tipoDocumento: t.tipoDocumento,
      numeroTesto: t.numeroTesto,
      dataDocumento: t.dataDocumento,
      cliente: { id: t.clienteId, denominazione: c.clienti.get(t.clienteId) ?? '' },
      contratto: { id: t.contrattoId, numero: c.contratti.get(t.contrattoId) ?? '' },
      registro: { id: t.registroIvaId, codice: c.registri.get(t.registroIvaId) ?? '' },
      totaleImponibile: t.totaleImponibile,
      totaleIva: t.totaleIva,
      totaleDocumento: t.totaleDocumento,
      errori: vistaSegnalazioni(
        t.segnalazioni?.errori,
        t.erroriColonna,
        MESSAGGI_ERRORE as Readonly<Record<ErroreDocumento, string>>
      ),
      avvisi: vistaSegnalazioni(
        t.segnalazioni?.avvisi,
        t.avvisiColonna,
        MESSAGGI_AVVISO as Readonly<Record<AvvisoDocumento, string>>
      ),
      esclusoDaDefinitiva: t.esclusoDaDefinitiva,
      emessoIl: t.emessoIl,
      annullabile,
      motivoNonAnnullabile: motivo,
      stornabile: t.stato === 'DEFINITIVO' && t.tipoDocumento !== 'TD04' && !haStorno,
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function documentoNonTrovato() {
  return new NotFoundException({
    error: 'DOCUMENTO_NON_TROVATO',
    message: 'Documento non trovato.',
  })
}
