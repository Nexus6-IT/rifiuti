// Lettura dei movimenti del registro collegati a un accesso (D13). Sola lettura: nessuna scrittura
// su `waste_movements`. Si collega la RADICE ordinaria della catena (F2-3) e si mostra la TESTA
// vigente: la rettifica di un'annotazione non rompe il collegamento, la differenza fra netto e
// quantita' si calcola su quanto e' in vigore oggi. Se la catena e' stata annullata non c'e' una
// testa vigente: la vista dice "annotazione annullata".
import { Prisma } from '@prisma/client'
import { WHERE_VIGENTE } from '../../domain/waste-movement/vigenza'

export interface RadiceMovimento {
  id: string
  registroId: string
  type: 'CARICO' | 'SCARICO'
  tipoAnnotazione: string
  cerCode: string
  progressiveNumber: number
  progressiveYear: number
}

export interface MovimentoCollegato {
  radiceId: string
  numero: string
  numeroVigente: string | null
  quantita: number | null
  unita: string | null
  annullato: boolean
}

const etichetta = (m: { progressiveNumber: number; progressiveYear: number }) =>
  `${m.progressiveNumber}/${m.progressiveYear}`

/** Il movimento dell'azienda (qualunque tipo di annotazione); null se non esiste. */
export async function leggiRadiceOrdinaria(
  tx: Prisma.TransactionClient,
  tenantId: string,
  movimentoId: string
): Promise<RadiceMovimento | null> {
  return tx.wasteMovement.findFirst({
    where: { id: movimentoId, tenantId },
    select: {
      id: true,
      registroId: true,
      type: true,
      tipoAnnotazione: true,
      cerCode: true,
      progressiveNumber: true,
      progressiveYear: true,
    },
  })
}

/** Radice e testa vigente di ciascuna catena, con due letture in tutto. */
export async function leggiMovimentiCollegati(
  tx: Prisma.TransactionClient,
  tenantId: string,
  radiceIds: string[]
): Promise<Map<string, MovimentoCollegato>> {
  const esito = new Map<string, MovimentoCollegato>()
  if (radiceIds.length === 0) return esito
  const [radici, vigenti] = await Promise.all([
    tx.wasteMovement.findMany({
      where: { tenantId, id: { in: radiceIds } },
      select: { id: true, progressiveNumber: true, progressiveYear: true },
    }),
    tx.wasteMovement.findMany({
      where: {
        tenantId,
        OR: [{ id: { in: radiceIds } }, { movimentoOriginaleId: { in: radiceIds } }],
        ...WHERE_VIGENTE,
      },
      select: {
        id: true,
        progressiveNumber: true,
        progressiveYear: true,
        quantity: true,
        unit: true,
        movimentoOriginaleId: true,
      },
    }),
  ])
  for (const r of radici) {
    const testa = vigenti.find(v => (v.movimentoOriginaleId ?? v.id) === r.id)
    esito.set(r.id, {
      radiceId: r.id,
      numero: etichetta(r),
      numeroVigente: testa ? etichetta(testa) : null,
      quantita: testa ? Number(testa.quantity) : null,
      unita: testa ? testa.unit : null,
      annullato: !testa,
    })
  }
  return esito
}
