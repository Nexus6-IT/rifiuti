import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output } from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { PeriodoFatturazione } from '../clienti/clienti.model'
import { ETICHETTE_FREQUENZA, FrequenzaPeriodi } from '../clienti/vocabolario-clienti'

const MAX_PERIODI = 12

const MESI_PER_FREQUENZA: Readonly<Record<FrequenzaPeriodi, number>> = {
  MENSILE: 1,
  BIMESTRALE: 2,
  TRIMESTRALE: 3,
  QUADRIMESTRALE: 4,
  SEMESTRALE: 6,
  ANNUALE: 12,
}

/** Giorni del mese in un anno non bisestile, come `periodiDaFrequenza` del backend (D10). */
const GIORNI_DEL_MESE = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Stessa generazione di `periodiDaFrequenza` (domain/contratti-cliente/periodi-fatturazione.ts). */
export function periodiDaFrequenza(f: FrequenzaPeriodi): PeriodoFatturazione[] {
  const passo = MESI_PER_FREQUENZA[f]
  const periodi: PeriodoFatturazione[] = []
  for (let mese = 1; mese <= 12; mese += passo) {
    const meseFine = mese + passo - 1
    periodi.push({
      giornoInizio: 1,
      meseInizio: mese,
      giornoFine: GIORNI_DEL_MESE[meseFine - 1],
      meseFine,
    })
  }
  return periodi
}

type Campo = keyof PeriodoFatturazione

/**
 * Periodi di fatturazione di un contratto (D10): fino a 12 intervalli giorno/mese. I pulsanti di
 * frequenza generano l'elenco, la tabella lo affina. Il frontend non valida (D20): sovrapposizioni
 * e date impossibili le rifiuta il backend col suo messaggio. Nessun periodo = si fattura a ogni
 * elaborazione.
 */
@Component({
  selector: 'app-periodi-fatturazione',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    <div class="frequenze" *ngIf="!disabled">
      <span>Genera:</span>
      <p-button
        *ngFor="let f of frequenze"
        [label]="f.label"
        [text]="true"
        size="small"
        (onClick)="genera(f.value)"
        [attr.data-testid]="'periodi-freq-' + f.value"
      />
    </div>
    <p *ngIf="periodi.length === 0" class="field-hint" data-testid="periodi-vuoto">
      Nessun periodo: il contratto si fattura a ogni elaborazione.
    </p>
    <table *ngIf="periodi.length > 0" class="periodi" aria-label="Periodi di fatturazione">
      <thead>
        <tr>
          <th scope="col">Dal (giorno)</th>
          <th scope="col">Dal (mese)</th>
          <th scope="col">Al (giorno)</th>
          <th scope="col">Al (mese)</th>
          <th scope="col"><span class="sr-only">Azioni</span></th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let p of periodi; let i = index">
          <td *ngFor="let c of campi">
            <input
              type="number"
              class="p-inputtext"
              min="1"
              [max]="c.max"
              [value]="p[c.campo]"
              [disabled]="disabled"
              (input)="cambia(i, c.campo, $any($event.target).value)"
              [attr.aria-label]="c.etichetta + ' del periodo ' + (i + 1)"
              [attr.data-testid]="'periodi-' + c.sigla + '-' + i"
            />
          </td>
          <td>
            <p-button
              *ngIf="!disabled"
              icon="pi pi-trash"
              [text]="true"
              severity="danger"
              size="small"
              (onClick)="rimuovi(i)"
              [ariaLabel]="'Rimuovi il periodo ' + (i + 1)"
              [attr.data-testid]="'periodi-rimuovi-' + i"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p-button
      *ngIf="!disabled"
      label="Aggiungi periodo"
      icon="pi pi-plus"
      [text]="true"
      size="small"
      [disabled]="periodi.length >= max"
      (onClick)="aggiungi()"
      data-testid="periodi-aggiungi"
    />
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .frequenze {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
        align-items: center;
      }
      .periodi {
        border-collapse: collapse;
      }
      .periodi th {
        text-align: left;
        font-weight: 600;
        font-size: 0.85rem;
        padding: 0 0.5rem 0.25rem 0;
      }
      .periodi td {
        padding: 0.15rem 0.5rem 0.15rem 0;
      }
      .periodi input {
        width: 5rem;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
    `,
  ],
})
export class PeriodiFatturazioneComponent {
  @Input() periodi: PeriodoFatturazione[] = []
  @Input() disabled = false
  @Output() periodiChange = new EventEmitter<PeriodoFatturazione[]>()

  readonly max = MAX_PERIODI
  readonly frequenze = (Object.keys(ETICHETTE_FREQUENZA) as FrequenzaPeriodi[]).map(value => ({
    value,
    label: ETICHETTE_FREQUENZA[value],
  }))
  readonly campi: { campo: Campo; sigla: string; etichetta: string; max: number }[] = [
    { campo: 'giornoInizio', sigla: 'gi', etichetta: 'Giorno di inizio', max: 31 },
    { campo: 'meseInizio', sigla: 'mi', etichetta: 'Mese di inizio', max: 12 },
    { campo: 'giornoFine', sigla: 'gf', etichetta: 'Giorno di fine', max: 31 },
    { campo: 'meseFine', sigla: 'mf', etichetta: 'Mese di fine', max: 12 },
  ]

  genera(f: FrequenzaPeriodi): void {
    if (this.disabled) return
    this.periodiChange.emit(periodiDaFrequenza(f))
  }

  aggiungi(): void {
    if (this.disabled || this.periodi.length >= MAX_PERIODI) return
    this.periodiChange.emit([
      ...this.periodi,
      { giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 12 },
    ])
  }

  rimuovi(i: number): void {
    if (this.disabled) return
    this.periodiChange.emit(this.periodi.filter((_, n) => n !== i))
  }

  /** Un campo svuotato vale 0 (data non valida): lo dirà il backend, non diventa NaN. */
  cambia(i: number, campo: Campo, testo: string): void {
    if (this.disabled) return
    const n = Number.parseInt(testo, 10)
    this.periodiChange.emit(
      this.periodi.map((p, k) => (k === i ? { ...p, [campo]: Number.isNaN(n) ? 0 : n } : p))
    )
  }
}
