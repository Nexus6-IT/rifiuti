import { Component, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { HttpErrorResponse } from '@angular/common/http'
import { ButtonModule } from 'primeng/button'

import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import {
  CampioneRiga,
  ConfrontoRiconciliazione,
  EsitoCampione,
  RapportoRiconciliazione,
  RiconciliazioneImportService,
  RiepilogoRapporto,
  VoceConfronto,
} from './riconciliazione-import.service'

/** La pagina governa l'import di tutte le aziende: stesso ruolo che il backend pretende. */
const RUOLI_AMMESSI = ['SUPER_ADMIN']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MOTIVO_MINIMO = 5

const ETICHETTA_CONFRONTO: Record<ConfrontoRiconciliazione['esito'], string> = {
  OK: 'Coincide',
  DIFFERENZE: 'Differenze',
  NON_APPLICABILE: 'Non applicabile',
  NON_VERIFICATO: 'Non verificato',
}

/**
 * Pagina «Riconciliazione import» (SUPER_ADMIN): rapporto versionato con i confronti 1-5, il campione a
 * mano (confronto 6), il verbale firmato e la chiusura.
 *
 * TRE REGOLE VISIBILI QUI:
 * 1. Il pulsante «Chiudi» e' sempre mostrato, mai nascosto: e' DISABILITATO con la ragione scritta
 *    accanto (differenze aperte, campioni senza esito o non corrispondenti).
 * 2. La chiusura chiede una conferma in due passaggi e invia la versione letta: se nel frattempo il
 *    rapporto e' cambiato il backend risponde 409 e la pagina lo rilegge.
 * 3. Una differenza si accetta solo con un motivo (minimo 5 caratteri) e crea una versione nuova.
 */
@Component({
  selector: 'app-riconciliazione-import',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Riconciliazione import</h1>
          <p class="page-subtitle">
            Confronto fra l'archivio WinWaste e quanto caricato in WasteFlow. Il rapporto si genera
            con
            <code>migrazione:riconcilia</code>; qui si controllano i confronti, si accettano le
            differenze con un motivo, si da l'esito al campione, si carica il verbale firmato e si
            chiude.
          </p>
        </div>
      </header>

      <section
        *ngIf="!autorizzato()"
        class="surface-card"
        data-testid="riconciliazione-non-autorizzato"
      >
        <div class="empty-state">
          <i class="pi pi-lock empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Accesso riservato</span>
          <p>Questa pagina governa l'import di tutte le aziende: e riservata al SUPER_ADMIN.</p>
        </div>
      </section>

      <ng-container *ngIf="autorizzato()">
        <section class="surface-card">
          <label for="tenant-id"><strong>Azienda (identificativo)</strong></label>
          <div class="flex align-items-center gap-2 mt-2">
            <input
              id="tenant-id"
              type="text"
              class="p-inputtext"
              style="min-width: 24rem"
              placeholder="00000000-0000-0000-0000-000000000000"
              [ngModel]="tenantId()"
              (ngModelChange)="tenantId.set($event.trim())"
              data-testid="riconciliazione-tenant"
            />
            <p-button
              label="Cerca rapporti"
              icon="pi pi-search"
              [disabled]="!tenantValido()"
              (onClick)="caricaElenco()"
              data-testid="riconciliazione-cerca"
            ></p-button>
          </div>
          <p *ngIf="tenantId() && !tenantValido()" class="text-secondary mt-2">
            L'identificativo dell'azienda non e valido.
          </p>
        </section>

        <p *ngIf="errore()" class="mt-3" role="alert" data-testid="riconciliazione-errore">
          {{ errore() }}
        </p>

        <section
          *ngIf="elenco() as righe"
          class="surface-card mt-4"
          data-testid="riconciliazione-elenco"
        >
          <h2>Rapporti</h2>
          <p *ngIf="righe.length === 0">Nessun rapporto per questa azienda.</p>
          <ul class="list-none p-0">
            <li *ngFor="let r of righe" class="flex align-items-center gap-3 py-2">
              <span>
                <strong>{{ r.archivio }}</strong> — versione {{ r.versione }} — {{ r.stato }} —
                {{ r.differenzeAperte }} differenze aperte, {{ r.campioniSenzaEsito }} campioni
                senza esito, {{ r.verbali }} verbali
              </span>
              <p-button
                label="Apri"
                icon="pi pi-folder-open"
                [text]="true"
                (onClick)="apri(r)"
                [attr.data-testid]="'riconciliazione-apri-' + r.radiceId"
              ></p-button>
            </li>
          </ul>
        </section>

        <ng-container *ngIf="rapporto() as r">
          <section class="surface-card mt-4" data-testid="riconciliazione-rapporto">
            <h2>Rapporto {{ r.esiti.archivioSorgente }} — versione {{ r.versione }}</h2>
            <p>
              Stato: <strong data-testid="riconciliazione-stato">{{ r.stato }}</strong> — impronta
              <code>{{ r.hashRapporto }}</code>
            </p>
          </section>

          <section
            *ngFor="let c of r.esiti.confronti"
            class="surface-card mt-4"
            [attr.data-testid]="'riconciliazione-confronto-' + c.numero"
          >
            <h3>
              Confronto {{ c.numero }}: {{ c.titolo }} —
              <span [attr.data-testid]="'riconciliazione-esito-' + c.numero">{{
                etichettaConfronto(c.esito)
              }}</span>
            </h3>
            <p *ngIf="c.nota" class="text-secondary">{{ c.nota }}</p>
            <table *ngIf="c.voci.length > 0" class="w-full">
              <thead>
                <tr>
                  <th>Voce</th>
                  <th>WinWaste</th>
                  <th>WasteFlow</th>
                  <th>Esito</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let v of c.voci">
                  <td>{{ v.descrizione }}</td>
                  <td>{{ v.sorgente ?? '-' }}</td>
                  <td>{{ v.destinazione ?? '-' }}</td>
                  <td>
                    <ng-container *ngIf="v.esito === 'OK'">Coincide</ng-container>
                    <ng-container *ngIf="v.esito === 'DIFFERENZA'">
                      <ng-container *ngIf="accettazione(c, v) as a; else daAccettare">
                        Accettata: {{ a.motivo }}
                      </ng-container>
                      <ng-template #daAccettare>
                        <input
                          type="text"
                          class="p-inputtext"
                          placeholder="Motivo (almeno 5 caratteri)"
                          [ngModel]="motivo(c, v)"
                          (ngModelChange)="impostaMotivo(c, v, $event)"
                          [attr.data-testid]="'riconciliazione-motivo-' + c.numero + '-' + v.chiave"
                          [disabled]="r.stato === 'CHIUSO'"
                        />
                        <p-button
                          label="Accetta"
                          [text]="true"
                          [disabled]="r.stato === 'CHIUSO' || !motivoValido(c, v)"
                          (onClick)="accetta(c, v)"
                          [attr.data-testid]="
                            'riconciliazione-accetta-' + c.numero + '-' + v.chiave
                          "
                        ></p-button>
                      </ng-template>
                    </ng-container>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="surface-card mt-4" data-testid="riconciliazione-campione">
            <h3>Confronto 6: campione a mano</h3>
            <p class="text-secondary">
              Seme <code>{{ r.esiti.campione.seme }}</code
              >: la scelta si puo rifare. Confronta le righe stampate dai due lati e dai l'esito.
            </p>
            <p *ngIf="r.campioni.length === 0">Nessuna riga nel campione.</p>
            <ul class="list-none p-0">
              <li *ngFor="let k of r.campioni" class="flex align-items-center gap-2 py-1">
                <span
                  >{{ k.tipo === 'MOVIMENTO' ? 'Movimento' : 'FIR' }}
                  <code>{{ k.legacyKey ?? k.riferimentoId }}</code> —
                  {{ k.esito ?? 'senza esito' }}</span
                >
                <p-button
                  label="Corrisponde"
                  [text]="true"
                  [disabled]="r.stato === 'CHIUSO'"
                  (onClick)="esito(k, 'CORRISPONDE')"
                  [attr.data-testid]="'riconciliazione-corrisponde-' + k.id"
                ></p-button>
                <p-button
                  label="Non corrisponde"
                  severity="danger"
                  [text]="true"
                  [disabled]="r.stato === 'CHIUSO'"
                  (onClick)="esito(k, 'NON_CORRISPONDE')"
                  [attr.data-testid]="'riconciliazione-non-corrisponde-' + k.id"
                ></p-button>
              </li>
            </ul>
          </section>

          <section class="surface-card mt-4" data-testid="riconciliazione-verbale">
            <h3>Verbale firmato</h3>
            <ul class="list-none p-0">
              <li *ngFor="let v of r.verbali">
                {{ v.nomeFile }} — {{ v.dimensione }} byte — versione {{ v.versioneRapporto }} —
                <code>{{ v.sha256 }}</code>
              </li>
            </ul>
            <p *ngIf="r.verbali.length === 0">Nessun verbale caricato.</p>
            <input
              *ngIf="r.stato === 'APERTO'"
              type="file"
              accept="application/pdf"
              (change)="caricaVerbale($event)"
              data-testid="riconciliazione-verbale-file"
            />
          </section>

          <section class="surface-card mt-4" data-testid="riconciliazione-chiusura">
            <h3>Chiusura</h3>
            <p *ngIf="motivoBlocco() as m" data-testid="riconciliazione-motivo-blocco">{{ m }}</p>
            <div class="flex align-items-center gap-2">
              <p-button
                *ngIf="!confermaChiusura()"
                label="Chiudi rapporto"
                icon="pi pi-lock"
                [disabled]="!!motivoBlocco()"
                (onClick)="confermaChiusura.set(true)"
                data-testid="riconciliazione-chiudi"
              ></p-button>
              <ng-container *ngIf="confermaChiusura()">
                <span>Il rapporto alla versione {{ r.versione }} non si potra piu modificare.</span>
                <p-button
                  label="Conferma chiusura"
                  icon="pi pi-check"
                  severity="danger"
                  (onClick)="chiudi()"
                  data-testid="riconciliazione-conferma-chiusura"
                ></p-button>
                <p-button
                  label="Annulla"
                  [text]="true"
                  (onClick)="confermaChiusura.set(false)"
                ></p-button>
              </ng-container>
            </div>
          </section>
        </ng-container>
      </ng-container>
    </div>
  `,
})
export class RiconciliazioneImportComponent {
  private readonly servizio = inject(RiconciliazioneImportService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)

  readonly tenantId = signal('')
  readonly elenco = signal<RiepilogoRapporto[] | null>(null)
  readonly rapporto = signal<RapportoRiconciliazione | null>(null)
  readonly errore = signal<string | null>(null)
  readonly confermaChiusura = signal(false)
  private readonly motivi = signal<Record<string, string>>({})

  readonly autorizzato = computed(() => {
    const ruolo = this.auth.currentUser()?.role
    return !!ruolo && RUOLI_AMMESSI.includes(ruolo)
  })
  readonly tenantValido = computed(() => UUID.test(this.tenantId()))

  /** Perche' la chiusura e' disabilitata, o `null` se si puo' chiudere. */
  readonly motivoBlocco = computed<string | null>(() => {
    const r = this.rapporto()
    if (!r) return null
    if (r.stato === 'CHIUSO') return 'Il rapporto e gia chiuso.'
    const v = r.valutazione
    const ragioni: string[] = []
    if (v.differenzeAperte.length > 0)
      ragioni.push(`${v.differenzeAperte.length} differenze da accettare con un motivo`)
    if (v.campioniSenzaEsito > 0) ragioni.push(`${v.campioniSenzaEsito} campioni senza esito`)
    if (v.campioniNonCorrispondono > 0)
      ragioni.push(`${v.campioniNonCorrispondono} campioni non corrispondenti (da correggere)`)
    return ragioni.length > 0 ? `Non si puo chiudere: ${ragioni.join(', ')}.` : null
  })

  etichettaConfronto(e: ConfrontoRiconciliazione['esito']): string {
    return ETICHETTA_CONFRONTO[e]
  }

  private chiave(c: ConfrontoRiconciliazione, v: VoceConfronto): string {
    return `${c.numero}:${v.chiave}`
  }

  accettazione(c: ConfrontoRiconciliazione, v: VoceConfronto) {
    return this.rapporto()?.esiti.accettazioni[this.chiave(c, v)] ?? null
  }

  motivo(c: ConfrontoRiconciliazione, v: VoceConfronto): string {
    return this.motivi()[this.chiave(c, v)] ?? ''
  }

  impostaMotivo(c: ConfrontoRiconciliazione, v: VoceConfronto, testo: string): void {
    this.motivi.update(m => ({ ...m, [this.chiave(c, v)]: testo }))
  }

  motivoValido(c: ConfrontoRiconciliazione, v: VoceConfronto): boolean {
    return this.motivo(c, v).trim().length >= MOTIVO_MINIMO
  }

  caricaElenco(): void {
    this.errore.set(null)
    this.rapporto.set(null)
    this.servizio.elenca(this.tenantId()).subscribe({
      next: righe => this.elenco.set(righe),
      error: e => this.errore.set(this.messaggio(e)),
    })
  }

  apri(r: RiepilogoRapporto): void {
    this.rileggi(r.radiceId)
  }

  private rileggi(radiceId: string): void {
    this.errore.set(null)
    this.confermaChiusura.set(false)
    this.servizio.leggi(this.tenantId(), radiceId).subscribe({
      next: r => {
        this.rapporto.set(r)
        this.motivi.set({})
      },
      error: e => this.errore.set(this.messaggio(e)),
    })
  }

  accetta(c: ConfrontoRiconciliazione, v: VoceConfronto): void {
    const r = this.rapporto()
    if (!r || !this.motivoValido(c, v)) return
    this.servizio
      .accetta(this.tenantId(), r.radiceId, r.versione, this.chiave(c, v), this.motivo(c, v).trim())
      .subscribe({
        next: nuovo =>
          this.dopoModifica(nuovo, 'Differenza accettata: nuova versione del rapporto'),
        error: e => this.gestisciErrore(e, r.radiceId),
      })
  }

  esito(k: CampioneRiga, esito: EsitoCampione): void {
    const r = this.rapporto()
    if (!r) return
    this.servizio.esitoCampione(this.tenantId(), r.radiceId, k.id, esito).subscribe({
      next: () => this.rileggi(r.radiceId),
      error: e => this.gestisciErrore(e, r.radiceId),
    })
  }

  caricaVerbale(evento: Event): void {
    const r = this.rapporto()
    const file = (evento.target as HTMLInputElement).files?.[0]
    if (!r || !file) return
    this.servizio.caricaVerbale(this.tenantId(), r.radiceId, r.versione, file).subscribe({
      next: nuovo => this.dopoModifica(nuovo, 'Verbale caricato'),
      error: e => this.gestisciErrore(e, r.radiceId),
    })
  }

  chiudi(): void {
    const r = this.rapporto()
    if (!r || this.motivoBlocco()) return
    this.servizio.chiudi(this.tenantId(), r.radiceId, r.versione).subscribe({
      next: nuovo => this.dopoModifica(nuovo, 'Rapporto chiuso'),
      error: e => this.gestisciErrore(e, r.radiceId),
    })
  }

  private dopoModifica(nuovo: RapportoRiconciliazione, messaggio: string): void {
    this.rapporto.set(nuovo)
    this.motivi.set({})
    this.confermaChiusura.set(false)
    this.toast.success(messaggio)
  }

  /** 409: il rapporto e' cambiato mentre lo guardavi, si rilegge invece di sovrascrivere. */
  private gestisciErrore(e: unknown, radiceId: string): void {
    if (e instanceof HttpErrorResponse && e.status === 409) {
      this.errore.set('Il rapporto e cambiato: ricaricato, ricontrolla prima di procedere.')
      this.rileggi(radiceId)
      return
    }
    this.errore.set(this.messaggio(e))
  }

  private messaggio(e: unknown): string {
    if (e instanceof HttpErrorResponse) {
      const m = (e.error as { message?: unknown } | null)?.message
      if (typeof m === 'string') return m
      if (e.status === 403) return 'Accesso negato.'
    }
    return 'Operazione non riuscita.'
  }
}
