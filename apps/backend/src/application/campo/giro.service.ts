/**
 * Giro dell'autista (app campo, P1): i ritiri PROGRAMMATI di un giorno assegnati all'autista
 * collegato all'utente che chiede. Nessun parametro di richiesta sceglie l'autista: e' sempre
 * quello dell'utente autenticato (`autisti.user_id`), quindi un autista non puo' leggere il giro
 * di un altro cambiando un id.
 */
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  DIMENSIONE_MASSIMA,
  RitiriRepository,
} from '../../infrastructure/persistence/ritiri.repository'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { dataValida } from '../ritiri/ritiri.input'
import { RitiroDatiNonValidiError } from '../ritiri/errori-ritiri'
import type { RitiroVista } from '../ritiri/ritiri.tipi'
import { AutistaNonCollegatoError } from './errori-campo'

export interface GiroVista {
  data: string
  autista: { id: string; nome: string; cognome: string }
  ritiri: RitiroVista[]
}

/** Ordine di giro dell'autista: `ordineGiro` crescente, senza ordine in fondo; stabile sul resto. */
export function ordinaGiro(ritiri: readonly RitiroVista[]): RitiroVista[] {
  return [...ritiri].sort((a, b) => {
    if (a.ordineGiro === b.ordineGiro) return 0
    if (a.ordineGiro === null) return 1
    if (b.ordineGiro === null) return -1
    return a.ordineGiro - b.ordineGiro
  })
}

@Injectable()
export class GiroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RitiriRepository
  ) {}

  async giro(tenantId: string, utenteId: string, data: string): Promise<GiroVista> {
    if (!dataValida(data)) throw new RitiroDatiNonValidiError(['La data del giro non è valida.'])
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const autista = await tx.autista.findFirst({
          where: { tenantId, userId: utenteId, attivo: true },
          select: { id: true, nome: true, cognome: true },
        })
        if (!autista) throw new AutistaNonCollegatoError()
        const elenco = await this.repo.elenca(
          tx,
          tenantId,
          { dal: data, al: data, stato: 'PROGRAMMATO', autistaId: autista.id },
          1,
          DIMENSIONE_MASSIMA
        )
        return { data, autista, ritiri: ordinaGiro(elenco.righe) }
      })
    )
  }
}
