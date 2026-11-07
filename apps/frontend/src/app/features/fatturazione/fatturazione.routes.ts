import { Routes } from '@angular/router'

/**
 * Rotte figlie di `/fatturazione`. Ogni task della 4.4c aggiunge le sue: `elaborazioni/:id`,
 * `documenti`, `documenti/:id`, `scostamenti`, `export-contabile/:adattatore`.
 */
export const FATTURAZIONE_ROUTES: Routes = [
  { path: '', redirectTo: 'elaborazioni', pathMatch: 'full' },
  {
    path: 'elaborazioni',
    loadComponent: () =>
      import('./elaborazioni/elaborazioni-lista.component').then(m => m.ElaborazioniListaComponent),
  },
  {
    path: 'elaborazioni/:id',
    loadComponent: () =>
      import('./elaborazioni/anteprima.component').then(m => m.AnteprimaComponent),
  },
  {
    path: 'documenti',
    loadComponent: () =>
      import('./documenti/documenti-lista.component').then(m => m.DocumentiListaComponent),
  },
  {
    path: 'documenti/:id',
    loadComponent: () =>
      import('./documenti/documento-dettaglio.component').then(m => m.DocumentoDettaglioComponent),
  },
  {
    path: 'export-contabile',
    loadComponent: () =>
      import('./export-contabile/mappature.component').then(m => m.MappatureComponent),
  },
  {
    path: 'export-contabile/:adattatore',
    loadComponent: () =>
      import('./export-contabile/mappature.component').then(m => m.MappatureComponent),
  },
]
