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
    path: 'scostamenti',
    loadComponent: () =>
      import('./scostamenti/scostamenti.component').then(m => m.ScostamentiComponent),
  },
]
