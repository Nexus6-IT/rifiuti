// Controllo dei riferimenti alle tabelle di fatturazione e agli agenti, comune a clienti (Task 14) e
// contratti (Task 16-17): esistenza nell'azienda, stato attivo, tipo della spesa, genere della
// codifica, registro delle ricevute split (D3, D9, D24).
//
// Una query per tabella, con `SELECT ... FOR SHARE` (R24): le righe scelte restano bloccate fino al
// commit di chi le sceglie, cosi' una disattivazione o un cambio di tipo concorrenti aspettano (o
// falliscono) invece di lasciare un cliente con una spesa "bollo" diventata di incasso, cosa che la
// FK non vede. Nessun messaggio riporta id o dati.
import { Prisma } from '@prisma/client'
import { motivoRegistroNonUsabile } from '../../domain/clienti/registro-iva'

export interface RiferimentiDaControllare {
  condizionePagamentoId?: string | null
  contoCorrenteId?: string | null
  speseIncassoId?: string | null
  bolloId?: string | null
  registroIvaId?: string | null
  agenteId?: string | null
  testoFatturazioneId?: string | null
  categoriaId?: string | null
  tipoId?: string | null
  motivoAnnulloId?: string | null
}

const MSG_CONDIZIONE = 'La condizione di pagamento scelta non esiste o è disattivata.'
const MSG_CONTO = 'Il conto corrente scelto non esiste o è disattivato.'
const MSG_INCASSO =
  'La spesa di incasso scelta non esiste, è disattivata o non è una spesa di incasso.'
const MSG_BOLLO = 'La spesa di bollo scelta non esiste, è disattivata o non è una spesa di bollo.'
const MSG_AGENTE = "L'agente scelto non esiste o è disattivato."
const MSG_TESTO = 'Il testo di fatturazione scelto non esiste o è disattivato.'
const MSG_CATEGORIA = 'La categoria scelta non esiste o è disattivata.'
const MSG_TIPO = 'Il tipo di contratto scelto non esiste o è disattivato.'
const MSG_MOTIVO = 'Il motivo di annullo scelto non esiste o è disattivato.'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Riga = { id: string; attivo: boolean }
type RigaSpesa = Riga & { tipo: string }
type RigaRegistro = Riga & { ricevuteSplit: boolean }
type RigaCodifica = Riga & { genere: string }

const presente = (v: string | null | undefined): v is string => typeof v === 'string' && v !== ''

function indice<R extends { id: string }>(righe: R[]): Map<string, R> {
  return new Map(righe.map(r => [r.id.toLowerCase(), r]))
}

/**
 * Messaggi dei riferimenti non validi, nell'ordine dei campi di `RiferimentiDaControllare`.
 * Si passano solo i campi cambiati e non null: gli altri non si leggono. Va chiamata nella
 * transazione che poi scrive la riga, perche' i lock `FOR SHARE` durano fino al suo commit.
 */
export async function controllaRiferimenti(
  tx: Prisma.TransactionClient,
  tenantId: string,
  r: RiferimentiDaControllare
): Promise<string[]> {
  const ids = (...v: Array<string | null | undefined>) =>
    [...new Set(v.filter(presente).map(x => x.toLowerCase()))].filter(x => UUID.test(x))

  const idCondizione = ids(r.condizionePagamentoId)
  const idConto = ids(r.contoCorrenteId)
  const idSpese = ids(r.speseIncassoId, r.bolloId)
  const idRegistro = ids(r.registroIvaId)
  const idAgente = ids(r.agenteId)
  const idTesto = ids(r.testoFatturazioneId)
  const idCodifiche = ids(r.categoriaId, r.tipoId, r.motivoAnnulloId)

  const condizioni = idCondizione.length
    ? indice(
        await tx.$queryRaw<
          Riga[]
        >`SELECT id::text AS id, attiva AS attivo FROM "condizioni_pagamento"
          WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${idCondizione}::uuid[]) FOR SHARE`
      )
    : null
  const conti = idConto.length
    ? indice(
        await tx.$queryRaw<Riga[]>`SELECT id::text AS id, attivo FROM "conti_correnti"
          WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${idConto}::uuid[]) FOR SHARE`
      )
    : null
  const spese = idSpese.length
    ? indice(
        await tx.$queryRaw<RigaSpesa[]>`SELECT id::text AS id, attiva AS attivo, tipo::text AS tipo
          FROM "spese_accessorie"
          WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${idSpese}::uuid[]) FOR SHARE`
      )
    : null
  const registri = idRegistro.length
    ? indice(
        await tx.$queryRaw<RigaRegistro[]>`SELECT id::text AS id, attivo,
            ricevute_split AS "ricevuteSplit" FROM "registri_iva"
          WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${idRegistro}::uuid[]) FOR SHARE`
      )
    : null
  const agenti = idAgente.length
    ? indice(
        await tx.$queryRaw<Riga[]>`SELECT id::text AS id, attivo FROM "agenti"
          WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${idAgente}::uuid[]) FOR SHARE`
      )
    : null
  const testi = idTesto.length
    ? indice(
        await tx.$queryRaw<Riga[]>`SELECT id::text AS id, attivo FROM "testi_fatturazione"
          WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${idTesto}::uuid[]) FOR SHARE`
      )
    : null
  const codifiche = idCodifiche.length
    ? indice(
        await tx.$queryRaw<RigaCodifica[]>`SELECT id::text AS id, attiva AS attivo,
            genere::text AS genere FROM "codifiche_contratto"
          WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${idCodifiche}::uuid[]) FOR SHARE`
      )
    : null

  const cerca = <R2>(m: Map<string, R2> | null, v: string | null | undefined): R2 | null =>
    m && presente(v) ? (m.get(v.toLowerCase()) ?? null) : null

  const errori: string[] = []

  if (presente(r.condizionePagamentoId)) {
    if (!cerca(condizioni, r.condizionePagamentoId)?.attivo) errori.push(MSG_CONDIZIONE)
  }
  if (presente(r.contoCorrenteId)) {
    if (!cerca(conti, r.contoCorrenteId)?.attivo) errori.push(MSG_CONTO)
  }
  if (presente(r.speseIncassoId)) {
    const s = cerca(spese, r.speseIncassoId)
    if (!s?.attivo || s.tipo !== 'INCASSO') errori.push(MSG_INCASSO)
  }
  if (presente(r.bolloId)) {
    const s = cerca(spese, r.bolloId)
    if (!s?.attivo || s.tipo !== 'BOLLO') errori.push(MSG_BOLLO)
  }
  if (presente(r.registroIvaId)) {
    const motivo = motivoRegistroNonUsabile(cerca(registri, r.registroIvaId))
    if (motivo) errori.push(motivo)
  }
  if (presente(r.agenteId)) {
    if (!cerca(agenti, r.agenteId)?.attivo) errori.push(MSG_AGENTE)
  }
  if (presente(r.testoFatturazioneId)) {
    if (!cerca(testi, r.testoFatturazioneId)?.attivo) errori.push(MSG_TESTO)
  }
  const codifica = (id: string | null | undefined, genere: string, messaggio: string) => {
    if (!presente(id)) return
    const c = cerca(codifiche, id)
    if (!c?.attivo || c.genere !== genere) errori.push(messaggio)
  }
  codifica(r.categoriaId, 'CATEGORIA', MSG_CATEGORIA)
  codifica(r.tipoId, 'TIPO', MSG_TIPO)
  codifica(r.motivoAnnulloId, 'MOTIVO_ANNULLO', MSG_MOTIVO)

  return errori
}
