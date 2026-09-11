import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'

/** Conteggio dei formulari emessi in un dato mese ('YYYY-MM'). */
export interface AndamentoMensileVoce {
  mese: string
  conteggio: number
}

export interface AndamentoMensileResult {
  mesi: AndamentoMensileVoce[]
}

/** Riga grezza restituita da `$queryRaw`. */
interface RigaGrezza {
  mese: Date
  conteggio: number
}

/**
 * Stati del ciclo di vita FIR (colonna `status`) che corrispondono al
 * dominio BOZZA (v. `fir-prisma.repository.ts`, DB_TO_STATO): un formulario
 * ancora in bozza non è "emesso". `CANCELLED` (ANNULLATO) è escluso allo
 * stesso modo: un formulario annullato non è mai stato completato, non è
 * andamento da mostrare come "emesso".
 *
 * Inseriti nell'SQL come frammento letterale via `Prisma.raw` (non come
 * parametro `$queryRaw` ordinario, che legherebbe l'intera stringa come UN
 * singolo valore anziché tre, e comunque senza un tipo esplicito da
 * confrontare con la colonna enum `fir_status`): sono costanti scelte da
 * questo file, non dati esterni, nessun rischio di injection.
 */
const STATI_ESCLUSI_SQL = Prisma.raw("'DRAFT', 'AWAITING_PRODUCER', 'CANCELLED'")

/**
 * «Un conteggio dice dove sei, una serie dice dove stai andando» (Task 4 del
 * piano cruscotto): formulari emessi per mese negli ultimi dodici mesi,
 * isolati per tenant.
 *
 * Non esiste in questo schema un campo "data di emissione" persistito e
 * popolato (il campo `submittedAt` sul modello `FIR` non è mai scritto da
 * alcun use case, verificato — v. report del task): si usa `createdAt`
 * come approssimazione del mese in cui il formulario è entrato nel
 * sistema, filtrato agli stati che indicano che è stato effettivamente
 * emesso (non BOZZA, non ANNULLATO). Per come funziona oggi il flusso
 * (emissione avviene a ridosso della creazione) è un'approssimazione
 * ragionevole, non un dato inventato — ma resta un'approssimazione: un FIR
 * creato in bozza un mese e emesso il mese successivo comparirebbe nel
 * mese di creazione, non in quello di emissione.
 *
 * Query aggregata via `$queryRaw` (`GROUP BY date_trunc('month', ...)`),
 * non un `findMany` di tutti i formulari dell'anno da contare in memoria:
 * dodici mesi di formulari di un tenant attivo sono tanti.
 */
@Injectable()
export class RaccogliAndamentoMensileUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async raccogli(tenantId: string, oggi: Date = new Date()): Promise<AndamentoMensileResult> {
    const dataInizio = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth() - 11, 1))

    const righe = await this.prisma.$queryRaw<RigaGrezza[]>`
      SELECT date_trunc('month', created_at) AS mese, COUNT(*)::int AS conteggio
      FROM firs
      WHERE tenant_id = ${tenantId}::uuid
        AND status NOT IN (${STATI_ESCLUSI_SQL})
        AND created_at >= ${dataInizio}
      GROUP BY mese
      ORDER BY mese ASC
    `

    const conteggiPerMese = new Map(
      righe.map(riga => [this.formatMese(new Date(riga.mese)), Number(riga.conteggio)])
    )

    const mesi = this.costruisciChiaviMesi(oggi).map(chiave => ({
      mese: chiave,
      conteggio: conteggiPerMese.get(chiave) ?? 0,
    }))

    return { mesi }
  }

  /** Le 12 chiavi 'YYYY-MM', dalla più vecchia (11 mesi fa) alla più recente (mese di `oggi`). */
  private costruisciChiaviMesi(oggi: Date): string[] {
    const chiavi: string[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth() - i, 1))
      chiavi.push(this.formatMese(d))
    }
    return chiavi
  }

  private formatMese(d: Date): string {
    const anno = d.getUTCFullYear()
    const mese = String(d.getUTCMonth() + 1).padStart(2, '0')
    return `${anno}-${mese}`
  }
}
