import { Route, Routes } from '@angular/router'
import { moduloGuard } from '../../core/guards/modulo.guard'

/** Le rotte figlie dichiarano il modulo anche se il padre `/fatturazione` è già protetto. */
const MODULO: Pick<Route, 'canActivate' | 'data'> = {
  canActivate: [moduloGuard],
  data: { modulo: 'contratti' },
}

/**
 * Rotte figlie di `/fatturazione`. Ogni task della 4.4c aggiunge le sue: `elaborazioni/:id`,
 * `documenti`, `documenti/:id`, `scostamenti`, `export-contabile/:adattatore`.
 */
export const FATTURAZIONE_ROUTES: Routes = [
  { path: '', redirectTo: 'elaborazioni', pathMatch: 'full' },
  {
    path: 'elaborazioni',
    ...MODULO,
    loadComponent: () =>
      import('./elaborazioni/elaborazioni-lista.component').then(m => m.ElaborazioniListaComponent),
  },
  {
    path: 'elaborazioni/:id',
    ...MODULO,
    loadComponent: () =>
      import('./elaborazioni/anteprima.component').then(m => m.AnteprimaComponent),
  },
  {
    path: 'scostamenti',
    ...MODULO,
    loadComponent: () =>
      import('./scostamenti/scostamenti.component').then(m => m.ScostamentiComponent),
  },
  {
    path: 'documenti',
    ...MODULO,
    loadComponent: () =>
      import('./documenti/documenti-lista.component').then(m => m.DocumentiListaComponent),
  },
  {
    path: 'documenti/:id',
    ...MODULO,
    loadComponent: () =>
      import('./documenti/documento-dettaglio.component').then(m => m.DocumentoDettaglioComponent),
  },
  {
    path: 'export-contabile',
    ...MODULO,
    loadComponent: () =>
      import('./export-contabile/mappature.component').then(m => m.MappatureComponent),
  },
  {
    path: 'export-contabile/:adattatore',
    ...MODULO,
    loadComponent: () =>
      import('./export-contabile/mappature.component').then(m => m.MappatureComponent),
  },
]
