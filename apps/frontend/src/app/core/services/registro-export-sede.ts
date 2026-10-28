import type { Movimento } from '../../features/registro/registro.service'
import type { RegistroExportMeta } from './export.service'

/**
 * Voci del campo "Filtri" nell'intestazione dell'export del registro: tipo, CER e, se
 * l'utente sta guardando una sola sede, quella sede.
 */
export function filtriRegistroExport(meta: RegistroExportMeta): string[] {
  const filtri: string[] = []
  if (meta.filtroTipo) filtri.push(`Tipo: ${meta.filtroTipo}`)
  if (meta.filtroCer) filtri.push(`CER: ${meta.filtroCer}`)
  if (meta.sede) filtri.push(`Sede: ${meta.sede}`)
  return filtri
}

/** La colonna "Sede" c'è solo se il chiamante fornisce l'etichetta (più registri, nessun filtro di sede). */
export function conColonnaSede(meta: RegistroExportMeta): boolean {
  return typeof meta.etichettaSede === 'function'
}

export function sedeDelMovimento(meta: RegistroExportMeta, m: Movimento): string {
  return meta.etichettaSede ? meta.etichettaSede(m) : ''
}
