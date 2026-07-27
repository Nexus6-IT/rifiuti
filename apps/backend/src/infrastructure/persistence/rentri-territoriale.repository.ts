import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'

interface RigaTerritoriale {
  presenteInRentri: boolean
}

/**
 * Repository delle 3 cache territoriali RENTRI (`RentriProvincia`,
 * `RentriComune`, `RentriNazione` — R4 Task 5), DISTINTE da
 * `IstatProvincia`/`IstatComune`/`IstatNazione` (v. il commento di testata
 * dei model in `schema.prisma` e l'audit
 * `docs/audits/rentri-codifiche-campi-2026-07-26.md`).
 *
 * Un solo repository per le 3 tabelle (invece di 3 quasi identici): la
 * chiave primaria e la politica di scrittura sono identiche, cambiano solo
 * il model Prisma delegato e — per provincia/comune — i campi aggiuntivi
 * `attivo`/`fineValidita`/`nuovoId` che il chiamante passa già pronti.
 */
@Injectable()
export class RentriTerritorialeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProvincia(id: string): Promise<RigaTerritoriale | null> {
    return this.prisma.rentriProvincia.findUnique({
      where: { id },
      select: { presenteInRentri: true },
    })
  }

  async upsertProvincia(data: {
    id: string
    code: string
    name: string
    regioneId: string
    attivo: boolean
    fineValidita: Date | null
  }): Promise<void> {
    await this.prisma.rentriProvincia.upsert({
      where: { id: data.id },
      create: { ...data, presenteInRentri: true, rimossoDaRentriAl: null, fonte: 'rentri' },
      update: { ...data, presenteInRentri: true, rimossoDaRentriAl: null },
    })
  }

  async marcaProvinciaRimossaSeAttiva(id: string, rimossoAl: Date): Promise<boolean> {
    const esistente = await this.prisma.rentriProvincia.findUnique({ where: { id } })
    if (!esistente || !esistente.presenteInRentri) return false
    await this.prisma.rentriProvincia.update({
      where: { id },
      data: { presenteInRentri: false, rimossoDaRentriAl: rimossoAl },
    })
    return true
  }

  async listTuttiGliIdProvincia(): Promise<string[]> {
    const righe = await this.prisma.rentriProvincia.findMany({ select: { id: true } })
    return righe.map(r => r.id)
  }

  async findComune(id: string): Promise<RigaTerritoriale | null> {
    return this.prisma.rentriComune.findUnique({
      where: { id },
      select: { presenteInRentri: true },
    })
  }

  async upsertComune(data: {
    id: string
    code: string
    name: string
    provinciaId: string
    cciaa: string
    attivo: boolean
    nuovoId: string | null
    fineValidita: Date | null
  }): Promise<void> {
    await this.prisma.rentriComune.upsert({
      where: { id: data.id },
      create: { ...data, presenteInRentri: true, rimossoDaRentriAl: null, fonte: 'rentri' },
      update: { ...data, presenteInRentri: true, rimossoDaRentriAl: null },
    })
  }

  async marcaComuneRimossoSeAttivo(id: string, rimossoAl: Date): Promise<boolean> {
    const esistente = await this.prisma.rentriComune.findUnique({ where: { id } })
    if (!esistente || !esistente.presenteInRentri) return false
    await this.prisma.rentriComune.update({
      where: { id },
      data: { presenteInRentri: false, rimossoDaRentriAl: rimossoAl },
    })
    return true
  }

  async listTuttiGliIdComune(): Promise<string[]> {
    const righe = await this.prisma.rentriComune.findMany({ select: { id: true } })
    return righe.map(r => r.id)
  }

  async findNazione(id: string): Promise<RigaTerritoriale | null> {
    return this.prisma.rentriNazione.findUnique({
      where: { id },
      select: { presenteInRentri: true },
    })
  }

  async upsertNazione(data: { id: string; code: string; name: string }): Promise<void> {
    await this.prisma.rentriNazione.upsert({
      where: { id: data.id },
      create: { ...data, presenteInRentri: true, rimossoDaRentriAl: null, fonte: 'rentri' },
      update: { ...data, presenteInRentri: true, rimossoDaRentriAl: null },
    })
  }

  async marcaNazioneRimossaSeAttiva(id: string, rimossoAl: Date): Promise<boolean> {
    const esistente = await this.prisma.rentriNazione.findUnique({ where: { id } })
    if (!esistente || !esistente.presenteInRentri) return false
    await this.prisma.rentriNazione.update({
      where: { id },
      data: { presenteInRentri: false, rimossoDaRentriAl: rimossoAl },
    })
    return true
  }

  async listTuttiGliIdNazione(): Promise<string[]> {
    const righe = await this.prisma.rentriNazione.findMany({ select: { id: true } })
    return righe.map(r => r.id)
  }
}
