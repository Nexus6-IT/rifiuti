// Mappature per azienda dell'export contabile (4.4c, Task 29, spec §7.3): per ogni adattatore, il
// codice che il gestionale si aspetta per una chiave di WasteFlow (codice IVA, conto dei ricavi,
// cliente, pagamento, registro). Una riga per (azienda, adattatore, tipo, chiave); `valore: null`
// nella richiesta cancella la voce. L'audit contiene l'adattatore e i conteggi: mai chiavi o valori
// (i codici dei clienti del gestionale sono dati dell'azienda).
//
// Nessun lock oltre a quelli di riga della propria scrittura: le voci si scrivono in ordine
// (tipo, chiave) e l'INSERT e' ordinato; il DELETE no, quindi un deadlock fra richieste che
// scrivono e cancellano chiavi incrociate e' possibile: Postgres ne ferma una e diventa 409
// `OPERAZIONE_CONCORRENTE` (come l'attesa oltre il timeout).
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { traduciErrorePrisma, type DescrizioneEntita } from '../../clienti/anagrafica-versionata'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../../listino/lock-listino'
import { nelContestoTenant } from '../../pese/nel-contesto-tenant'
import type { DocumentoPerExport } from '../export-csv'
import { conJoinLineari } from '../piani-query'
import {
  chiaveMappatura,
  TIPI_MAPPATURA,
  type ChiaveMancante,
  type TipoMappatura,
} from './adattatore-export-contabile'
import { RegistroAdattatori } from './registro-adattatori'
import { leggiChiaveIva, NOMI_TIPO_RIGA } from './teamsystem.adattatore'

/** Voci per richiesta (il DTO applica lo stesso limite; qui resta come difesa del servizio) (le colonne sono corte, ma una richiesta non deve poter essere enorme). */
export const MAX_VOCI_MAPPATURE = 500
const LUNGHEZZA_MASSIMA_CHIAVE = 100
const LUNGHEZZA_MASSIMA_VALORE = 50
/** Oltre questa soglia le liste si leggono con `JOIN` lineare (stessa forma della fatturazione). */
const SOGLIA_LISTA_LUNGA = 100

export interface MappaturaVista {
  tipo: TipoMappatura
  chiaveWasteflow: string
  valore: string
  versione: number
  /** Testo per l'utente (cliente, aliquota, condizione...): mai l'identificativo grezzo. */
  etichetta: string
}

/** Etichetta di una chiave che non corrisponde piu' a nessun dato dell'azienda. */
export const ETICHETTA_NON_PRESENTE = '(non più presente)'

export interface VoceMappatura {
  tipo: TipoMappatura
  chiaveWasteflow: string
  /** `null` cancella la voce. */
  valore: string | null
  /**
   * Versione letta dal client; `null` = voce nuova. Se non corrisponde a quella del database la
   * richiesta intera risponde 409 `VERSIONE_SUPERATA` e non scrive nulla.
   */
  versione: number | null
}

const versioneSuperata = (): ConflictException =>
  new ConflictException({
    error: 'VERSIONE_SUPERATA',
    message: 'Le mappature sono state modificate da un altro utente: ricarica e riprova.',
  })

const ENTITA: DescrizioneEntita = {
  prefisso: 'MAPPATURE_EXPORT',
  soggetto: 'Le mappature',
  femminile: true,
}

const vociNonValide = (message: string, error = 'VOCI_NON_VALIDE'): BadRequestException =>
  new BadRequestException({ error, message })

/** Controlli sulle voci, tutti prima di toccare il database. Torna le voci normalizzate e ordinate. */
function normalizza(voci: readonly VoceMappatura[]): VoceMappatura[] {
  if (!Array.isArray(voci)) throw vociNonValide('Le voci non sono valide.')
  if (voci.length > MAX_VOCI_MAPPATURE) {
    throw vociNonValide(`Al massimo ${MAX_VOCI_MAPPATURE} voci per richiesta.`, 'TROPPE_VOCI')
  }
  const viste = new Set<string>()
  const risultato: VoceMappatura[] = []
  for (const v of voci) {
    if (!(TIPI_MAPPATURA as readonly unknown[]).includes(v?.tipo)) {
      throw vociNonValide('Il tipo di una voce non è valido.')
    }
    if (
      typeof v.chiaveWasteflow !== 'string' ||
      v.chiaveWasteflow.trim() === '' ||
      v.chiaveWasteflow.length > LUNGHEZZA_MASSIMA_CHIAVE
    ) {
      throw vociNonValide(
        `La chiave di una voce deve avere da 1 a ${LUNGHEZZA_MASSIMA_CHIAVE} caratteri.`
      )
    }
    let valore: string | null = null
    if (v.valore !== null) {
      if (typeof v.valore !== 'string') throw vociNonValide('Il valore di una voce non è valido.')
      const pulito = v.valore.trim()
      valore = pulito
      if (pulito === '' || pulito.length > LUNGHEZZA_MASSIMA_VALORE) {
        throw vociNonValide(
          `Il valore di una voce deve avere da 1 a ${LUNGHEZZA_MASSIMA_VALORE} caratteri.`
        )
      }
    }
    const chiave = chiaveMappatura(v.tipo, v.chiaveWasteflow)
    if (viste.has(chiave))
      throw vociNonValide('Una voce compare più di una volta.', 'VOCI_DUPLICATE')
    viste.add(chiave)
    if (v.versione != null && (!Number.isInteger(v.versione) || v.versione < 1)) {
      throw vociNonValide('La versione di una voce non è valida.')
    }
    risultato.push({
      tipo: v.tipo,
      chiaveWasteflow: v.chiaveWasteflow,
      valore,
      versione: v.versione ?? null,
    })
  }
  return risultato.sort(
    (a, b) => a.tipo.localeCompare(b.tipo) || (a.chiaveWasteflow < b.chiaveWasteflow ? -1 : 1)
  )
}

@Injectable()
export class MappatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registro: RegistroAdattatori
  ) {}

  async lista(tenantId: string, adattatore: string): Promise<MappaturaVista[]> {
    this.registro.trova(adattatore)
    return nelContestoTenant(tenantId, () => this.leggiTutte(this.prisma, tenantId, adattatore))
  }

  async imposta(
    tenantId: string,
    utenteId: string,
    adattatore: string,
    voci: readonly VoceMappatura[]
  ): Promise<MappaturaVista[]> {
    this.registro.trova(adattatore)
    const ordinate = normalizza(voci)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          let impostate = 0
          let cancellate = 0
          // Le righe esistenti si bloccano in ordine (tipo, chiave) e si confrontano con la
          // versione letta dal client: una sola differenza e' 409 e la transazione non scrive nulla.
          const esistenti = await this.bloccaEsistenti(tx, tenantId, adattatore, ordinate)
          const perChiave = new Map(esistenti.map(e => [chiaveMappatura(e.tipo, e.chiave), e]))
          const daAggiornare: { id: string; valore: string }[] = []
          const nuove: (VoceMappatura & { valore: string })[] = []
          const daEliminare: string[] = []
          for (const v of ordinate) {
            const e = perChiave.get(chiaveMappatura(v.tipo, v.chiaveWasteflow))
            if (v.valore === null) {
              if (e === undefined) {
                if (v.versione !== null) throw versioneSuperata()
                continue
              }
              if (v.versione !== null && v.versione !== e.versione) throw versioneSuperata()
              daEliminare.push(e.id)
            } else if (e === undefined) {
              if (v.versione !== null) throw versioneSuperata()
              nuove.push({ ...v, valore: v.valore })
            } else {
              if (v.versione !== e.versione) throw versioneSuperata()
              if (e.valore !== v.valore) daAggiornare.push({ id: e.id, valore: v.valore })
            }
          }
          if (nuove.length > 0) {
            // Una voce nuova inserita da altri nel frattempo non si sovrascrive: conteggio.
            impostate += await tx.$executeRaw`
              INSERT INTO "mappature_export_contabile"
                (tenant_id, adattatore, tipo, chiave_wasteflow, valore, modificato_da, updated_at)
              SELECT ${tenantId}::uuid, ${adattatore}, x.t, x.c, x.v, ${utenteId}::uuid, now()
              FROM unnest(${nuove.map(v => v.tipo)}::text[],
                          ${nuove.map(v => v.chiaveWasteflow)}::text[],
                          ${nuove.map(v => v.valore)}::text[]) WITH ORDINALITY AS x(t, c, v, n)
              ORDER BY x.n
              ON CONFLICT (tenant_id, adattatore, tipo, chiave_wasteflow) DO NOTHING`
            if (impostate !== nuove.length) throw versioneSuperata()
          }
          if (daAggiornare.length > 0) {
            impostate += await tx.$executeRaw`
              UPDATE "mappature_export_contabile" m
              SET valore = x.v, versione = m.versione + 1,
                  modificato_da = ${utenteId}::uuid, updated_at = now()
              FROM unnest(${daAggiornare.map(v => v.id)}::uuid[],
                          ${daAggiornare.map(v => v.valore)}::text[]) AS x(i, v)
              WHERE m.id = x.i AND m.tenant_id = ${tenantId}::uuid`
          }
          if (daEliminare.length > 0) {
            cancellate = await tx.$executeRaw`
              DELETE FROM "mappature_export_contabile" m
              WHERE m.tenant_id = ${tenantId}::uuid AND m.id = ANY(${daEliminare}::uuid[])`
          }
          if (impostate + cancellate > 0) {
            await tx.activityLog.create({
              data: {
                tenantId,
                userId: utenteId,
                action: 'MAPPATURE_EXPORT_IMPOSTATE',
                description: "Mappature dell'export contabile modificate",
                metadata: { adattatore, impostate, cancellate },
              },
            })
          }
          return this.leggiTutte(tx, tenantId, adattatore)
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => traduciErrorePrisma(err, ENTITA, {}))
    )
  }

  /** Le chiavi richieste dai documenti scelti che l'azienda non ha ancora mappato. */
  async mancanti(
    tenantId: string,
    adattatore: string,
    documenti: readonly DocumentoPerExport[]
  ): Promise<ChiaveMancante[]> {
    const a = this.registro.trova(adattatore)
    const richieste = richiesteUniche(a.mappatureRichieste(documenti))
    if (richieste.length === 0) return []
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const valori = await this.valoriInTx(tx, tenantId, adattatore, richieste)
        return mancantiDa(richieste, valori)
      })
    )
  }

  /**
   * Valori delle sole chiavi richieste, in una transazione gia' aperta nel contesto del tenant.
   * Torna una mappa `chiaveMappatura(tipo, chiave)` -> valore; le chiavi senza voce non ci sono.
   * Liste lunghe: `JOIN` lineare (stessa forma della fatturazione, vedi `piani-query.ts`).
   */
  async valoriInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    adattatore: string,
    richieste: readonly ChiaveMancante[]
  ): Promise<Map<string, string>> {
    const valori = new Map<string, string>()
    if (richieste.length === 0) return valori
    const tipi = richieste.map(r => r.tipo)
    const chiavi = richieste.map(r => r.chiaveWasteflow)
    const leggi = () =>
      tx.$queryRaw<{ tipo: TipoMappatura; chiave: string; valore: string }[]>`
        SELECT m.tipo AS tipo, m.chiave_wasteflow AS chiave, m.valore AS valore
        FROM "mappature_export_contabile" m
        JOIN unnest(${tipi}::text[], ${chiavi}::text[]) AS x(t, c)
          ON m.tipo = x.t AND m.chiave_wasteflow = x.c
        WHERE m.tenant_id = ${tenantId}::uuid AND m.adattatore = ${adattatore}`
    const righe =
      richieste.length > SOGLIA_LISTA_LUNGA ? await conJoinLineari(tx, leggi) : await leggi()
    for (const r of righe) valori.set(chiaveMappatura(r.tipo, r.chiave), r.valore)
    return valori
  }

  /** Righe esistenti fra le voci indicate, bloccate `FOR UPDATE` in ordine (tipo, chiave). */
  private async bloccaEsistenti(
    tx: Prisma.TransactionClient,
    tenantId: string,
    adattatore: string,
    voci: readonly VoceMappatura[]
  ): Promise<
    { id: string; tipo: TipoMappatura; chiave: string; valore: string; versione: number }[]
  > {
    if (voci.length === 0) return []
    const tipi = voci.map(v => v.tipo)
    const chiavi = voci.map(v => v.chiaveWasteflow)
    const leggi = () =>
      tx.$queryRaw<
        { id: string; tipo: TipoMappatura; chiave: string; valore: string; versione: number }[]
      >`
        SELECT m.id::text AS id, m.tipo AS tipo, m.chiave_wasteflow AS chiave, m.valore AS valore,
               m.versione::int AS versione
        FROM "mappature_export_contabile" m
        JOIN unnest(${tipi}::text[], ${chiavi}::text[]) AS x(t, c)
          ON m.tipo = x.t AND m.chiave_wasteflow = x.c
        WHERE m.tenant_id = ${tenantId}::uuid AND m.adattatore = ${adattatore}
        ORDER BY m.tipo, m.chiave_wasteflow
        FOR UPDATE OF m`
    return voci.length > SOGLIA_LISTA_LUNGA ? conJoinLineari(tx, leggi) : leggi()
  }

  private async leggiTutte(
    db: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    adattatore: string
  ): Promise<MappaturaVista[]> {
    const righe = await db.$queryRaw<Omit<MappaturaVista, 'etichetta'>[]>`
      SELECT tipo AS tipo, chiave_wasteflow AS "chiaveWasteflow", valore AS valore,
             versione::int AS versione
      FROM "mappature_export_contabile"
      WHERE tenant_id = ${tenantId}::uuid AND adattatore = ${adattatore}
      ORDER BY tipo, chiave_wasteflow`
    const etichette = await this.etichette(db, tenantId, righe)
    return righe.map(r => ({
      ...r,
      etichetta:
        etichette.get(chiaveMappatura(r.tipo, r.chiaveWasteflow)) ?? ETICHETTA_NON_PRESENTE,
    }))
  }

  /**
   * Etichette per le voci lette: una query per tipo, non una per voce. La chiave puo' essere
   * l'identificativo o il codice dell'anagrafica: si risolve per entrambi. `CONTO_RICAVI` non ha
   * un'anagrafica (la chiave e' gia' un testo per l'utente).
   */
  private async etichette(
    db: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    righe: readonly { tipo: TipoMappatura; chiaveWasteflow: string }[]
  ): Promise<Map<string, string>> {
    const risultato = new Map<string, string>()
    const per = (tipo: TipoMappatura): string[] =>
      righe.filter(r => r.tipo === tipo).map(r => r.chiaveWasteflow)
    const registra = (
      tipo: TipoMappatura,
      trovate: { id: string; codice: string | null; etichetta: string }[]
    ): void => {
      for (const t of trovate) {
        risultato.set(chiaveMappatura(tipo, t.id), t.etichetta)
        if (t.codice !== null && !risultato.has(chiaveMappatura(tipo, t.codice))) {
          risultato.set(chiaveMappatura(tipo, t.codice), t.etichetta)
        }
      }
    }
    for (const r of righe) {
      if (r.tipo === 'CONTO_RICAVI') {
        risultato.set(
          chiaveMappatura(r.tipo, r.chiaveWasteflow),
          `Ricavi: ${NOMI_TIPO_RIGA[r.chiaveWasteflow] ?? r.chiaveWasteflow.toLowerCase()}`
        )
      }
    }
    const clienti = per('CLIENTE')
    if (clienti.length > 0) {
      const t = await db.$queryRaw<
        {
          id: string
          codice: string | null
          ragione: string
          nome: string | null
          cognome: string | null
        }[]
      >`
        SELECT c.id::text AS id, c.codice AS codice, d.ragione_sociale AS ragione,
               c.nome AS nome, c.cognome AS cognome
        FROM "clienti" c
        JOIN "ditte" d ON d.id = c.ditta_id AND d.tenant_id = c.tenant_id
        WHERE c.tenant_id = ${tenantId}::uuid
          AND (c.id::text = ANY(${clienti}::text[]) OR c.codice = ANY(${clienti}::text[]))`
      registra(
        'CLIENTE',
        t.map(x => {
          const persona = [x.cognome, x.nome].filter(p => p !== null && p.trim() !== '').join(' ')
          return { id: x.id, codice: x.codice, etichetta: persona !== '' ? persona : x.ragione }
        })
      )
    }
    // CODICE_IVA: la chiave e' `chiaveIva(aliquota, natura)` (TeamSystem). Si cerca il codice IVA
    // dell'azienda con quell'aliquota e quella natura; se l'azienda non lo ha, si usa lo stesso
    // testo che l'adattatore dà alla chiave mancante.
    const iva = per('CODICE_IVA')
    if (iva.length > 0) {
      const lette = iva.flatMap(k => {
        const l = leggiChiaveIva(k)
        return l ? [{ k, ...l }] : []
      })
      if (lette.length > 0) {
        const t = await db.$queryRaw<{ k: string; descrizione: string }[]>`
          SELECT DISTINCT ON (x.k) x.k AS k, c.descrizione AS descrizione
          FROM unnest(${lette.map(l => l.k)}::text[], ${lette.map(l => l.aliquota)}::numeric[],
                      ${lette.map(l => l.natura ?? '')}::text[]) AS x(k, a, n)
          JOIN "codici_iva" c ON c.tenant_id = ${tenantId}::uuid
                             AND c.aliquota = x.a AND c.natura IS NOT DISTINCT FROM NULLIF(x.n, '')
          ORDER BY x.k, c.codice`
        for (const x of t) risultato.set(chiaveMappatura('CODICE_IVA', x.k), x.descrizione)
      }
      for (const l of lette) {
        const k = chiaveMappatura('CODICE_IVA', l.k)
        if (!risultato.has(k)) {
          risultato.set(
            k,
            l.natura !== null
              ? `IVA esente ${l.natura}`
              : `IVA ${new Prisma.Decimal(l.aliquota).toString()}%`
          )
        }
      }
    }
    const pagamenti = per('PAGAMENTO')
    if (pagamenti.length > 0) {
      const t = await db.$queryRaw<{ id: string; codice: string; descrizione: string }[]>`
        SELECT id::text AS id, codice AS codice, descrizione AS descrizione
        FROM "condizioni_pagamento"
        WHERE tenant_id = ${tenantId}::uuid
          AND (id::text = ANY(${pagamenti}::text[]) OR codice = ANY(${pagamenti}::text[]))`
      registra(
        'PAGAMENTO',
        t.map(x => ({ id: x.id, codice: x.codice, etichetta: x.descrizione }))
      )
    }
    const registri = per('REGISTRO')
    if (registri.length > 0) {
      const t = await db.$queryRaw<{ id: string; codice: string; descrizione: string }[]>`
        SELECT id::text AS id, codice AS codice, descrizione AS descrizione FROM "registri_iva"
        WHERE tenant_id = ${tenantId}::uuid
          AND (id::text = ANY(${registri}::text[]) OR codice = ANY(${registri}::text[]))`
      registra(
        'REGISTRO',
        t.map(x => ({ id: x.id, codice: x.codice, etichetta: `${x.codice} - ${x.descrizione}` }))
      )
    }
    return risultato
  }
}

/** Una voce per (tipo, chiave): un adattatore puo' chiederla da piu' documenti. */
export function richiesteUniche(richieste: readonly ChiaveMancante[]): ChiaveMancante[] {
  const viste = new Map<string, ChiaveMancante>()
  for (const r of richieste) {
    const k = chiaveMappatura(r.tipo, r.chiaveWasteflow)
    if (!viste.has(k)) viste.set(k, r)
  }
  return [...viste.values()]
}

export function mancantiDa(
  richieste: readonly ChiaveMancante[],
  valori: ReadonlyMap<string, string>
): ChiaveMancante[] {
  return richieste
    .filter(r => !valori.has(chiaveMappatura(r.tipo, r.chiaveWasteflow)))
    .sort(
      (a, b) => a.tipo.localeCompare(b.tipo) || (a.chiaveWasteflow < b.chiaveWasteflow ? -1 : 1)
    )
}
