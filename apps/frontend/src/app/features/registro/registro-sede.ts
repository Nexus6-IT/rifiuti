import { RegistroVista } from './registro.service'

/** "Sede di Milano (OP123)"; un registro non ancora legato a una sede è "Registro senza sede". */
export function etichettaRegistro(r: RegistroVista): string {
  if (!r.unitaLocaleId) return 'Registro senza sede'
  return r.numIscrSito ? `${r.denominazione} (${r.numIscrSito})` : r.denominazione
}

/**
 * Registro da usare quando l'utente non ne sceglie uno: quello della sede principale,
 * altrimenti l'unico attivo; con più registri e nessuna principale `undefined` (il form
 * obbliga a scegliere).
 */
export function registroPredefinito(registri: RegistroVista[]): string | undefined {
  const principale = registri.find(r => r.principale)
  if (principale) return principale.id
  const attivi = registri.filter(r => r.attivo)
  return attivi.length === 1 ? attivi[0].id : undefined
}
