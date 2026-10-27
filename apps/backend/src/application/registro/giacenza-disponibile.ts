import { Prisma } from '@prisma/client'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { ALIAS_KG, ALIAS_T } from '../../domain/waste-movement/unita-misura-registro'
import { cerSoloCifre } from '../../domain/waste-movement/cer-registro'
import { sqlVigente } from '../../domain/waste-movement/vigenza'

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

interface Frammenti {
  tenantId: string
  registroId: string
  cifreCer: string
  aliasKg: string[]
  aliasT: string[]
}

function frammenti(p: { tenantId: string; registroId: string; cerCode: string }): Frammenti {
  return {
    tenantId: p.tenantId,
    registroId: p.registroId,
    cifreCer: cerSoloCifre(p.cerCode),
    aliasKg: [...ALIAS_KG],
    aliasT: [...ALIAS_T],
  }
}

/**
 * Corpo della CTE `righe`: un delta in kg per ogni annotazione VIGENTE di massa del CER nel
 * registro, piu le aperture. E' l'UNICO punto in cui si decide cosa entra nel saldo:
 * `giacenzaDisponibileAl` e `saldiRegistroCer` (controllo di giacenza delle correzioni, R6) lo
 * compongono entrambe, cosi non possono divergere.
 */
function sqlRigheDiMassa(f: Frammenti): Prisma.Sql {
  return Prisma.sql`
      SELECT (movement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date AS g,
             (CASE WHEN type = 'CARICO' THEN 1 ELSE -1 END * quantity *
              CASE WHEN upper(btrim(unit)) = ANY(${f.aliasT}::text[]) THEN 1000 ELSE 1 END) AS delta
      FROM waste_movements wm
      WHERE tenant_id = ${f.tenantId}::uuid
        AND ${sqlVigente('wm')}
        AND registro_id = ${f.registroId}::uuid
        AND regexp_replace(cer_code, '[^0-9]', '', 'g') = ${f.cifreCer}
        AND (upper(btrim(unit)) = ANY(${f.aliasKg}::text[])
             OR upper(btrim(unit)) = ANY(${f.aliasT}::text[])
             OR btrim(unit) = '')
      UNION ALL
      -- Le aperture del registro (giacenze iniziali) sono carichi del giorno data_riferimento.
      -- È una DATE: già il giorno italiano, niente AT TIME ZONE (passerebbe da un timestamp
      -- col fuso della sessione e potrebbe spostare il giorno).
      SELECT data_riferimento AS g,
             (quantita * CASE WHEN upper(btrim(unita)) = ANY(${f.aliasT}::text[]) THEN 1000 ELSE 1 END) AS delta
      FROM giacenze_iniziali
      WHERE tenant_id = ${f.tenantId}::uuid
        AND registro_id = ${f.registroId}::uuid
        AND regexp_replace(cer_code, '[^0-9]', '', 'g') = ${f.cifreCer}
        AND (upper(btrim(unita)) = ANY(${f.aliasKg}::text[])
             OR upper(btrim(unita)) = ANY(${f.aliasT}::text[])
             OR btrim(unita) = '')
    `
}

/**
 * Sottoquery scalare (array) delle unita dei CARICHI vigenti e delle aperture dello stesso CER
 * che non sono di massa. Condivisa come `sqlRigheDiMassa`.
 */
function sqlUnitaNonDiMassa(f: Frammenti): Prisma.Sql {
  return Prisma.sql`
           (SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::text[])
            FROM (
              SELECT upper(btrim(unit)) AS u
              FROM waste_movements wm
              WHERE tenant_id = ${f.tenantId}::uuid
                AND ${sqlVigente('wm')}
                AND registro_id = ${f.registroId}::uuid
                AND type = 'CARICO'
                AND regexp_replace(cer_code, '[^0-9]', '', 'g') = ${f.cifreCer}
                AND NOT (upper(btrim(unit)) = ANY(${f.aliasKg}::text[])
                         OR upper(btrim(unit)) = ANY(${f.aliasT}::text[])
                         OR btrim(unit) = '')
              UNION ALL
              SELECT upper(btrim(unita)) AS u
              FROM giacenze_iniziali
              WHERE tenant_id = ${f.tenantId}::uuid
                AND registro_id = ${f.registroId}::uuid
                AND regexp_replace(cer_code, '[^0-9]', '', 'g') = ${f.cifreCer}
                AND NOT (upper(btrim(unita)) = ANY(${f.aliasKg}::text[])
                         OR upper(btrim(unita)) = ANY(${f.aliasT}::text[])
                         OR btrim(unita) = '')
            ) nm)
    `
}

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
  const f = frammenti(p)
  const giornoAlla = giornoItaliano(p.alla)

  const righe = await tx.$queryRaw<RigaGiacenza[]>`
    WITH righe AS (${sqlRigheDiMassa(f)}),
    mov AS (SELECT g, SUM(delta) AS delta FROM righe GROUP BY g),
    saldi AS (SELECT g, SUM(delta) OVER (ORDER BY g) AS saldo FROM mov),
    candidati AS (
      SELECT ${giornoAlla}::date AS g,
             COALESCE((SELECT saldo FROM saldi WHERE g <= ${giornoAlla}::date ORDER BY g DESC LIMIT 1), 0) AS saldo
      UNION ALL
      SELECT g, saldo FROM saldi WHERE g > ${giornoAlla}::date
    )
    SELECT c.g AS vincolo_al, c.saldo, (SELECT COALESCE(SUM(delta), 0) FROM mov) AS saldo_totale,
           ${sqlUnitaNonDiMassa(f)} AS unita_non_massa
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

export interface ParametriSaldiCorrezione {
  tenantId: string
  registroId: string
  cerCode: string
}

export interface SaldiRegistroCer {
  /** Saldo di tutti i giorni (carichi e aperture meno scarichi vigenti), in kg. */
  saldoComplessivoKg: number
  /**
   * Il saldo piu basso fra quelli cumulati a fine di ciascun giorno con movimenti, in kg; 0 senza
   * movimenti. Confrontato PRIMA e DOPO una correzione, rivela un ordine delle date incoerente.
   */
  saldoMinimoGiornalieroKg: number
  /** Unita non di massa dei carichi vigenti e delle aperture dello stesso CER (come sopra). */
  unitaNonDiMassaCaricate: string[]
}

/**
 * Saldi del CER nel registro per il controllo di giacenza di una correzione (R6): da chiamare
 * PRIMA e DOPO l'insert nella stessa transazione. Usa gli stessi frammenti SQL di
 * `giacenzaDisponibileAl` (vigenti piu aperture): la correzione appena inserita sostituisce la
 * testa che corregge e un annullamento toglie l'intera catena.
 */
export async function saldiRegistroCer(
  tx: Prisma.TransactionClient,
  p: ParametriSaldiCorrezione
): Promise<SaldiRegistroCer> {
  const f = frammenti(p)
  const righe = await tx.$queryRaw<
    Array<{
      saldo_totale: Prisma.Decimal | number | string
      saldo_minimo: Prisma.Decimal | number | string | null
      unita_non_massa: string[] | null
    }>
  >`
    WITH righe AS (${sqlRigheDiMassa(f)}),
    mov AS (SELECT g, SUM(delta) AS delta FROM righe GROUP BY g),
    saldi AS (SELECT g, SUM(delta) OVER (ORDER BY g) AS saldo FROM mov)
    SELECT (SELECT COALESCE(SUM(delta), 0) FROM mov) AS saldo_totale,
           (SELECT MIN(saldo) FROM saldi) AS saldo_minimo,
           ${sqlUnitaNonDiMassa(f)} AS unita_non_massa
  `
  const r = righe?.[0]
  return {
    saldoComplessivoKg: arrotonda3(r?.saldo_totale ?? 0),
    saldoMinimoGiornalieroKg: arrotonda3(r?.saldo_minimo ?? 0),
    unitaNonDiMassaCaricate: Array.isArray(r?.unita_non_massa) ? [...r.unita_non_massa] : [],
  }
}
