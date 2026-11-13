/**
 * Dettaglio di un accesso: pesate (originale ed effettiva, storico delle rettifiche), netto con
 * qualita' e avvisi, collegamenti a FIR e registro con la differenza in kg.
 *
 * I permessi arrivano solo dal backend (`puoOperare`, `puoRettificare`): il frontend non li
 * deduce dal ruolo. Una pesata manuale ha SEMPRE il badge "Manuale" e l'avviso che non ha
 * garanzia metrologica. Gli allegati si aprono con `apriAllegato` (scaricati con
 * l'autenticazione, mai un link diretto). I messaggi del backend si mostrano testuali.
 */
import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { ToastService } from '../../core/services/toast.service'
import { CollegaDocumentoDialogComponent } from './collega-documento-dialog.component'
import { ricordaFuoco } from './fuoco'
import { MotivoDialogComponent } from './motivo-dialog.component'
import {
  badgePesata,
  etichettaFonte,
  etichettaQualita,
  formattaKg,
  MESSAGGIO_GIA_REGISTRATA,
  messaggioErrorePese,
} from './pese-formato'
import { STILI_PESE } from './pese-stili'
import { AVVISO_PESATA_MANUALE } from './pesata-manuale-form.component'
import { RettificaPesataDialogComponent } from './rettifica-pesata-dialog.component'
import { SecondaPesataDialogComponent } from './seconda-pesata-dialog.component'
import {
  AccessoVista,
  AllegatoVista,
  CollegamentoVista,
  PesataVista,
  PeseService,
  AgenteVista,
  StrumentoPesa,
} from './pese.service'

type Dialogo =
  | { tipo: 'seconda' }
  | { tipo: 'rettifica'; pesata: PesataVista }
  | { tipo: 'collega' }
  | { tipo: 'annulla' }
  | { tipo: 'revoca'; collegamento: CollegamentoVista }

const formatoDataOra = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  dateStyle: 'short',
  timeStyle: 'short',
})

/** Come nel backend: l'avviso e' gia' mostrato a parte, qui non si ripete. */
const AVVISO_SIMULATA_BACKEND = 'Pesata simulata: non è un peso reale.'

@Component({
  selector: 'app-accesso-dettaglio',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    CollegaDocumentoDialogComponent,
    MotivoDialogComponent,
    RettificaPesataDialogComponent,
    SecondaPesataDialogComponent,
  ],
  template: `
    <p-button
      label="Torna all'elenco"
      icon="pi pi-arrow-left"
      [text]="true"
      (onClick)="indietro.emit()"
      data-testid="ad-indietro"
      ariaLabel="Torna all'elenco degli accessi"
    ></p-button>

    <p *ngIf="caricamento()" role="status" class="nota">Caricamento…</p>
    <p
      *ngIf="erroreCaricamento() as e"
      role="alert"
      class="field-error"
      data-testid="ad-errore-caricamento"
    >
      {{ e }}
    </p>

    <ng-container *ngIf="accesso() as a">
      <header class="testata">
        <h2 class="titolo" tabindex="-1" id="ad-titolo">Accesso {{ a.numero }}</h2>
        <span class="badge" [class.badge-ko]="a.stato === 'ANNULLATO'" data-testid="ad-stato">{{
          etichettaStato(a.stato)
        }}</span>
        <span class="badge" data-testid="ad-verso">{{
          a.verso === 'CARICO' ? 'Carico' : 'Scarico'
        }}</span>
      </header>
      <dl class="riepilogo">
        <dt>Registro</dt>
        <dd>{{ a.registro.descrizione }}</dd>
        <dt>Mezzo</dt>
        <dd>
          {{ a.automezzo?.targa || a.targa || '—'
          }}<ng-container *ngIf="a.targaRimorchio || a.automezzo?.targaRimorchio">
            + {{ a.targaRimorchio || a.automezzo?.targaRimorchio }}</ng-container
          >
        </dd>
        <dt>CER</dt>
        <dd>{{ a.cerCode || '—' }}</dd>
        <dt>Aperto il</dt>
        <dd>{{ dataOra(a.apertoIl) }}</dd>
        <dt *ngIf="a.chiusoIl">Chiuso il</dt>
        <dd *ngIf="a.chiusoIl">{{ dataOra(a.chiusoIl) }}</dd>
        <ng-container *ngIf="a.annullatoIl">
          <dt>Annullato il</dt>
          <dd>{{ dataOra(a.annullatoIl) }}</dd>
          <dt>Motivo dell'annullamento</dt>
          <dd data-testid="ad-motivo-annullo">{{ a.motivoAnnullamento }}</dd>
        </ng-container>
        <dt *ngIf="a.descrizione">Descrizione</dt>
        <dd *ngIf="a.descrizione">{{ a.descrizione }}</dd>
        <dt *ngIf="a.note">Note</dt>
        <dd *ngIf="a.note">{{ a.note }}</dd>
      </dl>

      <p *ngIf="a.netto.simulato" class="avviso-manuale" data-testid="ad-avviso-simulata">
        Accesso con pesate simulate: non è un peso reale e non si usa nei documenti.
      </p>
      <p *ngIf="haManuale(a)" class="avviso-manuale" data-testid="ad-avviso-manuale">
        {{ avvisoManuale }}
      </p>

      <section aria-labelledby="ad-netto-titolo" class="blocco">
        <h3 id="ad-netto-titolo">Netto</h3>
        <ng-container [ngSwitch]="a.netto.stato">
          <p
            *ngSwitchCase="'NON_VALIDO'"
            class="field-error"
            role="alert"
            data-testid="ad-netto-errore"
          >
            Netto non valido: {{ a.netto.errore }}
          </p>
          <p *ngSwitchCase="'INCOMPLETO'" class="nota" data-testid="ad-netto-incompleto">
            Netto non ancora calcolabile: manca una pesata.
          </p>
          <div *ngSwitchDefault data-testid="ad-netto">
            <p class="netto-valore">
              <strong data-testid="ad-netto-valore">{{ kg(a.netto.nettoKg!) }}</strong>
              <span class="badge" data-testid="ad-qualita">{{ qualita(a.netto.qualita) }}</span>
              <span *ngIf="a.netto.rettificato" class="badge">Con rettifiche</span>
            </p>
            <p class="nota">
              Lordo {{ a.netto.lordoKg != null ? kg(a.netto.lordoKg) : '—' }} − tara
              {{ a.netto.taraKg != null ? kg(a.netto.taraKg) : '—' }}
            </p>
          </div>
        </ng-container>
        <ul class="avvisi" *ngIf="avvisi(a).length" data-testid="ad-avvisi">
          <li *ngFor="let v of avvisi(a)">{{ v }}</li>
        </ul>
      </section>

      <section aria-labelledby="ad-pesate-titolo" class="blocco">
        <h3 id="ad-pesate-titolo">Pesate</h3>
        <div class="table-responsive">
          <table class="tabella" data-testid="ad-pesate">
            <caption class="solo-lettori">
              Pesate dell'accesso
              {{
                a.numero
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">N.</th>
                <th scope="col">Fonte</th>
                <th scope="col">Peso originale</th>
                <th scope="col">Peso effettivo</th>
                <th scope="col">Strumento</th>
                <th scope="col">Registrata il</th>
                <th scope="col">Azioni</th>
              </tr>
            </thead>
            <tbody>
              <ng-container *ngFor="let p of a.pesate">
                <tr [attr.data-testid]="'ad-pesata-' + p.ordine">
                  <td>{{ p.ordine }}</td>
                  <td>
                    {{ fonte(p.fonte) }}
                    <div class="nota" *ngIf="p.agente" [attr.data-testid]="'ad-agente-' + p.ordine">
                      Agente: {{ p.agente }}
                    </div>
                    <span
                      class="badge"
                      *ngFor="let b of badge(p)"
                      [class.badge-ko]="b === 'Dato alterato' || b === 'Firma non verificata'"
                      [class.badge-simulata]="b === 'Simulata'"
                      [attr.data-testid]="'ad-badge-' + p.ordine"
                      >{{ b }}</span
                    >
                  </td>
                  <td>{{ kg(p.pesoOriginaleKg) }}</td>
                  <td>
                    <ng-container *ngIf="p.rettifiche.length; else uguale"
                      ><strong data-testid="ad-effettivo">{{
                        kg(p.pesoEffettivoKg)
                      }}</strong></ng-container
                    ><ng-template #uguale>—</ng-template>
                  </td>
                  <td>
                    {{ p.strumento?.descrizione || p.strumentoEsterno || '—' }}
                    <div class="nota" *ngIf="p.alibiId">Alibi {{ p.alibiId }}</div>
                    <div class="nota" *ngIf="p.oraStrumento">
                      Ora strumento {{ dataOra(p.oraStrumento) }}
                    </div>
                  </td>
                  <td>
                    {{ dataOra(p.oraRicezione) }}
                    <div class="nota" *ngIf="p.operatore">{{ p.operatore }}</div>
                  </td>
                  <td class="azioni-riga">
                    <p-button
                      *ngIf="p.allegato"
                      label="Apri allegato"
                      icon="pi pi-paperclip"
                      [text]="true"
                      size="small"
                      (onClick)="apriAllegato(p.allegato)"
                      [attr.data-testid]="'ad-allegato-' + p.ordine"
                      [ariaLabel]="'Apri l\\'allegato della pesata ' + p.ordine"
                    ></p-button>
                    <p-button
                      *ngIf="puoRettificarePesata(a, p)"
                      label="Rettifica"
                      icon="pi pi-pencil"
                      [text]="true"
                      size="small"
                      (onClick)="apriDialogo({ tipo: 'rettifica', pesata: p }, $event)"
                      [attr.data-testid]="'ad-rettifica-' + p.ordine"
                      [ariaLabel]="'Rettifica il peso della pesata ' + p.ordine"
                    ></p-button>
                  </td>
                </tr>
                <tr
                  *ngIf="p.motivo || p.avvisi.length || p.rettifiche.length"
                  class="dettaglio-riga"
                >
                  <td></td>
                  <td colspan="6">
                    <div *ngIf="p.motivo" class="nota">Motivo: {{ p.motivo }}</div>
                    <ul class="avvisi" *ngIf="p.avvisi.length">
                      <li *ngFor="let v of avvisiPesata(p)">{{ v }}</li>
                    </ul>
                    <div *ngIf="p.rettifiche.length" [attr.data-testid]="'ad-storico-' + p.ordine">
                      <strong class="nota">Rettifiche</strong>
                      <ol class="storico">
                        <li *ngFor="let r of p.rettifiche">
                          n. {{ r.numero }}: {{ kg(r.pesoPrecedenteKg) }} →
                          {{ kg(r.pesoNuovoKg) }} —
                          {{ r.motivo }}
                          <span class="nota"
                            >({{ r.autore || 'utente' }}, {{ dataOra(r.createdAt) }})</span
                          >
                          <span class="badge badge-ko" *ngIf="!r.integra">Dato alterato</span>
                          <p-button
                            *ngIf="r.allegato"
                            label="Apri allegato"
                            [text]="true"
                            size="small"
                            (onClick)="apriAllegato(r.allegato)"
                            [ariaLabel]="'Apri l\\'allegato della rettifica ' + r.numero"
                          ></p-button>
                        </li>
                      </ol>
                    </div>
                  </td>
                </tr>
              </ng-container>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="ad-coll-titolo" class="blocco">
        <h3 id="ad-coll-titolo">Documenti collegati</h3>
        <p class="nota" *ngIf="!a.collegamenti.length" data-testid="ad-coll-vuoti">
          Nessun documento collegato.
        </p>
        <ul class="collegamenti" *ngIf="a.collegamenti.length" data-testid="ad-collegamenti">
          <li
            *ngFor="let c of a.collegamenti"
            [attr.data-testid]="'ad-coll-' + c.id"
            [class.revocato]="!!c.revocatoIl"
          >
            <span>{{ descrizioneCollegamento(c) }}</span>
            <ng-container *ngIf="!c.revocatoIl && c.confronto as k">
              <span
                *ngIf="k.confrontabile"
                class="diff"
                [class.diff-ko]="k.differenzaKg !== 0"
                data-testid="ad-differenza"
              >
                Differenza {{ differenza(k.differenzaKg!) }}
              </span>
              <span *ngIf="!k.confrontabile" class="nota">Non confrontabile (unità diversa).</span>
            </ng-container>
            <span *ngIf="c.revocatoIl" class="nota"
              >Revocato il {{ dataOra(c.revocatoIl) }}: {{ c.motivoRevoca }}</span
            >
            <p-button
              *ngIf="a.puoRettificare && !c.revocatoIl && a.stato !== 'ANNULLATO'"
              label="Revoca"
              [text]="true"
              size="small"
              (onClick)="apriDialogo({ tipo: 'revoca', collegamento: c }, $event)"
              [attr.data-testid]="'ad-revoca-' + c.id"
              [ariaLabel]="'Revoca il collegamento a ' + descrizioneCollegamento(c)"
            ></p-button>
          </li>
        </ul>
      </section>

      <p
        *ngIf="erroreAzione() as e"
        class="field-error"
        role="alert"
        data-testid="ad-errore-azione"
      >
        {{ e }}
      </p>
      <div class="azioni azioni-sinistra">
        <p-button
          *ngIf="puoSecondaPesata(a)"
          label="Seconda pesata"
          icon="pi pi-plus"
          (onClick)="apriDialogo({ tipo: 'seconda' }, $event)"
          data-testid="ad-seconda"
        ></p-button>
        <p-button
          *ngIf="a.puoOperare && a.stato !== 'ANNULLATO'"
          label="Collega un documento"
          icon="pi pi-link"
          [outlined]="true"
          (onClick)="apriDialogo({ tipo: 'collega' }, $event)"
          data-testid="ad-collega"
        ></p-button>
        <p-button
          *ngIf="puoAnnullare(a)"
          label="Annulla l'accesso"
          icon="pi pi-times"
          severity="danger"
          [outlined]="true"
          (onClick)="apriDialogo({ tipo: 'annulla' }, $event)"
          data-testid="ad-annulla"
        ></p-button>
      </div>
    </ng-container>

    <ng-container *ngIf="dialogo() as d">
      <ng-container *ngIf="accesso() as a" [ngSwitch]="d.tipo">
        <app-seconda-pesata-dialog
          *ngSwitchCase="'seconda'"
          [accesso]="a"
          [strumenti]="strumenti"
          [agenti]="agenti"
          (fatto)="fatto($event, 'Seconda pesata registrata.')"
          (chiuso)="chiudiDialogo()"
          (ricarica)="carica()"
        ></app-seconda-pesata-dialog>
        <app-rettifica-pesata-dialog
          *ngSwitchCase="'rettifica'"
          [accesso]="a"
          [pesata]="$any(d).pesata"
          (fatto)="fatto($event, 'Rettifica registrata.')"
          (chiuso)="chiudiDialogo()"
          (ricarica)="carica()"
        ></app-rettifica-pesata-dialog>
        <app-collega-documento-dialog
          *ngSwitchCase="'collega'"
          [accesso]="a"
          (fatto)="fatto($event, 'Documento collegato.')"
          (chiuso)="chiudiDialogo()"
          (ricarica)="carica()"
        ></app-collega-documento-dialog>
        <app-motivo-dialog
          *ngSwitchCase="'annulla'"
          titolo="Annulla l'accesso"
          [messaggio]="
            'Stai per annullare l\\'accesso ' +
            a.numero +
            '. Le pesate restano registrate ma l\\'accesso non conta più.'
          "
          etichettaConferma="Annulla l'accesso"
          [inCorso]="inCorso()"
          [errore]="erroreDialogo()"
          (conferma)="annullaAccesso($event)"
          (annulla)="chiudiDialogo()"
        ></app-motivo-dialog>
        <app-motivo-dialog
          *ngSwitchCase="'revoca'"
          titolo="Revoca il collegamento"
          [messaggio]="
            'Stai per revocare il collegamento a ' +
            descrizioneCollegamento($any(d).collegamento) +
            ' dell\\'accesso ' +
            a.numero +
            '.'
          "
          etichettaConferma="Revoca"
          [inCorso]="inCorso()"
          [errore]="erroreDialogo()"
          (conferma)="revoca($any(d).collegamento, $event)"
          (annulla)="chiudiDialogo()"
        ></app-motivo-dialog>
      </ng-container>
    </ng-container>
  `,
  styles: [
    STILI_PESE,
    `
      .testata {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }
      .titolo {
        margin: 0;
        font-size: var(--font-size-lg);
      }
      .badge {
        display: inline-block;
        padding: 0 var(--spacing-sm);
        border-radius: 999px;
        border: 1px solid currentColor;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        margin-left: var(--spacing-xs);
      }
      .badge-ko {
        color: var(--color-danger);
      }
      .badge-simulata {
        color: var(--badge-simulata-ink, #6d28d9);
      }
      .riepilogo {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--spacing-xs) var(--spacing-base);
        margin: var(--spacing-base) 0;
      }
      .riepilogo dt {
        color: var(--text-secondary);
      }
      .riepilogo dd {
        margin: 0;
      }
      .blocco {
        margin-top: var(--spacing-base);
      }
      .blocco h3 {
        font-size: var(--font-size-base);
        margin: 0 0 var(--spacing-sm);
      }
      .tabella {
        width: 100%;
        border-collapse: collapse;
      }
      .tabella th,
      .tabella td {
        text-align: left;
        padding: var(--spacing-xs) var(--spacing-sm);
        vertical-align: top;
        border-bottom: 1px solid var(--rule);
      }
      .tabella th {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--text-tertiary);
        white-space: nowrap;
        border-bottom-color: var(--surface-border);
      }
      .solo-lettori {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .avvisi {
        margin: var(--spacing-xs) 0;
        padding-left: var(--spacing-base);
        color: var(--color-warning);
        font-size: var(--font-size-sm);
      }
      .storico {
        margin: var(--spacing-xs) 0;
        padding-left: var(--spacing-base);
      }
      .collegamenti {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .collegamenti li {
        display: flex;
        gap: var(--spacing-base);
        align-items: center;
        flex-wrap: wrap;
        padding: var(--spacing-xs) 0;
      }
      .collegamenti li.revocato {
        opacity: 0.7;
        text-decoration: none;
      }
      .diff {
        font-weight: var(--font-weight-medium);
      }
      .diff-ko {
        color: var(--color-danger);
      }
      .azioni-sinistra {
        justify-content: flex-start;
      }
      .netto-valore {
        font-size: var(--font-size-lg);
        margin: 0;
      }
    `,
  ],
})
export class AccessoDettaglioComponent implements OnInit {
  private readonly pese = inject(PeseService)
  private readonly toast = inject(ToastService)

  @Input({ required: true }) accessoId!: string
  @Input() strumenti: StrumentoPesa[] = []
  @Input() agenti: AgenteVista[] = []
  @Output() indietro = new EventEmitter<void>()
  /** Qualcosa e' cambiato: l'elenco va riletto quando si torna indietro. */
  @Output() modificato = new EventEmitter<void>()

  readonly accesso = signal<AccessoVista | null>(null)
  readonly caricamento = signal(false)
  readonly erroreCaricamento = signal<string | null>(null)
  readonly erroreAzione = signal<string | null>(null)
  readonly dialogo = signal<Dialogo | null>(null)
  readonly inCorso = signal(false)
  readonly erroreDialogo = signal<string | null>(null)

  readonly avvisoManuale = AVVISO_PESATA_MANUALE
  readonly kg = formattaKg
  readonly badge = badgePesata
  readonly fonte = etichettaFonte
  readonly qualita = etichettaQualita
  private ripristinaFuoco: (() => void) | null = null
  private fuocoMesso = false

  ngOnInit(): void {
    this.carica()
  }

  carica(): void {
    this.caricamento.set(true)
    this.erroreCaricamento.set(null)
    this.pese.dettaglioAccesso(this.accessoId).subscribe({
      next: a => {
        this.accesso.set(a)
        this.caricamento.set(false)
        if (!this.fuocoMesso) {
          this.fuocoMesso = true
          setTimeout(() => document.getElementById('ad-titolo')?.focus())
        }
      },
      error: err => {
        this.caricamento.set(false)
        this.erroreCaricamento.set(messaggioErrorePese(err, "Impossibile leggere l'accesso."))
      },
    })
  }

  dataOra(iso: string): string {
    return formatoDataOra.format(new Date(iso))
  }
  etichettaStato(s: AccessoVista['stato']): string {
    return s === 'APERTO' ? 'Aperto (mezzo in impianto)' : s === 'CHIUSO' ? 'Chiuso' : 'Annullato'
  }
  haManuale(a: AccessoVista): boolean {
    return a.pesate.some(p => p.fonte === 'MANUALE')
  }
  /** L'avviso metrologico e' gia' mostrato a parte: qui non si ripete. */
  avvisi(a: AccessoVista): string[] {
    return [...new Set([...a.avvisi, ...a.netto.avvisi])].filter(
      v => v !== AVVISO_PESATA_MANUALE && v !== AVVISO_SIMULATA_BACKEND
    )
  }
  avvisiPesata(p: PesataVista): string[] {
    return p.avvisi.filter(v => v !== AVVISO_PESATA_MANUALE && v !== AVVISO_SIMULATA_BACKEND)
  }
  puoRettificarePesata(a: AccessoVista, p: PesataVista): boolean {
    return a.puoRettificare && a.stato !== 'ANNULLATO' && p.fonte !== 'TARA_ANAGRAFICA'
  }
  puoSecondaPesata(a: AccessoVista): boolean {
    return a.puoOperare && a.stato === 'APERTO' && a.modo === 'DOPPIA'
  }
  puoAnnullare(a: AccessoVista): boolean {
    return (a.stato === 'APERTO' && a.puoOperare) || (a.stato === 'CHIUSO' && a.puoRettificare)
  }
  descrizioneCollegamento(c: CollegamentoVista): string {
    if (c.tipo === 'FIR' && c.fir) return `FIR ${c.fir.numero} (${c.fir.stato})`
    if (c.movimento) {
      const n = c.movimento.numeroVigente ?? c.movimento.numero
      return `Annotazione del registro n. ${n}${c.movimento.annullato ? ' (annullata)' : ''}`
    }
    return 'Documento'
  }
  differenza(kgDiff: number): string {
    return `${kgDiff > 0 ? '+' : ''}${formattaKg(kgDiff)}`
  }

  apriAllegato(al: AllegatoVista): void {
    this.erroreAzione.set(null)
    this.pese.apriAllegato(al.id).subscribe({
      error: err =>
        this.erroreAzione.set(messaggioErrorePese(err, "Impossibile aprire l'allegato.")),
    })
  }

  apriDialogo(d: Dialogo, ev?: unknown): void {
    this.ripristinaFuoco = ricordaFuoco(ev)
    this.erroreDialogo.set(null)
    this.erroreAzione.set(null)
    this.dialogo.set(d)
  }

  chiudiDialogo(): void {
    this.dialogo.set(null)
    this.inCorso.set(false)
    this.ripristinaFuoco?.()
    this.ripristinaFuoco = null
  }

  fatto(a: AccessoVista, messaggio: string): void {
    this.accesso.set(a)
    this.modificato.emit()
    this.chiudiDialogo()
    if (a.giaRegistrata) this.toast.info(MESSAGGIO_GIA_REGISTRATA)
    else this.toast.success(messaggio)
  }

  annullaAccesso(motivo: string): void {
    const a = this.accesso()
    if (!a || this.inCorso()) return
    this.inCorso.set(true)
    this.erroreDialogo.set(null)
    this.pese.annullaAccesso(a.id, motivo).subscribe({
      next: nuovo => this.fatto(nuovo, `Accesso ${a.numero} annullato.`),
      error: err => this.erroreAlDialogo(err, "Annullamento dell'accesso non riuscito."),
    })
  }

  revoca(c: CollegamentoVista, motivo: string): void {
    if (this.inCorso()) return
    this.inCorso.set(true)
    this.erroreDialogo.set(null)
    this.pese.revocaCollegamento(c.id, motivo).subscribe({
      next: nuovo => this.fatto(nuovo, 'Collegamento revocato.'),
      error: err => this.erroreAlDialogo(err, 'Revoca del collegamento non riuscita.'),
    })
  }

  private erroreAlDialogo(err: any, generico: string): void {
    this.inCorso.set(false)
    this.erroreDialogo.set(messaggioErrorePese(err, generico))
    if (err?.status === 409) this.carica()
  }
}
