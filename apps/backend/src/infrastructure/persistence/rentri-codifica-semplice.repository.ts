import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'

/**
 * Repository della cache generica `RentriCodificaSemplice` (R4 Task 5) — le
 * 4 tabelle di codifiche RENTRI "allinea ora" senza logica di dominio
 * propria (unità di misura, stati fisici, caratteristiche di pericolo,
 * attività R/D). A differenza di `ICERRepository` non è dietro
 * un'interfaccia di dominio: nessun consumatore applicativo la usa ancora
 * (v. l'audit, `docs/audits/rentri-codifiche-campi-2026-07-26.md`) — un'
 * interfaccia con più implementazioni sarebbe astrazione prematura.
 *
 * Stessa politica di scrittura di `CERPrismaRepository`: mai `delete`, solo
 * upsert e marcatura (`presenteInRentri`/`rimossoDaRentriAl`).
 */
@Injectable()
export class RentriCodificaSempliceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTabellaECode(
    tabella: string,
    code: string
  ): Promise<{ presenteInRentri: boolean } | null> {
    const record = await this.prisma.rentriCodificaSemplice.findUnique({
      where: { tabella_code: { tabella, code } },
      select: { presenteInRentri: true },
    })
    return record
  }

  /** Upsert additivo: crea la voce se nuova, aggiorna nome/id esterno se già nota — mai declassa `fonte`. */
  async upsertFromRentri(data: {
    tabella: string
    code: string
    externalId: string
    name: string
  }): Promise<void> {
    await this.prisma.rentriCodificaSemplice.upsert({
      where: { tabella_code: { tabella: data.tabella, code: data.code } },
      create: {
        tabella: data.tabella,
        code: data.code,
        externalId: data.externalId,
        name: data.name,
        presenteInRentri: true,
        rimossoDaRentriAl: null,
        fonte: 'rentri',
      },
      update: {
        externalId: data.externalId,
        name: data.name,
        presenteInRentri: true,
        rimossoDaRentriAl: null,
      },
    })
  }

  /** Marca `presenteInRentri=false` SOLO se la riga era attiva. Mai cancella. Idempotente: ritorna false se già marcata. */
  async marcaRimossoSeAttivo(tabella: string, code: string, rimossoAl: Date): Promise<boolean> {
    const esistente = await this.prisma.rentriCodificaSemplice.findUnique({
      where: { tabella_code: { tabella, code } },
    })
    if (!esistente || !esistente.presenteInRentri) return false

    await this.prisma.rentriCodificaSemplice.update({
      where: { tabella_code: { tabella, code } },
      data: { presenteInRentri: false, rimossoDaRentriAl: rimossoAl },
    })
    return true
  }

  /** Tutti i codici noti per la tabella (attivi e già marcati rimossi) — v. `CERPrismaRepository.listTuttiICodici`. */
  async listTuttiICodici(tabella: string): Promise<string[]> {
    const records = await this.prisma.rentriCodificaSemplice.findMany({
      where: { tabella },
      select: { code: true },
    })
    return records.map(r => r.code)
  }
}
