import { Component, inject } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import { TabViewModule } from 'primeng/tabview'
import { map } from 'rxjs'
import { CondizioniPagamentoComponent } from './condizioni-pagamento.component'
import { ContiCorrentiComponent } from './conti-correnti.component'
import { SpeseAccessorieComponent } from './spese-accessorie.component'
import { RegistriIvaComponent } from './registri-iva.component'
import { TestiFatturazioneComponent } from './testi-fatturazione.component'
import { CodificheContrattoComponent } from './codifiche-contratto.component'
import { CodiciIvaTabComponent } from '../../listino/tabelle/codici-iva-tab.component'
import { CodificheAddebitoTabComponent } from '../../listino/tabelle/codifiche-addebito-tab.component'

/** Schede nell'ordine di D20. */
const SCHEDE = [
  'condizioni',
  'conti',
  'spese',
  'registri',
  'testi',
  'categorie',
  'motivi',
  'iva',
  'addebiti',
] as const

@Component({
  selector: 'app-tabelle-fatturazione',
  standalone: true,
  imports: [
    TabViewModule,
    CondizioniPagamentoComponent,
    ContiCorrentiComponent,
    SpeseAccessorieComponent,
    RegistriIvaComponent,
    TestiFatturazioneComponent,
    CodificheContrattoComponent,
    CodiciIvaTabComponent,
    CodificheAddebitoTabComponent,
  ],
  template: `
    <h1>Tabelle di fatturazione</h1>
    <p-tabView [scrollable]="true" [activeIndex]="indiceAttivo()" (onChange)="scegli($event.index)">
      <p-tabPanel header="Condizioni di pagamento">
        <ng-template pTemplate="content"><app-condizioni-pagamento /></ng-template>
      </p-tabPanel>
      <p-tabPanel header="Conti correnti">
        <ng-template pTemplate="content"><app-conti-correnti /></ng-template>
      </p-tabPanel>
      <p-tabPanel header="Spese e bollo">
        <ng-template pTemplate="content"><app-spese-accessorie /></ng-template>
      </p-tabPanel>
      <p-tabPanel header="Registri IVA">
        <ng-template pTemplate="content"><app-registri-iva /></ng-template>
      </p-tabPanel>
      <p-tabPanel header="Testi di fatturazione">
        <ng-template pTemplate="content"><app-testi-fatturazione /></ng-template>
      </p-tabPanel>
      <p-tabPanel header="Categorie e tipi">
        <ng-template pTemplate="content">
          <app-codifiche-contratto genere="CATEGORIA" />
          <app-codifiche-contratto genere="TIPO" />
        </ng-template>
      </p-tabPanel>
      <p-tabPanel header="Motivi di annullo">
        <ng-template pTemplate="content"
          ><app-codifiche-contratto genere="MOTIVO_ANNULLO"
        /></ng-template>
      </p-tabPanel>
      <p-tabPanel header="Codici IVA">
        <ng-template pTemplate="content"><app-codici-iva-tab /></ng-template>
      </p-tabPanel>
      <p-tabPanel header="Gruppi e categorie di addebito">
        <ng-template pTemplate="content"><app-codifiche-addebito-tab /></ng-template>
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
