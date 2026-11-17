import { Component, OnInit, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { DropdownModule } from 'primeng/dropdown'
import { RentriUnitaLocaleService } from '../rentri/rentri-unita-locale.service'
import { TracciatoConsorzioComponent } from './tracciato-consorzio.component'
import { ConsorzioTracciato } from './tracciati.model'

interface SedeScelta {
  id: string
  denominazione: string
}

/**
 * Comunicazioni ai consorzi a record, CONOU (oli usati) e COBAT (batterie) (4.9c-d): sede, periodo,
 * anteprima, file e manifest. Il file si carica a mano sul portale del consorzio.
 */
@Component({
  selector: 'app-comunicazioni-tracciati',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DropdownModule, TracciatoConsorzioComponent],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Comunicazioni CONOU e COBAT</h1>
          <p class="page-subtitle">
            File di movimento per il consorzio degli oli usati e per quello delle batterie, dai
            movimenti marcati nel registro
          </p>
        </div>
        <p-button
          label="O.R.SO."
          icon="pi pi-arrow-left"
          [text]="true"
          (onClick)="vaiAOrso()"
          data-testid="tracciati-vai-orso"
        ></p-button>
      </header>

      <section class="surface-card mb-4">
        <div class="flex flex-wrap gap-3 align-items-end">
          <div class="flex flex-column gap-1" *ngIf="sedi().length > 1">
            <label for="trc-sede">Sede</label>
            <p-dropdown
              inputId="trc-sede"
              [options]="sedi()"
              optionLabel="denominazione"
              optionValue="id"
              [ngModel]="unitaLocaleId()"
              (ngModelChange)="unitaLocaleId.set($event)"
              placeholder="Scegli la sede"
              data-testid="tracciati-sede"
            ></p-dropdown>
          </div>
          <div class="flex flex-column gap-1" *ngIf="sedi().length === 1">
            <span class="text-secondary">Sede</span>
            <strong data-testid="tracciati-sede-unica">{{ sedi()[0].denominazione }}</strong>
          </div>
          <div class="flex gap-2">
            <p-button
              *ngFor="let c of consorzi"
              [label]="c"
              [outlined]="consorzio() !== c"
              (onClick)="consorzio.set(c)"
              [attr.data-testid]="'tracciati-scegli-' + c"
            ></p-button>
          </div>
        </div>
      </section>

      <p *ngIf="errore()" role="alert" data-testid="tracciati-errore">{{ errore() }}</p>
      <p *ngIf="sedi().length === 0 && !errore()" class="text-secondary">
        Nessuna sede attiva: aggiungi un'unità locale in «Sedi RENTRI».
      </p>

      <app-tracciato-consorzio
        *ngIf="unitaLocaleId() as sede"
        [consorzio]="consorzio()"
        [unitaLocaleId]="sede"
      ></app-tracciato-consorzio>
    </div>
  `,
})
export class ComunicazioniTracciatiComponent implements OnInit {
  private readonly sediServizio = inject(RentriUnitaLocaleService)
  private readonly router = inject(Router)

  readonly consorzi: ConsorzioTracciato[] = ['CONOU', 'COBAT']
  readonly consorzio = signal<ConsorzioTracciato>('CONOU')
  readonly sedi = signal<SedeScelta[]>([])
  readonly unitaLocaleId = signal<string | null>(null)
  readonly errore = signal<string | null>(null)

  ngOnInit(): void {
    this.sediServizio.list().subscribe({
      next: elenco => {
        const attive = elenco
          .filter(s => s.attiva)
          .map(s => ({ id: s.id, denominazione: s.denominazione }))
        this.sedi.set(attive)
        if (attive.length === 1) this.unitaLocaleId.set(attive[0].id)
      },
      error: () => this.errore.set('Impossibile caricare le sedi.'),
    })
  }

  vaiAOrso(): void {
    void this.router.navigate(['/comunicazioni'])
  }
}
