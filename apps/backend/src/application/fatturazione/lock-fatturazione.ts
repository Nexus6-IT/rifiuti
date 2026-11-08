// Lock della fatturazione per periodo (fase 4.4b1, spec §8, Q20). L'ordine, mai invertito:
//
//   1. elaborazione FOR UPDATE                           (`bloccaElaborazione`)
//   2. numerazioni FOR UPDATE per registro_iva_id         (`numerazione.ts`, Task 8)
//   3. contratti FOR SHARE per id
//   4. elenchi FOR SHARE per id
//   5. righe di listino FOR SHARE per id                  (3-5: `bloccaPerDefinitiva`)
//   6. testate e righe dei legami FOR UPDATE per id       (`bloccaRigheLegame`, 4.3)
//   7. definitiva: documenti in BOZZA FOR UPDATE, poi marcatori INSERT/DELETE
//      (`definitiva.ts`, passi 8-9)
//      annullo e storno: documento DEFINITIVO FOR UPDATE, dopo la numerazione e PRIMA dei legami
//      (passo 2 di `annullo-storno.service.ts`)
//
// I passi 6 e 7 sono righe diverse fra definitiva e annullo/storno (una BOZZA non e' mai l'origine
// di un annullo nella stessa finestra), quindi l'ordine diverso fra i due percorsi non puo' dare
// un ciclo: le risorse COMUNI (numerazione, legami, marcatori) si prendono sempre in quest'ordine.
//
// La 4.4 non prende MAI il lock del registro, il lock consultivo per radice o
// `impostazioni_fatturazione FOR UPDATE` (S5): lo prova `guardia-registro.spec.ts`.
//
// Perche' FOR SHARE sugli insiemi interi: il listino lo scrive con FOR UPDATE (elenchi) e FOR NO
// KEY UPDATE (righe), che confliggono con FOR SHARE, quindi una modifica del listino e una
// definitiva si serializzano nello stesso ordine (contratto -> elenchi -> righe) e non si
// incrociano mai. Due definitive fra loro NON si bloccano sul listino: FOR SHARE non confligge.
//
// `bloccaPerDefinitiva` NON sostituisce `bloccaListinoInCondivisione` (4.3), che lavora su un
// contratto solo e lancia 404/409: qui si blocca quello che si trova e non si lancia mai 404 o
// 409. Un id sparito o un contratto cambiato lo vede l'impronta al passo 5 della definitiva
// (`ANTEPRIMA_SUPERATA`, voce `cambiati`).
import { NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { StatoElaborazione } from '../../domain/fatturazione/codici'
import { bloccaRigheLegame } from '../legami-movimento/lock-legame'
import { conJoinLineari } from './piani-query'

/** Gli insiemi che la definitiva blocca, tutti con id distinti e in ordine. */
export interface InsiemiDaBloccare {
  /** Contratti principali dei documenti e i loro allegati. */
  contrattoIds: string[]
  /** Elenchi di quei contratti validi nel periodo dei documenti. */
  elencoIds: string[]
  /** Righe di listino (`righe_addebito`) di quegli elenchi. */
  rigaIds: string[]
  /** Legami citati dalle righe dei documenti in bozza. */
  legameIds: string[]
}

const distintiOrdinati = (ids: Iterable<string>): string[] => [...new Set(ids)].sort()

interface DocumentoLetto {
  id: string
  contratto_id: string
  elenco_id: string | null
  periodo_dal: string
  periodo_al: string
}

/**
 * Legge, SENZA lock (Q20), gli insiemi che `bloccaPerDefinitiva` blocchera': contratti principali
 * e allegati dei documenti, i loro elenchi validi nel periodo del documento, le righe di listino
 * di quegli elenchi e i legami delle righe delle bozze, piu' le righe di listino CITATE da quei
 * legami e dalle righe dei documenti con il loro elenco, anche fuori validita' (N2 del Task 17).
 * Al piu' 5 query in tutto, qualunque sia il numero di documenti; tutte `= ANY(uuid[])`.
 */
export function insiemiPerDefinitiva(
  tx: Prisma.TransactionClient,
  tenantId: string,
  documentoIds: readonly string[]
): Promise<InsiemiDaBloccare> {
  // Nested loop spento (I5 del Task 27a), ripristinato alla fine: vedi `selezionaElaborazione`.
  return conJoinLineari(tx, () => insiemiPerDefinitivaInterna(tx, tenantId, documentoIds))
}

async function insiemiPerDefinitivaInterna(
  tx: Prisma.TransactionClient,
  tenantId: string,
  documentoIds: readonly string[]
): Promise<InsiemiDaBloccare> {
  const ids = distintiOrdinati(documentoIds)
  if (ids.length === 0) return { contrattoIds: [], elencoIds: [], rigaIds: [], legameIds: [] }

  const documenti = await tx.$queryRaw<DocumentoLetto[]>`
    SELECT id::text AS id, contratto_id::text AS contratto_id, elenco_id::text AS elenco_id,
           periodo_dal::text AS periodo_dal, periodo_al::text AS periodo_al
    FROM documenti_fattura
    WHERE tenant_id = ${tenantId}::uuid AND id IN (SELECT unnest(${ids}::uuid[]))`
  const principali = distintiOrdinati(documenti.map(d => d.contratto_id))

  const allegati =
    principali.length === 0
      ? []
      : await tx.$queryRaw<{ id: string; principale: string }[]>`
          SELECT id::text AS id, contratto_principale_id::text AS principale
          FROM contratti_cliente
          WHERE tenant_id = ${tenantId}::uuid AND eliminato_il IS NULL
            AND contratto_principale_id IN (SELECT unnest(${principali}::uuid[]))`
  const contrattiIds = distintiOrdinati([...principali, ...allegati.map(a => a.id)])

  // Per ogni principale, i periodi dei suoi documenti: un elenco entra se vale in uno di essi.
  const periodi = new Map<string, { dal: string; al: string }[]>()
  for (const d of documenti) {
    const l = periodi.get(d.contratto_id) ?? []
    l.push({ dal: d.periodo_dal, al: d.periodo_al })
    periodi.set(d.contratto_id, l)
  }
  const principaleDi = new Map<string, string>()
  for (const p of principali) principaleDi.set(p, p)
  for (const a of allegati) principaleDi.set(a.id, a.principale)

  const elenchi =
    contrattiIds.length === 0
      ? []
      : await tx.$queryRaw<
          {
            id: string
            contratto_id: string
            valido_dal: string | null
            valido_al: string | null
          }[]
        >`
          SELECT id::text AS id, contratto_id::text AS contratto_id,
                 valido_dal::text AS valido_dal, valido_al::text AS valido_al
          FROM elenchi_addebiti
          WHERE tenant_id = ${tenantId}::uuid AND contratto_id IN (SELECT unnest(${contrattiIds}::uuid[]))`
  const elencoIds = new Set<string>()
  for (const d of documenti) if (d.elenco_id !== null) elencoIds.add(d.elenco_id)
  for (const e of elenchi) {
    const finestre = periodi.get(principaleDi.get(e.contratto_id) ?? '') ?? []
    const vale = finestre.some(
      f =>
        (e.valido_dal === null || e.valido_dal <= f.al) &&
        (e.valido_al === null || e.valido_al >= f.dal)
    )
    if (vale) elencoIds.add(e.id)
  }

  // Legami delle bozze e righe di listino CITATE (N2 del Task 17): una riga citata da un legame o
  // da una riga del documento puo' stare in un elenco fuori validita' (arretrati, elenco scaduto).
  // Anche quella riga e il suo elenco si bloccano, altrimenti una modifica del listino concorrente
  // la cambierebbe sotto la definitiva. Una sola query per le due cose.
  // CTE MATERIALIZED su `unnest` (I2 del Task 27a): l'array dei documenti si converte UNA volta e
  // non per ogni riga (piano generico con `= ANY(($n)::uuid[])` come Filter: 5 s a 10.000
  // legami contro 45 ms).
  const citati = await tx.$queryRaw<{ tipo: string; id: string; elenco_id: string | null }[]>`
    WITH d AS MATERIALIZED (SELECT DISTINCT unnest(${ids}::uuid[]) AS id),
    x AS MATERIALIZED (
      SELECT r.legame_id, r.riga_addebito_id FROM righe_documento_fattura r
      JOIN d ON d.id = r.documento_id
      WHERE r.tenant_id = ${tenantId}::uuid)
    SELECT 'L' AS tipo, x.legame_id::text AS id, NULL::text AS elenco_id
    FROM x WHERE x.legame_id IS NOT NULL
    UNION
    SELECT 'R', ra.id::text, ra.elenco_id::text
    FROM righe_addebito ra
    WHERE ra.tenant_id = ${tenantId}::uuid AND ra.id IN (
      SELECT x.riga_addebito_id FROM x WHERE x.riga_addebito_id IS NOT NULL
      UNION
      SELECT rl.riga_addebito_id FROM righe_legame_movimento rl
      WHERE rl.tenant_id = ${tenantId}::uuid
        AND rl.legame_id IN (SELECT x.legame_id FROM x WHERE x.legame_id IS NOT NULL))`
  for (const c of citati) if (c.tipo === 'R' && c.elenco_id !== null) elencoIds.add(c.elenco_id)
  const elenchiOrdinati = distintiOrdinati(elencoIds)
  const righeCitate = citati.filter(c => c.tipo === 'R').map(c => c.id)

  // Le righe di listino di TUTTI gli elenchi bloccati (insiemi interi, Q20), citate comprese.
  const righe =
    elenchiOrdinati.length === 0
      ? []
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id FROM righe_addebito
          WHERE tenant_id = ${tenantId}::uuid AND elenco_id IN (SELECT unnest(${elenchiOrdinati}::uuid[]))`

  return {
    contrattoIds: contrattiIds,
    elencoIds: elenchiOrdinati,
    rigaIds: distintiOrdinati([...righe.map(r => r.id), ...righeCitate]),
    legameIds: distintiOrdinati(citati.filter(c => c.tipo === 'L').map(c => c.id)),
  }
}

/**
 * Passo 1 della definitiva: l'elaborazione `FOR UPDATE`. Due richieste insieme si accodano e la
 * seconda trova lo stato `IN_DEFINITIVA`. 404 `ELABORAZIONE_NON_TROVATA` se non c'e' (o e' di
 * un'altra azienda).
 */
export async function bloccaElaborazione(
  tx: Prisma.TransactionClient,
  tenantId: string,
  elaborazioneId: string
): Promise<{ stato: StatoElaborazione; versione: number }> {
  const righe = await tx.$queryRaw<{ stato: StatoElaborazione; versione: number }[]>`
    SELECT stato::text AS stato, versione FROM elaborazioni_fatturazione
    WHERE tenant_id = ${tenantId}::uuid AND id = ${elaborazioneId}::uuid
    FOR UPDATE`
  if (righe.length === 0) {
    throw new NotFoundException({
      error: 'ELABORAZIONE_NON_TROVATA',
      message: 'Elaborazione non trovata.',
    })
  }
  return righe[0]
}

/** Blocca FOR SHARE (in ordine di id) le righe di `tabella` con id nella lista. Una query. */
async function bloccaInCondivisione(
  tx: Prisma.TransactionClient,
  tenantId: string,
  tabella: 'contratti_cliente' | 'elenchi_addebiti' | 'righe_addebito',
  ids: readonly string[]
): Promise<void> {
  if (ids.length === 0) return
  // Nomi di tabella da un insieme chiuso: `Prisma.raw` e' sicuro.
  const t = Prisma.raw(tabella)
  await tx.$queryRaw`
    SELECT x.id::text AS id FROM ${t} x
    JOIN unnest(${ids}::uuid[]) AS chiesti(chiesto) ON chiesto = x.id
    WHERE x.tenant_id = ${tenantId}::uuid
    ORDER BY x.id FOR SHARE OF x`
}

/**
 * Passi 3-6 della definitiva: contratti FOR SHARE -> elenchi FOR SHARE -> righe di listino FOR
 * SHARE -> testate e righe dei legami FOR UPDATE (`bloccaRigheLegame`), ciascun insieme intero con
 * una query (`JOIN unnest`, in ordine di id). Non lancia mai 404 o 409: blocca le righe che trova.
 *
 * `JOIN unnest` su liste grandi vuole `enable_nestloop = off`; qui lo si spegne per le query a
 * lista e lo si RIPRISTINA prima di tornare (scansione P46): le letture che il chiamante fa dopo,
 * nella stessa transazione, ritrovano il planner com'era.
 */
export async function bloccaPerDefinitiva(
  tx: Prisma.TransactionClient,
  tenantId: string,
  s: InsiemiDaBloccare
): Promise<void> {
  await conJoinLineari(tx, async () => {
    await bloccaInCondivisione(tx, tenantId, 'contratti_cliente', distintiOrdinati(s.contrattoIds))
    await bloccaInCondivisione(tx, tenantId, 'elenchi_addebiti', distintiOrdinati(s.elencoIds))
    await bloccaInCondivisione(tx, tenantId, 'righe_addebito', distintiOrdinati(s.rigaIds))
    // Chiama a sua volta `joinLineari`: il ripristino lo fa `conJoinLineari` alla fine, anche se
    // una query lancia.
    await bloccaRigheLegame(tx, tenantId, s.legameIds)
  })
}
