import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { AgentePesaNonTrovatoError } from '../errori-pese'
import { nelContestoTenant } from '../nel-contesto-tenant'

export type StatoStrumentoAgente = 'OK' | 'ERRORE' | 'NON_CONFIGURATO'

export interface StrumentoInBattito {
  strumentoId: string
  stato: StatoStrumentoAgente
  ultimoErrore?: string
}

export interface DatiBattito {
  versione: string
  /** ISO 8601 con offset */
  oraAgente: string
  codaInAttesa: number
  lettureScartate: number
  ultimaSequenza: number
  strumenti: StrumentoInBattito[]
}

export interface RispostaBattito {
  oraServer: string
  simulazioneAmmessa: boolean
  revocato: false
}

export interface StatoStrumentoVivo {
  stato: StatoStrumentoAgente
  ultimoErrore: string | null
}

/** Nessuna scrittura se l'ultimo battito scritto e' di meno di 20 secondi fa (D8). */
export const MS_MINIMI_TRA_SCRITTURE = 20_000
const INT_MAX = 2_147_483_647

/**
 * Battito dell'agente (D8): ultimo contatto, IP, versione, scarto dell'orologio del PC, coda e
 * letture scartate. Lo stato dei singoli strumenti si tiene IN MEMORIA (mappa per agente: basta
 * con un processo `backend`; dopo un riavvio si riempie al battito successivo, entro 60 s) e lo
 * legge la gestione degli agenti. Le scritture sono diradate: al massimo una ogni 20 s per agente.
 */
@Injectable()
export class BattitoAgenteService {
  private readonly scrittoAl = new Map<string, number>()
  private readonly strumenti = new Map<string, Map<string, StatoStrumentoVivo>>()
  /** Orologio sostituibile nelle prove (diradamento delle scritture). */
  orologio: () => number = () => Date.now()

  constructor(private readonly prisma: PrismaService) {}

  async registra(
    agente: { id: string; tenantId: string },
    dati: DatiBattito,
    ip: string | null,
    ricezione: Date
  ): Promise<RispostaBattito> {
    this.strumenti.set(
      agente.id,
      new Map(
        dati.strumenti.map(s => [
          s.strumentoId,
          { stato: s.stato, ultimoErrore: s.ultimoErrore ?? null },
        ])
      )
    )
    const ora = this.orologio()
    const ultima = this.scrittoAl.get(agente.id)
    const scrivi = ultima === undefined || ora - ultima >= MS_MINIMI_TRA_SCRITTURE

    return nelContestoTenant(agente.tenantId, async () => {
      const azienda = await this.prisma.tenant.findUnique({
        where: { id: agente.tenantId },
        select: { peseSimulazioneAmmessa: true },
      })
      if (!azienda) throw new AgentePesaNonTrovatoError()
      if (scrivi) {
        this.scrittoAl.set(agente.id, ora)
        const scarto = Date.parse(dati.oraAgente) - ricezione.getTime()
        await this.prisma.$transaction(async tx => {
          await tx.agentePesa.updateMany({
            where: { id: agente.id, tenantId: agente.tenantId, stato: 'ATTIVO' },
            data: {
              ultimoContattoIl: ricezione,
              ultimoIp: ip ? ip.slice(0, 45) : null,
              versioneAgente: dati.versione.slice(0, 30),
              scartoOrologioMs: Math.max(-INT_MAX, Math.min(INT_MAX, Math.round(scarto))),
              codaInAttesa: Math.min(INT_MAX, dati.codaInAttesa),
              lettureScartate: Math.min(INT_MAX, dati.lettureScartate),
            },
          })
          // L'ultima sequenza non regredisce (un battito in ritardo non la riporta indietro).
          await tx.agentePesa.updateMany({
            where: {
              id: agente.id,
              tenantId: agente.tenantId,
              OR: [
                { ultimaSequenza: null },
                { ultimaSequenza: { lt: BigInt(dati.ultimaSequenza) } },
              ],
            },
            data: { ultimaSequenza: BigInt(dati.ultimaSequenza) },
          })
        })
      }
      return {
        oraServer: this.nuovaData().toISOString(),
        simulazioneAmmessa: azienda.peseSimulazioneAmmessa,
        revocato: false as const,
      }
    })
  }

  /** Stato in memoria degli strumenti di un agente (vuoto se non ha ancora battuto dopo un riavvio). */
  statoStrumenti(agenteId: string): ReadonlyMap<string, StatoStrumentoVivo> {
    return this.strumenti.get(agenteId) ?? new Map()
  }

  private nuovaData(): Date {
    return new Date()
  }
}
