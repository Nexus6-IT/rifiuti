import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'

/** Obbligo del MUD dell'azienda (A-W-10). Motivo, data e utente solo con il flag attivo. */
export interface ObbligoMud {
  mudNonDovuto: boolean
  motivo: string | null
  impostatoIl: Date | null
  impostatoDa: string | null
}

/**
 * Filtro Prisma sui tenant per chi è tenuto al MUD: da usare in ogni query che manda
 * promemoria o calcola scadenze del MUD (scadenzario, pagina MUD), così un'azienda segnata
 * come non tenuta non arriva nemmeno al ciclo.
 */
export const FILTRO_AZIENDE_TENUTE_AL_MUD = { mudNonDovuto: false } as const

const SELECT_OBBLIGO = {
  mudNonDovuto: true,
  mudNonDovutoMotivo: true,
  mudNonDovutoIl: true,
  mudNonDovutoDa: true,
} as const

type RigaObbligo = {
  mudNonDovuto: boolean
  mudNonDovutoMotivo: string | null
  mudNonDovutoIl: Date | null
  mudNonDovutoDa: string | null
}

const MOTIVO_MIN = 5
const MOTIVO_MAX = 500

function comeObbligo(r: RigaObbligo): ObbligoMud {
  return {
    mudNonDovuto: r.mudNonDovuto,
    motivo: r.mudNonDovutoMotivo,
    impostatoIl: r.mudNonDovutoIl,
    impostatoDa: r.mudNonDovutoDa,
  }
}

/**
 * Flag "MUD non dovuto" per azienda (decisione A-W-10, come il flag MUD S/N di WinWaste).
 *
 * Lo imposta un amministratore dell'azienda (il controllo del ruolo effettivo sta nel
 * controller). Con il flag lo scadenzario non manda promemoria del MUD e l'aggregazione
 * aggiunge l'avviso informativo `MUD_NON_DOVUTO`: il file si può generare comunque.
 * Ogni modifica lascia una riga `MUD_OBBLIGO_MODIFICATO` in `ActivityLog`.
 */
@Injectable()
export class MudObbligoService {
  constructor(private readonly prisma: PrismaService) {}

  async leggi(tenantId: string): Promise<ObbligoMud> {
    const riga = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: SELECT_OBBLIGO,
    })
    if (!riga) throw new NotFoundException('Azienda non trovata.')
    return comeObbligo(riga)
  }

  async imposta(
    tenantId: string,
    userId: string,
    mudNonDovuto: boolean,
    motivo: string | null
  ): Promise<ObbligoMud> {
    // Con il flag spento il motivo non serve e si scarta: motivo, data e utente tornano null.
    const motivoPulito = mudNonDovuto ? (motivo ?? '').trim() : null
    if (
      motivoPulito !== null &&
      (motivoPulito.length < MOTIVO_MIN || motivoPulito.length > MOTIVO_MAX)
    ) {
      throw new BadRequestException("Indicare il motivo per cui l'azienda non è tenuta al MUD.")
    }

    return this.prisma.$transaction(async tx => {
      const prima = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: SELECT_OBBLIGO,
      })
      if (!prima) throw new NotFoundException('Azienda non trovata.')

      const dopo = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          mudNonDovuto,
          mudNonDovutoMotivo: motivoPulito,
          mudNonDovutoIl: mudNonDovuto ? new Date() : null,
          mudNonDovutoDa: mudNonDovuto ? userId : null,
        },
        select: SELECT_OBBLIGO,
      })

      await tx.activityLog.create({
        data: {
          tenantId,
          userId,
          action: 'MUD_OBBLIGO_MODIFICATO',
          description: mudNonDovuto
            ? `Azienda segnata come non tenuta al MUD: ${motivoPulito}`
            : 'Azienda di nuovo tenuta al MUD',
          metadata: {
            prima: { mudNonDovuto: prima.mudNonDovuto, motivo: prima.mudNonDovutoMotivo },
            dopo: { mudNonDovuto: dopo.mudNonDovuto, motivo: dopo.mudNonDovutoMotivo },
          },
        },
      })

      return comeObbligo(dopo)
    })
  }
}
