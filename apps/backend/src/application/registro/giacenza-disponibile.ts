import { Prisma } from '@prisma/client'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { ALIAS_KG, ALIAS_T } from '../../domain/waste-movement/unita-misura-registro'
import { cerSoloCifre } from '../../domain/waste-movement/cer-registro'

export interface ParametriGiacenza {
  tenantId: string
  /** Registro di cui si calcola la giacenza: carichi e scarichi di un altro registro non contano. */
  registroId: string
  cerCode: string
  alla: Date
}

export interface GiacenzaDisponibile {
  /** Carichi (aperture comprese) meno scarichi del CER a qualunque data, in kg. Decide il blocco. */
  saldoComplessivoKg: number
  /**
   * Quanto uno SCARICO del giorno italiano di `alla` può consumare senza portare
   * sotto zero nessun saldo da quel giorno in poi. Decide solo l'avviso sull'ordine delle date.
   */
  disponibileAllaDataKg: number
  /** Giorno (mezzanotte UTC) del saldo che fa da limite: il giorno di `alla` o uno successivo. */
  vincoloAl: Date
  /**
   * Unità (maiuscole, senza spazi ai bordi, ordinate, distinte) dei CARICHI dello stesso CER che
   * non sono kg, t o vuote: non entrano nei saldi, quindi chi scarica in kg non può contare su di loro.
   */
  unitaNonDiMassaCaricate: string[]
}

interface RigaGiacenza {
  vincolo_al: Date
  saldo: Prisma.Decimal | number | string
  saldo_totale: Prisma.Decimal | number | string
  unita_non_massa: string[] | null
}

const arrotonda3 = (v: unknown): number => Math.round(Number(v) * 1000) / 1000

/**
 * Saldi in kg per giorno italiano di `movement_date` (colonna senza fuso, scritta in UTC).
 * Considera solo la famiglia di massa (alias di kg e t, unità vuota); il CER si confronta
 * sulle sole cifre: con o senza asterisco, con o senza spazi (righe storiche scritte prima
 * della normalizzazione "NN NN NN") è lo stesso rifiuto. Le liste di alias arrivano da
 * `unita-misura-registro.ts`.
 * I valori possono essere negativi se lo storico è già incoerente.
 */
export async function giacenzaDisponibileAl(
  tx: Prisma.TransactionClient,
  p: ParametriGiacenza
): Promise<GiacenzaDisponibile> {
  const cifreCer = cerSoloCifre(p.cerCode)
  const giornoAlla = giornoItaliano(p.alla)
  const aliasKg = [...ALIAS_KG]
  const aliasT = [...ALIAS_T]

  const righe = await tx.$queryRaw<RigaGiacenza[]>`
    WITH righe AS (
      SELECT (movement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date AS g,
             (CASE WHEN type = 'CARICO' THEN 1 ELSE -1 END * quantity *
              CASE WHEN upper(btrim(unit)) = ANY(${aliasT}::text[]) THEN 1000 ELSE 1 END) AS delta
      FROM waste_movements
      WHERE tenant_id = ${p.tenantId}::uuid
        AND registro_id = ${p.registroId}::uuid
        AND regexp_replace(cer_code, '[^0-9]', '', 'g') = ${cifreCer}
        AND (upper(btrim(unit)) = ANY(${aliasKg}::text[])
             OR upper(btrim(unit)) = ANY(${aliasT}::text[])
             OR btrim(unit) = '')
      UNION ALL
      -- Le aperture del registro (giacenze iniziali) sono carichi del giorno data_riferimento.
      -- È una DATE: già il giorno italiano, niente AT TIME ZONE (passerebbe da un timestamp
      -- col fuso della sessione e potrebbe spostare il giorno).
      SELECT data_riferimento AS g,
             (quantita * CASE WHEN upper(btrim(unita)) = ANY(${aliasT}::text[]) THEN 1000 ELSE 1 END) AS delta
      FROM giacenze_iniziali
      WHERE tenant_id = ${p.tenantId}::uuid
        AND registro_id = ${p.registroId}::uuid
        AND regexp_replace(cer_code, '[^0-9]', '', 'g') = ${cifreCer}
        AND (upper(btrim(unita)) = ANY(${aliasKg}::text[])
             OR upper(btrim(unita)) = ANY(${aliasT}::text[])
             OR btrim(unita) = '')
    ),
    mov AS (SELECT g, SUM(delta) AS delta FROM righe GROUP BY g),
    saldi AS (SELECT g, SUM(delta) OVER (ORDER BY g) AS saldo FROM mov),
    candidati AS (
      SELECT ${giornoAlla}::date AS g,
             COALESCE((SELECT saldo FROM saldi WHERE g <= ${giornoAlla}::date ORDER BY g DESC LIMIT 1), 0) AS saldo
      UNION ALL
      SELECT g, saldo FROM saldi WHERE g > ${giornoAlla}::date
    )
    SELECT c.g AS vincolo_al, c.saldo, (SELECT COALESCE(SUM(delta), 0) FROM mov) AS saldo_totale,
           (SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::text[])
            FROM (
              SELECT upper(btrim(unit)) AS u
              FROM waste_movements
              WHERE tenant_id = ${p.tenantId}::uuid
                AND registro_id = ${p.registroId}::uuid
                AND type = 'CARICO'
                AND regexp_replace(cer_code, '[^0-9]', '', 'g') = ${cifreCer}
                AND NOT (upper(btrim(unit)) = ANY(${aliasKg}::text[])
                         OR upper(btrim(unit)) = ANY(${aliasT}::text[])
                         OR btrim(unit) = '')
              UNION ALL
              SELECT upper(btrim(unita)) AS u
              FROM giacenze_iniziali
              WHERE tenant_id = ${p.tenantId}::uuid
                AND registro_id = ${p.registroId}::uuid
                AND regexp_replace(cer_code, '[^0-9]', '', 'g') = ${cifreCer}
                AND NOT (upper(btrim(unita)) = ANY(${aliasKg}::text[])
                         OR upper(btrim(unita)) = ANY(${aliasT}::text[])
                         OR btrim(unita) = '')
            ) nm) AS unita_non_massa
    FROM candidati c ORDER BY c.saldo ASC, c.g ASC LIMIT 1
  `

  // La query restituisce sempre il candidato del giorno richiesto; se non arriva nessuna
  // riga, nessun movimento conta: saldo zero, col limite al giorno di `alla`.
  const r: RigaGiacenza = righe?.[0] ?? {
    vincolo_al: new Date(`${giornoAlla}T00:00:00Z`),
    saldo: 0,
    saldo_totale: 0,
    unita_non_massa: [],
  }
  return {
    saldoComplessivoKg: arrotonda3(r.saldo_totale),
    disponibileAllaDataKg: arrotonda3(r.saldo),
    vincoloAl: new Date(r.vincolo_al),
    unitaNonDiMassaCaricate: Array.isArray(r.unita_non_massa) ? [...r.unita_non_massa] : [],
  }
}
