import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'

/**
 * Servizio di lookup sui dati di riferimento condivisi (ATECO, ISTAT
 * nazioni/province/comuni). Comune a tutto l'applicativo: anagrafiche, MUD, ecc.
 * Tabelle globali (non tenant-scoped).
 */
@Injectable()
export class ReferenceDataService {
  constructor(private readonly prisma: PrismaService) {}

  // --- ATECO ---
  findAteco(code: string) {
    return this.prisma.atecoCode.findUnique({ where: { code: normalizeAteco(code) } })
  }

  searchAteco(query: string, limit = 20) {
    return this.prisma.atecoCode.findMany({
      where: {
        OR: [
          { code: { startsWith: normalizeAteco(query) } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
    })
  }

  // --- Nazioni ---
  findNazione(code: string) {
    return this.prisma.istatNazione.findUnique({ where: { code } })
  }

  // --- Province ---
  findProvinciaBySigla(sigla: string) {
    return this.prisma.istatProvincia.findUnique({ where: { sigla: sigla.toUpperCase() } })
  }

  // --- Comuni ---
  findComuneByCode(code: string) {
    return this.prisma.istatComune.findUnique({ where: { code } })
  }

  /**
   * Risolve un comune per nome (case-insensitive), opzionalmente entro una
   * provincia. Ritorna il primo match o null. Usato dal MUD per il codice ISTAT.
   */
  async findComuneByName(name: string, provinciaSigla?: string) {
    return this.prisma.istatComune.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(provinciaSigla ? { provinciaSigla: provinciaSigla.toUpperCase() } : {}),
      },
    })
  }

  searchComuni(query: string, limit = 20) {
    return this.prisma.istatComune.findMany({
      where: { name: { contains: query, mode: 'insensitive' } },
      take: limit,
      orderBy: { name: 'asc' },
    })
  }

  /**
   * Valida località (comune + provincia) contro le tabelle ISTAT condivise.
   *
   * Comportamento "graceful": se le tabelle di riferimento non sono ancora
   * popolate, la validazione viene saltata (ok=true) per non bloccare l'uso
   * quando i dati non sono caricati. Quando i dati sono presenti, provincia e
   * comune devono essere validi; ritorna anche il codice ISTAT del comune.
   */
  async validateLocalita(
    comune: string,
    provinciaSigla: string,
  ): Promise<{ ok: boolean; error?: string; comuneCode?: string }> {
    const provinceCount = await this.prisma.istatProvincia.count()
    if (provinceCount === 0) return { ok: true } // tabelle non popolate → skip

    const provincia = await this.findProvinciaBySigla(provinciaSigla)
    if (!provincia) {
      return { ok: false, error: `Provincia non valida: ${provinciaSigla}` }
    }

    const comuneCount = await this.prisma.istatComune.count()
    if (comuneCount === 0) return { ok: true }

    const found = await this.findComuneByName(comune, provinciaSigla)
    if (!found) {
      return {
        ok: false,
        error: `Comune non valido per la provincia ${provinciaSigla.toUpperCase()}: ${comune}`,
      }
    }
    return { ok: true, comuneCode: found.code }
  }

  /** Conteggi per dataset (stato popolamento). */
  async counts() {
    const [ateco, nazioni, province, comuni] = await Promise.all([
      this.prisma.atecoCode.count(),
      this.prisma.istatNazione.count(),
      this.prisma.istatProvincia.count(),
      this.prisma.istatComune.count(),
    ])
    return { ateco, nazioni, province, comuni }
  }
}

/** ATECO senza punti, uppercase. */
export function normalizeAteco(code: string): string {
  return (code || '').replace(/[.\s]/g, '').toUpperCase()
}
