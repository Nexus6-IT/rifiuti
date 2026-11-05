// Selezione e letture di un'elaborazione di fatturazione per periodo (fase 4.4b1, spec §5.2).
//
// SOLA LETTURA: nessun lock, nessuna scrittura (nemmeno su `waste_movements`: lo prova
// `guardia-registro.spec.ts`). Sceglie i contratti, i legami `CONFERMATO`, i listini, i marcatori e
// i dati del cliente e del cedente, e li trasforma negli ingressi di `calcolaDocumento`
// (`InputDocumento`) e nella fotografia dei dati fiscali (`FotografiaDocumento`).
//
// Il numero di query NON dipende dal numero di contratti o di legami: una query per insieme, tutte
// `= ANY(uuid[])` su una tabella sola (lezione della 4.3: mai un join su tutto il tenant, mai una
// query per documento). L'unica lettura larga e' il frammento `sqlCandidati` della 4.3, riusato
// senza copiarlo, che e' gia' limitato da «fatturazione da» e dalla fine del periodo.
import { Prisma } from '@prisma/client'
import type { StatoContrattoCliente } from '../../domain/contratti-cliente/regole-contratto-cliente'
import {
  contoCorrenteEffettivo,
  destinatarioEffettivo,
} from '../../domain/contratti-cliente/regole-contratto-cliente'
import {
  periodoDaFatturare,
  type PeriodoFatturazione,
} from '../../domain/contratti-cliente/periodi-fatturazione'
import type { Scaglione } from '../../domain/listino/prezzo-speciale'
import type { Scadenza } from '../../domain/listino/scadenze-fisse'
import type { ErroreGenerale, Segnalazione } from '../../domain/fatturazione/codici'
import { FORMA_MINIMO_CATEGORIA } from '../../domain/fatturazione/costanti-fiscali'
import { righeFisse, type MarcatoreEsistente } from '../../domain/fatturazione/righe-fisse'
import type { InputDocumento } from '../../domain/fatturazione/calcola-documento'
import { improntaElaborazione } from '../../domain/fatturazione/impronta'
import type { DatiBanca } from '../../domain/fatturazione/pagamento'
import type {
  CodiceIvaDaFatturare,
  FotografiaDocumento,
  RigaLegameDaFatturare,
  RigaListinoDaFatturare,
} from '../../domain/fatturazione/tipi'
import { normalizzaTesto } from '../../domain/fatturazione/xml/normalizza-testo'
import { leggiFatturazioneDaInTx } from '../legami-movimento/impostazioni-fatturazione.service'
import { sqlCandidati } from '../legami-movimento/lista-legami.service'
import { leggiCedenteVista, type CedenteVista } from './cedente.service'

export interface FiltriElaborazione {
  clienteIds?: string[]
  contrattoIds?: string[]
  categoriaIds?: string[]
  tipiAddebito?: string[]
  registroIvaIds?: string[]
}

export interface ParametriElaborazione {
  periodoDal: string
  periodoAl: string
  dataDocumento: string
  raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'
  includiArretrati: boolean
  filtri: FiltriElaborazione
}

export interface DocumentoSelezionato {
  /** `contrattoId` (PER_CONTRATTO) oppure `contrattoId:elencoId` (PER_ELENCO). Unica nella selezione. */
  chiave: string
  contrattoId: string
  contrattoNumero: string
  elencoId: string | null
  clienteId: string
  clienteFatturazioneId: string
  denominazione: string
  /** `null`: il Task 18 non ne fa una bozza e lo elenca in `documentiNonGenerati` (Q3). */
  registroIvaId: string | null
  periodo: { dal: string; al: string }
  input: InputDocumento
  fotografia: FotografiaDocumento
}

export interface SelezioneElaborazione {
  documenti: DocumentoSelezionato[]
  erroriGenerali: Segnalazione<ErroreGenerale>[]
  /**
   * Legami che aspettano un'azione (`DA_COLLEGARE`, `PROPOSTO`, `MANCANTE`, `DA_RIALLINEARE`) con
   * data nel periodo, per motivo e contratto; piu' i contratti con periodi ambigui (il motivo e'
   * il messaggio, `quanti` 1).
   */
  erroriPeriodo: { motivo: string; quanti: number; contrattoId: string | null }[]
  versioni: Parameters<typeof improntaElaborazione>[0]
}

// ---------------------------------------------------------------------------------------------
// Righe lette dal database (nomi di colonna come nelle query)
// ---------------------------------------------------------------------------------------------

interface ContrattoRiga {
  id: string
  versione: number
  numero: string
  stato: StatoContrattoCliente
  clienteId: string
  clienteFatturazioneId: string
  dataInizio: string
  dataFine: string | null
  condizionePagamentoId: string | null
  contoCorrenteId: string | null
  speseIncassoId: string | null
  bolloId: string | null
  registroIvaId: string | null
  testoFatturazioneId: string | null
  esigibilita: string
  ritenuta: string | null
  codiceDestinatario: string | null
  riferimentoAmministrazione: string | null
  cig: string | null
  cup: string | null
  idDocumentoPa: string | null
  principaleId: string | null
}

interface ElencoRiga {
  id: string
  versione: number
  contrattoId: string
  codice: string
  validoDal: string | null
  validoAl: string | null
  cig: string | null
  cup: string | null
  idDocumentoPa: string | null
}

interface RigaListinoSql {
  id: string
  versione: number
  elencoId: string
  tipo: string
  descrizione: string | null
  categoriaId: string | null
  unitaMisura: string
  prezzo: string | null
  quantitaFissa: string | null
  sconto: string | null
  prezzoSpeciale: boolean
  applicaA: string | null
  condizione: number | null
  condizioniRiferite: string | null
  periodoScadenze: string | null
  minimoFatturabile: string | null
  minimoPerCategoria: boolean
  codiceIvaId: string
}

interface ClienteRiga {
  id: string
  versione: number
  dittaId: string
  sedeId: string
  nome: string | null
  cognome: string | null
  codiceDestinatario: string | null
  pec: string | null
  riferimentoAmministrazione: string | null
  iban: string | null
  contoCorrenteId: string | null
  registroIvaId: string | null
}

interface DittaRiga {
  id: string
  ragioneSociale: string
  partitaIva: string | null
  codiceFiscale: string | null
}

interface SedeRiga {
  id: string
  via: string
  civico: string
  cap: string
  comune: string
  provincia: string
}

interface CandidatoRiga {
  legameId: string | null
  contrattoId: string | null
  clienteId: string | null
  giorno: string
  stato: 'CONFERMATO' | 'DA_RIALLINEARE' | 'PROPOSTO' | 'DA_COLLEGARE' | 'MANCANTE'
}

interface LegameRiga {
  id: string
  versione: number
  contrattoId: string
  elencoId: string
  movimentoVigenteId: string
  dataMovimento: string
}

interface RigaLegameSql {
  id: string
  legameId: string
  rigaAddebitoId: string
  tipo: string
  descrizione: string | null
  unitaMisura: string
  quantita: string | null
  prezzo: string | null
  prezzoSpeciale: boolean
  sconto: string | null
  codiceIvaId: string
  aliquotaIva: string
  naturaIva: string | null
}

interface MovimentoRiga {
  id: string
  quantita: string
  unita: string
  cerCode: string
  firId: string | null
}

interface SpesaRiga {
  id: string
  versione: number
  descrizione: string
  importo: string
  codiceIvaId: string | null
}

// ---------------------------------------------------------------------------------------------
// Funzioni di appoggio
// ---------------------------------------------------------------------------------------------

const FORMA_DATA = /^\d{4}-\d{2}-\d{2}$/

function validaData(nome: string, valore: string): void {
  const [a, m, g] = valore.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, g))
  const esiste =
    FORMA_DATA.test(valore) &&
    d.getUTCFullYear() === a &&
    d.getUTCMonth() === m - 1 &&
    d.getUTCDate() === g
  if (!esiste) throw new Error(`${nome}: atteso un giorno valido in forma AAAA-MM-GG.`)
}

const ESIGIBILITA: Readonly<Record<string, 'I' | 'D' | 'S'>> = {
  IMMEDIATA: 'I',
  DIFFERITA: 'D',
  SCISSIONE: 'S',
}

/** Id distinti, in ordine: le liste per `= ANY` non hanno doppioni. */
const distinti = (ids: Iterable<string | null | undefined>): string[] => [
  ...new Set([...ids].filter((x): x is string => typeof x === 'string')),
]

/** Testo normalizzato come lo vuole l'XML: vuoto = il campo obbligatorio dell'XSD resterebbe vuoto. */
const testo = (v: string | null | undefined, max = 255): string =>
  v === null || v === undefined ? '' : normalizzaTesto(v, max)

function raggruppa<T>(righe: readonly T[], chiave: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of righe) {
    const k = chiave(r)
    const l = m.get(k)
    if (l === undefined) m.set(k, [r])
    else l.push(r)
  }
  return m
}

function dentroIntervallo(
  validoDal: string | null,
  validoAl: string | null,
  p: { dal: string; al: string }
): boolean {
  return (validoDal === null || validoDal <= p.al) && (validoAl === null || validoAl >= p.dal)
}

/** Ripetitore di una query solo se la lista non e' vuota (altrimenti `[]` senza toccare il database). */
async function seNonVuota<T>(ids: readonly string[], q: () => Promise<T[]>): Promise<T[]> {
  return ids.length === 0 ? [] : q()
}

const vuotaVersioni = (
  parametri: ParametriElaborazione,
  cedente: { id: string; versione: number } | null
): SelezioneElaborazione['versioni'] => ({
  parametri,
  legami: [],
  contratti: [],
  elenchi: [],
  righeAddebito: [],
  codiciIva: [],
  clienti: [],
  condizioniPagamento: [],
  speseAccessorie: [],
  contiCorrenti: [],
  cedente,
  marcatori: [],
})

/** Una riga del listino «una volta sola» per documento (canoni e minimi di un allegato, Q6). */
const eUnaVolta = (tipo: string): boolean =>
  tipo === 'F' || tipo === 'MW' || tipo === 'MF' || FORMA_MINIMO_CATEGORIA.test(tipo)

type PeriodoEsito =
  | { esito: 'OK'; dal: string; al: string }
  | { esito: 'NESSUNO' }
  | { esito: 'ERRORE'; messaggio: string }

function periodoEffettivo(periodi: PeriodoFatturazione[], p: ParametriElaborazione): PeriodoEsito {
  const r = periodoDaFatturare(periodi, p.periodoDal, p.periodoAl)
  switch (r.esito) {
    case 'NESSUN_PERIODO':
      // Senza periodi di fatturazione vale l'intervallo digitato (spec §5.2, punto 2).
      return { esito: 'OK', dal: p.periodoDal, al: p.periodoAl }
    case 'NESSUNA_SCADENZA':
      return { esito: 'NESSUNO' }
    case 'ERRORE':
      return { esito: 'ERRORE', messaggio: r.messaggio }
    case 'PERIODO':
      return { esito: 'OK', dal: r.dal, al: r.al }
  }
}

interface ContrattoAttivo {
  c: ContrattoRiga
  periodo: { dal: string; al: string }
}

// ---------------------------------------------------------------------------------------------
// La selezione
// ---------------------------------------------------------------------------------------------

/**
 * Seleziona i documenti di un'elaborazione. Sola lettura, nessun lock: va chiamata dentro una
 * transazione nel contesto del tenant (RLS) e, per l'anteprima, in `REPEATABLE READ`.
 */
export async function selezionaElaborazione(
  tx: Prisma.TransactionClient,
  tenantId: string,
  p: ParametriElaborazione
): Promise<SelezioneElaborazione> {
  validaData('periodoDal', p.periodoDal)
  validaData('periodoAl', p.periodoAl)
  validaData('dataDocumento', p.dataDocumento)

  const erroriGenerali: Segnalazione<ErroreGenerale>[] = []
  const erroriPeriodo: SelezioneElaborazione['erroriPeriodo'] = []
  const f = p.filtri
  const lista = (v: string[] | undefined): string[] | null => (v && v.length > 0 ? v : null)
  const fClienti = lista(f.clienteIds)
  const fContratti = lista(f.contrattoIds)
  const fCategorie = lista(f.categoriaIds)
  const fTipi = lista(f.tipiAddebito)
  const fRegistri = lista(f.registroIvaIds)

  // 1. Cedente e «fatturazione da».
  const cedenteVista = await leggiCedenteVista(tx, tenantId)
  const cedenteVoce =
    cedenteVista.versione === 0 ? null : { id: tenantId, versione: cedenteVista.versione }
  const cedenteCompleto = cedenteVista.completo && cedenteNormalizzabile(cedenteVista)
  if (!cedenteCompleto) erroriGenerali.push({ codice: 'CEDENTE_INCOMPLETO' })

  const fatturazioneDa = await leggiFatturazioneDaInTx(tx, tenantId)
  if (fatturazioneDa === null) {
    // Fatturazione spenta: nessun movimento e' fatturabile.
    return {
      documenti: [],
      erroriGenerali,
      erroriPeriodo,
      versioni: vuotaVersioni(p, cedenteVoce),
    }
  }

  // 2. Contratti principali (stati ammessi, filtri per id), poi i loro periodi di fatturazione.
  const contratti = await tx.$queryRaw<ContrattoRiga[]>`
    SELECT c.id::text AS id, c.versione, c.numero, c.stato::text AS stato,
           c.cliente_id::text AS "clienteId",
           COALESCE(c.cliente_fatturazione_id, c.cliente_id)::text AS "clienteFatturazioneId",
           c.data_inizio::text AS "dataInizio", c.data_fine::text AS "dataFine",
           c.condizione_pagamento_id::text AS "condizionePagamentoId",
           c.conto_corrente_id::text AS "contoCorrenteId",
           c.spese_incasso_id::text AS "speseIncassoId", c.bollo_id::text AS "bolloId",
           c.registro_iva_id::text AS "registroIvaId",
           c.testo_fatturazione_id::text AS "testoFatturazioneId",
           c.esigibilita_iva::text AS esigibilita, c.ritenuta_percentuale::text AS ritenuta,
           c.codice_destinatario AS "codiceDestinatario",
           c.riferimento_amministrazione AS "riferimentoAmministrazione",
           c.codice_cig AS cig, c.codice_cup AS cup, c.id_documento_pa AS "idDocumentoPa",
           c.contratto_principale_id::text AS "principaleId"
    FROM contratti_cliente c
    WHERE c.tenant_id = ${tenantId}::uuid AND c.eliminato_il IS NULL
      AND c.contratto_principale_id IS NULL
      AND c.stato IN ('ATTIVO', 'SOSPESO', 'SOSPESO_MOVIMENTI')
      AND c.data_inizio <= ${p.periodoAl}::date
      ${fClienti ? Prisma.sql`AND c.cliente_id = ANY(${fClienti}::uuid[])` : Prisma.empty}
      ${fContratti ? Prisma.sql`AND c.id = ANY(${fContratti}::uuid[])` : Prisma.empty}
    ORDER BY c.numero, c.id`
  const contrattoIdsTutti = contratti.map(c => c.id)

  const periodiRighe = await seNonVuota(
    contrattoIdsTutti,
    () =>
      tx.$queryRaw<(PeriodoFatturazione & { contrattoId: string })[]>`
      SELECT contratto_id::text AS "contrattoId", giorno_inizio AS "giornoInizio",
             mese_inizio AS "meseInizio", giorno_fine AS "giornoFine", mese_fine AS "meseFine"
      FROM periodi_fatturazione_cliente
      WHERE tenant_id = ${tenantId}::uuid AND contratto_id = ANY(${contrattoIdsTutti}::uuid[])
      ORDER BY contratto_id, ordine`
  )
  const periodiPer = raggruppa(periodiRighe, r => r.contrattoId)

  // 3. Clienti di fatturazione, ditte e sedi (servono a registro, destinatario e cessionario).
  const clienteFattIds = distinti(contratti.map(c => c.clienteFatturazioneId))
  const clienti = await seNonVuota(
    clienteFattIds,
    () =>
      tx.$queryRaw<ClienteRiga[]>`
      SELECT id::text AS id, versione, ditta_id::text AS "dittaId", sede_id::text AS "sedeId",
             nome, cognome, codice_destinatario AS "codiceDestinatario",
             pec_fatturazione AS pec, riferimento_amministrazione AS "riferimentoAmministrazione",
             iban, conto_corrente_id::text AS "contoCorrenteId",
             registro_iva_id::text AS "registroIvaId"
      FROM clienti
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${clienteFattIds}::uuid[])`
  )
  const clientePerId = new Map(clienti.map(c => [c.id, c]))

  // Registro IVA effettivo (contratto -> cliente di fatturazione -> predefinito del cedente): il
  // primo valorizzato; se e' disattivato o manca il documento ha `registroIvaId` null.
  const registroScelto = (c: ContrattoRiga): string | null =>
    c.registroIvaId ??
    clientePerId.get(c.clienteFatturazioneId)?.registroIvaId ??
    cedenteVista.registroIvaPredefinitoId ??
    null

  // 4. Periodo effettivo e validita'; filtro per registro.
  const attivi: ContrattoAttivo[] = []
  const filtraSoloPerContratto = fCategorie !== null || fTipi !== null
  for (const c of contratti) {
    if (fRegistri !== null) {
      const r = registroScelto(c)
      if (r === null || !fRegistri.includes(r)) continue
    }
    const e = periodoEffettivo(periodiPer.get(c.id) ?? [], p)
    if (e.esito === 'NESSUNO') continue
    if (e.esito === 'ERRORE') {
      // Con un filtro per categoria o tipo non si sa se il contratto sarebbe entrato: si tace.
      if (!filtraSoloPerContratto) {
        erroriPeriodo.push({ motivo: e.messaggio, quanti: 1, contrattoId: c.id })
      }
      continue
    }
    const periodo = { dal: e.dal, al: e.al }
    // Validita' del contratto che interseca il periodo effettivo (spec §5.2, punto 1).
    if (c.dataInizio > periodo.al || (c.dataFine !== null && c.dataFine < periodo.dal)) continue
    attivi.push({ c, periodo })
  }
  const principaleIds = attivi.map(a => a.c.id)
  const periodoDelPrincipale = new Map(attivi.map(a => [a.c.id, a.periodo]))

  // 5. Allegati (stato ATTIVO e validita' che interseca il periodo del principale), poi elenchi.
  const allegatiRighe = await seNonVuota(
    principaleIds,
    () =>
      tx.$queryRaw<ContrattoRiga[]>`
      SELECT c.id::text AS id, c.versione, c.numero, c.stato::text AS stato,
             c.cliente_id::text AS "clienteId", c.cliente_id::text AS "clienteFatturazioneId",
             c.data_inizio::text AS "dataInizio", c.data_fine::text AS "dataFine",
             NULL::text AS "condizionePagamentoId", NULL::text AS "contoCorrenteId",
             NULL::text AS "speseIncassoId", NULL::text AS "bolloId", NULL::text AS "registroIvaId",
             NULL::text AS "testoFatturazioneId", c.esigibilita_iva::text AS esigibilita,
             NULL::text AS ritenuta, NULL::text AS "codiceDestinatario",
             NULL::text AS "riferimentoAmministrazione", NULL::text AS cig, NULL::text AS cup,
             NULL::text AS "idDocumentoPa", c.contratto_principale_id::text AS "principaleId"
      FROM contratti_cliente c
      WHERE c.tenant_id = ${tenantId}::uuid AND c.eliminato_il IS NULL AND c.stato = 'ATTIVO'
        AND c.contratto_principale_id = ANY(${principaleIds}::uuid[])
      ORDER BY c.numero, c.id`
  )
  const allegati = allegatiRighe.filter(a => {
    const per = periodoDelPrincipale.get(a.principaleId as string)
    return (
      per !== undefined && !(a.dataInizio > per.al || (a.dataFine !== null && a.dataFine < per.dal))
    )
  })
  const allegatiPer = raggruppa(allegati, a => a.principaleId as string)

  const contrattiConElenchi = distinti([...principaleIds, ...allegati.map(a => a.id)])
  const elenchiTutti = await seNonVuota(
    contrattiConElenchi,
    () =>
      tx.$queryRaw<ElencoRiga[]>`
      SELECT id::text AS id, versione, contratto_id::text AS "contrattoId", codice,
             valido_dal::text AS "validoDal", valido_al::text AS "validoAl",
             codice_cig AS cig, codice_cup AS cup, id_documento_pa AS "idDocumentoPa"
      FROM elenchi_addebiti
      WHERE tenant_id = ${tenantId}::uuid AND contratto_id = ANY(${contrattiConElenchi}::uuid[])
      ORDER BY codice, id`
  )
  const elenchiPerContratto = raggruppa(elenchiTutti, e => e.contrattoId)
  /** Elenchi validi nel periodo del principale (stessi per i suoi allegati), in ordine di codice. */
  const elenchiValidi = (contrattoId: string, per: { dal: string; al: string }): ElencoRiga[] =>
    (elenchiPerContratto.get(contrattoId) ?? []).filter(e =>
      dentroIntervallo(e.validoDal, e.validoAl, per)
    )

  // 6. Righe di listino degli elenchi validi, scaglioni e scadenze, categorie e codici IVA.
  const elenchiUsatiIds = distinti(
    attivi.flatMap(a =>
      [a.c.id, ...(allegatiPer.get(a.c.id) ?? []).map(x => x.id)].flatMap(cid =>
        elenchiValidi(cid, a.periodo).map(e => e.id)
      )
    )
  )
  const righeSql = await seNonVuota(
    elenchiUsatiIds,
    () =>
      tx.$queryRaw<RigaListinoSql[]>`
      SELECT id::text AS id, versione, elenco_id::text AS "elencoId", tipo, descrizione,
             categoria_id::text AS "categoriaId", unita_misura AS "unitaMisura",
             prezzo::text AS prezzo, quantita_fissa::text AS "quantitaFissa", sconto,
             prezzo_speciale AS "prezzoSpeciale", applica_a::text AS "applicaA", condizione,
             condizioni_riferite AS "condizioniRiferite", periodo_scadenze AS "periodoScadenze",
             minimo_fatturabile::text AS "minimoFatturabile",
             minimo_per_categoria AS "minimoPerCategoria", codice_iva_id::text AS "codiceIvaId"
      FROM righe_addebito
      WHERE tenant_id = ${tenantId}::uuid AND elenco_id = ANY(${elenchiUsatiIds}::uuid[])
      ORDER BY tipo, cer_code NULLS FIRST, riferimento NULLS FIRST, id`
  )
  const speciali = righeSql.filter(r => r.prezzoSpeciale).map(r => r.id)
  const conScadenze = righeSql.filter(r => r.tipo === 'F').map(r => r.id)
  const scaglioniRighe = await seNonVuota(
    speciali,
    () =>
      tx.$queryRaw<(Scaglione & { rigaId: string })[]>`
      SELECT riga_id::text AS "rigaId", ordine, fino_a::text AS "finoA", prezzo::text AS prezzo,
             sconto, provvigione, tipo_calcolo AS "tipoCalcolo"
      FROM scaglioni_riga_addebito
      WHERE tenant_id = ${tenantId}::uuid AND riga_id = ANY(${speciali}::uuid[])
      ORDER BY riga_id, ordine`
  )
  const scadenzeRighe = await seNonVuota(
    conScadenze,
    () =>
      tx.$queryRaw<(Scadenza & { rigaId: string })[]>`
      SELECT riga_id::text AS "rigaId", ordine, giorno, mese, anno::int AS anno
      FROM scadenze_riga_addebito
      WHERE tenant_id = ${tenantId}::uuid AND riga_id = ANY(${conScadenze}::uuid[])
      ORDER BY riga_id, ordine`
  )
  const scaglioniPer = raggruppa(scaglioniRighe, s => s.rigaId)
  const scadenzePer = raggruppa(scadenzeRighe, s => s.rigaId)

  const categoriaIds = distinti(righeSql.map(r => r.categoriaId))
  const categorie = await seNonVuota(
    categoriaIds,
    () =>
      tx.$queryRaw<{ id: string; codice: string }[]>`
      SELECT id::text AS id, codice FROM codifiche_addebito
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${categoriaIds}::uuid[])`
  )
  const codiceCategoria = new Map(categorie.map(c => [c.id, c.codice]))

  // 7. Condizioni, conti, spese e testi dei contratti; registri.
  const condizioneIds = distinti(attivi.map(a => a.c.condizionePagamentoId))
  const condizioni = await seNonVuota(
    condizioneIds,
    () =>
      tx.$queryRaw<
        {
          id: string
          versione: number
          codice: string
          descrizione: string
          modalita: string
          giorniRate: number[]
          fineMese: boolean
        }[]
      >`
      SELECT id::text AS id, versione, codice, descrizione, modalita, giorni_rate AS "giorniRate",
             fine_mese AS "fineMese"
      FROM condizioni_pagamento
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${condizioneIds}::uuid[])`
  )
  const condizionePerId = new Map(condizioni.map(c => [c.id, c]))

  const contoPer = new Map<string, string | null>() // contratto -> conto effettivo
  for (const a of attivi) {
    const cl = clientePerId.get(a.c.clienteFatturazioneId)
    contoPer.set(
      a.c.id,
      contoCorrenteEffettivo(
        { contoCorrenteId: a.c.contoCorrenteId },
        { contoCorrenteId: cl?.contoCorrenteId ?? null }
      )
    )
  }
  const contoIds = distinti(contoPer.values())
  const conti = await seNonVuota(
    contoIds,
    () =>
      tx.$queryRaw<
        { id: string; versione: number; banca: string; iban: string; bic: string | null }[]
      >`
      SELECT id::text AS id, versione, banca, iban, bic FROM conti_correnti
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${contoIds}::uuid[])`
  )
  const contoPerId = new Map(conti.map(c => [c.id, c]))

  const spesaIds = distinti(attivi.flatMap(a => [a.c.speseIncassoId, a.c.bolloId]))
  const spese = await seNonVuota(
    spesaIds,
    () =>
      tx.$queryRaw<SpesaRiga[]>`
      SELECT id::text AS id, versione, descrizione, importo::text AS importo,
             codice_iva_id::text AS "codiceIvaId"
      FROM spese_accessorie
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${spesaIds}::uuid[])`
  )
  const spesaPerId = new Map(spese.map(s => [s.id, s]))

  const testoIds = distinti(attivi.map(a => a.c.testoFatturazioneId))
  const testi = await seNonVuota(
    testoIds,
    () =>
      tx.$queryRaw<{ id: string; righe: string[] }[]>`
      SELECT id::text AS id, righe FROM testi_fatturazione
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${testoIds}::uuid[])`
  )
  const testoPerId = new Map(testi.map(t => [t.id, t.righe]))

  const registroIds = distinti([
    ...attivi.map(a => registroScelto(a.c)),
    cedenteVista.registroIvaPredefinitoId,
  ])
  const registri = await seNonVuota(
    registroIds,
    () =>
      tx.$queryRaw<{ id: string; attivo: boolean }[]>`
      SELECT id::text AS id, attivo FROM registri_iva
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${registroIds}::uuid[])`
  )
  const registroAttivo = new Map(registri.map(r => [r.id, r.attivo]))

  // 8. Ditte e sedi dei clienti di fatturazione.
  const dittaIds = distinti(clienti.map(c => c.dittaId))
  const sedeIds = distinti(clienti.map(c => c.sedeId))
  const ditte = await seNonVuota(
    dittaIds,
    () =>
      tx.$queryRaw<DittaRiga[]>`
      SELECT id::text AS id, ragione_sociale AS "ragioneSociale", partita_iva AS "partitaIva",
             codice_fiscale AS "codiceFiscale"
      FROM ditte WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${dittaIds}::uuid[])`
  )
  const sedi = await seNonVuota(
    sedeIds,
    () =>
      tx.$queryRaw<SedeRiga[]>`
      SELECT id::text AS id, via, civico, cap, comune, provincia FROM sedi_ditte
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${sedeIds}::uuid[])`
  )
  const dittaPerId = new Map(ditte.map(d => [d.id, d]))
  const sedePerId = new Map(sedi.map(s => [s.id, s]))

  // 9. Marcatori dei canoni (righe `F`) e codici IVA di tutto quello che e' stato letto.
  const marcatoriTutti = await seNonVuota(
    conScadenze,
    () =>
      tx.$queryRaw<MarcatoreEsistente[]>`
      SELECT riga_addebito_id::text AS "rigaAddebitoId", tipo::text AS tipo,
             chiave_competenza AS "chiaveCompetenza"
      FROM marcatori_addebiti_fatturati
      WHERE tenant_id = ${tenantId}::uuid AND riga_addebito_id = ANY(${conScadenze}::uuid[])
      ORDER BY riga_addebito_id, tipo, chiave_competenza`
  )
  const marcatoriPer = raggruppa(marcatoriTutti, m => m.rigaAddebitoId)

  // 10. Legami: il frammento della 4.3, senza copiarlo. Tutti i candidati fino alla fine del
  // periodo piu' largo (dall'inizio di «fatturazione da» in poi) e soltanto gli stati che
  // aspettano qualcosa: i fatturati restano fuori dalla query.
  const candidatiSql = sqlCandidati(tenantId, fatturazioneDa, {
    dal: null,
    al: p.periodoAl,
    clienteId: null,
    contrattoId: null,
    registroId: null,
    motivo: null,
  })
  const principaleSet = new Set(principaleIds)
  const candidatiTutti = await tx.$queryRaw<CandidatoRiga[]>`
    SELECT c.legame_id::text AS "legameId", c.contratto_id::text AS "contrattoId",
           c.cliente_id::text AS "clienteId", c.giorno::text AS giorno, c.stato_lista AS stato
    FROM (${candidatiSql}) c
    WHERE c.stato_lista IN ('CONFERMATO', 'DA_RIALLINEARE', 'PROPOSTO', 'DA_COLLEGARE', 'MANCANTE')`
  // Solo i legami dei nostri contratti (o senza contratto): il filtro sta qui e non nella query,
  // dove un `= ANY` su centinaia di id rallenta il piano generico (misurato).
  const candidati = candidatiTutti.filter(
    c => c.contrattoId === null || principaleSet.has(c.contrattoId as string)
  )

  // Dettagli dei soli legami CONFERMATO: legame, righe, movimento vigente e FIR.
  const confermatiIds = distinti(
    candidati.filter(c => c.stato === 'CONFERMATO').map(c => c.legameId)
  )
  const legamiRighe = await seNonVuota(
    confermatiIds,
    () =>
      tx.$queryRaw<LegameRiga[]>`
      SELECT id::text AS id, versione, contratto_id::text AS "contrattoId",
             elenco_id::text AS "elencoId", movimento_vigente_id::text AS "movimentoVigenteId",
             data_movimento::text AS "dataMovimento"
      FROM legami_movimento
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${confermatiIds}::uuid[])`
  )
  const righeLegameSql = await seNonVuota(
    confermatiIds,
    () =>
      tx.$queryRaw<RigaLegameSql[]>`
      SELECT id::text AS id, legame_id::text AS "legameId", riga_addebito_id::text AS "rigaAddebitoId",
             tipo, descrizione, unita_misura AS "unitaMisura", quantita::text AS quantita,
             prezzo::text AS prezzo, prezzo_speciale AS "prezzoSpeciale", sconto,
             codice_iva_id::text AS "codiceIvaId", aliquota_iva::text AS "aliquotaIva",
             natura_iva AS "naturaIva"
      FROM righe_legame_movimento
      WHERE tenant_id = ${tenantId}::uuid AND legame_id = ANY(${confermatiIds}::uuid[])
      ORDER BY legame_id, ordine`
  )
  const movimentoIds = distinti(legamiRighe.map(l => l.movimentoVigenteId))
  const movimenti = await seNonVuota(
    movimentoIds,
    () =>
      tx.$queryRaw<MovimentoRiga[]>`
      SELECT id::text AS id, quantity::text AS quantita, unit AS unita, cer_code AS "cerCode",
             fir_id::text AS "firId"
      FROM waste_movements
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${movimentoIds}::uuid[])`
  )
  const movimentoPerId = new Map(movimenti.map(m => [m.id, m]))
  const firIds = distinti(movimenti.map(m => m.firId))
  const firs = await seNonVuota(
    firIds,
    () =>
      tx.$queryRaw<{ id: string; numero: string | null }[]>`
      SELECT id::text AS id, fir_number AS numero FROM firs
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${firIds}::uuid[])`
  )
  const numeroFirPer = new Map(firs.map(x => [x.id, x.numero]))
  const legamePerId = new Map(legamiRighe.map(l => [l.id, l]))
  const righeLegamePer = raggruppa(righeLegameSql, r => r.legameId)

  // Codici IVA: righe di listino, righe dei legami e spese dei contratti.
  const ivaIds = distinti([
    ...righeSql.map(r => r.codiceIvaId),
    ...righeLegameSql.map(r => r.codiceIvaId),
    ...spese.map(s => s.codiceIvaId),
  ])
  const ivaRighe = await seNonVuota(
    ivaIds,
    () =>
      tx.$queryRaw<(CodiceIvaDaFatturare & { versione: number })[]>`
      SELECT id::text AS id, versione, aliquota::text AS aliquota, natura, descrizione
      FROM codici_iva
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ivaIds}::uuid[])`
  )
  const codiciIva = new Map<string, CodiceIvaDaFatturare>(ivaRighe.map(c => [c.id, c]))

  // Righe di listino nella forma del calcolo (stesso oggetto in tutti i documenti).
  const eAllegato = new Set(allegati.map(a => a.id))
  const contrattoDelElenco = new Map(elenchiTutti.map(e => [e.id, e.contrattoId]))
  const listinoPerElenco = new Map<string, RigaListinoDaFatturare[]>()
  for (const r of righeSql) {
    const iva = codiciIva.get(r.codiceIvaId)
    if (iva === undefined) continue // FK: non puo' mancare; difesa contro una lettura incoerente
    const riga: RigaListinoDaFatturare = {
      id: r.id,
      versione: r.versione,
      elencoId: r.elencoId,
      daAllegato: eAllegato.has(contrattoDelElenco.get(r.elencoId) as string),
      tipo: r.tipo,
      descrizione: r.descrizione,
      categoriaId: r.categoriaId,
      categoriaCodice: r.categoriaId === null ? null : (codiceCategoria.get(r.categoriaId) ?? null),
      unitaMisura: r.unitaMisura,
      prezzo: r.prezzo,
      quantitaFissa: r.quantitaFissa,
      sconto: r.sconto,
      prezzoSpeciale: r.prezzoSpeciale,
      applicaA: r.applicaA,
      condizione: r.condizione,
      condizioniRiferite: r.condizioniRiferite,
      scaglioni: (scaglioniPer.get(r.id) ?? []).map(({ rigaId: _r, ...s }) => s),
      scadenze: (scadenzePer.get(r.id) ?? []).map(({ rigaId: _r, ...s }) => s),
      periodoScadenze: r.periodoScadenze,
      minimoFatturabile: r.minimoFatturabile,
      minimoPerCategoria: r.minimoPerCategoria,
      codiceIva: iva,
    }
    const l = listinoPerElenco.get(r.elencoId)
    if (l === undefined) listinoPerElenco.set(r.elencoId, [riga])
    else l.push(riga)
  }

  // ---------------------------------------------------------------------------------------
  // Documenti: per ogni contratto, i legami, il listino, i valori effettivi, la fotografia.
  // ---------------------------------------------------------------------------------------
  const cedenteFoto = fotografiaCedente(cedenteVista)
  const documenti: DocumentoSelezionato[] = []
  const candidatiPerContratto = raggruppa(
    candidati.filter(c => c.contrattoId !== null),
    c => c.contrattoId as string
  )
  /** Una riga di errore del periodo per (motivo, contratto). */
  const conteggi = new Map<string, { motivo: string; quanti: number; contrattoId: string | null }>()
  const conta = (motivo: string, contrattoId: string | null): void => {
    const k = `${motivo}\u0000${contrattoId ?? ''}`
    const x = conteggi.get(k)
    if (x === undefined) conteggi.set(k, { motivo, quanti: 1, contrattoId })
    else x.quanti++
  }

  for (const { c, periodo } of attivi) {
    const principaleElenchi = elenchiValidi(c.id, periodo)
    const allegatiDelContratto = allegatiPer.get(c.id) ?? []
    const elenchiAllegati = allegatiDelContratto.flatMap(a => elenchiValidi(a.id, periodo))
    const righePrincipale = (e: ElencoRiga) => listinoPerElenco.get(e.id) ?? []
    const righeAllegati = elenchiAllegati.flatMap(e => listinoPerElenco.get(e.id) ?? [])

    // Filtri per categoria e per tipo di addebito (decisione 25): scelgono il contratto, il
    // documento resta intero. Servono righe di ciascun filtro, anche diverse fra loro.
    if (fCategorie !== null || fTipi !== null) {
      const tutte = [...principaleElenchi.flatMap(righePrincipale), ...righeAllegati]
      if (
        fCategorie !== null &&
        !tutte.some(r => r.categoriaId !== null && fCategorie.includes(r.categoriaId))
      ) {
        continue
      }
      if (fTipi !== null && !tutte.some(r => fTipi.includes(r.tipo))) continue
    }

    // Legami del contratto nell'intervallo di questo periodo.
    const delContratto = candidatiPerContratto.get(c.id) ?? []
    const finestraDal = p.includiArretrati ? null : periodo.dal
    const nellaFinestra = (g: string): boolean =>
      g <= periodo.al && (finestraDal === null || g >= finestraDal)
    let arretrati = 0
    let daCollegareEsclusi = 0
    const confermati: CandidatoRiga[] = []
    for (const k of delContratto) {
      if (k.stato === 'CONFERMATO') {
        if (k.giorno > periodo.al) continue
        if (k.giorno < periodo.dal) arretrati++
        if (nellaFinestra(k.giorno)) confermati.push(k)
      } else if (nellaFinestra(k.giorno)) {
        conta(k.stato, c.id)
        daCollegareEsclusi++
      }
    }

    // Documenti del contratto: uno, o uno per elenco del principale (Q6).
    const gruppi: (ElencoRiga | null)[] =
      p.raggruppamento === 'PER_ELENCO' && principaleElenchi.length > 0 ? principaleElenchi : [null]
    const legamiDelContratto = confermati
      .map(k => legamePerId.get(k.legameId as string))
      .filter((l): l is LegameRiga => l !== undefined)
    const elenchiValidiIds = new Set(principaleElenchi.map(e => e.id))

    const cl = clientePerId.get(c.clienteFatturazioneId)
    const ditta = cl === undefined ? undefined : dittaPerId.get(cl.dittaId)
    const sede = cl === undefined ? undefined : sedePerId.get(cl.sedeId)
    const cessionario = fotografiaCessionario(cl, ditta, sede)

    const registroId = registroScelto(c)
    const registroEffettivo =
      registroId !== null && registroAttivo.get(registroId) === true ? registroId : null

    const dest = destinatarioEffettivo(
      {
        codiceDestinatario: c.codiceDestinatario,
        riferimentoAmministrazione: c.riferimentoAmministrazione,
      },
      {
        codiceDestinatario: cl?.codiceDestinatario ?? null,
        riferimentoAmministrazione: cl?.riferimentoAmministrazione ?? null,
      }
    )
    const condizione =
      c.condizionePagamentoId === null ? undefined : condizionePerId.get(c.condizionePagamentoId)
    const contoId = contoPer.get(c.id) ?? null
    const conto = contoId === null ? undefined : contoPerId.get(contoId)
    const contoCedente: DatiBanca | null =
      conto === undefined ? null : { istituto: conto.banca, iban: conto.iban, bic: conto.bic }
    const bancaCliente: DatiBanca | null = cl?.iban
      ? { istituto: null, iban: cl.iban, bic: null }
      : null
    const spesaIncasso = c.speseIncassoId === null ? undefined : spesaPerId.get(c.speseIncassoId)
    const spesaBollo = c.bolloId === null ? undefined : spesaPerId.get(c.bolloId)
    const iva = (id: string | null | undefined): CodiceIvaDaFatturare | null =>
      id === null || id === undefined ? null : (codiciIva.get(id) ?? null)

    for (const [indice, elenco] of gruppi.entries()) {
      // Legami del documento: tutti (PER_CONTRATTO) o quelli dell'elenco; con PER_ELENCO i
      // legami di un elenco non valido nel periodo vanno nel documento del primo elenco.
      const legami = legamiDelContratto.filter(l =>
        elenco === null
          ? true
          : l.elencoId === elenco.id || (indice === 0 && !elenchiValidiIds.has(l.elencoId))
      )

      // Listino del documento (ordine: elenchi del principale, poi quelli degli allegati).
      const righeProprie =
        elenco === null ? principaleElenchi.flatMap(righePrincipale) : righePrincipale(elenco)
      const righeDegliAllegati =
        elenco === null || indice === 0
          ? righeAllegati
          : righeAllegati.filter(r => !eUnaVolta(r.tipo))
      const righeDoc = [...righeProprie, ...righeDegliAllegati]
      const listino = new Map<string, RigaListinoDaFatturare>(righeDoc.map(r => [r.id, r]))
      const fisse = righeDoc.filter(r => r.tipo === 'F')
      const quantita = righeDoc.filter(r => r.tipo === 'TT' || r.tipo === 'TF')
      const minimi = righeDoc.filter(
        r => r.tipo === 'MW' || r.tipo === 'MF' || FORMA_MINIMO_CATEGORIA.test(r.tipo)
      )
      const posizione = new Map([...listino.keys()].map((id, i) => [id, i + 1]))
      const marcatori = fisse.flatMap(r => marcatoriPer.get(r.id) ?? [])

      // Il documento esiste se c'e' qualcosa da fatturare: movimenti (non con SOSPESO_MOVIMENTI,
      // che fattura solo i fissi) o un canone/scadenza del periodo (anche incompleto).
      const esitoFissi = righeFisse({
        righe: fisse,
        periodo,
        contratto: { dataInizio: c.dataInizio, dataFine: c.dataFine },
        marcatori,
        numeroRiga: id => posizione.get(id) as number,
      })
      const haFissi = esitoFissi.righe.length > 0 || esitoFissi.errori.length > 0
      const haMovimenti = legami.length > 0 && c.stato !== 'SOSPESO_MOVIMENTI'
      if (!haMovimenti && !haFissi) continue

      const legamiDaFatturare: RigaLegameDaFatturare[] = legami
        .flatMap(l => {
          const mov = movimentoPerId.get(l.movimentoVigenteId)
          if (mov === undefined) return []
          return (righeLegamePer.get(l.id) ?? []).map(
            (r): RigaLegameDaFatturare => ({
              legameId: l.id,
              rigaLegameId: r.id,
              legameVersione: l.versione,
              elencoId: l.elencoId,
              movimentoVigenteId: l.movimentoVigenteId,
              dataMovimento: l.dataMovimento,
              quantitaMovimento: mov.quantita,
              unitaMovimento: mov.unita,
              cerCode: mov.cerCode,
              numeroFir: mov.firId === null ? null : (numeroFirPer.get(mov.firId) ?? null),
              rigaAddebitoId: r.rigaAddebitoId,
              tipo: r.tipo,
              descrizione: r.descrizione,
              unitaMisura: r.unitaMisura,
              quantita: r.quantita,
              prezzo: r.prezzo,
              prezzoSpeciale: r.prezzoSpeciale,
              sconto: r.sconto,
              codiceIvaId: r.codiceIvaId,
              aliquotaIva: r.aliquotaIva,
              naturaIva: r.naturaIva,
            })
          )
        })
        .sort(
          (a, b) =>
            a.dataMovimento.localeCompare(b.dataMovimento) || a.legameId.localeCompare(b.legameId)
        )

      // Dati PA: dell'elenco, se li ha, altrimenti del contratto.
      const cig = elenco?.cig ?? c.cig
      const cup = elenco?.cup ?? c.cup
      const idDocumento = elenco?.idDocumentoPa ?? c.idDocumentoPa

      const input: InputDocumento = {
        raggruppamento: p.raggruppamento,
        contratto: {
          id: c.id,
          versione: c.versione,
          stato: c.stato,
          dataInizio: c.dataInizio,
          dataFine: c.dataFine,
          esigibilita: ESIGIBILITA[c.esigibilita] ?? 'I',
          ritenutaPercentuale: c.ritenuta,
          condizione:
            condizione === undefined
              ? null
              : {
                  modalita: condizione.modalita,
                  giorniRate: condizione.giorniRate,
                  fineMese: condizione.fineMese,
                },
          contoCedente,
          bancaCliente,
          speseIncasso:
            spesaIncasso === undefined
              ? null
              : {
                  descrizione: spesaIncasso.descrizione,
                  importo: spesaIncasso.importo,
                  codiceIva: iva(spesaIncasso.codiceIvaId),
                },
          bollo:
            spesaBollo === undefined
              ? null
              : { importo: spesaBollo.importo, codiceIva: iva(spesaBollo.codiceIvaId) },
          registroIvaId: registroEffettivo,
          codiceDestinatario: dest.codiceDestinatario,
          pec: cl?.pec ?? null,
          cig,
          cup,
          idDocumento,
          clienteCompleto: cessionario.completo,
        },
        periodo,
        dataDocumento: p.dataDocumento,
        legami: legamiDaFatturare,
        listino,
        righeFisse: fisse,
        righeQuantita: quantita,
        minimi,
        marcatori,
        codiciIva,
        legamiDaCollegareEsclusi: daCollegareEsclusi,
        arretrati,
      }

      const foto: FotografiaDocumento = {
        cedente: cedenteFoto,
        cessionario: cessionario.foto,
        pagamento:
          condizione === undefined
            ? null
            : {
                codice: condizione.codice,
                descrizione: condizione.descrizione,
                modalita: condizione.modalita,
                giorniRate: condizione.giorniRate,
                fineMese: condizione.fineMese,
              },
        conto: contoCedente === null ? null : { ...contoCedente },
        testoFatturazione:
          c.testoFatturazioneId === null ? [] : (testoPerId.get(c.testoFatturazioneId) ?? []),
        cig,
        cup,
        idDocumento,
      }

      documenti.push({
        chiave: elenco === null ? c.id : `${c.id}:${elenco.id}`,
        contrattoId: c.id,
        contrattoNumero: c.numero,
        elencoId: elenco?.id ?? null,
        clienteId: c.clienteId,
        clienteFatturazioneId: c.clienteFatturazioneId,
        denominazione: cessionario.etichetta,
        registroIvaId: registroEffettivo,
        periodo,
        input,
        fotografia: foto,
      })
    }
  }

  // 11. Movimenti senza contratto (stessa finestra dell'intervallo digitato).
  const senzaContratto = filtraSenzaContratto(candidati, p, fClienti, {
    salta: fContratti !== null || fCategorie !== null || fTipi !== null || fRegistri !== null,
  })
  for (const k of senzaContratto) conta(k.stato, null)
  if (senzaContratto.length > 0) {
    erroriGenerali.push({
      codice: 'LEGAMI_SENZA_CONTRATTO',
      dettaglio: String(senzaContratto.length),
    })
  }
  erroriPeriodo.push(...conteggi.values())

  // 12. Ultima data del registro (senza lock): la definitiva la ricontrolla sotto lock.
  const registriUsati = distinti(documenti.map(d => d.registroIvaId))
  if (registriUsati.length > 0) {
    const anno = Number(p.dataDocumento.slice(0, 4))
    const anteriori = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM numerazioni_fattura
      WHERE tenant_id = ${tenantId}::uuid AND anno = ${anno}::smallint
        AND registro_iva_id = ANY(${registriUsati}::uuid[])
        AND ultima_data > ${p.dataDocumento}::date`
    if ((anteriori[0]?.n ?? 0) > 0) erroriGenerali.push({ codice: 'DATA_ANTERIORE_ULTIMA_FATTURA' })
  }

  // 13. Versioni per l'impronta (§5.3, estesa dalla Q4): cio' che il calcolo legge.
  const voce = <T extends { id: string; versione: number }>(righe: Iterable<T>) => {
    const m = new Map<string, { id: string; versione: number }>()
    for (const r of righe) m.set(r.id, { id: r.id, versione: r.versione })
    return [...m.values()]
  }
  const usati = {
    legami: new Set<string>(),
    contratti: new Set<string>(),
    elenchi: new Set<string>(),
    righe: new Set<string>(),
    clienti: new Set<string>(),
    condizioni: new Set<string>(),
    spese: new Set<string>(),
    conti: new Set<string>(),
    iva: new Set<string>(),
  }
  const marcatoriUsati = new Map<string, MarcatoreEsistente>()
  const contrattoPerId = new Map([...contratti, ...allegati].map(c => [c.id, c]))
  for (const d of documenti) {
    const c = contrattoPerId.get(d.contrattoId) as ContrattoRiga
    usati.contratti.add(c.id)
    for (const a of allegatiPer.get(c.id) ?? []) usati.contratti.add(a.id)
    usati.clienti.add(d.clienteFatturazioneId)
    if (c.condizionePagamentoId !== null) usati.condizioni.add(c.condizionePagamentoId)
    if (c.speseIncassoId !== null) usati.spese.add(c.speseIncassoId)
    if (c.bolloId !== null) usati.spese.add(c.bolloId)
    const conto = contoPer.get(c.id) ?? null
    if (conto !== null) usati.conti.add(conto)
    for (const l of d.input.legami) usati.legami.add(l.legameId)
    for (const r of d.input.listino.values()) {
      usati.righe.add(r.id)
      usati.elenchi.add(r.elencoId)
      usati.iva.add(r.codiceIva.id)
    }
    for (const l of d.input.legami) usati.iva.add(l.codiceIvaId)
    for (const id of [c.speseIncassoId, c.bolloId]) {
      const iv = id === null ? null : spesaPerId.get(id)?.codiceIvaId
      if (iv) usati.iva.add(iv)
    }
    for (const m of d.input.marcatori) {
      marcatoriUsati.set(`${m.rigaAddebitoId}|${m.tipo}|${m.chiaveCompetenza}`, m)
    }
  }
  const legamiVoci = voce(
    documenti
      .flatMap(d => d.input.legami)
      .map(l => ({ id: l.legameId, versione: l.legameVersione }))
  )

  return {
    documenti,
    erroriGenerali,
    erroriPeriodo,
    versioni: {
      parametri: p,
      legami: legamiVoci,
      contratti: voce([...contratti, ...allegati].filter(c => usati.contratti.has(c.id))),
      elenchi: voce(elenchiTutti.filter(e => usati.elenchi.has(e.id))),
      righeAddebito: voce(righeSql.filter(r => usati.righe.has(r.id))),
      codiciIva: voce(ivaRighe.filter(i => usati.iva.has(i.id))),
      clienti: voce(clienti.filter(x => usati.clienti.has(x.id))),
      condizioniPagamento: voce(condizioni.filter(x => usati.condizioni.has(x.id))),
      speseAccessorie: voce(spese.filter(x => usati.spese.has(x.id))),
      contiCorrenti: voce(conti.filter(x => usati.conti.has(x.id))),
      cedente: cedenteVoce,
      marcatori: [...marcatoriUsati.values()],
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Fotografia e controlli dei campi obbligatori dell'XML
// ---------------------------------------------------------------------------------------------

/**
 * Il serializzatore dell'XML lancia `CampoXmlObbligatorioVuotoError` se un campo obbligatorio
 * resta vuoto DOPO la normalizzazione: qui si controlla prima, cosi' un dato che non si puo'
 * emettere diventa un errore del documento (o del cedente) e non un'eccezione dopo la definitiva.
 */
function cedenteNormalizzabile(c: CedenteVista): boolean {
  const t = c.daTenant
  return (
    testo(t.ragioneSociale, 80) !== '' &&
    testo(t.partitaIva, 28) !== '' &&
    testo(t.indirizzo, 60) !== '' &&
    /^\d{5}$/.test((t.cap ?? '').trim()) &&
    testo(t.comune, 60) !== '' &&
    testo(c.regimeFiscale, 4) !== '' &&
    // `IscrizioneREA`: ufficio (sigla di due lettere) e numero insieme.
    (c.reaUfficio === null ||
      (/^[A-Za-z]{2}$/.test(c.reaUfficio.trim()) && testo(t.numeroRea, 20) !== ''))
  )
}

function fotografiaCedente(c: CedenteVista): FotografiaDocumento['cedente'] {
  const t = c.daTenant
  return {
    denominazione: t.ragioneSociale,
    partitaIva: t.partitaIva ?? '',
    codiceFiscale: t.codiceFiscale,
    regimeFiscale: c.regimeFiscale ?? '',
    sede: {
      indirizzo: t.indirizzo ?? '',
      cap: t.cap ?? '',
      comune: t.comune ?? '',
      provincia: t.provincia,
      nazione: 'IT',
    },
    rea:
      c.reaUfficio === null
        ? null
        : {
            ufficio: c.reaUfficio,
            numero: t.numeroRea ?? '',
            capitaleSociale: c.capitaleSociale,
            socioUnico: c.socioUnico,
            statoLiquidazione: c.statoLiquidazione,
          },
    idTrasmittente: c.idTrasmittenteCodice ?? t.partitaIva ?? '',
  }
}

function fotografiaCessionario(
  cl: ClienteRiga | undefined,
  ditta: DittaRiga | undefined,
  sede: SedeRiga | undefined
): {
  foto: FotografiaDocumento['cessionario']
  completo: { datiFiscali: boolean; sede: boolean }
  etichetta: string
} {
  const nome = (cl?.nome ?? '').trim()
  const cognome = (cl?.cognome ?? '').trim()
  const persona = nome !== '' && cognome !== ''
  const ragioneSociale = ditta?.ragioneSociale ?? ''
  const partitaIva = (ditta?.partitaIva ?? '').trim()
  const codiceFiscale = (ditta?.codiceFiscale ?? '').trim()
  const indirizzo =
    sede === undefined ? '' : [sede.via, sede.civico].filter(x => x.trim() !== '').join(' ')
  const anagraficaOk = persona
    ? testo(nome, 60) !== '' && testo(cognome, 60) !== ''
    : testo(ragioneSociale, 80) !== ''
  const datiFiscali = anagraficaOk && (testo(partitaIva, 28) !== '' || codiceFiscale !== '')
  const sedeOk =
    sede !== undefined &&
    testo(indirizzo, 60) !== '' &&
    /^\d{5}$/.test(sede.cap.trim()) &&
    testo(sede.comune, 60) !== ''
  return {
    foto: {
      denominazione: persona ? null : ragioneSociale,
      nome: persona ? nome : null,
      cognome: persona ? cognome : null,
      partitaIva: partitaIva === '' ? null : partitaIva,
      codiceFiscale: codiceFiscale === '' ? null : codiceFiscale,
      sede: {
        indirizzo,
        cap: sede?.cap ?? '',
        comune: sede?.comune ?? '',
        provincia: sede?.provincia ?? null,
        nazione: 'IT',
      },
    },
    completo: { datiFiscali, sede: sedeOk },
    etichetta: persona ? `${nome} ${cognome}` : ragioneSociale,
  }
}

/**
 * Movimenti dell'intervallo digitato senza contratto (nessun legame, legami senza contratto):
 * non hanno un periodo effettivo, quindi vale l'intervallo richiesto (dall'inizio di «fatturazione
 * da» con gli arretrati). Se i filtri escludono un cliente non si sa a chi appartengano: con un
 * filtro diverso da quello per cliente non si riportano.
 */
function filtraSenzaContratto(
  candidati: readonly CandidatoRiga[],
  p: ParametriElaborazione,
  clienti: string[] | null,
  opz: { salta: boolean }
): CandidatoRiga[] {
  if (opz.salta) return []
  return candidati.filter(
    k =>
      k.contrattoId === null &&
      k.stato !== 'CONFERMATO' &&
      k.giorno <= p.periodoAl &&
      (p.includiArretrati || k.giorno >= p.periodoDal) &&
      (clienti === null || (k.clienteId !== null && clienti.includes(k.clienteId)))
  )
}
