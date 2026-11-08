import { CommonModule } from '@angular/common'
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { Subscription } from 'rxjs'
import { MESSAGGIO_CONCORRENTE, naturaConflitto } from './errori-azione'
import { messaggiErrore } from './listino-calcoli'
import { ElencoAddebiti, NuovoElenco } from './listino.model'
import { ListinoService } from './listino.service'
import { CampoDataComponent } from '../../shared/components/campo-data.component'

interface ModuloElenco {
  codice: string
  descrizione: string
  nota1: string
  nota2: string
  validoDal: string
  validoAl: string
  predefinito: boolean
  codiceCig: string
  codiceCup: string
  idDocumentoPa: string
  dataDocumentoPa: string
}

const vuoto = (): ModuloElenco => ({
  codice: '',
  descrizione: '',
  nota1: '',
  nota2: '',
  validoDal: '',
  validoAl: '',
  predefinito: false,
  codiceCig: '',
  codiceCup: '',
  idDocumentoPa: '',
  dataDocumentoPa: '',
})

const vuotoNull = (v: string): string | null => (v.trim() === '' ? null : v.trim())

/**
 * Nuovo elenco o modifica. Il backend è l'arbitro: i suoi messaggi si mostrano uno per riga. Un
 * 409 (versione superata, contratto annullato nel frattempo) mostra il messaggio con "Ricarica":
 * la pagina rilegge gli elenchi e il dialog si chiude, così la modifica riparte dalla versione nuova.
 */
@Component({
  selector: 'app-elenco-dialog',
  standalone: true,
  imports: [
    CampoDataComponent,
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="chiudi()"
      [modal]="true"
      [style]="{ width: '40rem', maxWidth: '95vw' }"
      [header]="elenco ? 'Modifica elenco' : 'Nuovo elenco'"
      [closable]="!inCorso()"
    >
      <form class="modulo" (ngSubmit)="salva()" id="listino-elenco-form">
        <label for="el-codice">Codice</label>
        <input pInputText id="el-codice" name="codice" maxlength="3" [(ngModel)]="modulo.codice" />
        <label for="el-descrizione">Descrizione</label>
        <input
          pInputText
          id="el-descrizione"
          name="descrizione"
          maxlength="45"
          [(ngModel)]="modulo.descrizione"
          required
        />
        <label for="el-nota1">Nota 1</label>
        <input pInputText id="el-nota1" name="nota1" maxlength="45" [(ngModel)]="modulo.nota1" />
        <label for="el-nota2">Nota 2</label>
        <input pInputText id="el-nota2" name="nota2" maxlength="45" [(ngModel)]="modulo.nota2" />
        <label for="el-dal">Valido dal</label>
        <app-campo-data inputId="el-dal" name="dal" [(ngModel)]="modulo.validoDal" [piena]="true" />
        <label for="el-al">Valido al</label>
        <app-campo-data inputId="el-al" name="al" [(ngModel)]="modulo.validoAl" [piena]="true" />
        <label for="el-cig">CIG</label>
        <input pInputText id="el-cig" name="cig" maxlength="10" [(ngModel)]="modulo.codiceCig" />
        <label for="el-cup">CUP</label>
        <input pInputText id="el-cup" name="cup" maxlength="15" [(ngModel)]="modulo.codiceCup" />
        <label for="el-idpa">Id documento PA</label>
        <input pInputText id="el-idpa" name="idpa" [(ngModel)]="modulo.idDocumentoPa" />
        <label for="el-datapa">Data documento PA</label>
        <app-campo-data
          inputId="el-datapa"
          name="datapa"
          [(ngModel)]="modulo.dataDocumentoPa"
          [piena]="true"
        />
        <label class="spunta" for="el-predefinito">
          <input
            type="checkbox"
            id="el-predefinito"
            name="predefinito"
            [(ngModel)]="modulo.predefinito"
            data-testid="listino-elenco-predefinito"
          />
          Elenco predefinito
        </label>
      </form>
      <p *ngIf="avviso() as a" role="status" class="field-hint" data-testid="listino-elenco-avviso">
        {{ a }}
      </p>
      <ul
        *ngIf="errori().length > 0"
        role="alert"
        class="field-error"
        data-testid="listino-elenco-errore"
      >
        <li *ngFor="let m of errori()">{{ m }}</li>
      </ul>
      <ng-template pTemplate="footer">
        <p-button
          *ngIf="conflitto()"
          label="Ricarica"
          icon="pi pi-refresh"
          [outlined]="true"
          (onClick)="ricarica.emit()"
          data-testid="listino-elenco-ricarica"
        />
        <p-button label="Annulla" [text]="true" [disabled]="inCorso()" (onClick)="chiudi()" />
        <p-button
          label="Salva"
          icon="pi pi-check"
          [disabled]="inCorso() || modulo.descrizione.trim() === ''"
          (onClick)="salva()"
          data-testid="listino-elenco-salva"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .modulo {
        display: grid;
        grid-template-columns: 10rem 1fr;
        gap: 0.5rem 0.75rem;
        align-items: center;
      }
      .spunta {
        display: inline-flex;
        gap: 0.4rem;
        align-items: center;
      }
    `,
  ],
})
export class ElencoDialogComponent implements OnChanges {
  private readonly servizio = inject(ListinoService)
  private readonly distrutto = inject(DestroyRef)

  @Input() visible = false
  /** VIEWER o contratto annullato (D16): `salva` non scrive, il backend resta l'arbitro. */
  @Input() soloLettura = false
  @Input({ required: true }) contrattoId = ''
  /** null = nuovo. */
  @Input() elenco: ElencoAddebiti | null = null
  @Output() visibleChange = new EventEmitter<boolean>()
  @Output() salvato = new EventEmitter<ElencoAddebiti>()
  /** "Ricarica" dopo un 409: la pagina rilegge e chiude il dialog. */
  @Output() ricarica = new EventEmitter<void>()

  modulo: ModuloElenco = vuoto()
  readonly errori = signal<string[]>([])
  readonly avviso = signal<string | null>(null)
  readonly conflitto = signal(false)
  readonly inCorso = signal(false)
  private proposta?: Subscription
  private salvataggio?: Subscription

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.apri()
    if (c['visible'] && !this.visible) {
      this.proposta?.unsubscribe()
      this.salvataggio?.unsubscribe()
      this.inCorso.set(false)
    }
  }

  private apri(): void {
    this.errori.set([])
    this.avviso.set(null)
    this.conflitto.set(false)
    this.inCorso.set(false)
    const e = this.elenco
    this.modulo = e
      ? {
          codice: e.codice,
          descrizione: e.descrizione,
          nota1: e.nota1 ?? '',
          nota2: e.nota2 ?? '',
          validoDal: e.validoDal ?? '',
          validoAl: e.validoAl ?? '',
          predefinito: e.predefinito,
          codiceCig: e.codiceCig ?? '',
          codiceCup: e.codiceCup ?? '',
          idDocumentoPa: e.idDocumentoPa ?? '',
          dataDocumentoPa: e.dataDocumentoPa ?? '',
        }
      : vuoto()
    if (!e) {
      // Il codice proposto è informativo; se i codici sono esauriti lo si dice subito.
      this.proposta?.unsubscribe()
      this.proposta = this.servizio.elenchi
        .prossimoCodice(this.contrattoId)
        .pipe(takeUntilDestroyed(this.distrutto))
        .subscribe({
          next: codice => {
            if (this.modulo.codice === '' && this.visible) this.modulo.codice = codice
          },
          error: err =>
            this.avviso.set(messaggiErrore(err, 'Impossibile proporre il codice.').join(' ')),
        })
    }
  }

  chiudi(): void {
    if (this.inCorso()) return
    this.visibleChange.emit(false)
  }

  salva(): void {
    if (this.soloLettura || this.inCorso() || this.modulo.descrizione.trim() === '') return
    const m = this.modulo
    const dati: NuovoElenco = {
      codice: m.codice.trim(),
      descrizione: m.descrizione.trim(),
      nota1: vuotoNull(m.nota1),
      nota2: vuotoNull(m.nota2),
      validoDal: vuotoNull(m.validoDal),
      validoAl: vuotoNull(m.validoAl),
      predefinito: m.predefinito,
      codiceCig: vuotoNull(m.codiceCig),
      codiceCup: vuotoNull(m.codiceCup),
      idDocumentoPa: vuotoNull(m.idDocumentoPa),
      dataDocumentoPa: vuotoNull(m.dataDocumentoPa),
    }
    const esistente = this.elenco
    this.inCorso.set(true)
    this.errori.set([])
    this.conflitto.set(false)
    const richiesta = esistente
      ? this.servizio.elenchi.modifica(esistente.id, { ...dati, versione: esistente.versione })
      : this.servizio.elenchi.crea(this.contrattoId, dati)
    this.salvataggio = richiesta.pipe(takeUntilDestroyed(this.distrutto)).subscribe({
      next: salvato => {
        this.inCorso.set(false)
        this.salvato.emit(salvato)
      },
      error: err => {
        this.inCorso.set(false)
        const natura = naturaConflitto(err)
        this.errori.set(
          natura === 'concorrente'
            ? [MESSAGGIO_CONCORRENTE]
            : messaggiErrore(err, "Impossibile salvare l'elenco.")
        )
        // "Ricarica" solo se i dati sono cambiati: un 409 causato da quanto scritto (codice già
        // usato nell'elenco) si corregge nel campo, senza perdere il form.
        this.conflitto.set(natura === 'rilettura')
      },
    })
  }
}
