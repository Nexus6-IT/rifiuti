/**
 * Base dei repository di ruolo (produttore, trasportatore, destinatario) su ditte e sedi (F2-10).
 *
 * Le tre righe di ruolo condividono la stessa forma: ditta (identita' fiscale e ragione sociale),
 * sede predefinita (indirizzo e contatti) e i soli dati del ruolo (albo, autorizzazione, scadenze).
 * Qui sta tutta la parte comune; ogni repository concreto dice solo come si chiama il modello, quali
 * sono i suoi campi e come si ricostruisce l'entita'.
 *
 * Le colonne vecchie della riga di ruolo (ragione sociale, P.IVA, indirizzo e contatti) sono una
 * copia congelata (D6): qui non si scrivono piu'.
 */
import { PrismaService } from './prisma.service'
import { TenantContext } from '../../core/context/tenant-context'
import {
  SedeNonModificabileError,
  SedeNonTrovataError,
  SedeNonValidaPerRuoloError,
} from '../../core/domain/errors'
import {
  NOME_RUOLO,
  RuoloControparte,
  chiaveIndirizzo,
} from '../../domain/registry/entities/sede-ditta'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'
import { OpzioniLetturaRuolo } from '../../domain/registry/repositories/ditta.repository'
import { ClientDitte, DittaPrismaRepository } from './ditta-prisma.repository'

/** Quello che una riga di ruolo ha in comune, qualunque sia il ruolo. */
export interface ControparteComune {
  readonly id: string
  readonly ragioneSociale: string
  readonly dittaId: string
  readonly sedeId: string
  readonly email?: string
  readonly telefono?: string
  readonly pec?: string
  readonly createdAt: Date
  readonly partitaIVA: { getValue(): string } | null
}

/** Sede letta dal database (i campi che servono a ricostruire indirizzo e contatti). */
export interface RecordSedeLetto {
  id: string
  via: string
  civico: string
  cap: string
  comune: string
  provincia: string
  email: string | null
  telefono: string | null
  pec: string | null
}

/** Contesto della ditta letto insieme alla riga di ruolo. */
export interface ContestoDittaLetto {
  ditta: {
    ragioneSociale: string
    partitaIva: string | null
    codiceFiscale: string | null
  }
  numeroSedi: number
  ruoliDitta?: RuoloControparte[]
}

export abstract class RuoloDittaPrismaBase<E extends ControparteComune> {
  private readonly ditte = new DittaPrismaRepository()

  protected abstract readonly modello: 'produttore' | 'trasportatore' | 'destinatario'
  protected abstract readonly ruolo: RuoloControparte

  constructor(protected readonly prisma: PrismaService) {}

  /** Indirizzo della sede predefinita, come lo chiama l'entita' (`sedeLegale` o `sede`). */
  protected abstract indirizzoDi(entita: E): Indirizzo

  /** Campi propri del ruolo (albo, autorizzazione, scadenze), con i nomi delle colonne Prisma. */
  protected abstract campiRuolo(entita: E): Record<string, unknown>

  /** Ricostruisce l'entita' dalla riga di ruolo, dalla ditta e dalla sede. */
  protected abstract daRecord(riga: any, sede: RecordSedeLetto, contesto: ContestoDittaLetto): E

  // -------------------------------------------------------------------------------------------
  // Scritture
  // -------------------------------------------------------------------------------------------

  /** Inserisce la riga di ruolo nella transazione del chiamante (D3 passo 5). */
  async crea(client: ClientDitte, entita: E): Promise<void> {
    const tenantId = TenantContext.requireTenantId()
    await (client as any)[this.modello].create({
      data: {
        id: entita.id,
        tenantId,
        createdAt: entita.createdAt,
        dittaId: entita.dittaId,
        sedeId: entita.sedeId,
        ...this.campiRuolo(entita),
      },
    })
  }

  /**
   * Modifica del ruolo in UNA transazione: ragione sociale della ditta, indirizzo e contatti della
   * sede predefinita, riga di ruolo. La ragione sociale e la sede sono condivise con gli altri
   * ruoli della stessa ditta (D7).
   */
  async save(entita: E, client?: ClientDitte): Promise<void> {
    const tenantId = TenantContext.requireTenantId()
    // con il `client` del chiamante le scritture fanno parte della sua transazione
    const esegui = async (tx: ClientDitte) => {
      await tx.ditta.updateMany({
        where: { id: entita.dittaId, tenantId },
        data: { ragioneSociale: entita.ragioneSociale },
      })

      // le scritture sulle sedi di una ditta sono serializzate (come in DitteService)
      await this.ditte.bloccaSedi(tx, entita.dittaId)
      const attuale = await this.ditte.trovaSede(tx, entita.dittaId, entita.sedeId)
      if (!attuale) throw new SedeNonTrovataError()
      const indirizzo = this.indirizzoDi(entita)
      const nuovaChiave = chiaveIndirizzo(indirizzo)
      if (attuale.chiaveIndirizzo() !== nuovaChiave) {
        // due sedi attive con lo stesso indirizzo renderebbero casuale la scelta della sede
        const altre = await this.ditte.sedi(tx, entita.dittaId)
        if (
          altre.some(s => s.id !== attuale.id && s.attiva && s.chiaveIndirizzo() === nuovaChiave)
        ) {
          throw new SedeNonModificabileError('Esiste già una sede con questo indirizzo.')
        }
      }
      await tx.sedeDitta.updateMany({
        where: { id: entita.sedeId, dittaId: entita.dittaId, tenantId },
        data: {
          via: indirizzo.getVia(),
          civico: indirizzo.getCivico(),
          cap: indirizzo.getCAP(),
          comune: indirizzo.getCitta(), // il dominio dice "citta", il database "comune"
          provincia: indirizzo.getProvincia(),
          email: entita.email || null,
          telefono: entita.telefono || null,
          pec: entita.pec || null,
        },
      })

      await (tx as any)[this.modello].updateMany({
        where: { id: entita.id, tenantId },
        data: {
          sedeId: entita.sedeId,
          ...this.campiRuolo(entita),
        },
      })
    }
    if (client) await esegui(client)
    else await this.prisma.$transaction(esegui)
  }

  async delete(id: string): Promise<void> {
    // deleteMany scoped per tenant: impedisce la cancellazione cross-tenant. Si cancella solo la
    // riga di ruolo: ditta e sedi restano (D4).
    const tenantId = TenantContext.requireTenantId()
    await (this.prisma.db as any)[this.modello].deleteMany({ where: { id, tenantId } })
  }

  // -------------------------------------------------------------------------------------------
  // Letture
  // -------------------------------------------------------------------------------------------

  async findById(
    id: string,
    opzioni: OpzioniLetturaRuolo = {},
    client?: ClientDitte
  ): Promise<E | null> {
    // Scoping per tenant: la RLS-extension e' no-op su findUnique, quindi una findUnique per sola
    // PK esporrebbe anagrafiche di altri tenant.
    const tenantId = TenantContext.requireTenantId()
    // `as any` sul client esteso: con piu' di ~140 modelli la riduzione dell'unione con
    // `ClientDitte` supera la profondita' di TypeScript (TS2321).
    const lettore: any = client ?? (this.prisma.db as any)
    const riga = await lettore[this.modello].findFirst({
      where: { id, tenantId },
      include: this.includeDettaglio(),
    })
    if (!riga) return null

    let sede: RecordSedeLetto = this.sedeDellaRiga(riga)
    if (opzioni.sedeId && opzioni.sedeId !== riga.sedeId) {
      // la sede indicata deve essere attiva e della stessa ditta del ruolo (D4, D9)
      const altra = await lettore.sedeDitta.findFirst({
        where: { id: opzioni.sedeId, dittaId: riga.dittaId, tenantId, attiva: true },
      })
      if (!altra) throw new SedeNonValidaPerRuoloError(NOME_RUOLO[this.ruolo])
      sede = altra
      riga.sedeId = altra.id
    }
    return this.daRecord(riga, sede, this.contesto(riga, true))
  }

  async findByTenantId(tenantId: string): Promise<E[]> {
    const righe = await (this.prisma.db as any)[this.modello].findMany({
      where: { tenantId },
      include: this.includeElenco(),
      orderBy: { ditta: { ragioneSociale: 'asc' } },
    })
    return righe.map((r: any) => this.daRecord(r, this.sedeDellaRiga(r), this.contesto(r, false)))
  }

  /** Il ruolo della ditta, se c'e': una riga per ruolo per ditta (D1). */
  async findByDittaId(client: ClientDitte, dittaId: string): Promise<E | null> {
    const tenantId = TenantContext.requireTenantId()
    const riga = await (client as any)[this.modello].findFirst({
      where: { dittaId, tenantId },
      include: this.includeElenco(),
    })
    if (!riga) return null
    return this.daRecord(riga, this.sedeDellaRiga(riga), this.contesto(riga, false))
  }

  /** Prima riga del ruolo che soddisfa il filtro (per le unicita' proprie del ruolo). */
  protected async primoPer(where: Record<string, unknown>): Promise<E | null> {
    const tenantId = TenantContext.requireTenantId()
    const riga = await (this.prisma.db as any)[this.modello].findFirst({
      where: { ...where, tenantId },
      include: this.includeElenco(),
    })
    if (!riga) return null
    return this.daRecord(riga, this.sedeDellaRiga(riga), this.contesto(riga, false))
  }

  // -------------------------------------------------------------------------------------------
  // Dettagli
  // -------------------------------------------------------------------------------------------

  private includeElenco() {
    return {
      ditta: {
        include: { _count: { select: { sedi: { where: { attiva: true } } } } },
      },
      sede: true,
    }
  }

  private includeDettaglio() {
    const soloId = { select: { id: true } }
    return {
      ditta: {
        include: {
          _count: { select: { sedi: { where: { attiva: true } } } },
          produttori: soloId,
          trasportatori: soloId,
          destinatari: soloId,
        },
      },
      sede: true,
    }
  }

  private sedeDellaRiga(riga: any): RecordSedeLetto {
    if (!riga.ditta || !riga.sede) {
      // la migration collega ogni riga a una ditta e a una sede: una riga senza e' un dato guasto
      throw new Error('Anagrafica senza ditta o sede: dati non coerenti.')
    }
    return riga.sede
  }

  private contesto(riga: any, conRuoli: boolean): ContestoDittaLetto {
    const d = riga.ditta
    return {
      ditta: {
        ragioneSociale: d.ragioneSociale,
        partitaIva: d.partitaIva,
        codiceFiscale: d.codiceFiscale,
      },
      numeroSedi: d._count?.sedi ?? 0,
      ...(conRuoli && {
        ruoliDitta: [
          ...(d.produttori?.length ? (['PRODUTTORE'] as const) : []),
          ...(d.trasportatori?.length ? (['TRASPORTATORE'] as const) : []),
          ...(d.destinatari?.length ? (['DESTINATARIO'] as const) : []),
        ],
      }),
    }
  }
}
