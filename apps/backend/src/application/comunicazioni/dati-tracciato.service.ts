import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  TRACCIATI_DATI,
  VERSIONE_SCHEMA_DATI,
  validaDatiTracciato,
  type DatiPerTracciato,
  type TracciatoDati,
} from '../../domain/comunicazioni/dati-tracciato'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { MovimentoNonTrovatoError } from './marcatura-consorzi.port'
import {
  DatiTracciatoNonValidiError,
  type DatiTracciatoPort,
  type DatiTracciatoVista,
} from './dati-tracciato.port'

function controllaTracciato(tracciato: string): asserts tracciato is TracciatoDati {
  if (!(TRACCIATI_DATI as readonly string[]).includes(tracciato)) {
    throw new DatiTracciatoNonValidiError([`tracciato sconosciuto: ${tracciato}`])
  }
}

/**
 * Dati del tracciato per movimento (4.9c-f, D2). Stanno nella tabella propria
 * `dati_tracciato_movimento`, agganciati alla RADICE della catena: seguono rettifiche e
 * annullamenti. Non toccano `dati_consorzio_movimento`, quindi la marcatura per consorzio resta
 * quella decisa da regole e correzioni manuali.
 */
@Injectable()
export class DatiTracciatoService implements DatiTracciatoPort {
  constructor(private readonly prisma: PrismaService) {}

  /** Radice della catena del movimento, con registro e verso (servono alla chiave composta). */
  private async radice(tenantId: string, movimentoId: string) {
    const m = await this.prisma.wasteMovement.findFirst({
      where: { id: movimentoId, tenantId },
      select: { id: true, movimentoOriginaleId: true, registroId: true, type: true },
    })
    if (!m) throw new MovimentoNonTrovatoError()
    if (m.movimentoOriginaleId === null)
      return { id: m.id, registroId: m.registroId, verso: m.type }
    const r = await this.prisma.wasteMovement.findFirstOrThrow({
      where: { id: m.movimentoOriginaleId, tenantId },
      select: { id: true, registroId: true, type: true },
    })
    return { id: r.id, registroId: r.registroId, verso: r.type }
  }

  private vista<T extends TracciatoDati>(
    tracciato: T,
    r: { dati: Prisma.JsonValue; versioneSchema: number; updatedAt: Date }
  ): DatiTracciatoVista<T> {
    return {
      tracciato,
      dati: r.dati as unknown as DatiPerTracciato[T],
      versioneSchema: r.versioneSchema,
      aggiornatoIl: r.updatedAt.toISOString(),
    }
  }

  async leggi<T extends TracciatoDati>(
    tenantId: string,
    movimentoId: string,
    tracciato: T
  ): Promise<DatiTracciatoVista<T> | null> {
    controllaTracciato(tracciato)
    const radice = await this.radice(tenantId, movimentoId)
    const riga = await this.prisma.datiTracciatoMovimento.findFirst({
      where: { tenantId, movimentoOriginaleId: radice.id, tracciato },
    })
    return riga ? this.vista(tracciato, riga) : null
  }

  async imposta<T extends TracciatoDati>(
    tenantId: string,
    userId: string,
    movimentoId: string,
    tracciato: T,
    dati: unknown
  ): Promise<DatiTracciatoVista<T>> {
    controllaTracciato(tracciato)
    const esito = validaDatiTracciato(tracciato, dati)
    if (!esito.ok) throw new DatiTracciatoNonValidiError(esito.errori)
    const radice = await this.radice(tenantId, movimentoId)
    const json = esito.valore as unknown as Prisma.InputJsonObject
    const riga = await this.prisma.datiTracciatoMovimento.upsert({
      where: {
        tenantId_movimentoOriginaleId_tracciato: {
          tenantId,
          movimentoOriginaleId: radice.id,
          tracciato,
        },
      },
      create: {
        tenantId,
        registroId: radice.registroId,
        verso: radice.verso,
        movimentoOriginaleId: radice.id,
        tracciato,
        dati: json,
        versioneSchema: VERSIONE_SCHEMA_DATI[tracciato],
        modificatoDa: userId,
      },
      update: {
        dati: json,
        versioneSchema: VERSIONE_SCHEMA_DATI[tracciato],
        modificatoDa: userId,
      },
    })
    return this.vista(tracciato, riga)
  }

  async cancella(tenantId: string, movimentoId: string, tracciato: TracciatoDati): Promise<void> {
    controllaTracciato(tracciato)
    const radice = await this.radice(tenantId, movimentoId)
    await this.prisma.datiTracciatoMovimento.deleteMany({
      where: { tenantId, movimentoOriginaleId: radice.id, tracciato },
    })
  }
}
