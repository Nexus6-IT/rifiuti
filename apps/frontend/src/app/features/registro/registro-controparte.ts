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
