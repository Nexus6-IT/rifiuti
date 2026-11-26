import { Routes } from '@angular/router';
import { autenticatoGuard } from './core/autenticato.guard';
import { AccessoPagina } from './pagine/accesso';
import { GiroPagina } from './pagine/giro';
import { LoginPagina } from './pagine/login';
import { RicevutaPagina } from './pagine/ricevuta';
import { RitiroPagina } from './pagine/ritiro';

export const routes: Routes = [
  { path: 'login', component: LoginPagina, title: 'Accesso · WasteFlow campo' },
  { path: 'accesso', component: AccessoPagina },
  {
    path: '',
    component: GiroPagina,
    canActivate: [autenticatoGuard],
    title: 'Giro · WasteFlow campo',
  },
  {
    path: 'ritiro/:id',
    component: RitiroPagina,
    canActivate: [autenticatoGuard],
    title: 'Ritiro · WasteFlow campo',
  },
  {
    path: 'ritiro/:id/ricevuta',
    component: RicevutaPagina,
    canActivate: [autenticatoGuard],
    title: 'Ricevuta · WasteFlow campo',
  },
  { path: '**', redirectTo: '' },
];
