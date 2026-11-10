import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core'
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { messaggioErrore } from '../../clienti/tabelle/tabella-comune'
import { convertiLogo, logoComeDataUrl } from './logo-modello'
import {
  AMBITI_MODELLO,
  COLORE_PRIMARIO_PREDEFINITO,
  COLORE_SECONDARIO_PREDEFINITO,
  COPIE_MAX,
  COPIE_MIN,
  DatiModelloStampa,
  ModelloStampaVista,
} from './modello-stampa.model'
import { ModelliStampaService } from './modelli-stampa.service'

const COLORE = /^#[0-9A-Fa-f]{6}$/

/** Nuovo modello di stampa o modifica, con anteprima di intestazione, piè di pagina e colori. */
@Component({
  selector: 'app-modello-stampa-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, DialogModule, InputTextModule],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="chiudi()"
      [header]="elemento ? 'Modifica modello' : 'Nuovo modello'"
      [modal]="true"
      [style]="{ width: '36rem', maxWidth: '96vw' }"
    >
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <label for="mod-nome">Nome</label>
        <input
          pInputText
          id="mod-nome"
          formControlName="nome"
          maxlength="100"
          data-testid="modello-dlg-nome"
        />
        <label for="mod-ambito">Ambito</label>
        <select id="mod-ambito" formControlName="ambito" data-testid="modello-dlg-ambito">
          @for (a of ambiti; track a.valore) {
            <option [value]="a.valore">{{ a.etichetta }}</option>
          }
        </select>
        <label for="mod-copie">Copie per FIR ({{ copieMin }}-{{ copieMax }})</label>
        <input
          pInputText
          id="mod-copie"
          type="number"
          formControlName="copie"
          [min]="copieMin"
          [max]="copieMax"
          [attr.aria-invalid]="form.controls.copie.invalid ? 'true' : null"
          data-testid="modello-dlg-copie"
        />
        <label for="mod-intestazione">Testo di intestazione</label>
        <input
          pInputText
          id="mod-intestazione"
          formControlName="testoIntestazione"
          maxlength="500"
          data-testid="modello-dlg-intestazione"
        />
        <label for="mod-piede">Testo del piè di pagina</label>
        <input
          pInputText
          id="mod-piede"
          formControlName="testoPiePagina"
          maxlength="500"
          data-testid="modello-dlg-piede"
        />
        <div class="colori">
          <div>
            <label for="mod-primario">Colore principale</label>
            <input
              id="mod-primario"
              type="color"
              formControlName="colorePrimario"
              data-testid="modello-dlg-primario"
            />
          </div>
          <div>
            <label for="mod-secondario">Colore secondario</label>
            <input
              id="mod-secondario"
              type="color"
              formControlName="coloreSecondario"
              data-testid="modello-dlg-secondario"
            />
          </div>
        </div>
        <label for="mod-logo">Logo (PNG o JPEG, al massimo 256 KB)</label>
        <input
          id="mod-logo"
          type="file"
          accept="image/png,image/jpeg"
          (change)="scegliLogo($event)"
          [attr.aria-describedby]="erroreLogo() ? 'mod-logo-errore' : null"
          data-testid="modello-dlg-logo"
        />
        <small
          *ngIf="erroreLogo() as e"
          id="mod-logo-errore"
          role="alert"
          class="field-error"
          data-testid="modello-dlg-logo-errore"
          >{{ e }}</small
        >
        <p-button
          *ngIf="logo()"
          label="Togli il logo"
          [text]="true"
          severity="danger"
          (onClick)="logo.set(null)"
          data-testid="modello-dlg-logo-togli"
        />
        <div
          class="anteprima"
          aria-label="Anteprima del modello"
          data-testid="modello-dlg-anteprima"
        >
          <div class="anteprima__testa" [style.borderBottomColor]="valori().colorePrimario">
            <img
              *ngIf="logoUrl() as src"
              [src]="src"
              alt="Logo del modello"
              class="anteprima__logo"
              data-testid="modello-dlg-anteprima-logo"
            />
            <span
              [style.color]="valori().colorePrimario"
              data-testid="modello-dlg-anteprima-testa"
              >{{ valori().testoIntestazione || valori().nome || 'Intestazione' }}</span
            >
          </div>
          <div class="anteprima__corpo">Formulario di identificazione del rifiuto</div>
          <div class="anteprima__piede" [style.color]="valori().coloreSecondario">
            {{ valori().testoPiePagina || 'Piè di pagina' }}
          </div>
        </div>
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="modello-dlg-errore">
          {{ e }}
        </p>
      </form>
      <ng-template pTemplate="footer">
        <p-button label="Annulla" [text]="true" (onClick)="chiudi()" />
        <p-button
          label="Salva"
          icon="pi pi-check"
          [disabled]="form.invalid || inCorso()"
          (onClick)="salva()"
          data-testid="modello-dlg-salva"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .dlg-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .colori {
        display: flex;
        gap: 1.5rem;
      }
      .colori > div {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      select {
        padding: 0.5rem;
        border: 1px solid var(--rule, #ccc);
        border-radius: 6px;
        background: var(--surface-card, #fff);
        color: inherit;
      }
      .anteprima {
        border: 1px solid var(--rule, #ccc);
        border-radius: 6px;
        background: #fff;
        color: #222;
        font-size: 0.85rem;
      }
      .anteprima__testa {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem;
        border-bottom: 2px solid;
        font-weight: 600;
      }
      .anteprima__logo {
        max-height: 2.5rem;
        max-width: 8rem;
      }
      .anteprima__corpo {
        padding: 1rem 0.75rem;
      }
      .anteprima__piede {
        padding: 0.4rem 0.75rem;
        border-top: 1px solid #ddd;
        font-size: 0.75rem;
      }
    `,
  ],
})
export class ModelloStampaDialogComponent implements OnChanges {
  private readonly servizio = inject(ModelliStampaService)

  @Input() visible = false
  /** null = nuovo. */
  @Input() elemento: ModelloStampaVista | null = null
  @Output() salvato = new EventEmitter<ModelloStampaVista>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly ambiti = AMBITI_MODELLO
  readonly copieMin = COPIE_MIN
  readonly copieMax = COPIE_MAX
  readonly errore = signal<string | null>(null)
  readonly erroreLogo = signal<string | null>(null)
  readonly inCorso = signal(false)
  readonly logo = signal<string | null>(null)
  readonly logoUrl = computed(() => logoComeDataUrl(this.logo()))
  private readonly modifiche = signal(0)
  /** Valori correnti del form, per l'anteprima. */
  readonly valori = computed(() => {
    this.modifiche()
    return this.form.getRawValue()
  })

  readonly form = new FormGroup({
    nome: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    ambito: new FormControl<DatiModelloStampa['ambito']>('GENERALE', { nonNullable: true }),
    copie: new FormControl(1, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(COPIE_MIN), Validators.max(COPIE_MAX)],
    }),
    testoIntestazione: new FormControl('', { nonNullable: true }),
    testoPiePagina: new FormControl('', { nonNullable: true }),
    colorePrimario: new FormControl(COLORE_PRIMARIO_PREDEFINITO, {
      nonNullable: true,
      validators: [Validators.pattern(COLORE)],
    }),
    coloreSecondario: new FormControl(COLORE_SECONDARIO_PREDEFINITO, {
      nonNullable: true,
      validators: [Validators.pattern(COLORE)],
    }),
  })

  constructor() {
    this.form.valueChanges.subscribe(() => this.modifiche.update(n => n + 1))
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  private inizializza(): void {
    const e = this.elemento
    this.form.reset({
      nome: e?.nome ?? '',
      ambito: e?.ambito ?? 'GENERALE',
      copie: e?.copie ?? 1,
      testoIntestazione: e?.testoIntestazione ?? '',
      testoPiePagina: e?.testoPiePagina ?? '',
      colorePrimario: e?.colorePrimario ?? COLORE_PRIMARIO_PREDEFINITO,
      coloreSecondario: e?.coloreSecondario ?? COLORE_SECONDARIO_PREDEFINITO,
    })
    this.logo.set(e?.logoBase64 ?? null)
    this.erroreLogo.set(null)
    this.errore.set(null)
    this.inCorso.set(false)
  }

  async scegliLogo(evento: Event): Promise<void> {
    const campo = evento.target as HTMLInputElement
    const file = campo.files?.[0]
    if (!file) return
    const esito = convertiLogo(new Uint8Array(await file.arrayBuffer()))
    if ('errore' in esito) {
      this.erroreLogo.set(esito.errore)
      campo.value = ''
      return
    }
    this.erroreLogo.set(null)
    this.logo.set(esito.base64)
  }

  salva(): void {
    if (this.form.invalid || this.inCorso()) return
    const v = this.form.getRawValue()
    const dati: DatiModelloStampa = {
      nome: v.nome.trim(),
      ambito: v.ambito,
      copie: Number(v.copie),
      testoIntestazione: v.testoIntestazione.trim() || null,
      testoPiePagina: v.testoPiePagina.trim() || null,
      colorePrimario: v.colorePrimario,
      coloreSecondario: v.coloreSecondario,
      logoBase64: this.logo(),
    }
    this.inCorso.set(true)
    this.errore.set(null)
    const chiamata = this.elemento
      ? this.servizio.modifica(this.elemento.id, dati, this.elemento.versione)
      : this.servizio.crea(dati)
    chiamata.subscribe({
      next: salvato => {
        this.inCorso.set(false)
        this.salvato.emit(salvato)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile salvare il modello di stampa.'))
      },
    })
  }

  chiudi(): void {
    this.errore.set(null)
    this.visibleChange.emit(false)
  }
}
