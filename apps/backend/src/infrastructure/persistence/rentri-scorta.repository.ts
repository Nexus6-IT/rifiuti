import { Injectable } from '@nestjs/common'
import { RentriNumeroVidimatoStato } from '@prisma/client'
import { PrismaService } from './prisma.service'

/** Riga della scorta di numeri FIR pre-vidimati dall'ente RENTRI (R6). */
export interface NumeroVidimatoRow {
  id: string
  tenantId: string
  numIscrSito: string
  codiceBlocco: string
  progressivo: number
  numeroFir: string
  qrCodeBytes: string
  stato: RentriNumeroVidimatoStato
  firId: string | null
  dataVidimazione: Date
  dataConsumo: Date | null
}

/** Conteggio dei numeri DISPONIBILI raggruppati per blocco. */
export interface DisponibiliPerBlocco {
  codiceBlocco: string
  numIscrSito: string
  disponibili: number
}

/** Dati di un numero appena vidimato dall'ente, da aggiungere alla scorta. */
export interface NuovoNumeroVidimato {
  numIscrSito: string
  codiceBlocco: string
  progressivo: number
  numeroFir: string
  qrCodeBytes: string
  dataVidimazione: Date
}

/** Riga grezza restituita da `$queryRaw` (nomi colonna snake_case). */
interface RawRow {
  id: string
  tenant_id: string
  num_iscr_sito: string
  codice_blocco: string
  progressivo: number
  numero_fir: string
  qr_code_bytes: string
  stato: RentriNumeroVidimatoStato
  fir_id: string | null
  data_vidimazione: Date
  data_consumo: Date | null
}

/**
 * Repository della scorta di numeri FIR pre-vidimati dall'ente RENTRI (R6,
 * v. `docs/audits/rentri-blocchi-come-fanno-gli-altri-2026-09-11.md`).
 *
 * **Il metodo critico è {@link consumaProssimoDisponibile}.** Due FIR emessi
 * nello stesso istante non devono mai ricevere lo stesso numero: la scelta
 * del numero e la sua marcatura come USATO avvengono in un **unico statement
 * SQL** (`UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)`),
 * non in una `SELECT` seguita da un'`UPDATE` separata. È lo stesso principio
 * già in uso in questo progetto per `RegistraMovimentoUseCase` (lì un
 * advisory lock + `SELECT MAX(...)`, qui un lock di riga perché il "prossimo
 * disponibile" è una riga specifica, non un massimo aggregato) — ma qui la
 * garanzia non dipende da tenere aperta una transazione applicativa: essendo
 * un singolo statement, PostgreSQL lo esegue atomicamente da solo, quindi
 * funziona anche fuori da un `$transaction` esplicito.
 *
 * `FOR UPDATE SKIP LOCKED` (non `FOR UPDATE` semplice): due chiamate
 * concorrenti che trovano più righe DISPONIBILI non si accodano l'una
 * dietro l'altra sulla STESSA riga bloccata — la seconda salta quella già
 * in lavorazione dalla prima e prende la successiva libera. Se invece resta
 * una sola riga contesa, la seconda non la vede proprio (non è più
 * DISPONIBILE quando la sua sotto-query rilegge, o la salta se ancora
 * lockata) e la funzione ritorna `null` — mai un doppio assegnamento, mai
 * un blocco indefinito.
 *
 * Isolamento: `tenantId` basta (= l'azienda in questo progetto, v.
 * `TENANT_SCOPED_MODELS`). Uso `this.prisma` (client base), non
 * `this.prisma.db` (estensione RLS): il filtro tenant è già esplicito in
 * ogni query raw, stesso principio di `RegistraMovimentoUseCase` — l'RLS
 * extension intercetta solo le operazioni di modello (`findMany`, `create`,
 * ...), non `$queryRaw`.
 */
@Injectable()
export class RentriScortaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Inserisce un numero appena vidimato dall'ente come DISPONIBILE. */
  async inserisciDisponibile(tenantId: string, input: NuovoNumeroVidimato): Promise<void> {
    await this.prisma.rentriNumeroVidimato.create({
      data: {
        tenantId,
        numIscrSito: input.numIscrSito,
        codiceBlocco: input.codiceBlocco,
        progressivo: input.progressivo,
        numeroFir: input.numeroFir,
        qrCodeBytes: input.qrCodeBytes,
        dataVidimazione: input.dataVidimazione,
        stato: RentriNumeroVidimatoStato.DISPONIBILE,
      },
    })
  }

  /** Totale dei numeri DISPONIBILI del tenant, opzionalmente filtrato per unità locale. */
  async contaTotaleDisponibili(tenantId: string, numIscrSito?: string): Promise<number> {
    return this.prisma.rentriNumeroVidimato.count({
      where: {
        tenantId,
        stato: RentriNumeroVidimatoStato.DISPONIBILE,
        ...(numIscrSito ? { numIscrSito } : {}),
      },
    })
  }

  /** Numeri DISPONIBILI del tenant, raggruppati per blocco (per la vista "scorta"). */
  async contaDisponibiliPerBlocco(tenantId: string): Promise<DisponibiliPerBlocco[]> {
    const gruppi = await this.prisma.rentriNumeroVidimato.groupBy({
      by: ['codiceBlocco', 'numIscrSito'],
      where: { tenantId, stato: RentriNumeroVidimatoStato.DISPONIBILE },
      _count: { _all: true },
    })
    return gruppi.map(g => ({
      codiceBlocco: g.codiceBlocco,
      numIscrSito: g.numIscrSito,
      disponibili: g._count._all,
    }))
  }

  /**
   * Consuma atomicamente il prossimo numero DISPONIBILE (il progressivo più
   * basso) per il tenant, opzionalmente ristretto a una unità locale e/o a
   * un blocco specifico. Ritorna `null` se non c'è nulla da consumare —
   * FAIL-CLOSED, mai un numero inventato.
   *
   * Ordine dei parametri interpolati nella query, fisso e usato dai test che
   * mockano `$queryRaw` (v. `rentri-scorta.repository.spec.ts`): tenantId,
   * numIscrSito (x2, per il confronto `IS NULL OR =`), codiceBlocco (x2),
   * firId.
   */
  async consumaProssimoDisponibile(
    tenantId: string,
    opzioni: { numIscrSito?: string; codiceBlocco?: string; firId: string }
  ): Promise<NumeroVidimatoRow | null> {
    const numIscrSito = opzioni.numIscrSito ?? null
    const codiceBlocco = opzioni.codiceBlocco ?? null

    const righe = await this.prisma.$queryRaw<RawRow[]>`
      UPDATE rentri_numeri_vidimati
      SET stato = 'USATO', fir_id = ${opzioni.firId}::uuid, data_consumo = now(), updated_at = now()
      WHERE id = (
        SELECT id FROM rentri_numeri_vidimati
        WHERE tenant_id = ${tenantId}::uuid
          AND stato = 'DISPONIBILE'
          AND (${numIscrSito}::text IS NULL OR num_iscr_sito = ${numIscrSito}::text)
          AND (${codiceBlocco}::text IS NULL OR codice_blocco = ${codiceBlocco}::text)
        ORDER BY progressivo ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, tenant_id, num_iscr_sito, codice_blocco, progressivo, numero_fir,
                qr_code_bytes, stato, fir_id, data_vidimazione, data_consumo
    `

    const riga = righe[0]
    return riga ? this.toPlain(riga) : null
  }

  private toPlain(row: RawRow): NumeroVidimatoRow {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      numIscrSito: row.num_iscr_sito,
      codiceBlocco: row.codice_blocco,
      progressivo: row.progressivo,
      numeroFir: row.numero_fir,
      qrCodeBytes: row.qr_code_bytes,
      stato: row.stato,
      firId: row.fir_id,
      dataVidimazione: row.data_vidimazione,
      dataConsumo: row.data_consumo,
    }
  }
}
