import { Prisma } from '@prisma/client'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { ALIAS_KG, ALIAS_T } from '../../domain/waste-movement/unita-misura-registro'

export interface ParametriGiacenza {
  tenantId: string
  cerCode: string
  alla: Date
}

export interface GiacenzaDisponibile {
  /** Carichi meno scarichi del CER a qualunque data, in kg. Decide il blocco. */
  saldoComplessivoKg: number
  /**
   * Quanto uno SCARICO del giorno italiano di `alla` può consumare senza portare
   * sotto zero nessun saldo da quel giorno in poi. Decide solo l'avviso sull'ordine delle date.
   */
  disponibileAllaDataKg: number
  /** Giorno (mezzanotte UTC) del saldo che fa da limite: il giorno di `alla` o uno successivo. */
  vincoloAl: Date
}

interface RigaGiacenza {
  vincolo_al: Date
  saldo: Prisma.Decimal | number | string
  saldo_totale: Prisma.Decimal | number | string
}

const arrotonda3 = (v: unknown): number => Math.round(Number(v) * 1000) / 1000

/**
 * Saldi in kg per giorno italiano di `movement_date` (colonna senza fuso, scritta in UTC).
 * Considera solo la famiglia di massa (alias di kg e t, unità vuota); il CER si confronta
 * con e senza asterisco. Le liste di alias arrivano da `unita-misura-registro.ts`.
 * I valori possono essere negativi se lo storico è già incoerente.
 */
export async function giacenzaDisponibileAl(
  tx: Prisma.TransactionClient,
  p: ParametriGiacenza
): Promise<GiacenzaDisponibile> {
  const cerSenzaStella = p.cerCode.replace(/\*$/, '')
  const cerConStella = `${cerSenzaStella}*`
  const giornoAlla = giornoItaliano(p.alla)
  const aliasKg = [...ALIAS_KG]
  const aliasT = [...ALIAS_T]

  const righe = await tx.$queryRaw<RigaGiacenza[]>`
    WITH mov AS (
      SELECT (movement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date AS g,
             SUM(CASE WHEN type = 'CARICO' THEN 1 ELSE -1 END * quantity *
                 CASE WHEN upper(btrim(unit)) = ANY(${aliasT}::text[]) THEN 1000 ELSE 1 END) AS delta
      FROM waste_movements
      WHERE tenant_id = ${p.tenantId}::uuid
        AND cer_code IN (${cerSenzaStella}, ${cerConStella})
        AND (upper(btrim(unit)) = ANY(${aliasKg}::text[])
             OR upper(btrim(unit)) = ANY(${aliasT}::text[])
             OR btrim(unit) = '')
      GROUP BY 1
    ),
    saldi AS (SELECT g, SUM(delta) OVER (ORDER BY g) AS saldo FROM mov),
    candidati AS (
      SELECT ${giornoAlla}::date AS g,
             COALESCE((SELECT saldo FROM saldi WHERE g <= ${giornoAlla}::date ORDER BY g DESC LIMIT 1), 0) AS saldo
      UNION ALL
      SELECT g, saldo FROM saldi WHERE g > ${giornoAlla}::date
    )
    SELECT c.g AS vincolo_al, c.saldo, (SELECT COALESCE(SUM(delta), 0) FROM mov) AS saldo_totale
    FROM candidati c ORDER BY c.saldo ASC, c.g ASC LIMIT 1
  `

  const r = righe[0]
  return {
    saldoComplessivoKg: arrotonda3(r.saldo_totale),
    disponibileAllaDataKg: arrotonda3(r.saldo),
    vincoloAl: new Date(r.vincolo_al),
  }
}
