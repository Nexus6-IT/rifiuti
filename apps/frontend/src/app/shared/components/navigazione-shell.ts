/**
 * Voce attiva e titolo della shell, calcolati dal solo percorso (funzioni pure).
 * `percorso` e' il pathname senza query ne' frammento.
 */
export interface VoceShell {
  label: string
  route: string
}

/** Pagine raggiungibili ma senza voce nel menu: il titolo della barra sotto i 992 px viene da qui. */
export const TITOLI_FUORI_MENU: readonly VoceShell[] = [
  { label: 'Notifiche', route: '/notifications' },
  { label: 'Accesso non consentito', route: '/permissions/denied' },
  { label: 'Dashboard consulente', route: '/permissions/consultant-dashboard' },
  { label: 'Permessi', route: '/permissions' },
  { label: 'RENTRI', route: '/rentri' },
  { label: 'FIR', route: '/fir' },
  { label: 'Giacenze', route: '/giacenze' },
]

function corrisponde(percorso: string, rotta: string): boolean {
  return percorso === rotta || percorso.startsWith(rotta + '/')
}

/**
 * La rotta di menu con il prefisso piu' lungo per segmenti: `/clienti/fatturazione`
 * accende «Fatturazione da» e non «Clienti»; `/clientiX` non accende nulla.
 */
export function rottaVoceAttiva(percorso: string, rotte: readonly string[]): string | null {
  let migliore: string | null = null
  for (const rotta of rotte) {
    if (corrisponde(percorso, rotta) && (migliore === null || rotta.length > migliore.length)) {
      migliore = rotta
    }
  }
  return migliore
}

function etichettaDi(percorso: string, voci: readonly VoceShell[]): string | null {
  const rotta = rottaVoceAttiva(
    percorso,
    voci.map(v => v.route)
  )
  return voci.find(v => v.route === rotta)?.label ?? null
}

/** Titolo per la barra sotto i 992 px: prima il menu, poi le pagine fuori menu, infine «WasteFlow». */
export function titoloShell(percorso: string, voci: readonly VoceShell[]): string {
  return etichettaDi(percorso, voci) ?? etichettaDi(percorso, TITOLI_FUORI_MENU) ?? 'WasteFlow'
}
