import { Injectable } from '@nestjs/common'
import { STATI_ESCLUSI } from './stati-andamento'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'

/** Conteggio dei formulari creati in un dato mese ('YYYY-MM'). */
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
 * «Un conteggio dice dove sei, una serie dice dove stai andando» (Task 4 del
 * piano cruscotto): formulari creati per mese negli ultimi dodici mesi,
 * isolati per tenant.
 *
 * ETICHETTA "creati", non "emessi" (ruling PO, giro di revisione 1): non
 * esiste in questo schema un campo "data di emissione" persistito e
 * popolato (il campo `submittedAt` sul modello `FIR` non è mai scritto da
 * alcun use case, verificato — v. report del task), quindi si usa
 * `createdAt` come chiave temporale. Non è un'approssimazione trascurabile
 * da nascondere dietro un'etichetta "emessi": l'esistenza dello stato
 * `AWAITING_PRODUCER` dimostra che il ritardo fra creazione ed emissione è
 * un caso PREVISTO dal dominio, non raro — quindi il testo mostrato
 * all'utente (titolo sezione, aria-label del grafico, intestazione della
 * tabella per screen reader, tutto lato frontend) dice "creati", che è
 * esattamente ciò che questa query conta. Aggiungere il campo "data di
 * emissione" resterebbe la soluzione corretta ma vale solo in avanti (i
 * formulari già in banca dati non lo avrebbero, il grafico resterebbe
 * vuoto per dodici mesi): debito dichiarato, non risolto qui.
 *
 * Il filtro di stato (esclude BOZZA e ANNULLATO) resta comunque utile: un
 * formulario mai uscito dalla bozza o poi annullato non è un evento da
 * mostrare in un grafico di "cosa è successo", a prescindere dall'etichetta.
 *
 * Query aggregata via `$queryRaw` (`GROUP BY date_trunc('month', ...)`),
 * non un `findMany` di tutti i formulari dell'anno da contare in memoria:
 * dodici mesi di formulari di un tenant attivo sono tanti.
 *
 * NIENTE DIFESA IN PROFONDITÀ QUI (rilievo revisione finale, 2026-09-11):
 * `this.prisma.$queryRaw` usa il client NUDO, non `this.prisma.db` esteso
 * con `rlsExtension` — per disegno, non per svista. L'estensione intercetta
 * solo le operazioni del Prisma Client (`findMany`, `groupBy`, ...); una SQL
 * grezza le è invisibile per costruzione, indipendentemente da quale dei due
 * client la esegue. L'isolamento per tenant qui è SOLO il filtro esplicito
 * `tenant_id = ${tenantId}::uuid` nella query sotto.
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
        AND status::text <> ALL(${STATI_ESCLUSI}::text[])
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
