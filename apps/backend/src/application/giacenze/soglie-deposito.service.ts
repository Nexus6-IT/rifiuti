// Soglie del deposito temporaneo per azienda e per registro (D4 del piano Fase 2 pezzo 6).
// Precedenza per RIGA INTERA: riga del registro, poi riga dell'azienda, poi SOGLIE_PREDEFINITE.
// Nessuna riga = valori predefiniti (D6): nessun backfill.
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { DomainError } from '../../core/domain/errors'
import {
  SOGLIE_PREDEFINITE,
  validaSoglie,
  type SoglieDeposito,
} from '../../domain/waste-movement/deposito-temporaneo'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RegistroNonTrovatoError } from '../registro/registri.service'

export type OrigineSoglie = 'REGISTRO' | 'AZIENDA' | 'PREDEFINITA'

export interface SoglieApplicate extends SoglieDeposito {
  origine: OrigineSoglie
}

export interface SoglieConfigurate extends SoglieDeposito {
  note: string | null
  aggiornatoIl: Date
}

export interface DatiSoglie extends SoglieDeposito {
  note?: string | null
}

export interface ConfigurazioneSoglie {
  predefinite: SoglieDeposito
  azienda: SoglieConfigurate | null
  registri: {
    registroId: string
    registroDescrizione: string
    attivo: boolean
    soglie: SoglieConfigurate | null
  }[]
}

/** Il controller la traduce in 400 coi messaggi di `validaSoglie`. */
export class SoglieNonValideError extends DomainError {
  constructor(public readonly messaggi: string[]) {
    super(messaggi.join(' '))
    this.name = 'SoglieNonValideError'
  }
}

interface RigaSoglia {
  registroId: string | null
  criterio: SoglieDeposito['criterio']
  giorniMax: number | null
  kgMaxTotale: Prisma.Decimal | number
  kgMaxPericolosi: Prisma.Decimal | number
  preavvisoGiorni: number
  preavvisoPercentuale: number
  note: string | null
  updatedAt: Date
}

function comeSoglie(r: RigaSoglia): SoglieDeposito {
  return {
    criterio: r.criterio,
    giorniMax: r.giorniMax,
    kgMaxTotale: Number(r.kgMaxTotale),
    kgMaxPericolosi: Number(r.kgMaxPericolosi),
    preavvisoGiorni: r.preavvisoGiorni,
    preavvisoPercentuale: r.preavvisoPercentuale,
  }
}

function comeConfigurate(r: RigaSoglia): SoglieConfigurate {
  return { ...comeSoglie(r), note: r.note ?? null, aggiornatoIl: r.updatedAt }
}

@Injectable()
export class SoglieDepositoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Una sola `findMany` per tutti i registri richiesti e per la riga dell'azienda. */
  async soglieApplicate(
    tenantId: string,
    registroIds: string[]
  ): Promise<Map<string, SoglieApplicate>> {
    return this.nelContesto(tenantId, async () => {
      const righe = await this.prisma.sogliaDepositoTemporaneo.findMany({
        where: { tenantId, OR: [{ registroId: null }, { registroId: { in: registroIds } }] },
      })
      const azienda = righe.find(r => r.registroId === null)
      const perRegistro = new Map(
        righe.filter(r => r.registroId !== null).map(r => [r.registroId as string, r])
      )
      const risultato = new Map<string, SoglieApplicate>()
      for (const id of registroIds) {
        const riga = perRegistro.get(id)
        if (riga) risultato.set(id, { ...comeSoglie(riga), origine: 'REGISTRO' })
        else if (azienda) risultato.set(id, { ...comeSoglie(azienda), origine: 'AZIENDA' })
        else risultato.set(id, { ...SOGLIE_PREDEFINITE, origine: 'PREDEFINITA' })
      }
      return risultato
    })
  }

  async leggiConfigurazione(tenantId: string): Promise<ConfigurazioneSoglie> {
    return this.nelContesto(tenantId, async () => {
      const [righe, registri] = await Promise.all([
        this.prisma.sogliaDepositoTemporaneo.findMany({ where: { tenantId } }),
        this.prisma.registroRifiuti.findMany({
          where: { tenantId },
          select: { id: true, descrizione: true, attivo: true },
          orderBy: [{ attivo: 'desc' }, { createdAt: 'asc' }],
        }),
      ])
      const azienda = righe.find(r => r.registroId === null)
      const perRegistro = new Map(
        righe.filter(r => r.registroId !== null).map(r => [r.registroId as string, r])
      )
      return {
        predefinite: SOGLIE_PREDEFINITE,
        azienda: azienda ? comeConfigurate(azienda) : null,
        registri: registri.map(g => {
          const riga = perRegistro.get(g.id)
          return {
            registroId: g.id,
            registroDescrizione: g.descrizione,
            attivo: g.attivo,
            soglie: riga ? comeConfigurate(riga) : null,
          }
        }),
      }
    })
  }

  async imposta(
    tenantId: string,
    utenteId: string,
    registroId: string | null,
    dati: DatiSoglie
  ): Promise<SoglieConfigurate> {
    const messaggi = validaSoglie(dati)
    if (messaggi.length > 0) throw new SoglieNonValideError(messaggi)
    return this.nelContesto(tenantId, async () => {
      if (registroId) await this.verificaRegistro(tenantId, registroId)
      const chiave = `soglie-deposito|${tenantId}|${registroId ?? 'azienda'}`
      return this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
        const prima = await tx.sogliaDepositoTemporaneo.findFirst({
          where: { tenantId, registroId },
        })
        const valori = {
          criterio: dati.criterio,
          giorniMax: dati.giorniMax,
          kgMaxTotale: dati.kgMaxTotale,
          kgMaxPericolosi: dati.kgMaxPericolosi,
          preavvisoGiorni: dati.preavvisoGiorni,
          preavvisoPercentuale: dati.preavvisoPercentuale,
          note: dati.note?.trim() ? dati.note.trim() : null,
          impostatoDa: utenteId,
        }
        const dopo = prima
          ? await tx.sogliaDepositoTemporaneo.update({ where: { id: prima.id }, data: valori })
          : await tx.sogliaDepositoTemporaneo.create({ data: { tenantId, registroId, ...valori } })
        await tx.activityLog.create({
          data: {
            tenantId,
            userId: utenteId,
            action: 'DEPOSITO_SOGLIE_IMPOSTATE',
            description: registroId
              ? 'Soglie del deposito temporaneo impostate per un registro'
              : "Soglie del deposito temporaneo impostate per l'azienda",
            metadata: {
              registroId,
              prima: prima ? { ...comeSoglie(prima), note: prima.note } : null,
              dopo: { ...comeSoglie(dopo), note: dopo.note },
            },
          },
        })
        return comeConfigurate(dopo)
      })
    })
  }

  /** Senza riga non scrive nulla e non da' errore; registro di un'altra azienda: 404. */
  async elimina(tenantId: string, utenteId: string, registroId: string | null): Promise<void> {
    return this.nelContesto(tenantId, async () => {
      if (registroId) await this.verificaRegistro(tenantId, registroId)
      const chiave = `soglie-deposito|${tenantId}|${registroId ?? 'azienda'}`
      await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
        const prima = await tx.sogliaDepositoTemporaneo.findFirst({
          where: { tenantId, registroId },
        })
        if (!prima) return
        await tx.sogliaDepositoTemporaneo.delete({ where: { id: prima.id } })
        await tx.activityLog.create({
          data: {
            tenantId,
            userId: utenteId,
            action: 'DEPOSITO_SOGLIE_RIMOSSE',
            description: registroId
              ? 'Soglie del deposito temporaneo rimosse da un registro'
              : "Soglie del deposito temporaneo rimosse dall'azienda",
            metadata: { registroId, prima: { ...comeSoglie(prima), note: prima.note } },
          },
        })
      })
    })
  }

  private async verificaRegistro(tenantId: string, registroId: string): Promise<void> {
    const registro = await this.prisma.registroRifiuti.findFirst({
      where: { id: registroId, tenantId },
      select: { id: true },
    })
    if (!registro) throw new RegistroNonTrovatoError()
  }

  private nelContesto<R>(tenantId: string, fn: () => Promise<R>): Promise<R> {
    const corrente = TenantContext.getStoreTenantId()
    if (corrente === null) return TenantContext.run({ tenantId }, fn)
    if (corrente !== tenantId) {
      return Promise.reject(
        new Error(
          'SoglieDepositoService: il tenant richiesto non coincide con quello del contesto.'
        )
      )
    }
    return fn()
  }
}
