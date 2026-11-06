// Manutenzione della fatturazione (fase 4.4b1, Task 22): pulizia delle bozze vecchie e recupero
// delle elaborazioni rimaste appese dopo la caduta di un processo. Ogni funzione lavora su UN
// tenant dentro la transazione che le passa il chiamante (il job apre il contesto dell'azienda,
// quindi la RLS vale): nessun DELETE o UPDATE esce dal tenant, e il filtro esplicito sul tenant
// resta come seconda difesa.
//
// Ordine dei lock: l'elaborazione `FOR UPDATE SKIP LOCKED` per prima (una elaborazione che un
// altro processo sta lavorando si salta, si rivede al giro dopo), poi i documenti in BOZZA.
// Non si prende mai il lock della numerazione, dei legami o dei marcatori (spec §8).
import { Prisma } from '@prisma/client'
import { impostaTimeoutLock } from '../listino/lock-listino'
import { ORFANA_DOPO_MINUTI } from './elaborazioni.service'

/** `SCARTATA` e `FALLITA` perdono le bozze dopo 7 giorni, `ANTEPRIMA_PRONTA` dopo 30. */
export const BOZZE_SCARTATE_DOPO_GIORNI = 7
export const BOZZE_ANTEPRIMA_DOPO_GIORNI = 30
/** Soglia di `IN_CORSO` e `IN_DEFINITIVA` (Q25); quella di `IN_CODA` e' `ORFANA_DOPO_MINUTI` (Task 18). */
export const ORFANA_ATTIVA_DOPO_MINUTI = 5

export const MESSAGGIO_ELABORAZIONE_INTERROTTA = 'Elaborazione interrotta'

const giorniPrima = (ora: Date, giorni: number): Date =>
  new Date(ora.getTime() - giorni * 86_400_000)
const minutiPrima = (ora: Date, minuti: number): Date => new Date(ora.getTime() - minuti * 60_000)

/**
 * Cancella le bozze delle elaborazioni `SCARTATA`/`FALLITA` ferme da piu' di 7 giorni e di quelle
 * `ANTEPRIMA_PRONTA` ferme da piu' di 30 (queste ultime diventano `SCARTATA`). Le righe e le rate
 * cadono con la testata (FK a cascata, ammesse dal trigger solo per la BOZZA). I documenti non in
 * bozza non si toccano mai: il filtro e' sullo stato del documento, non su quello dell'elaborazione.
 * Restituisce le bozze cancellate.
 */
export async function pulisciBozzeTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ora: Date
): Promise<number> {
  await impostaTimeoutLock(tx)
  const soglieScartate = giorniPrima(ora, BOZZE_SCARTATE_DOPO_GIORNI)
  const sogliaAnteprima = giorniPrima(ora, BOZZE_ANTEPRIMA_DOPO_GIORNI)
  const bersagli = await tx.$queryRaw<{ id: string; stato: string; versione: number }[]>`
    SELECT id::text AS id, stato::text AS stato, versione
    FROM elaborazioni_fatturazione
    WHERE tenant_id = ${tenantId}::uuid
      AND ((stato IN ('SCARTATA', 'FALLITA') AND updated_at < ${soglieScartate}::timestamptz)
        OR (stato = 'ANTEPRIMA_PRONTA' AND updated_at < ${sogliaAnteprima}::timestamptz))
    ORDER BY id
    FOR UPDATE SKIP LOCKED`
  if (bersagli.length === 0) return 0

  const cancellate = await tx.$executeRaw`
    DELETE FROM documenti_fattura
    WHERE tenant_id = ${tenantId}::uuid
      AND stato = 'BOZZA'
      AND elaborazione_id = ANY(${bersagli.map(b => b.id)}::uuid[])`

  const daScartare = bersagli.filter(b => b.stato === 'ANTEPRIMA_PRONTA').map(b => b.id)
  if (daScartare.length > 0) {
    // La versione sale: una richiesta che aveva letto l'anteprima non puo' piu' confermarla.
    await tx.$executeRaw`
      UPDATE elaborazioni_fatturazione
      SET stato = 'SCARTATA', versione = versione + 1, updated_at = ${ora}::timestamptz
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${daScartare}::uuid[])
        AND stato = 'ANTEPRIMA_PRONTA'`
  }
  return cancellate
}

/**
 * Riporta a uno stato stabile le elaborazioni rimaste appese perche' il processo e' caduto.
 * Orfana = `IN_CODA` ferma da piu' di `ORFANA_DOPO_MINUTI` (15, Task 18: i rinvii del job non
 * aggiornano `updated_at`), oppure `IN_CORSO` o `IN_DEFINITIVA` ferma da piu' di 5 minuti, e in
 * ogni caso con il `job_id` assente da `jobVivi` (job attivi, in attesa e ritardati della coda:
 * un job rinviato non e' orfano, Q25).
 * `IN_DEFINITIVA` torna `ANTEPRIMA_PRONTA` con esito `ELABORAZIONE_INTERROTTA` (la definitiva e'
 * una transazione sola: se non ha fatto commit non ha lasciato nulla); `IN_CORSO` e `IN_CODA`
 * diventano `FALLITA`. La versione sale. Restituisce le elaborazioni recuperate.
 */
export async function recuperaOrfaniTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobVivi: ReadonlySet<string>,
  ora: Date
): Promise<number> {
  await impostaTimeoutLock(tx)
  const sogliaCoda = minutiPrima(ora, ORFANA_DOPO_MINUTI)
  const sogliaAttive = minutiPrima(ora, ORFANA_ATTIVA_DOPO_MINUTI)
  const candidate = await tx.$queryRaw<{ id: string; stato: string; jobId: string | null }[]>`
    SELECT id::text AS id, stato::text AS stato, job_id AS "jobId"
    FROM elaborazioni_fatturazione
    WHERE tenant_id = ${tenantId}::uuid
      AND ((stato = 'IN_CODA' AND updated_at < ${sogliaCoda}::timestamptz)
        OR (stato IN ('IN_CORSO', 'IN_DEFINITIVA') AND updated_at < ${sogliaAttive}::timestamptz))
    ORDER BY id
    FOR UPDATE SKIP LOCKED`
  const orfane = candidate.filter(c => c.jobId === null || !jobVivi.has(c.jobId))
  if (orfane.length === 0) return 0

  const daRiportare = orfane.filter(o => o.stato === 'IN_DEFINITIVA').map(o => o.id)
  const daFallire = orfane.filter(o => o.stato !== 'IN_DEFINITIVA').map(o => o.id)
  if (daRiportare.length > 0) {
    await tx.$executeRaw`
      UPDATE elaborazioni_fatturazione
      SET stato = 'ANTEPRIMA_PRONTA', versione = versione + 1, updated_at = ${ora}::timestamptz,
          esito = '{"codice":"ELABORAZIONE_INTERROTTA"}'::jsonb
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${daRiportare}::uuid[])
        AND stato = 'IN_DEFINITIVA'`
  }
  if (daFallire.length > 0) {
    await tx.$executeRaw`
      UPDATE elaborazioni_fatturazione
      SET stato = 'FALLITA', versione = versione + 1, updated_at = ${ora}::timestamptz,
          errore_tecnico = ${MESSAGGIO_ELABORAZIONE_INTERROTTA}
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${daFallire}::uuid[])
        AND stato IN ('IN_CODA', 'IN_CORSO')`
  }
  return orfane.length
}
