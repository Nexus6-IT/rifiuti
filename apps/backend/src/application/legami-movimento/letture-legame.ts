// Letture del legame (fase 4.3, Task 14): i dati che il servizio passa alle funzioni di dominio
// della proposta. Solo SELECT, sempre con il tenant nella where (anche con la RLS accesa), una
// query per lista e mai una per riga. Nessun lock: chi conferma blocca poi con `lock-legame.ts` e
// rilegge.
import { Prisma } from '@prisma/client'
import type { TipoQuantita } from '../../domain/listino/riga-addebito'
import type {
  ClienteDaFir,
  ContrattoCandidato,
  ElencoCandidato,
} from '../../domain/legami-movimento/proposta-contratto'
import type { RigaCandidata } from '../../domain/legami-movimento/proposta-righe'
import { joinLineari } from '../listino/lock-listino'
import { sqlGiornoMovimento } from './giorno-movimento'

export interface ElencoLetto extends ElencoCandidato {
  contrattoId: string
}

/** Riga di listino con i campi per la proposta (`RigaCandidata`) e quelli da copiare nel legame. */
export interface RigaListinoLetta extends RigaCandidata {
  elencoId: string
  descrizione: string | null
  /** Decimale come stringa con la scala della colonna (`1.000000`); `null` = prezzo assente. */
  prezzo: string | null
  prezzoSpeciale: boolean
  sconto: string | null
  codiceIvaId: string
}

export interface CodiceIvaLetto {
  id: string
  codice: string
  /** Decimale come stringa con la scala della colonna (`22.00`). */
  aliquota: string
  natura: string | null
  attivo: boolean
}

export interface DatiPerProposta {
  /** Contratti del cliente NON eliminati (M4), di ogni stato: lo stato lo giudica il dominio. */
  contratti: ContrattoCandidato[]
  /** Elenchi di quei contratti, di ogni validita': la scelta la fa `proponiElenco`. */
  elenchi: ElencoLetto[]
  /** Righe `CER` del CER del movimento e righe `V`, solo degli elenchi validi alla data. */
  righe: RigaListinoLetta[]
  codiciIva: CodiceIvaLetto[]
}

export interface InputDatiPerProposta {
  cerCode: string
  /** `AAAA-MM-GG`. */
  movementDate: string
  clienteId: string | null
  /** Sede del produttore sul FIR: non serve alle query (la scelta del contratto e' del dominio). */
  sedeId: string | null
  /** Contratto scelto a mano: restringe la lettura a quel contratto. */
  contrattoId?: string
  /** Elenco scelto a mano: restringe gli elenchi letti a quello. */
  elencoId?: string
}

/**
 * Contratti, elenchi, righe e codici IVA per calcolare una proposta: quattro query, una per lista,
 * qualunque sia il numero di righe. Elenchi e righe si ricavano dal cliente con join (nessun
 * elenco di id da rimandare al database). Senza cliente non c'e' nulla da leggere.
 */
export async function leggiDatiPerProposta(
  tx: Prisma.TransactionClient,
  tenantId: string,
  i: InputDatiPerProposta
): Promise<DatiPerProposta> {
  if (i.clienteId === null) return { contratti: [], elenchi: [], righe: [], codiciIva: [] }
  const contrattoId = i.contrattoId ?? null
  const elencoId = i.elencoId ?? null
  const cifre = i.cerCode.replace(/\D/g, '')

  const contratti = await tx.$queryRaw<ContrattoCandidato[]>`
    SELECT c.id::text AS id, c.cliente_id::text AS "clienteId", c.stato::text AS stato,
           to_char(c.data_inizio, 'YYYY-MM-DD') AS "dataInizio",
           to_char(c.data_fine, 'YYYY-MM-DD') AS "dataFine", c.sede_id::text AS "sedeId"
    FROM contratti_cliente c
    WHERE c.tenant_id = ${tenantId}::uuid AND c.cliente_id = ${i.clienteId}::uuid
      AND c.eliminato_il IS NULL
      AND (${contrattoId}::uuid IS NULL OR c.id = ${contrattoId}::uuid)
    ORDER BY c.data_inizio, c.id`

  const elenchi = await tx.$queryRaw<ElencoLetto[]>`
    SELECT e.id::text AS id, e.contratto_id::text AS "contrattoId",
           to_char(e.valido_dal, 'YYYY-MM-DD') AS "validoDal",
           to_char(e.valido_al, 'YYYY-MM-DD') AS "validoAl", e.predefinito AS predefinito
    FROM elenchi_addebiti e
    JOIN contratti_cliente c ON c.id = e.contratto_id AND c.tenant_id = e.tenant_id
    WHERE e.tenant_id = ${tenantId}::uuid AND c.cliente_id = ${i.clienteId}::uuid
      AND c.eliminato_il IS NULL
      AND (${contrattoId}::uuid IS NULL OR c.id = ${contrattoId}::uuid)
      AND (${elencoId}::uuid IS NULL OR e.id = ${elencoId}::uuid)
    ORDER BY e.codice, e.id`

  const righe = await tx.$queryRaw<
    (Omit<RigaListinoLetta, 'tipoQuantita'> & { tipoQuantita: string | null })[]
  >`
    SELECT r.id::text AS id, r.elenco_id::text AS "elencoId", r.tipo AS tipo,
           r.cer_code AS "cerCode", r.riferimento AS riferimento,
           a.codice AS "addebitoCodice", COALESCE(r.cer_proposta, '{}')::text[] AS "cerProposta",
           COALESCE(r.addebiti_proposti, '{}')::text[] AS "addebitiProposti",
           r.tipo_quantita::text AS "tipoQuantita", r.unita_misura AS "unitaMisura",
           r.descrizione AS descrizione, r.prezzo::text AS prezzo,
           r.prezzo_speciale AS "prezzoSpeciale", r.sconto AS sconto,
           r.codice_iva_id::text AS "codiceIvaId"
    FROM righe_addebito r
    JOIN elenchi_addebiti e ON e.id = r.elenco_id AND e.tenant_id = r.tenant_id
    JOIN contratti_cliente c ON c.id = e.contratto_id AND c.tenant_id = e.tenant_id
    LEFT JOIN addebiti a ON a.id = r.addebito_id AND a.tenant_id = r.tenant_id
    WHERE r.tenant_id = ${tenantId}::uuid AND c.cliente_id = ${i.clienteId}::uuid
      AND c.eliminato_il IS NULL
      AND (${contrattoId}::uuid IS NULL OR c.id = ${contrattoId}::uuid)
      AND (${elencoId}::uuid IS NULL OR e.id = ${elencoId}::uuid)
      AND (e.valido_dal IS NULL OR e.valido_dal <= ${i.movementDate}::date)
      AND (e.valido_al IS NULL OR e.valido_al >= ${i.movementDate}::date)
      AND r.tipo IN ('CER', 'V')
      AND (r.tipo <> 'CER' OR ${cifre} = ''
           OR regexp_replace(COALESCE(r.cer_code, ''), '[^0-9]', '', 'g') = ${cifre})
    ORDER BY r.elenco_id, r.id`

  // Pochi id distinti (i codici IVA dell'azienda): `IN` su una sola tabella, lineare.
  const ivaIds = [...new Set(righe.map(r => r.codiceIvaId))]
  const codiciIva =
    ivaIds.length === 0
      ? []
      : await tx.$queryRaw<CodiceIvaLetto[]>`
          SELECT v.id::text AS id, v.codice AS codice, v.aliquota::text AS aliquota,
                 v.natura AS natura, v.attivo AS attivo
          FROM codici_iva v
          WHERE v.tenant_id = ${tenantId}::uuid
            AND v.id IN (${Prisma.join(ivaIds.map(id => Prisma.sql`${id}::uuid`))})
          ORDER BY v.id`

  return {
    contratti,
    elenchi,
    righe: righe.map(r => ({ ...r, tipoQuantita: r.tipoQuantita as TipoQuantita | null })),
    codiciIva,
  }
}

/**
 * Cliente proposto dal FIR (spec §6.2): `FIR.producerId` -> `Produttore.dittaId` -> `Cliente`
 * (azienda, ditta). Il cliente si restituisce anche se disattivato (`attivo=false`): lo giudica
 * `proponiCliente`. La sede e' quella del produttore sul FIR (`producerSedeId`), anche se il FIR
 * non porta a un cliente. FIR inesistente o di un'altra azienda: nessun cliente, nessuna sede.
 */
export async function clienteDaFir(
  tx: Prisma.TransactionClient,
  tenantId: string,
  firId: string
): Promise<{ cliente: ClienteDaFir | null; sedeId: string | null }> {
  const r = await tx.$queryRaw<
    { clienteId: string | null; attivo: boolean | null; sedeId: string | null }[]
  >`
    SELECT c.id::text AS "clienteId", c.attivo AS attivo, f.producer_sede_id::text AS "sedeId"
    FROM firs f
    LEFT JOIN produttori p ON p.id = f.producer_id AND p.tenant_id = f.tenant_id
    LEFT JOIN clienti c ON c.ditta_id = p.ditta_id AND c.tenant_id = f.tenant_id
    WHERE f.tenant_id = ${tenantId}::uuid AND f.id = ${firId}::uuid`
  if (r.length === 0) return { cliente: null, sedeId: null }
  const { clienteId, attivo, sedeId } = r[0]
  return {
    cliente: clienteId === null ? null : { id: clienteId, attivo: attivo === true },
    sedeId,
  }
}

/** Cliente con l'etichetta da mostrare (ragione sociale della ditta). */
export interface ClienteLetto {
  id: string
  attivo: boolean
  etichetta: string
}

/** Cliente dell'azienda per id (anche disattivato: lo giudica il chiamante); `null` se non c'e'. */
export async function leggiCliente(
  tx: Prisma.TransactionClient,
  tenantId: string,
  clienteId: string
): Promise<ClienteLetto | null> {
  const r = await tx.$queryRaw<ClienteLetto[]>`
    SELECT c.id::text AS id, c.attivo AS attivo, dt.ragione_sociale AS etichetta
    FROM clienti c
    JOIN ditte dt ON dt.id = c.ditta_id AND dt.tenant_id = c.tenant_id
    WHERE c.tenant_id = ${tenantId}::uuid AND c.id = ${clienteId}::uuid`
  return r[0] ?? null
}

/** Numero e descrizione dei contratti, codice e descrizione degli elenchi: per le etichette dei menu. */
export interface EtichetteListino {
  contratti: Map<string, string>
  elenchi: Map<string, string>
}

/**
 * Etichette dei contratti NON eliminati del cliente e dei loro elenchi: due query, una per
 * lista. Servono solo alla vista della proposta (`<numero> - <descrizione>`, `<codice> -
 * <descrizione>`), non alle regole.
 */
export async function leggiEtichetteListino(
  tx: Prisma.TransactionClient,
  tenantId: string,
  clienteId: string
): Promise<EtichetteListino> {
  const contratti = await tx.$queryRaw<{ id: string; numero: string; descrizione: string }[]>`
    SELECT c.id::text AS id, c.numero AS numero, c.descrizione AS descrizione
    FROM contratti_cliente c
    WHERE c.tenant_id = ${tenantId}::uuid AND c.cliente_id = ${clienteId}::uuid
      AND c.eliminato_il IS NULL`
  const elenchi = await tx.$queryRaw<{ id: string; codice: string; descrizione: string }[]>`
    SELECT e.id::text AS id, e.codice AS codice, e.descrizione AS descrizione
    FROM elenchi_addebiti e
    JOIN contratti_cliente c ON c.id = e.contratto_id AND c.tenant_id = e.tenant_id
    WHERE e.tenant_id = ${tenantId}::uuid AND c.cliente_id = ${clienteId}::uuid
      AND c.eliminato_il IS NULL`
  return {
    contratti: new Map(contratti.map(c => [c.id, `${c.numero} - ${c.descrizione}`])),
    elenchi: new Map(elenchi.map(e => [e.id, `${e.codice} - ${e.descrizione}`])),
  }
}

/** Esito del controllo delle scelte dell'utente: cio' che esiste davvero nell'azienda. */
export interface ScelteLette {
  contratto: { id: string; clienteId: string } | null
  elenco: { id: string; contrattoId: string; clienteId: string } | null
  righe: { id: string; elencoId: string }[]
}

/**
 * Cerca nell'azienda i contratto, elenco e righe scelti dall'utente, per distinguere «non c'e'»
 * (404) da «c'e' ma non e' di chi dice» (400): il confronto lo fa il servizio. Un contratto
 * eliminato non si trova. Liste di id con `JOIN unnest` (query lineare), mai `= ANY`.
 */
export async function leggiScelteProposta(
  tx: Prisma.TransactionClient,
  tenantId: string,
  s: { contrattoId?: string; elencoId?: string; righeIds?: readonly string[] }
): Promise<ScelteLette> {
  const contratto = s.contrattoId
    ? ((
        await tx.$queryRaw<{ id: string; clienteId: string }[]>`
          SELECT c.id::text AS id, c.cliente_id::text AS "clienteId" FROM contratti_cliente c
          WHERE c.tenant_id = ${tenantId}::uuid AND c.id = ${s.contrattoId}::uuid
            AND c.eliminato_il IS NULL`
      )[0] ?? null)
    : null
  const elenco = s.elencoId
    ? ((
        await tx.$queryRaw<{ id: string; contrattoId: string; clienteId: string }[]>`
          SELECT e.id::text AS id, e.contratto_id::text AS "contrattoId",
                 c.cliente_id::text AS "clienteId"
          FROM elenchi_addebiti e
          JOIN contratti_cliente c ON c.id = e.contratto_id AND c.tenant_id = e.tenant_id
          WHERE e.tenant_id = ${tenantId}::uuid AND e.id = ${s.elencoId}::uuid
            AND c.eliminato_il IS NULL`
      )[0] ?? null)
    : null
  const ids = [...new Set(s.righeIds ?? [])].sort()
  let righe: { id: string; elencoId: string }[] = []
  if (ids.length > 0) {
    await joinLineari(tx)
    righe = await tx.$queryRaw<{ id: string; elencoId: string }[]>`
      SELECT r.id::text AS id, r.elenco_id::text AS "elencoId" FROM righe_addebito r
      JOIN unnest(${ids}::uuid[]) AS chiesti(chiesto) ON chiesto = r.id
      WHERE r.tenant_id = ${tenantId}::uuid
      ORDER BY r.id`
  }
  return { contratto, elenco, righe }
}

/** Il FIR esiste nell'azienda (serve a distinguere «FIR senza cliente» da «FIR non trovato»). */
export async function firEsiste(
  tx: Prisma.TransactionClient,
  tenantId: string,
  firId: string
): Promise<boolean> {
  const r = await tx.$queryRaw<{ n: number }[]>`
    SELECT 1 AS n FROM firs WHERE tenant_id = ${tenantId}::uuid AND id = ${firId}::uuid`
  return r.length > 0
}

/** Dati del movimento VIGENTE di un legame, quelli che servono a ricalcolare la proposta. */
export interface MovimentoPerLegame {
  type: 'CARICO' | 'SCARICO'
  causale: string
  causaleAziendaId: string | null
  cerCode: string
  /** Giorno italiano `AAAA-MM-GG` (`sqlGiornoMovimento`). */
  giorno: string
  unit: string
  /** Decimale come stringa (`100.00`). */
  quantity: string
  firId: string | null
}

/** Il movimento (una sola riga, per id) da cui si ricalcola il legame; `null` se non c'e'. */
export async function leggiMovimentoPerLegame(
  tx: Prisma.TransactionClient,
  tenantId: string,
  movimentoId: string
): Promise<MovimentoPerLegame | null> {
  const r = await tx.$queryRaw<MovimentoPerLegame[]>`
    SELECT m.type::text AS type, m.causale AS causale,
           m.causale_azienda_id::text AS "causaleAziendaId", m.cer_code AS "cerCode",
           to_char(${sqlGiornoMovimento('m')}, 'YYYY-MM-DD') AS giorno, m.unit AS unit,
           m.quantity::text AS quantity, m.fir_id::text AS "firId"
    FROM waste_movements m
    WHERE m.tenant_id = ${tenantId}::uuid AND m.id = ${movimentoId}::uuid`
  return r[0] ?? null
}

/** Stato di un contratto dell'azienda, anche eliminato (il controllo lo fa il chiamante). */
export async function leggiStatoContratto(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contrattoId: string
): Promise<{ stato: string; eliminato: boolean } | null> {
  const r = await tx.$queryRaw<{ stato: string; eliminato: boolean }[]>`
    SELECT c.stato::text AS stato, (c.eliminato_il IS NOT NULL) AS eliminato
    FROM contratti_cliente c
    WHERE c.tenant_id = ${tenantId}::uuid AND c.id = ${contrattoId}::uuid`
  return r[0] ?? null
}

/** Validita' di un elenco di addebiti (`AAAA-MM-GG`, `null` = senza limite). */
export async function leggiValiditaElenco(
  tx: Prisma.TransactionClient,
  tenantId: string,
  elencoId: string
): Promise<{ validoDal: string | null; validoAl: string | null } | null> {
  const r = await tx.$queryRaw<{ validoDal: string | null; validoAl: string | null }[]>`
    SELECT to_char(e.valido_dal, 'YYYY-MM-DD') AS "validoDal",
           to_char(e.valido_al, 'YYYY-MM-DD') AS "validoAl"
    FROM elenchi_addebiti e
    WHERE e.tenant_id = ${tenantId}::uuid AND e.id = ${elencoId}::uuid`
  return r[0] ?? null
}
