// Mappature per azienda dell'export contabile (4.4c, Task 29, spec §7.3): per ogni adattatore, il
// codice che il gestionale si aspetta per una chiave di WasteFlow (codice IVA, conto dei ricavi,
// cliente, pagamento, registro). Una riga per (azienda, adattatore, tipo, chiave); `valore: null`
// nella richiesta cancella la voce. L'audit contiene l'adattatore e i conteggi: mai chiavi o valori
// (i codici dei clienti del gestionale sono dati dell'azienda).
//
// Nessun lock oltre a quelli di riga della propria scrittura: le voci si scrivono in ordine
// (tipo, chiave) cosi' due richieste concorrenti non si incrociano; un'attesa oltre il timeout
// diventa 409 `OPERAZIONE_CONCORRENTE`.
import { BadRequestException, Injectable } from '@nestjs/common'
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

/** Voci per richiesta (le colonne sono corte, ma una richiesta non deve poter essere enorme). */
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
}

export interface VoceMappatura {
  tipo: TipoMappatura
  chiaveWasteflow: string
  /** `null` cancella la voce. */
  valore: string | null
}

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
    risultato.push({ tipo: v.tipo, chiaveWasteflow: v.chiaveWasteflow, valore })
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
    const daScrivere = ordinate.filter(v => v.valore !== null)
    const daCancellare = ordinate.filter(v => v.valore === null)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          let impostate = 0
          let cancellate = 0
          if (daScrivere.length > 0) {
            // Una riga nuova o con un valore diverso; a parita' di valore non cambia nulla
            // (la versione sale solo se il valore cambia).
            impostate = await tx.$executeRaw`
              INSERT INTO "mappature_export_contabile"
                (tenant_id, adattatore, tipo, chiave_wasteflow, valore, modificato_da, updated_at)
              SELECT ${tenantId}::uuid, ${adattatore}, x.t, x.c, x.v, ${utenteId}::uuid, now()
              FROM unnest(${daScrivere.map(v => v.tipo)}::text[],
                          ${daScrivere.map(v => v.chiaveWasteflow)}::text[],
                          ${daScrivere.map(v => v.valore)}::text[]) WITH ORDINALITY AS x(t, c, v, n)
              ORDER BY x.n
              ON CONFLICT (tenant_id, adattatore, tipo, chiave_wasteflow) DO UPDATE
              SET valore = EXCLUDED.valore,
                  versione = "mappature_export_contabile".versione + 1,
                  modificato_da = EXCLUDED.modificato_da,
                  updated_at = now()
              WHERE "mappature_export_contabile".valore IS DISTINCT FROM EXCLUDED.valore`
          }
          if (daCancellare.length > 0) {
            cancellate = await tx.$executeRaw`
              DELETE FROM "mappature_export_contabile" m
              USING unnest(${daCancellare.map(v => v.tipo)}::text[],
                           ${daCancellare.map(v => v.chiaveWasteflow)}::text[]) AS x(t, c)
              WHERE m.tenant_id = ${tenantId}::uuid AND m.adattatore = ${adattatore}
                AND m.tipo = x.t AND m.chiave_wasteflow = x.c`
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

  private async leggiTutte(
    db: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    adattatore: string
  ): Promise<MappaturaVista[]> {
    return db.$queryRaw<MappaturaVista[]>`
      SELECT tipo AS tipo, chiave_wasteflow AS "chiaveWasteflow", valore AS valore,
             versione::int AS versione
      FROM "mappature_export_contabile"
      WHERE tenant_id = ${tenantId}::uuid AND adattatore = ${adattatore}
      ORDER BY tipo, chiave_wasteflow`
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
