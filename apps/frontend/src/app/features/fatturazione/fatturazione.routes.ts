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
]
