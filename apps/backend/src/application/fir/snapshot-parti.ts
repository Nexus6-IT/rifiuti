/**
 * Snapshot anagrafici delle parti di un FIR, presi dal registro.
 *
 * Il FIR e' un documento legale: l'anagrafica va "congelata" come SNAPSHOT al momento della
 * creazione (o quando la parte cambia in una modifica della bozza), non referenziata dal vivo.
 * Funzioni condivise da creazione e modifica: stesso congelamento, stessi campi.
 */

import { ParteFIR, TipoTratta, TrattaTrasportoFIR } from '../../domain/fir/aggregates/fir.aggregate'
import { Produttore } from '../../domain/registry/entities/produttore'
import { Trasportatore } from '../../domain/registry/entities/trasportatore'
import { Destinatario } from '../../domain/registry/entities/destinatario'

export function snapshotProduttore(p: Produttore): ParteFIR {
  return {
    registroId: p.id,
    ragioneSociale: p.ragioneSociale,
    partitaIva: p.partitaIVA?.getValue() ?? '',
    indirizzo: p.sedeLegale.getFormatted(),
    contatto: p.pec || p.email || undefined,
  }
}

export function snapshotTrasportatore(t: Trasportatore): ParteFIR {
  return {
    registroId: t.id,
    ragioneSociale: t.ragioneSociale,
    partitaIva: t.partitaIVA?.getValue() ?? '',
    indirizzo: t.sedeLegale.getFormatted(),
    contatto: t.pec || t.email || undefined,
  }
}

export function snapshotDestinatario(d: Destinatario): ParteFIR {
  return {
    registroId: d.id,
    ragioneSociale: d.ragioneSociale,
    partitaIva: d.partitaIVA?.getValue() ?? '',
    indirizzo: d.sede.getFormatted(),
    contatto: d.pec || d.email || undefined,
  }
}

/**
 * Snapshot anagrafico immutabile di un trasportatore aggiuntivo (tratta
 * intermodale). Mezzo e data presa in carico restano vuoti alla creazione:
 * verranno valorizzati a runtime durante l'esecuzione del trasporto.
 */
export function snapshotTratta(
  t: Trasportatore,
  ordine: number,
  tipoTratta: TipoTratta
): TrattaTrasportoFIR {
  return {
    ordine,
    tipoTratta,
    trasportatoreId: t.id,
    denominazione: t.ragioneSociale,
    partitaIva: t.partitaIVA?.getValue() ?? '',
    numeroIscrizioneAlbo: t.numeroIscrizione,
  }
}
