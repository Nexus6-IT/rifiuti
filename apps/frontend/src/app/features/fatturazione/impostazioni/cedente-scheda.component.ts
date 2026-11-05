import { CommonModule } from '@angular/common'
import { Component, OnInit, computed, inject, signal } from '@angular/core'
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextModule } from 'primeng/inputtext'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { RegistroIva } from '../../clienti/clienti.model'
import { TabelleFatturazioneService } from '../../clienti/tabelle-fatturazione.service'
import { leggiErroriAzione } from '../../listino/errori-azione'
import { puoImpostareFatturazione } from '../../legami/permessi-legami'
import {
  formatNumero,
  leggiNumero,
  messaggioNumero,
  validatoreNumero,
} from '../../../shared/utils/numero-modificabile'
import { ImpostazioniFatturazione44Service } from './impostazioni-fatturazione-4-4.service'
import { CedenteVista, DESCRIZIONI_REGIMI, DatiCedente, REGIMI_FISCALI } from './impostazioni.model'

const MESSAGGIO_VERSIONE =
  'I dati del cedente sono stati modificati da un altro utente: sono stati ricaricati.'

/** Voci del menu del regime fiscale: il codice in testa, poi la descrizione. */
export const OPZIONI_REGIME: { value: string; label: string }[] = REGIMI_FISCALI.map(c => ({
  value: c,
  label: DESCRIZIONI_REGIMI[c] ? `${c} - ${DESCRIZIONI_REGIMI[c]}` : c,
}))

const OPZIONI_SOCIO_UNICO = [
  { value: 'SU', label: 'SU - Socio unico' },
  { value: 'SM', label: 'SM - Più soci' },
]

const OPZIONI_LIQUIDAZIONE = [
  { value: 'LN', label: 'LN - Non in liquidazione' },
  { value: 'LS', label: 'LS - In liquidazione' },
]

const MSG_CAPITALE = 'Il capitale sociale è un importo positivo con al massimo due decimali.'
const MSG_REA = 'Indica la sigla della provincia, due lettere (es. MI).'

/** Capitale sociale come lo accetta l'XSD: positivo, al massimo due decimali, virgola. */
export const validatoreCapitale: ValidatorFn = (c: AbstractControl): ValidationErrors | null => {
  const t = String(c.value ?? '').replace(/\s+/g, '')
  if (t === '') return null
  const base = validatoreNumero('decimale')(c)
  if (base) return base
  return /^\d+(,\d{1,2})?$/.test(t) ? null : { numero: MSG_CAPITALE }
}

/** Sigla della provincia dell'ufficio REA: due lettere. */
export const validatoreRea: ValidatorFn = (c: AbstractControl): ValidationErrors | null => {
  const t = String(c.value ?? '').trim()
  return t === '' || /^[A-Za-z]{2}$/.test(t) ? null : { rea: MSG_REA }
}

/** Scheda «Dati del cedente»: dati del tenant in sola lettura e dati fiscali modificabili. */
@Component({
  selector: 'app-cedente-scheda',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, DropdownModule, InputTextModule],
  styles: [
    `
      .dati-sola-lettura {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 0.25rem 1rem;
        margin: 0;
      }
      .dati-sola-lettura dt {
        font-weight: 600;
      }
      .dati-sola-lettura dd {
        margin: 0;
      }
    `,
  ],
  template: `
    <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="cedente-errore">
      {{ e }}
    </p>
    <section *ngIf="!cedente() && !errore()" class="surface-card" data-testid="cedente-caricamento">
      <p role="status">Caricamento in corso...</p>
    </section>
    <p-button
      *ngIf="daRiprovare()"
      label="Riprova"
      icon="pi pi-refresh"
      [outlined]="true"
      (onClick)="carica()"
      data-testid="cedente-riprova"
    />

    <ng-container *ngIf="cedente() as c">
      <section
        *ngIf="!c.completo"
        class="avviso-riquadro"
        role="status"
        data-testid="cedente-incompleto"
      >
        <p>Dati del cedente incompleti: senza questi dati non si emettono fatture. Mancano:</p>
        <ul>
          <li *ngFor="let m of c.mancanti">{{ m }}</li>
        </ul>
      </section>

      <section class="surface-card" aria-labelledby="cedente-tenant-titolo">
        <h2 id="cedente-tenant-titolo" class="section-title">Dati dell'azienda</h2>
        <p class="nota-pagina">Si modificano nell'anagrafica dell'azienda.</p>
        <dl class="dati-sola-lettura" data-testid="cedente-tenant">
          <dt>Ragione sociale</dt>
          <dd>{{ c.daTenant.ragioneSociale }}</dd>
          <dt>Partita IVA</dt>
          <dd>{{ c.daTenant.partitaIva || '—' }}</dd>
          <dt>Codice fiscale</dt>
          <dd>{{ c.daTenant.codiceFiscale || '—' }}</dd>
          <dt>Indirizzo</dt>
          <dd>{{ indirizzo(c) }}</dd>
          <dt>Numero REA</dt>
          <dd>{{ c.daTenant.numeroRea || '—' }}</dd>
        </dl>
      </section>

      <form
        class="surface-card"
        [formGroup]="form"
        (ngSubmit)="salva()"
        aria-label="Dati fiscali del cedente"
      >
        <div class="field">
          <label for="ced-regime"
            >Regime fiscale <span class="req" aria-hidden="true">*</span
            ><span class="sr-only"> (obbligatorio)</span></label
          >
          <p-dropdown
            formControlName="regimeFiscale"
            [options]="opzioniRegime"
            optionLabel="label"
            optionValue="value"
            inputId="ced-regime"
            placeholder="Scegli il regime"
            styleClass="w-full"
            appendTo="body"
            [required]="true"
            [attr.aria-describedby]="erroreRegime() ? 'ced-regime-errore' : null"
            data-testid="cedente-regime"
          />
          <small *ngIf="erroreRegime()" id="ced-regime-errore" class="field-error" role="alert"
            >Scegli il regime fiscale.</small
          >
        </div>
        <div class="field">
          <label for="ced-rea">Ufficio REA (sigla della provincia)</label>
          <input
            pInputText
            id="ced-rea"
            formControlName="reaUfficio"
            maxlength="2"
            [attr.aria-invalid]="erroreRea() ? 'true' : null"
            [attr.aria-describedby]="erroreRea() ? 'ced-rea-errore' : null"
            data-testid="cedente-rea"
          />
          <small
            *ngIf="erroreRea() as m"
            id="ced-rea-errore"
            class="field-error"
            role="alert"
            data-testid="cedente-rea-errore"
            >{{ m }}</small
          >
        </div>
        <div class="field">
          <label for="ced-capitale">Capitale sociale</label>
          <input
            pInputText
            id="ced-capitale"
            formControlName="capitaleSociale"
            inputmode="decimal"
            autocomplete="off"
            [attr.aria-invalid]="erroreCapitale() ? 'true' : null"
            [attr.aria-describedby]="erroreCapitale() ? 'ced-capitale-errore' : null"
            data-testid="cedente-capitale"
          />
          <small
            *ngIf="erroreCapitale() as m"
            id="ced-capitale-errore"
            class="field-error"
            role="alert"
            data-testid="cedente-capitale-errore"
            >{{ m }}</small
          >
        </div>
        <div class="field">
          <label for="ced-socio">Socio unico</label>
          <p-dropdown
            formControlName="socioUnico"
            [options]="opzioniSocioUnico"
            optionLabel="label"
            optionValue="value"
            placeholder="Non indicato"
            [showClear]="true"
            inputId="ced-socio"
            styleClass="w-full"
            appendTo="body"
            data-testid="cedente-socio"
          />
        </div>
        <div class="field">
          <label for="ced-liquidazione">Stato di liquidazione</label>
          <p-dropdown
            formControlName="statoLiquidazione"
            [options]="opzioniLiquidazione"
            optionLabel="label"
            optionValue="value"
            inputId="ced-liquidazione"
            styleClass="w-full"
            appendTo="body"
            data-testid="cedente-liquidazione"
          />
        </div>
        <div class="field">
          <label for="ced-registro">Registro IVA predefinito</label>
          <p-dropdown
            formControlName="registroIvaPredefinitoId"
            [options]="opzioniRegistro()"
            optionLabel="descrizione"
            optionValue="id"
            inputId="ced-registro"
            [showClear]="true"
            placeholder="Nessuno"
            styleClass="w-full"
            appendTo="body"
            data-testid="cedente-registro"
          />
        </div>
        <div class="field">
          <label for="ced-trasmittente">Codice dell'id trasmittente</label>
          <input
            pInputText
            id="ced-trasmittente"
            maxlength="28"
            formControlName="idTrasmittenteCodice"
            autocomplete="off"
            data-testid="cedente-trasmittente"
          />
        </div>
        <p-button
          type="submit"
          label="Salva"
          icon="pi pi-check"
          [disabled]="!puoModificare() || inCorso()"
          [loading]="inCorso()"
          data-testid="cedente-salva"
        />
        <p *ngIf="!puoModificare()" class="nota-pagina" data-testid="cedente-sola-lettura">
          Solo gli amministratori possono modificare i dati del cedente.
        </p>
      </form>
    </ng-container>
  `,
})
export class CedenteSchedaComponent implements OnInit {
  private readonly servizio = inject(ImpostazioniFatturazione44Service)
  private readonly tabelle = inject(TabelleFatturazioneService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)
  private readonly fb = inject(FormBuilder)

  readonly opzioniRegime = OPZIONI_REGIME
  readonly opzioniSocioUnico = OPZIONI_SOCIO_UNICO
  readonly opzioniLiquidazione = OPZIONI_LIQUIDAZIONE

  readonly cedente = signal<CedenteVista | null>(null)
  /** Tutti i registri IVA, anche disattivati: serve a mostrare quello già scelto. */
  readonly registri = signal<RegistroIva[]>([])
  /** Menu del registro predefinito: gli attivi, più quello già scelto anche se disattivato. */
  readonly opzioniRegistro = computed(() => {
    const scelto = this.cedente()?.registroIvaPredefinitoId ?? null
    return this.registri().filter(r => r.attivo || r.id === scelto)
  })
  /** Vero se l'ultima lettura è fallita: «Riprova» si offre anche con dati già in pagina. */
  readonly daRiprovare = signal(false)
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)

  readonly form = this.fb.group({
    regimeFiscale: this.fb.control<string | null>(null, Validators.required),
    reaUfficio: this.fb.control('', validatoreRea),
    capitaleSociale: this.fb.control('', validatoreCapitale),
    socioUnico: this.fb.control<'SU' | 'SM' | null>(null),
    statoLiquidazione: this.fb.control<'LN' | 'LS'>('LN'),
    registroIvaPredefinitoId: this.fb.control<string | null>(null),
    idTrasmittenteCodice: this.fb.control(''),
  })

  readonly puoModificare = () => puoImpostareFatturazione(this.auth.currentUser()?.role)

  ngOnInit(): void {
    this.carica()
    this.tabelle.registri.list({ incluseDisattivate: true }).subscribe({
      next: r => this.registri.set(r),
      // Senza l'elenco il menu resta vuoto: il registro predefinito è facoltativo.
      error: () => this.registri.set([]),
    })
  }

  indirizzo(c: CedenteVista): string {
    const d = c.daTenant
    const localita = [d.cap, d.comune, d.provincia ? `(${d.provincia})` : null]
      .filter(Boolean)
      .join(' ')
    return [d.indirizzo, localita].filter(Boolean).join(', ') || '—'
  }

  erroreRegime(): boolean {
    const c = this.form.controls.regimeFiscale
    return c.touched && c.invalid
  }

  erroreRea(): string | null {
    const e = this.form.controls.reaUfficio.errors?.['rea']
    return typeof e === 'string' ? e : null
  }

  erroreCapitale(): string | null {
    return messaggioNumero(this.form.controls.capitaleSociale)
  }

  /** Rilegge i dati; `messaggio` resta visibile dopo la rilettura (es. versione superata). */
  carica(messaggio: string | null = null): void {
    this.servizio.leggiCedente().subscribe({
      next: c => {
        this.cedente.set(c)
        this.riempi(c)
        this.errore.set(messaggio)
        this.daRiprovare.set(false)
      },
      error: err => {
        this.daRiprovare.set(true)
        this.errore.set(
          leggiErroriAzione(err, 'Impossibile caricare i dati del cedente.').messaggi.join(' ')
        )
      },
    })
  }

  private riempi(c: CedenteVista): void {
    this.form.reset({
      regimeFiscale: c.regimeFiscale,
      reaUfficio: c.reaUfficio ?? '',
      capitaleSociale: formatNumero(c.capitaleSociale, 2),
      socioUnico: c.socioUnico,
      statoLiquidazione: c.statoLiquidazione,
      registroIvaPredefinitoId: c.registroIvaPredefinitoId,
      idTrasmittenteCodice: c.idTrasmittenteCodice ?? '',
    })
    if (this.puoModificare()) this.form.enable()
    else this.form.disable()
  }

  salva(): void {
    const corrente = this.cedente()
    if (!corrente || this.inCorso() || !this.puoModificare()) return
    this.form.markAllAsTouched()
    if (this.form.invalid) return
    const v = this.form.getRawValue()
    if (v.regimeFiscale === null) return
    const testo = (t: string): string | null => (t.trim() === '' ? null : t.trim())
    const dati: DatiCedente = {
      regimeFiscale: v.regimeFiscale,
      reaUfficio: testo(v.reaUfficio ?? '')?.toUpperCase() ?? null,
      capitaleSociale: leggiNumero(v.capitaleSociale ?? '').valore,
      socioUnico: v.socioUnico,
      statoLiquidazione: v.statoLiquidazione ?? 'LN',
      registroIvaPredefinitoId: v.registroIvaPredefinitoId,
      idTrasmittenteCodice: testo(v.idTrasmittenteCodice ?? ''),
      versione: corrente.versione,
    }
    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio.salvaCedente(dati).subscribe({
      next: c => {
        this.inCorso.set(false)
        this.cedente.set(c)
        this.riempi(c)
        this.toast.success('Dati del cedente salvati.', 'Fatturazione')
      },
      error: err => {
        this.inCorso.set(false)
        const e = leggiErroriAzione(err, 'Impossibile salvare i dati del cedente.')
        if (e.conflitto && e.rilettura) {
          this.carica(MESSAGGIO_VERSIONE)
          return
        }
        this.errore.set(e.messaggi.join(' '))
      },
    })
  }
}
