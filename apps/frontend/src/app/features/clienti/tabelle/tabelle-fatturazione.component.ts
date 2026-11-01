import { Component, inject } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import { TabViewModule } from 'primeng/tabview'
import { map } from 'rxjs'
import { CondizioniPagamentoComponent } from './condizioni-pagamento.component'
import { ContiCorrentiComponent } from './conti-correnti.component'
import { SpeseAccessorieComponent } from './spese-accessorie.component'

/** Schede nell'ordine di D20 (le altre arrivano con il Task 22). */
const SCHEDE = ['condizioni', 'conti', 'spese'] as const

@Component({
  selector: 'app-tabelle-fatturazione',
  standalone: true,
  imports: [
    TabViewModule,
    CondizioniPagamentoComponent,
    ContiCorrentiComponent,
    SpeseAccessorieComponent,
  ],
  template: `
    <h1>Tabelle di fatturazione</h1>
    <p-tabView [activeIndex]="indiceAttivo()" (onChange)="scegli($event.index)">
      <p-tabPanel header="Condizioni di pagamento">
        <ng-template pTemplate="content"><app-condizioni-pagamento /></ng-template>
      </p-tabPanel>
      <p-tabPanel header="Conti correnti">
        <ng-template pTemplate="content"><app-conti-correnti /></ng-template>
      </p-tabPanel>
      <p-tabPanel header="Spese e bollo">
        <ng-template pTemplate="content"><app-spese-accessorie /></ng-template>
      </p-tabPanel>
    </p-tabView>
  `,
})
export class TabelleFatturazioneComponent {
  private readonly route = inject(ActivatedRoute)
  private readonly router = inject(Router)

  readonly indiceAttivo = toSignal(
    this.route.queryParamMap.pipe(
      map(p => Math.max(0, SCHEDE.indexOf((p.get('scheda') ?? '') as (typeof SCHEDE)[number])))
    ),
    { initialValue: 0 }
  )

  scegli(indice: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { scheda: SCHEDE[indice] ?? SCHEDE[0] },
      queryParamsHandling: 'merge',
    })
  }
}
