import { CommonModule } from '@angular/common'
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { ConfirmationService, SharedModule } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { InputSwitchModule } from 'primeng/inputswitch'
import { Observable } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { leggiErroriAzione } from '../listino/errori-azione'
import { ConfigurazioneSdiService } from './configurazione-sdi.service'
import {
  ConfigurazioneSdi,
  PASSI_ONBOARDING_ETICHETTE,
  PROVIDER_SDI_ETICHETTE,
  puoConfigurareSdi,
} from './sdi.model'

const MESSAGGIO_VERSIONE =
  'La configurazione è stata modificata da un altro utente: i dati sono stati ricaricati.'

/**
 * Scheda «Invio SDI» (4.5a): provider, ambiente, credenziali (che non vengono mai mostrate: si
 * possono solo sostituire), webhook, verifica della connessione, interruttore «Invio attivo» e
 * passi di onboarding. Solo ADMIN e SUPER_ADMIN modificano. L'invio vero e proprio arriva con
 * la 4.5b: qui l'interruttore resta una predisposizione.
 */
@Component({
  selector: 'app-configurazione-sdi',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    InputSwitchModule,
    SharedModule,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Invio SDI</h1>
          <p class="page-subtitle">
            Collegamento con il provider che trasmette le fatture elettroniche allo SDI.
          </p>
        </div>
      </header>

      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="sdi-errore">{{ e }}</p>

      <section *ngIf="!cfg() && !errore()" class="surface-card" data-testid="sdi-caricamento">
        <p role="status">Caricamento in corso...</p>
      </section>
      <p-button
        *ngIf="!cfg() && errore()"
        label="Riprova"
        icon="pi pi-refresh"
        [outlined]="true"
        (onClick)="carica()"
        data-testid="sdi-riprova"
      />

      <ng-container *ngIf="cfg() as c">
        <p
          *ngIf="!c.configurata"
          class="avviso-riquadro"
          role="status"
          data-testid="sdi-non-configurata"
        >
          Nessuna configurazione: scegli il provider e salva.
        </p>

        <section class="surface-card" aria-label="Collegamento con il provider">
          <div class="campo">
            <label for="sdi-provider">Provider</label>
            <select
              id="sdi-provider"
              name="provider"
              [(ngModel)]="provider"
              [disabled]="!puoModificare()"
              data-testid="sdi-provider"
            >
              <option value="" disabled>Scegli...</option>
              <option *ngFor="let p of provider_opzioni" [value]="p.codice">
                {{ p.etichetta }}
              </option>
            </select>
          </div>
          <div class="campo">
            <label for="sdi-ambiente">Ambiente</label>
            <select
              id="sdi-ambiente"
              name="ambiente"
              [(ngModel)]="ambiente"
              [disabled]="!puoModificare()"
              data-testid="sdi-ambiente"
            >
              <option value="SANDBOX">Sandbox (prova)</option>
              <option value="PRODUZIONE">Produzione</option>
            </select>
          </div>
          <div class="campo">
            <label for="sdi-apikey">Chiave API del provider</label>
            <input
              id="sdi-apikey"
              name="apiKey"
              type="password"
              autocomplete="off"
              [(ngModel)]="apiKey"
              [disabled]="!puoModificare()"
              [placeholder]="
                c.haCredenziali
                  ? 'Salvata: scrivi per sostituirla'
                  : 'Vuota: si usa l’account di piattaforma'
              "
              data-testid="sdi-apikey"
            />
          </div>
          <div class="campo">
            <label for="sdi-idconf">Id della configurazione presso il provider</label>
            <input
              id="sdi-idconf"
              name="idConf"
              type="text"
              [(ngModel)]="idConfigurazione"
              [disabled]="!puoModificare()"
              data-testid="sdi-idconf"
            />
          </div>
          <div class="campo">
            <label for="sdi-segreto">Segreto del webhook</label>
            <input
              id="sdi-segreto"
              name="segreto"
              type="password"
              autocomplete="off"
              [(ngModel)]="segreto"
              [disabled]="!puoModificare()"
              [placeholder]="c.haSegretoWebhook ? 'Salvato: scrivi per sostituirlo' : ''"
              data-testid="sdi-segreto"
            />
          </div>
          <div class="campo campo--riga">
            <label for="sdi-firma">Firma dal provider</label>
            <p-inputSwitch
              inputId="sdi-firma"
              [(ngModel)]="firma"
              [disabled]="!puoModificare()"
              data-testid="sdi-firma"
            />
          </div>
          <p-button
            label="Salva"
            icon="pi pi-check"
            styleClass="wf-primario"
            [disabled]="!puoModificare() || inCorso()"
            [loading]="inCorso()"
            (onClick)="salva()"
            data-testid="sdi-salva"
          />
        </section>

        <section
          *ngIf="tokenNuovo() as t"
          class="surface-card"
          role="status"
          data-testid="sdi-token-riquadro"
        >
          <h2>Token del webhook</h2>
          <p>
            Copia l'indirizzo nel pannello del provider: <strong>non verrà più mostrato</strong>.
          </p>
          <code data-testid="sdi-token">{{ t }}</code>
        </section>

        <section *ngIf="c.configurata" class="surface-card" aria-label="Verifica e invio">
          <div class="riga-azioni">
            <p-button
              label="Verifica connessione"
              icon="pi pi-bolt"
              [outlined]="true"
              [disabled]="!puoModificare() || inCorso()"
              (onClick)="verifica()"
              data-testid="sdi-verifica"
            />
            <p-button
              label="Rigenera il token del webhook"
              icon="pi pi-refresh"
              [outlined]="true"
              [disabled]="!puoModificare() || inCorso()"
              (onClick)="chiediRigenera()"
              data-testid="sdi-rigenera"
            />
          </div>
          <p
            *ngIf="c.verificataIl"
            class="avviso-riquadro"
            role="status"
            data-testid="sdi-verificata"
          >
            Connessione verificata il {{ c.verificataIl | date: 'dd/MM/yyyy HH:mm' }}.
          </p>
          <p
            *ngIf="!c.verificataIl && c.ultimoEsitoVerifica"
            class="field-error"
            role="status"
            data-testid="sdi-esito-ko"
          >
            Verifica non riuscita: {{ c.ultimoEsitoVerifica }}
          </p>
          <div class="campo campo--riga">
            <label for="sdi-invio">Invio attivo</label>
            <p-inputSwitch
              inputId="sdi-invio"
              [ngModel]="c.invioAttivo"
              (ngModelChange)="cambiaInvio($event)"
              [disabled]="!puoModificare() || inCorso() || !c.verificataIl"
              data-testid="sdi-invio"
            />
          </div>
          <p class="nota-pagina" data-testid="sdi-nota-invio">
            L'interruttore si abilita solo dopo una verifica riuscita e si spegne da solo se cambi
            provider, ambiente o credenziali.
          </p>
        </section>

        <section *ngIf="c.configurata" class="surface-card" aria-label="Onboarding">
          <h2>Onboarding</h2>
          <ul class="elenco-passi">
            <li *ngFor="let p of c.passiOnboarding">
              <label>
                <input
                  type="checkbox"
                  [checked]="!!c.onboarding[p]"
                  [disabled]="!puoModificare() || inCorso()"
                  (change)="passo(p, $any($event.target).checked)"
                  [attr.data-testid]="'sdi-passo-' + p"
                />
                {{ etichettaPasso(p) }}
              </label>
              <span *ngIf="c.onboarding[p] as s" class="nota-pagina">
                — {{ s.il | date: 'dd/MM/yyyy' }}
              </span>
            </li>
          </ul>
        </section>
      </ng-container>
      <p-confirmDialog />
    </div>
  `,
})
export class ConfigurazioneSdiComponent implements OnInit {
  private readonly servizio = inject(ConfigurazioneSdiService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)
  private readonly destroyRef = inject(DestroyRef)

  readonly cfg = signal<ConfigurazioneSdi | null>(null)
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  /** Token in chiaro dopo creazione o rigenerazione: sparisce alla prossima azione. */
  readonly tokenNuovo = signal<string | null>(null)

  readonly provider_opzioni = (
    Object.keys(PROVIDER_SDI_ETICHETTE) as (keyof typeof PROVIDER_SDI_ETICHETTE)[]
  ).map(codice => ({ codice, etichetta: PROVIDER_SDI_ETICHETTE[codice] }))

  provider = ''
  ambiente = 'SANDBOX'
  apiKey = ''
  idConfigurazione = ''
  segreto = ''
  firma = false

  readonly puoModificare = () => puoConfigurareSdi(this.auth.currentUser()?.role)
  readonly etichettaPasso = (p: string) => PASSI_ONBOARDING_ETICHETTE[p] ?? p

  ngOnInit(): void {
    this.carica()
  }

  carica(messaggio: string | null = null): void {
    this.servizio
      .leggi()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: c => {
          this.applica(c)
          this.errore.set(messaggio)
        },
        error: err =>
          this.errore.set(
            leggiErroriAzione(err, 'Impossibile caricare la configurazione.').messaggi.join(' ')
          ),
      })
  }

  private applica(c: ConfigurazioneSdi): void {
    this.cfg.set(c)
    this.provider = c.provider ?? ''
    this.ambiente = c.ambiente ?? 'SANDBOX'
    this.idConfigurazione = c.idConfigurazioneProvider ?? ''
    this.firma = c.firmaDalProvider
    // Le credenziali non tornano mai dal server: i campi si svuotano dopo ogni salvataggio.
    this.apiKey = ''
    this.segreto = ''
  }

  salva(): void {
    const corrente = this.cfg()
    if (!corrente || this.inCorso()) return
    if (!this.provider) {
      this.errore.set('Scegli il provider.')
      return
    }
    this.esegui(
      this.servizio.salva({
        provider: this.provider,
        ambiente: this.ambiente,
        ...(this.apiKey.trim() ? { credenziali: { apiKey: this.apiKey.trim() } } : {}),
        idConfigurazioneProvider: this.idConfigurazione.trim() || null,
        ...(this.segreto.trim() ? { segretoWebhook: this.segreto.trim() } : {}),
        firmaDalProvider: this.firma,
        versione: corrente.versione,
      }),
      'Configurazione salvata.',
      c => c.webhookToken ?? null
    )
  }

  verifica(): void {
    if (this.inCorso()) return
    this.inCorso.set(true)
    this.errore.set(null)
    this.tokenNuovo.set(null)
    this.servizio
      .verifica()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          this.inCorso.set(false)
          this.applica(r.configurazione)
          if (r.esito.ok) this.toast.success('Connessione verificata.', 'Invio SDI')
          else this.toast.warn(r.esito.dettaglio, 'Verifica non riuscita')
        },
        error: err => this.fallita(err, 'Impossibile verificare la connessione.'),
      })
  }

  chiediRigenera(): void {
    this.conferma.confirm({
      header: 'Rigenera il token del webhook',
      message:
        'Il token attuale smetterà di funzionare: dovrai aggiornare l’indirizzo nel pannello del provider.',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Rigenera',
      rejectLabel: 'Annulla',
      defaultFocus: 'reject',
      accept: () => this.rigenera(),
    })
  }

  private rigenera(): void {
    const corrente = this.cfg()
    if (!corrente) return
    this.esegui(
      this.servizio.rigeneraToken(corrente.versione),
      'Token rigenerato.',
      c => c.webhookToken ?? null
    )
  }

  cambiaInvio(attivo: boolean): void {
    const corrente = this.cfg()
    if (!corrente) return
    this.esegui(
      this.servizio.impostaInvioAttivo(attivo, corrente.versione),
      attivo ? 'Invio attivato.' : 'Invio spento.',
      () => null
    )
  }

  passo(passo: string, fatto: boolean): void {
    const corrente = this.cfg()
    if (!corrente) return
    this.esegui(
      this.servizio.impostaPasso(passo, fatto, corrente.versione),
      'Onboarding aggiornato.',
      () => null
    )
  }

  private esegui(
    chiamata: Observable<ConfigurazioneSdi>,
    messaggio: string,
    token: (c: ConfigurazioneSdi) => string | null
  ): void {
    this.inCorso.set(true)
    this.errore.set(null)
    this.tokenNuovo.set(null)
    chiamata.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: c => {
        this.inCorso.set(false)
        this.applica(c)
        this.tokenNuovo.set(token(c))
        this.toast.success(messaggio, 'Invio SDI')
      },
      error: err => this.fallita(err, 'Impossibile salvare la configurazione.'),
    })
  }

  private fallita(err: unknown, ripiego: string): void {
    this.inCorso.set(false)
    const e = leggiErroriAzione(err, ripiego)
    if (e.conflitto && e.rilettura) {
      this.carica(MESSAGGIO_VERSIONE)
      return
    }
    this.errore.set(e.messaggi.join(' '))
    // L'interruttore e' legato a `cfg`: dopo un rifiuto torna al valore del server.
    this.cfg.set(this.cfg() ? { ...this.cfg()! } : null)
  }
}
