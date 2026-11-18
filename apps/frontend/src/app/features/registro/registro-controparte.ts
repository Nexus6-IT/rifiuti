/**
 * Sede della ditta controparte scelta nel form del registro (D5). La scelta (dall'anagrafica dei
 * produttori o dal FIR collegato) compila nome e indirizzo e ricorda la sede; la sede vale solo
 * finche' nome e indirizzo restano quelli compilati dalla scelta. Se l'utente li modifica a mano,
 * la sede non si invia: il backend ripiega sul FIR e sul nome. Funzioni pure, senza Angular.
 */
export interface SceltaControparte {
  /** Sede della ditta scelta; assente se l'anagrafica o il FIR non la indicano. */
  sedeId?: string | null
  /** Nome e indirizzo compilati nel form al momento della scelta. */
  nome: string
  indirizzo: string
  /**
   * Da dove viene la sede: predefinita dell'anagrafica, FIR collegato, scelta esplicita dell'utente
   * nel selettore. Serve all'ordine di precedenza (utente > FIR > predefinita).
   */
  origine?: 'anagrafica' | 'fir' | 'utente'
}

/** Campi della sede della ditta usati per comporre l'indirizzo. */
export interface SedeIndirizzabile {
  id: string
  via: string
  civico: string
  cap: string
  citta: string
  provincia: string
}

/** Testo confrontabile: `trim`, spazi singoli, maiuscole ignorate. */
export function compattaTesto(t: string | null | undefined): string {
  return (t ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Sede da inviare con la registrazione: quella della scelta se nome e indirizzo correnti, compattati,
 * coincidono con quelli della scelta; altrimenti `undefined`.
 */
export function sedeControparteDaInviare(
  scelta: SceltaControparte | null,
  nome: string | null | undefined,
  indirizzo: string | null | undefined
): string | undefined {
  if (!scelta?.sedeId) return undefined
  const invariati =
    compattaTesto(nome) === compattaTesto(scelta.nome) &&
    compattaTesto(indirizzo) === compattaTesto(scelta.indirizzo)
  return invariati ? scelta.sedeId : undefined
}

/**
 * Scelta dopo la selezione di un produttore dall'anagrafica. Ordine di precedenza: scelta esplicita
 * dell'utente > sede del FIR > predefinita del produttore. Una sede gia' ricordata da FIR o utente
 * per la stessa ditta (stesso nome compattato) non viene scavalcata dalla predefinita; resta anche
 * il suo indirizzo (il chiamante lo riscrive nel form), cosi' la sede continua a valere.
 */
export function sceltaDaAnagrafica(
  corrente: SceltaControparte | null,
  nuova: { sedeId?: string | null; nome: string; indirizzo: string }
): SceltaControparte {
  const stessaDitta = !!corrente && compattaTesto(corrente.nome) === compattaTesto(nuova.nome)
  if (
    stessaDitta &&
    corrente.sedeId &&
    (corrente.origine === 'fir' || corrente.origine === 'utente')
  ) {
    return {
      sedeId: corrente.sedeId,
      nome: nuova.nome,
      // la sede resta e con lei il suo indirizzo (non quello della sede legale)
      indirizzo: corrente.indirizzo,
      origine: corrente.origine,
    }
  }
  return { ...nuova, origine: 'anagrafica' }
}

/** Indirizzo in stringa unica, nello stesso formato dell'indirizzo della sede legale. */
export function indirizzoDaSede(s: SedeIndirizzabile): string {
  const via = [s.via, s.civico].filter(Boolean).join(' ').trim()
  const comune = [s.cap, s.citta].filter(Boolean).join(' ').trim()
  const prov = s.provincia ? `(${s.provincia})` : ''
  return [via, comune, prov].filter(Boolean).join(', ').replace(', (', ' (')
}

/** Scelta esplicita dell'utente nel selettore: nome invariato, indirizzo della sede scelta. */
export function sceltaDaSedeScelta(nome: string, sede: SedeIndirizzabile): SceltaControparte {
  return { sedeId: sede.id, nome, indirizzo: indirizzoDaSede(sede), origine: 'utente' }
}
