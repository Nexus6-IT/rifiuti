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
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { CheckboxModule } from 'primeng/checkbox'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { Cliente, ProrogaScadenze } from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { Opzione } from '../clienti/opzioni-fatturazione'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import { messaggioErrore } from '../clienti/tabelle/tabella-comune'
import { SceltaClienteComponent } from './scelta-cliente.component'
import { CampoDataComponent } from '../../shared/components/campo-data.component'

/**
 * Proroga massiva delle scadenze (D11, come F6 di WinWaste): sposta di un anno la fine dei
 * contratti con fine entro la data indicata. Di default solo quelli con rinnovo automatico e non
 * i sospesi; cliente e categoria restringono. Al termine toast "Contratti prorogati: N".
 */
@Component({
  selector: 'app-proroga-dialog',
  standalone: true,
  imports: [
    CampoDataComponent,
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    SceltaClienteComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      header="Proroga scadenze"
      [modal]="true"
      [style]="{ width: '34rem' }"
    >
      <div *ngIf="inRiepilogo()" class="dlg-form" data-testid="proroga-riepilogo">
        <p>
          Stai per spostare di un anno la data di fine dei contratti con questi filtri. L'operazione
          non si annulla.
        </p>
        <ul>
          <li *ngFor="let r of riepilogo()">{{ r }}</li>
        </ul>
      </div>
      <form [formGroup]="form" (ngSubmit)="avanti()" class="dlg-form" [hidden]="inRiepilogo()">
        <p>Sposta di un anno la data di fine dei contratti che scadono entro la data indicata.</p>
        <label for="proroga-data">Contratti con fine entro il</label>
        <app-campo-data
          inputId="proroga-data"
          formControlName="scadutiEntro"
          data-testid="proroga-data"
          [piena]="true"
        />
        <div class="spunta">
          <p-checkbox
            inputId="proroga-solo-rinnovo"
            formControlName="soloRinnovoAutomatico"
            [binary]="true"
            data-testid="proroga-solo-rinnovo-automatico"
          />
          <label for="proroga-solo-rinnovo">Solo con rinnovo automatico</label>
        </div>
        <div class="spunta">
          <p-checkbox
            inputId="proroga-sospesi"
            formControlName="ancheSospesi"
            [binary]="true"
            data-testid="proroga-anche-sospesi"
          />
          <label for="proroga-sospesi">Anche i contratti sospesi</label>
        </div>
        <app-scelta-cliente
          prefisso="proroga-cliente"
          prefissoNuovo="proroga-cliente-nuovo"
          etichetta="Cliente (facoltativo)"
          [valore]="clienteOpzione()"
          (scelto)="clienteScelto($event)"
        />
        <label for="proroga-categoria">Categoria (facoltativa)</label>
        <p-dropdown
          inputId="proroga-categoria"
          [options]="categorie()"
          optionLabel="etichetta"
          optionValue="id"
          formControlName="categoriaId"
          placeholder="Tutte le categorie"
          [showClear]="true"
          ariaLabel="Categoria"
          styleClass="w-full"
          data-testid="proroga-categoria"
        />
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="proroga-errore">
          {{ e }}
        </p>
      </form>
      <ng-template pTemplate="footer">
        <p-button label="Annulla" [text]="true" (onClick)="chiudi()" />
        <p-button
          *ngIf="inRiepilogo()"
          label="Indietro"
          [text]="true"
          [disabled]="inCorso()"
          (onClick)="inRiepilogo.set(false)"
          data-testid="proroga-indietro"
        />
        <p-button
          *ngIf="!inRiepilogo()"
          label="Proroga"
          icon="pi pi-calendar-plus"
          [disabled]="form.invalid || inCorso()"
          (onClick)="avanti()"
          data-testid="proroga-conferma"
        />
        <p-button
          *ngIf="inRiepilogo()"
          label="Conferma la proroga"
          icon="pi pi-check"
          [disabled]="form.invalid || inCorso()"
          (onClick)="conferma()"
          data-testid="proroga-conferma-finale"
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
      .spunta {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
    `,
  ],
})
export class ProrogaDialogComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ClientiService)
  private readonly tabelle = inject(TabelleFatturazioneService)
  private readonly toast = inject(ToastService)

  @Input() visible = false
  /** Numero dei contratti prorogati. */
  @Output() prorogato = new EventEmitter<number>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly categorie = signal<Opzione[]>([])
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  /** Passo di conferma: riepilogo dei filtri prima dell'invio. */
  readonly inRiepilogo = signal(false)
  readonly riepilogo = signal<string[]>([])
  private clienteNome: string | null = null
  /** Cliente scelto (solo per il filtro: non serve altro che l'id). */
  readonly clienteOpzione = signal<Opzione | null>(null)
  private clienteId: string | null = null

  readonly form = new FormGroup({
    scadutiEntro: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    soloRinnovoAutomatico: new FormControl(true, { nonNullable: true }),
    ancheSospesi: new FormControl(false, { nonNullable: true }),
    categoriaId: new FormControl('', { nonNullable: true }),
  })

  private lettura?: Subscription

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  ngOnDestroy(): void {
    this.lettura?.unsubscribe()
  }

  private inizializza(): void {
    this.form.reset({
      scadutiEntro: '',
      soloRinnovoAutomatico: true,
      ancheSospesi: false,
      categoriaId: '',
    })
    this.clienteId = null
    this.clienteNome = null
    this.clienteOpzione.set(null)
    this.inRiepilogo.set(false)
    this.riepilogo.set([])
    this.errore.set(null)
    this.inCorso.set(false)
    this.lettura?.unsubscribe()
    this.lettura = this.tabelle.codifiche.list('CATEGORIA').subscribe({
      next: elenco => this.categorie.set(elenco.map(c => ({ id: c.id, etichetta: c.descrizione }))),
      error: () => this.categorie.set([]),
    })
  }

  clienteScelto(cliente: Cliente | null): void {
    this.clienteId = cliente?.id ?? null
    this.clienteNome = cliente ? (cliente.ditta?.ragioneSociale ?? 'Cliente scelto') : null
  }

  /** Primo passo: riepiloga i filtri e chiede la conferma (la proroga non si annulla). */
  avanti(): void {
    if (this.form.invalid || this.inCorso()) return
    const v = this.form.getRawValue()
    const [anno, mese, giorno] = v.scadutiEntro.split('-')
    const categoria = this.categorie().find(c => c.id === v.categoriaId)?.etichetta
    this.riepilogo.set([
      `Contratti con fine entro il ${giorno}/${mese}/${anno}`,
      `Categoria: ${v.categoriaId ? (categoria ?? 'scelta') : 'tutte'}`,
      `Cliente: ${this.clienteId ? (this.clienteNome ?? 'scelto') : 'tutti'}`,
      v.soloRinnovoAutomatico
        ? 'Solo contratti con rinnovo automatico'
        : 'Anche senza rinnovo automatico',
      v.ancheSospesi ? 'Compresi i contratti sospesi' : 'Esclusi i contratti sospesi',
    ])
    this.errore.set(null)
    this.inRiepilogo.set(true)
  }

  conferma(): void {
    if (this.form.invalid || this.inCorso() || !this.inRiepilogo()) return
    const v = this.form.getRawValue()
    const dati: ProrogaScadenze = {
      scadutiEntro: v.scadutiEntro,
      soloRinnovoAutomatico: v.soloRinnovoAutomatico,
      ancheSospesi: v.ancheSospesi,
      ...(this.clienteId ? { clienteId: this.clienteId } : {}),
      ...(v.categoriaId ? { categoriaId: v.categoriaId } : {}),
    }
    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio.contratti.proroga(dati).subscribe({
      next: esito => {
        this.inCorso.set(false)
        this.toast.success(`Contratti prorogati: ${esito.prorogati}`)
        this.prorogato.emit(esito.prorogati)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.inRiepilogo.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile prorogare i contratti.'))
      },
    })
  }

  chiudi(): void {
    this.visibleChange.emit(false)
  }
}
