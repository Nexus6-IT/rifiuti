import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
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
  { value: null, label: 'Non indicato' },
  { value: 'SU', label: 'SU - Socio unico' },
  { value: 'SM', label: 'SM - Più soci' },
]

const OPZIONI_LIQUIDAZIONE = [
  { value: 'LN', label: 'LN - Non in liquidazione' },
  { value: 'LS', label: 'LS - In liquidazione' },
]

/** Scheda «Dati del cedente»: dati del tenant in sola lettura e dati fiscali modificabili. */
@Component({
  selector: 'app-cedente-scheda',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, DropdownModule, InputTextModule],
  template: `
    <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="cedente-errore">
      {{ e }}
    </p>
    <section *ngIf="!cedente() && !errore()" class="surface-card" data-testid="cedente-caricamento">
      <p role="status">Caricamento in corso...</p>
    </section>
    <p-button
      *ngIf="!cedente() && errore()"
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
            >Regime fiscale <span class="req" aria-hidden="true">*</span></label
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
            data-testid="cedente-regime"
          />
          <small
            *ngIf="form.controls.regimeFiscale.touched && form.controls.regimeFiscale.invalid"
            class="field-error"
            role="alert"
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
            data-testid="cedente-rea"
          />
        </div>
        <div class="field">
          <label for="ced-capitale">Capitale sociale</label>
          <input
            pInputText
            id="ced-capitale"
            formControlName="capitaleSociale"
            inputmode="decimal"
            autocomplete="off"
            data-testid="cedente-capitale"
          />
          <small
            *ngIf="erroreCapitale() as m"
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
            [options]="registri()"
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
  readonly registri = signal<RegistroIva[]>([])
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)

  readonly form = this.fb.group({
    regimeFiscale: this.fb.control<string | null>(null, Validators.required),
    reaUfficio: this.fb.control(''),
    capitaleSociale: this.fb.control('', validatoreNumero('decimale')),
    socioUnico: this.fb.control<'SU' | 'SM' | null>(null),
    statoLiquidazione: this.fb.control<'LN' | 'LS'>('LN'),
    registroIvaPredefinitoId: this.fb.control<string | null>(null),
    idTrasmittenteCodice: this.fb.control(''),
  })

  readonly puoModificare = () => puoImpostareFatturazione(this.auth.currentUser()?.role)

  ngOnInit(): void {
    this.carica()
    this.tabelle.registri.list().subscribe({
      next: r => this.registri.set(r.filter(x => x.attivo)),
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
      },
      error: err =>
        this.errore.set(
          leggiErroriAzione(err, 'Impossibile caricare i dati del cedente.').messaggi.join(' ')
        ),
    })
  }

  private riempi(c: CedenteVista): void {
    this.form.reset({
      regimeFiscale: c.regimeFiscale,
      reaUfficio: c.reaUfficio ?? '',
      capitaleSociale: formatNumero(c.capitaleSociale),
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
      reaUfficio: testo(v.reaUfficio ?? ''),
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
