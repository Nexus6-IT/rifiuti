/**
 * Accesso ai dati dei ritiri programmati (4.7, T10). Ogni metodo riceve il client transazionale
 * `tx` del servizio: l'atomicità (FOR UPDATE + controllo FIR + scrittura) è decisa lassù.
 * Lo stato visibile non è mai salvato: la lista lo ricava da un LEFT JOIN LATERAL sul FIR attivo
 * (`status <> 'CANCELLED'`, lo stesso predicato dell'indice unico parziale), quindi in UNA query.
 */
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { ProvenienzaRifiuto, TipoTratta, WasteOperationType } from '@prisma/client'
import {
  statoVisibile,
  type FasciaRitiro,
  type StatoFirDb,
  type StatoRitiro,
} from '../../domain/ritiri'
import type { ValoriRitiro } from '../../application/ritiri/ritiri.input'
import { statiFirPerVisibile } from '../../application/ritiri/ritiri.input'
import type {
  FiltriRitiri,
  RitiroFirVista,
  RitiroVista,
} from '../../application/ritiri/ritiri.tipi'

export type Tx = Prisma.TransactionClient

export interface RitiroBloccato {
  id: string
  stato: StatoRitiro
  versione: number
}

interface RigaRitiro {
  id: string
  data_prevista: string
  fascia: FasciaRitiro | null
  ordine_giro: number | null
  produttore_id: string
  produttore_nome: string
  produttore_sede_id: string
  via: string
  civico: string
  cap: string
  comune: string
  provincia: string
  trasportatore_id: string
  trasportatore_nome: string
  destinatario_id: string
  destinatario_nome: string
  destinatario_sede_id: string
  automezzo_id: string | null
  targa: string | null
  cer_code: string
  descrizione: string
  stato_fisico: string | null
  caratteristiche_pericolo: string | null
  numero_colli: number | null
  quantita_presunta: string
  unita: string
  tipo_operazione: WasteOperationType
  codice_operazione: string | null
  provenienza: ProvenienzaRifiuto | null
  tipo_tratta: TipoTratta | null
  annotazioni: string | null
  note_interne: string | null
  stato: StatoRitiro
  motivo: string | null
  serie_id: string | null
  versione: number
  fir_id: string | null
  fir_numero: string | null
  fir_status: StatoFirDb | null
  totale: number
}

const DIMENSIONE_PREDEFINITA = 200
export const DIMENSIONE_MASSIMA = 2000

const SELECT_VISTA = Prisma.sql`
  SELECT r.id::text AS id,
         to_char(r.data_prevista, 'YYYY-MM-DD') AS data_prevista,
         r.fascia::text AS fascia,
         r.ordine_giro::int AS ordine_giro,
         r.produttore_id::text AS produttore_id,
         dp.ragione_sociale AS produttore_nome,
         r.produttore_sede_id::text AS produttore_sede_id,
         sp.via, sp.civico, sp.cap, sp.comune, sp.provincia,
         r.trasportatore_id::text AS trasportatore_id,
         dt.ragione_sociale AS trasportatore_nome,
         r.destinatario_id::text AS destinatario_id,
         dd.ragione_sociale AS destinatario_nome,
         r.destinatario_sede_id::text AS destinatario_sede_id,
         r.automezzo_id::text AS automezzo_id,
         a.targa,
         r.cer_code, r.descrizione, r.stato_fisico, r.caratteristiche_pericolo, r.numero_colli,
         r.quantita_presunta::text AS quantita_presunta,
         r.unita,
         r.tipo_operazione::text AS tipo_operazione,
         r.codice_operazione,
         r.provenienza::text AS provenienza,
         r.tipo_tratta::text AS tipo_tratta,
         r.annotazioni, r.note_interne,
         r.stato::text AS stato,
         r.motivo,
         r.serie_id::text AS serie_id,
         r.versione,
         f.id::text AS fir_id,
         f.fir_number AS fir_numero,
         f.status::text AS fir_status,
         count(*) OVER ()::int AS totale
  FROM ritiri r
  JOIN produttori p ON p.id = r.produttore_id AND p.tenant_id = r.tenant_id
  JOIN ditte dp ON dp.id = p.ditta_id AND dp.tenant_id = r.tenant_id
  JOIN sedi_ditte sp ON sp.id = r.produttore_sede_id AND sp.tenant_id = r.tenant_id
  JOIN trasportatori t ON t.id = r.trasportatore_id AND t.tenant_id = r.tenant_id
  JOIN ditte dt ON dt.id = t.ditta_id AND dt.tenant_id = r.tenant_id
  JOIN destinatari d ON d.id = r.destinatario_id AND d.tenant_id = r.tenant_id
  JOIN ditte dd ON dd.id = d.ditta_id AND dd.tenant_id = r.tenant_id
  LEFT JOIN automezzi a ON a.id = r.automezzo_id AND a.tenant_id = r.tenant_id
  LEFT JOIN LATERAL (
    SELECT fx.id, fx.fir_number, fx.status
    FROM firs fx
    WHERE fx.tenant_id = r.tenant_id AND fx.ritiro_id = r.id AND fx.status::text <> 'CANCELLED'
    LIMIT 1
  ) f ON true`

const ORDINE = Prisma.sql`
  ORDER BY r.data_prevista, (r.automezzo_id IS NULL), r.automezzo_id,
           (r.ordine_giro IS NULL), r.ordine_giro, r.created_at, r.id`

function comeVista(r: RigaRitiro, dettaglio: boolean): RitiroVista {
  const vista: RitiroVista = {
    id: r.id,
    dataPrevista: r.data_prevista,
    fascia: r.fascia,
    ordineGiro: r.ordine_giro,
    produttore: {
      id: r.produttore_id,
      nome: r.produttore_nome,
      sedeId: r.produttore_sede_id,
      indirizzo: `${r.via} ${r.civico}, ${r.cap} ${r.comune} (${r.provincia})`,
    },
    trasportatore: { id: r.trasportatore_id, nome: r.trasportatore_nome },
    destinatario: {
      id: r.destinatario_id,
      nome: r.destinatario_nome,
      sedeId: r.destinatario_sede_id,
    },
    automezzo: r.automezzo_id && r.targa ? { id: r.automezzo_id, targa: r.targa } : null,
    cerCode: r.cer_code,
    descrizione: r.descrizione,
    quantitaPresunta: r.quantita_presunta,
    unita: r.unita,
    stato: r.stato,
    statoVisibile: statoVisibile(r.stato, r.fir_status),
    motivo: r.motivo,
    fir: r.fir_id ? { id: r.fir_id, numero: r.fir_numero, status: r.fir_status as string } : null,
    serieId: r.serie_id,
    versione: r.versione,
  }
  if (dettaglio) {
    vista.statoFisico = r.stato_fisico
    vista.caratteristichePericolo = r.caratteristiche_pericolo
    vista.numeroColli = r.numero_colli
    vista.codiceOperazione = r.codice_operazione
    vista.tipoOperazione = r.tipo_operazione
    vista.provenienza = r.provenienza
    vista.tipoTratta = r.tipo_tratta
    vista.annotazioni = r.annotazioni
    vista.noteInterne = r.note_interne
  }
  return vista
}

@Injectable()
export class RitiriRepository {
  /** Ritiro bloccato FOR UPDATE: serializza annullo/modifica con l'INSERT di un FIR (FK e trigger). */
  async bloccaPerId(tx: Tx, tenantId: string, id: string): Promise<RitiroBloccato | null> {
    const righe = await tx.$queryRaw<RitiroBloccato[]>`
      SELECT id::text AS id, stato::text AS stato, versione
      FROM ritiri
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE`
    return righe[0] ?? null
  }

  /** FIR non annullato del ritiro, se c'è. */
  async firAttivo(tx: Tx, tenantId: string, ritiroId: string): Promise<RitiroFirVista | null> {
    const righe = await tx.$queryRaw<{ id: string; numero: string | null; status: string }[]>`
      SELECT id::text AS id, fir_number AS numero, status::text AS status
      FROM firs
      WHERE tenant_id = ${tenantId}::uuid AND ritiro_id = ${ritiroId}::uuid
        AND status::text <> 'CANCELLED'
      LIMIT 1`
    return righe[0] ?? null
  }

  async firPrecedenti(tx: Tx, tenantId: string, ritiroId: string): Promise<RitiroFirVista[]> {
    return tx.$queryRaw<RitiroFirVista[]>`
      SELECT id::text AS id, fir_number AS numero, status::text AS status
      FROM firs
      WHERE tenant_id = ${tenantId}::uuid AND ritiro_id = ${ritiroId}::uuid
        AND status::text = 'CANCELLED'
      ORDER BY created_at, id`
  }

  async trovaPerChiave(tx: Tx, tenantId: string, chiave: string): Promise<string[]> {
    const righe = await tx.ritiro.findMany({
      where: { tenantId, chiaveIdempotenza: chiave },
      select: { id: true },
    })
    return righe.map(r => r.id)
  }

  async inserisci(
    tx: Tx,
    tenantId: string,
    utenteId: string,
    valori: ValoriRitiro[],
    meta: { serieId: string | null; chiaveIdempotenza: string }
  ): Promise<string[]> {
    const ids: string[] = []
    for (const v of valori) {
      const r = await tx.ritiro.create({
        data: {
          tenantId,
          creatoDa: utenteId,
          serieId: meta.serieId,
          chiaveIdempotenza: meta.chiaveIdempotenza,
          ...this.colonne(v),
        },
        select: { id: true },
      })
      ids.push(r.id)
    }
    return ids
  }

  /** Sovrascrive i campi di dati e incrementa la versione (il chiamante ha già bloccato la riga). */
  async aggiornaDati(tx: Tx, tenantId: string, id: string, v: ValoriRitiro): Promise<void> {
    await tx.ritiro.update({
      where: { id_tenantId: { id, tenantId } },
      data: { ...this.colonne(v), versione: { increment: 1 } },
    })
  }

  async impostaStato(
    tx: Tx,
    tenantId: string,
    id: string,
    modifica:
      | { stato: 'NON_ESEGUITO'; motivo: string }
      | { stato: 'ANNULLATO'; motivo: string; utenteId: string }
      | { stato: 'PROGRAMMATO'; dataPrevista: string }
  ): Promise<void> {
    const data: Prisma.RitiroUncheckedUpdateInput = { versione: { increment: 1 } }
    if (modifica.stato === 'PROGRAMMATO') {
      data.stato = 'PROGRAMMATO'
      data.motivo = null
      data.dataPrevista = new Date(`${modifica.dataPrevista}T00:00:00.000Z`)
    } else if (modifica.stato === 'NON_ESEGUITO') {
      data.stato = 'NON_ESEGUITO'
      data.motivo = modifica.motivo
    } else {
      data.stato = 'ANNULLATO'
      data.motivo = modifica.motivo
      data.annullatoDa = modifica.utenteId
      data.annullatoIl = new Date()
    }
    await tx.ritiro.update({ where: { id_tenantId: { id, tenantId } }, data })
  }

  async leggi(
    tx: Tx,
    tenantId: string,
    id: string,
    opzioni: { dettaglio: boolean }
  ): Promise<RitiroVista | null> {
    const righe = await tx.$queryRaw<RigaRitiro[]>(
      Prisma.sql`${SELECT_VISTA} WHERE r.tenant_id = ${tenantId}::uuid AND r.id = ${id}::uuid`
    )
    if (righe.length === 0) return null
    const vista = comeVista(righe[0], opzioni.dettaglio)
    if (opzioni.dettaglio) vista.firPrecedenti = await this.firPrecedenti(tx, tenantId, id)
    return vista
  }

  /** Più ritiri per id, nell'ordine fisso di giro (data, mezzo, ordine, creazione). */
  async leggiMolti(tx: Tx, tenantId: string, ids: string[]): Promise<RitiroVista[]> {
    if (ids.length === 0) return []
    const righe = await tx.$queryRaw<RigaRitiro[]>(
      Prisma.sql`${SELECT_VISTA}
        WHERE r.tenant_id = ${tenantId}::uuid
          AND r.id IN (${Prisma.join(ids.map(i => Prisma.sql`${i}::uuid`))})
        ${ORDINE}`
    )
    return righe.map(r => comeVista(r, false))
  }

  /** Lista filtrata e impaginata, stato visibile compreso, in una sola query. */
  async elenca(
    tx: Tx,
    tenantId: string,
    filtri: Omit<FiltriRitiri, 'pagina' | 'dimensione'>,
    pagina: number,
    dimensione: number
  ): Promise<{ righe: RitiroVista[]; totale: number }> {
    const condizioni: Prisma.Sql[] = [Prisma.sql`r.tenant_id = ${tenantId}::uuid`]
    if (filtri.dal) condizioni.push(Prisma.sql`r.data_prevista >= ${filtri.dal}::date`)
    if (filtri.al) condizioni.push(Prisma.sql`r.data_prevista <= ${filtri.al}::date`)
    if (filtri.automezzoId)
      condizioni.push(Prisma.sql`r.automezzo_id = ${filtri.automezzoId}::uuid`)
    if (filtri.trasportatoreId) {
      condizioni.push(Prisma.sql`r.trasportatore_id = ${filtri.trasportatoreId}::uuid`)
    }
    if (filtri.produttoreId)
      condizioni.push(Prisma.sql`r.produttore_id = ${filtri.produttoreId}::uuid`)
    if (filtri.cerCode) condizioni.push(Prisma.sql`r.cer_code = ${filtri.cerCode}`)
    if (filtri.statoVisibile) condizioni.push(this.condizioneVisibile(filtri.statoVisibile))

    const righe = await tx.$queryRaw<RigaRitiro[]>(
      Prisma.sql`${SELECT_VISTA}
        WHERE ${Prisma.join(condizioni, ' AND ')}
        ${ORDINE}
        LIMIT ${dimensione} OFFSET ${(pagina - 1) * dimensione}`
    )
    return { righe: righe.map(r => comeVista(r, false)), totale: righe[0]?.totale ?? 0 }
  }

  limitiPagina(pagina?: number, dimensione?: number): { pagina: number; dimensione: number } {
    const d =
      Number.isInteger(dimensione) && (dimensione as number) > 0
        ? (dimensione as number)
        : DIMENSIONE_PREDEFINITA
    const p = Number.isInteger(pagina) && (pagina as number) > 0 ? (pagina as number) : 1
    return { pagina: p, dimensione: Math.min(d, DIMENSIONE_MASSIMA) }
  }

  // --- anagrafiche: appartenenza al tenant e coerenza sede-ditta -----------------------------

  async dittaDelRuolo(
    tx: Tx,
    tenantId: string,
    ruolo: 'produttore' | 'trasportatore' | 'destinatario',
    id: string
  ): Promise<string | null> {
    const where = { id, tenantId }
    const select = { dittaId: true }
    const r =
      ruolo === 'produttore'
        ? await tx.produttore.findFirst({ where, select })
        : ruolo === 'trasportatore'
          ? await tx.trasportatore.findFirst({ where, select })
          : await tx.destinatario.findFirst({ where, select })
    return r?.dittaId ?? null
  }

  async sedeAttivaDellaDitta(
    tx: Tx,
    tenantId: string,
    sedeId: string,
    dittaId: string
  ): Promise<boolean> {
    const s = await tx.sedeDitta.findFirst({
      where: { id: sedeId, tenantId, dittaId, attiva: true },
      select: { id: true },
    })
    return s !== null
  }

  async automezzoAttivo(tx: Tx, tenantId: string, id: string): Promise<boolean> {
    const a = await tx.automezzo.findFirst({
      where: { id, tenantId, attivo: true },
      select: { id: true },
    })
    return a !== null
  }

  // --- interni -----------------------------------------------------------------------------

  private colonne(v: ValoriRitiro) {
    return {
      dataPrevista: new Date(`${v.dataPrevista}T00:00:00.000Z`),
      fascia: v.fascia,
      ordineGiro: v.ordineGiro,
      produttoreId: v.produttoreId,
      produttoreSedeId: v.produttoreSedeId,
      trasportatoreId: v.trasportatoreId,
      destinatarioId: v.destinatarioId,
      destinatarioSedeId: v.destinatarioSedeId,
      automezzoId: v.automezzoId,
      cerCode: v.cerCode,
      descrizione: v.descrizione,
      statoFisico: v.statoFisico,
      caratteristichePericolo: v.caratteristichePericolo,
      numeroColli: v.numeroColli,
      quantitaPresunta: new Prisma.Decimal(v.quantitaPresunta),
      unita: v.unita,
      tipoOperazione: v.tipoOperazione,
      codiceOperazione: v.codiceOperazione,
      provenienza: v.provenienza,
      tipoTratta: v.tipoTratta,
      annotazioni: v.annotazioni,
      noteInterne: v.noteInterne,
    }
  }

  private condizioneVisibile(visibile: NonNullable<FiltriRitiri['statoVisibile']>): Prisma.Sql {
    switch (visibile) {
      case 'ANNULLATO':
        return Prisma.sql`r.stato::text = 'ANNULLATO'`
      case 'NON_ESEGUITO':
        return Prisma.sql`r.stato::text = 'NON_ESEGUITO'`
      case 'DA_GENERARE':
        return Prisma.sql`(r.stato::text = 'PROGRAMMATO' AND f.id IS NULL)`
      default: {
        const stati = statiFirPerVisibile(visibile)
        if (stati.length === 0) return Prisma.sql`false`
        return Prisma.sql`(r.stato::text = 'PROGRAMMATO' AND f.status::text IN (${Prisma.join(stati)}))`
      }
    }
  }
}
