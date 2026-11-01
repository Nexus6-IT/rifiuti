import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { Subscription } from 'rxjs'
import { AggiuntaInLinea } from '../clienti/aggiunta-in-linea'
import { CodificaContratto, ContrattoCliente } from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { Opzione } from '../clienti/opzioni-fatturazione'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import { CodificaDialogComponent } from '../clienti/tabelle/codifica-dialog.component'
import { messaggioErrore } from '../clienti/tabelle/tabella-comune'

const LUNGHEZZA_MASSIMA_MOTIVO = 255

/** Serve almeno uno fra il motivo codificato e il testo (D8: l'annullo vuole un motivo). */
function almenoUnMotivo(g: AbstractControl): ValidationErrors | null {
  const v = g.value as { motivoId: string; motivo: string }
  return v.motivoId || v.motivo.trim() ? null : { motivoMancante: true }
}

/**
 * Annullo di un contratto (definitivo): motivo codificato scelto fra quelli attivi, con "Nuovo
 * motivo" rapido in linea, e/o testo libero (si precompila con la descrizione del motivo scelto).
 * Manda `PATCH :id/stato` con la versione letta; a qualunque errore (409 compreso) chiude e
 * segnala `fallito`, così la lista mostra il messaggio e si ricarica.
 */
@Component({
  selector: 'app-annullo-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputTextareaModule,
    CodificaDialogComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="alCambioVisibilita($event)"
      [header]="'Annulla il contratto ' + (contratto?.numero ?? '')"
      [modal]="true"
      [style]="{ width: '32rem' }"
    >
      <form [formGroup]="form" (ngSubmit)="conferma()" class="dlg-form">
        <p>L'annullo è definitivo: il contratto non si riattiva più.</p>
        <label for="annullo-motivo">Motivo</label>
        <div class="riga">
          <p-dropdown
            inputId="annullo-motivo"
            [options]="motivi()"
            optionLabel="etichetta"
            optionValue="id"
            formControlName="motivoId"
            placeholder="Scegli un motivo"
            [showClear]="true"
            (onChange)="scegliMotivo($event.value)"
            (onClear)="scegliMotivo('')"
            ariaLabel="Motivo di annullo"
            styleClass="w-full"
            data-testid="annullo-motivo"
          />
          <p-button
            label="Nuovo motivo"
            icon="pi pi-plus"
            [text]="true"
            size="small"
            (onClick)="inLinea.apri('motivo', 'create', $any($event))"
            data-testid="annullo-nuovo-motivo"
          />
        </div>
        <label for="annullo-testo">Descrizione del motivo</label>
        <textarea
          pInputTextarea
          id="annullo-testo"
          formControlName="motivo"
          rows="3"
          [maxLength]="${LUNGHEZZA_MASSIMA_MOTIVO}"
          data-testid="annullo-testo"
        ></textarea>
        <p *ngIf="form.invalid" class="field-hint" role="status" data-testid="annullo-indicatore">
          Indica un motivo: scegline uno o scrivi il testo.
        </p>
      </form>
      <ng-template pTemplate="footer">
        <p-button
          label="Indietro"
          [text]="true"
          (onClick)="chiudi()"
          data-testid="annullo-indietro"
        />
        <p-button
          label="Annulla il contratto"
          icon="pi pi-times"
          severity="danger"
          [disabled]="form.invalid || inCorso()"
          (onClick)="conferma()"
          data-testid="annullo-conferma"
        />
      </ng-template>
    </p-dialog>
    <app-codifica-dialog
      [visible]="inLinea.aperto === 'motivo'"
      genere="MOTIVO_ANNULLO"
      [rapida]="true"
      (visibleChange)="chiudiSub($event)"
      (salvato)="dopoMotivo($event)"
    />
  `,
  styles: [
    `
      .dlg-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .riga {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .riga p-dropdown {
        flex: 1 1 auto;
        min-width: 0;
      }
    `,
  ],
})
export class AnnulloDialogComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ClientiService)
  private readonly tabelle = inject(TabelleFatturazioneService)

  @Input() visible = false
  @Input() contratto: ContrattoCliente | null = null
  @Output() annullato = new EventEmitter<ContrattoCliente>()
  /** Messaggio del backend (o ripiego): la lista lo mostra e si ricarica. */
  @Output() fallito = new EventEmitter<string>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly inLinea = new AggiuntaInLinea<'motivo'>()
  /** Motivi attivi; `etichetta` è la descrizione. */
  readonly motivi = signal<Opzione[]>([])
  readonly inCorso = signal(false)

  readonly form = new FormGroup(
    {
      motivoId: new FormControl('', { nonNullable: true }),
      motivo: new FormControl('', { nonNullable: true }),
    },
    { validators: almenoUnMotivo }
  )

  private lettura?: Subscription

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  ngOnDestroy(): void {
    this.lettura?.unsubscribe()
  }

  private inizializza(): void {
    this.form.reset({ motivoId: '', motivo: '' })
    this.inCorso.set(false)
    this.lettura?.unsubscribe()
    this.lettura = this.tabelle.codifiche.list('MOTIVO_ANNULLO').subscribe({
      next: elenco => this.motivi.set(elenco.map(m => ({ id: m.id, etichetta: m.descrizione }))),
      error: () => this.motivi.set([]),
    })
  }

  /** Scelto il codice il testo si precompila con la descrizione; svuotando il codice il testo resta. */
  scegliMotivo(id: string): void {
    this.form.controls.motivoId.setValue(id ?? '')
    const voce = this.motivi().find(m => m.id === id)
    if (voce) this.form.controls.motivo.setValue(voce.etichetta.slice(0, LUNGHEZZA_MASSIMA_MOTIVO))
  }

  dopoMotivo(nuovo: CodificaContratto): void {
    this.motivi.update(v => [...v, { id: nuovo.id, etichetta: nuovo.descrizione }])
    this.inLinea.salvato(nuovo, id => this.scegliMotivo(id), false)
  }

  chiudiSub(visibile: boolean): void {
    if (!visibile) this.inLinea.chiudi()
  }

  /** Esc nel sub-dialog non deve chiudere questo dialog né perdere il testo scritto. */
  alCambioVisibilita(visibile: boolean): void {
    if (!visibile && this.inLinea.bloccaChiusuraEsterna(visibile)) return
    if (!visibile) this.chiudi()
  }

  conferma(): void {
    const contratto = this.contratto
    if (!contratto || this.form.invalid || this.inCorso()) return
    const v = this.form.getRawValue()
    const motivo = v.motivo.trim()
    this.inCorso.set(true)
    this.servizio.contratti
      .cambiaStato(contratto.id, {
        stato: 'ANNULLATO',
        versione: contratto.versione,
        ...(v.motivoId ? { motivoAnnulloId: v.motivoId } : {}),
        ...(motivo ? { motivo } : {}),
      })
      .subscribe({
        next: aggiornato => {
          this.inCorso.set(false)
          this.annullato.emit(aggiornato)
          this.chiudi()
        },
        error: err => {
          this.inCorso.set(false)
          this.fallito.emit(messaggioErrore(err, 'Impossibile annullare il contratto.'))
          this.chiudi()
        },
      })
  }

  chiudi(): void {
    this.visibleChange.emit(false)
  }
}
