/** Solo ADMIN e SUPER_ADMIN impostano «fatturazione da» (spec §9). */
export const RUOLI_IMPOSTAZIONE_FATTURAZIONE: readonly string[] = ['SUPER_ADMIN', 'ADMIN']

export function puoImpostareFatturazione(role: string | null | undefined): boolean {
  return !!role && RUOLI_IMPOSTAZIONE_FATTURAZIONE.includes(role)
}

export interface PermessiLegami {
  /** Confermare, modificare, escludere, azioni di massa (anche prezzo e sconto di riga). */
  scrive: boolean
  /** «Aggiorna prezzi». */
  aggiornaPrezzi: boolean
  impostaFatturazione: boolean
}

/** Spec §9: VIEWER legge; OPERATOR scrive; ADMIN e SUPER_ADMIN anche «Aggiorna prezzi» e impostazioni. */
export function permessiLegami(role: string | null | undefined): PermessiLegami {
  const admin = puoImpostareFatturazione(role)
  return {
    scrive: admin || role === 'OPERATOR',
    aggiornaPrezzi: admin,
    impostaFatturazione: admin,
  }
}
