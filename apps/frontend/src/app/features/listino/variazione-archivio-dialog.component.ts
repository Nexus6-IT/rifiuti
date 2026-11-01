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
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { Opzione, etichettaCodice } from '../clienti/opzioni-fatturazione'
import { messaggioErrore } from '../clienti/tabelle/tabella-comune'
import {
  AnteprimaVariazione,
  CorpoVariazione,
  NumeroListino,
  TipoVariazione,
} from './listino.model'
import { ListinoService } from './listino.service'
import { puoVariarePrezzi } from './permessi-listino'
import { ETICHETTE_TIPO_VARIAZIONE, TIPI_ELENCABILI } from './vocabolario-listino'

const TUTTI_I_LISTINI: readonly NumeroListino[] = [1, 2, 3, 4, 5, 6]
const TIPI = Object.keys(ETICHETTE_TIPO_VARIAZIONE) as TipoVariazione[]
const MESSAGGIO_409 = 'I dati sono cambiati dopo l’anteprima: rifai l’anteprima.'

/**
 * Variazione dei prezzi dell'archivio (E22, D21): prima l'anteprima (vecchio → nuovo per addebito e
 * listino), poi, solo da lì, il riepilogo di conferma e l'applicazione con l'impronta
 * dell'anteprima. Qualsiasi modifica ai criteri scarta l'anteprima; un 409 (l'archivio è cambiato
 * nel frattempo) obbliga a rifarla. Il valore è un testo con il punto decimale (R12).
 */
@Component({
  selector: 'app-variazione-archivio-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, DialogModule, InputTextModule],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      header="Variazione prezzi dell'archivio"
      [modal]="true"
      [style]="{ width: '52rem' }"
      [breakpoints]="{ '960px': '95vw' }"
    >
      <div *ngIf="esito() !== null" class="dlg-form" data-testid="var-esito" role="status">
        <p>Prezzi aggiornati: {{ esito() }}</p>
      </div>

      <div *ngIf="esito() === null && inRiepilogo()" class="dlg-form" data-testid="var-riepilogo">
        <p>
          Stai per modificare i prezzi dell'archivio. L'operazione non si annulla e non tocca i
          contratti.
        </p>
        <ul>
          <li *ngFor="let r of riepilogo()">{{ r }}</li>
        </ul>
      </div>

      <form
        *ngIf="esito() === null"
        [formGroup]="form"
        class="dlg-form"
        [hidden]="inRiepilogo()"
        (ngSubmit)="anteprima()"
      >
        <label for="var-tipo">Tipo di variazione</label>
        <select id="var-tipo" formControlName="tipo" class="p-inputtext" data-testid="var-tipo">
          <option *ngFor="let t of tipi" [value]="t">{{ etichette[t] }}</option>
        </select>

        <ng-container *ngIf="!sostituzioneIva()">
          <label for="var-valore">{{ etichettaValore() }}</label>
          <input
            pInputText
            id="var-valore"
            formControlName="valore"
            inputmode="decimal"
            data-testid="var-valore"
          />
        </ng-container>
        <ng-container *ngIf="sostituzioneIva()">
          <label for="var-da-iva">Dal codice IVA</label>
          <select
            id="var-da-iva"
            formControlName="daCodiceIvaId"
            class="p-inputtext"
            data-testid="var-da-iva"
          >
            <option value="">—</option>
            <option *ngFor="let o of codiciIva()" [value]="o.id">{{ o.etichetta }}</option>
          </select>
          <label for="var-a-iva">Al codice IVA</label>
          <select
            id="var-a-iva"
            formControlName="aCodiceIvaId"
            class="p-inputtext"
            data-testid="var-a-iva"
          >
            <option value="">—</option>
            <option *ngFor="let o of codiciIva()" [value]="o.id">{{ o.etichetta }}</option>
          </select>
        </ng-container>

        <fieldset class="listini">
          <legend>Categorie (nessuna = tutte)</legend>
          <label *ngFor="let o of categorie()" class="spunta">
            <input
              type="checkbox"
              [checked]="categorieScelte().includes(o.id)"
              (change)="cambiaCategoria(o.id, $any($event.target).checked)"
              [attr.data-testid]="'var-cat-' + o.id"
            />
            {{ o.etichetta }}
          </label>
        </fieldset>

        <fieldset class="listini">
          <legend>Tipi di addebito (nessuno = tutti)</legend>
          <label *ngFor="let t of tipiProposti" class="spunta" [attr.title]="t.etichetta">
            <input
              type="checkbox"
              [checked]="tipiScelti().includes(t.tipo)"
              (change)="cambiaTipo(t.tipo, $any($event.target).checked)"
              [attr.data-testid]="'var-tipo-' + t.tipo"
            />
            {{ t.tipo }}
          </label>
        </fieldset>

        <fieldset class="listini">
          <legend>Listini da variare</legend>
          <label *ngFor="let n of numeri" class="spunta">
            <input
              type="checkbox"
              [checked]="listini().includes(n)"
              (change)="cambiaListino(n, $any($event.target).checked)"
              [attr.data-testid]="'var-listino-' + n"
            />
            Listino {{ n }}
          </label>
        </fieldset>
        <p *ngIf="addebitiIds?.length" class="field-hint" data-testid="var-solo-addebito">
          La variazione riguarda solo l'addebito scelto dall'elenco.
        </p>
      </form>

      <ng-container *ngIf="esito() === null && !inRiepilogo() && anteprimaCorrente() as a">
        <h3 class="sezione">Anteprima: {{ a.totale }} prezzi da modificare</h3>
        <p *ngIf="a.righe.length === 0" data-testid="var-nessuna-riga">
          Nessun prezzo corrisponde ai criteri.
        </p>
        <table *ngIf="a.righe.length > 0" class="anteprima" data-testid="var-righe">
          <thead>
            <tr>
              <th scope="col">Addebito</th>
              <th scope="col">Listino</th>
              <th scope="col">Prima</th>
              <th scope="col" aria-label="diventa"></th>
              <th scope="col">Dopo</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let r of a.righe">
              <td>{{ r.descrizione }}</td>
              <td>{{ r.listino }}</td>
              <td>{{ r.prima }}</td>
              <td aria-hidden="true">→</td>
              <td>{{ r.dopo }}</td>
            </tr>
          </tbody>
        </table>
        <div *ngIf="a.errori.length > 0" data-testid="var-errori">
          <h4>Errori nell'anteprima</h4>
          <p role="alert" class="field-error">
            Con questi errori la variazione non può essere applicata: correggi gli addebiti indicati
            o restringi i criteri, poi rifai l'anteprima.
          </p>
          <ul>
            <li *ngFor="let e of a.errori">{{ e.descrizione }}: {{ e.messaggio }}</li>
          </ul>
        </div>
      </ng-container>

      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="var-errore">{{ e }}</p>

      <ng-template pTemplate="footer">
        <p-button
          [label]="esito() !== null ? 'Chiudi' : 'Annulla'"
          [text]="true"
          [disabled]="applicando()"
          (onClick)="chiudi()"
          data-testid="var-chiudi"
        />
        <ng-container *ngIf="esito() === null">
          <ng-container *ngIf="!inRiepilogo()">
            <p-button
              label="Anteprima"
              icon="pi pi-eye"
              [outlined]="true"
              [disabled]="!puoAnteprima()"
              (onClick)="anteprima()"
              data-testid="var-anteprima"
            />
            <p-button
              *ngIf="anteprimaCorrente() !== null"
              label="Applica"
              icon="pi pi-check"
              [disabled]="!puoApplicare()"
              (onClick)="avanti()"
              data-testid="var-applica"
            />
          </ng-container>
          <ng-container *ngIf="inRiepilogo()">
            <p-button
              label="Indietro"
              [text]="true"
              [disabled]="inCorso()"
              (onClick)="inRiepilogo.set(false)"
              data-testid="var-indietro"
            />
            <p-button
              label="Conferma la variazione"
              icon="pi pi-check"
              [disabled]="inCorso() || !puoApplicare()"
              (onClick)="applica()"
              data-testid="var-conferma-finale"
            />
          </ng-container>
        </ng-container>
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
      .listini {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        border: 1px solid var(--surface-border, #ccc);
        padding: 0.5rem;
      }
      .spunta {
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .anteprima {
        width: 100%;
        border-collapse: collapse;
      }
      .anteprima th,
      .anteprima td {
        padding: 0.25rem 0.5rem;
        text-align: left;
      }
      .sezione {
        margin: 0.75rem 0 0.25rem;
      }
    `,
  ],
})
export class VariazioneArchivioDialogComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ListinoService)
  private readonly auth = inject(AuthService)

  @Input() visible = false
  /** Solo questi addebiti (azione della riga); null = tutto l'archivio. */
  @Input() addebitiIds: string[] | null = null
  /** Numero dei prezzi aggiornati. */
  @Output() applicata = new EventEmitter<number>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly tipi = TIPI
  readonly etichette = ETICHETTE_TIPO_VARIAZIONE
  readonly numeri = TUTTI_I_LISTINI
  /** `T???` e `M???` stanno per ogni categoria: come filtro non hanno una forma esatta. */
  readonly tipiProposti = TIPI_ELENCABILI.filter(t => !t.tipo.includes('?'))
  readonly categorieScelte = signal<string[]>([])
  readonly tipiScelti = signal<string[]>([])
  readonly applicando = signal(false)
  readonly categorie = signal<Opzione[]>([])
  readonly codiciIva = signal<Opzione[]>([])
  readonly listini = signal<NumeroListino[]>([...TUTTI_I_LISTINI])
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  readonly inRiepilogo = signal(false)
  readonly riepilogo = signal<string[]>([])
  readonly esito = signal<number | null>(null)
  /** Anteprima ancora valida per i criteri correnti. */
  readonly anteprimaCorrente = signal<AnteprimaVariazione | null>(null)

  readonly form = new FormGroup({
    tipo: new FormControl<TipoVariazione>('AUMENTO_PERCENTUALE', { nonNullable: true }),
    valore: new FormControl('', { nonNullable: true }),
    daCodiceIvaId: new FormControl('', { nonNullable: true }),
    aCodiceIvaId: new FormControl('', { nonNullable: true }),
  })

  /** Corpo con cui è stata chiesta l'anteprima: è quello che si applica, non il form di adesso. */
  private corpo: CorpoVariazione | null = null
  private letture?: Subscription
  private richiesta?: Subscription
  private applicazione?: Subscription
  private modifiche?: Subscription

  constructor() {
    this.modifiche = this.form.valueChanges.subscribe(() => this.scarta())
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  ngOnDestroy(): void {
    this.letture?.unsubscribe()
    this.richiesta?.unsubscribe()
    this.applicazione?.unsubscribe()
    this.modifiche?.unsubscribe()
  }

  private inizializza(): void {
    this.letture?.unsubscribe()
    this.richiesta?.unsubscribe()
    this.applicazione?.unsubscribe()
    this.applicando.set(false)
    this.form.reset({ tipo: 'AUMENTO_PERCENTUALE' })
    this.categorieScelte.set([])
    this.tipiScelti.set([])
    this.listini.set([...TUTTI_I_LISTINI])
    this.corpo = null
    this.anteprimaCorrente.set(null)
    this.inRiepilogo.set(false)
    this.riepilogo.set([])
    this.esito.set(null)
    this.errore.set(null)
    this.inCorso.set(false)
    const s = new Subscription()
    this.letture = s
    s.add(
      this.servizio.codifiche.list('CATEGORIA').subscribe({
        next: l =>
          this.categorie.set(
            l.map(c => ({ id: c.id, etichetta: etichettaCodice(c.codice, c.descrizione) }))
          ),
        error: () => this.categorie.set([]),
      })
    )
    s.add(
      this.servizio.codiciIva.list().subscribe({
        next: l =>
          this.codiciIva.set(
            l.map(c => ({ id: c.id, etichetta: etichettaCodice(c.codice, c.descrizione) }))
          ),
        error: () => this.codiciIva.set([]),
      })
    )
  }

  sostituzioneIva(): boolean {
    return this.form.controls.tipo.value === 'SOSTITUZIONE_IVA'
  }

  etichettaValore(): string {
    const t = this.form.controls.tipo.value
    return t.endsWith('PERCENTUALE') ? 'Percentuale (%)' : 'Importo (€)'
  }

  puoVariare(): boolean {
    return puoVariarePrezzi(this.auth.currentUser()?.role)
  }

  /** Cambiano i criteri: l'anteprima non vale più e l'impronta con lei. */
  private scarta(): void {
    this.richiesta?.unsubscribe()
    this.corpo = null
    this.anteprimaCorrente.set(null)
    this.inRiepilogo.set(false)
    this.inCorso.set(false)
  }

  cambiaListino(n: NumeroListino, scelto: boolean): void {
    const attuali = this.listini().filter(x => x !== n)
    this.listini.set((scelto ? [...attuali, n] : attuali).sort((a, b) => a - b))
    this.scarta()
  }

  cambiaCategoria(id: string, scelta: boolean): void {
    this.categorieScelte.update(v =>
      scelta ? [...v.filter(x => x !== id), id] : v.filter(x => x !== id)
    )
    this.scarta()
  }

  cambiaTipo(tipo: string, scelto: boolean): void {
    this.tipiScelti.update(v =>
      scelto ? [...v.filter(x => x !== tipo), tipo] : v.filter(x => x !== tipo)
    )
    this.scarta()
  }

  private criteriCompleti(): boolean {
    const v = this.form.getRawValue()
    if (this.listini().length === 0) return false
    return this.sostituzioneIva()
      ? v.daCodiceIvaId !== '' && v.aCodiceIvaId !== ''
      : v.valore.trim() !== ''
  }

  puoAnteprima(): boolean {
    return this.criteriCompleti()
  }

  puoApplicare(): boolean {
    const a = this.anteprimaCorrente()
    return (
      a !== null &&
      a.righe.length > 0 &&
      a.errori.length === 0 &&
      !this.inCorso() &&
      this.puoVariare()
    )
  }

  private costruisciCorpo(): CorpoVariazione {
    const v = this.form.getRawValue()
    const ids = this.addebitiIds
    return {
      tipo: v.tipo,
      ...(this.sostituzioneIva()
        ? { daCodiceIvaId: v.daCodiceIvaId, aCodiceIvaId: v.aCodiceIvaId }
        : { valore: v.valore.trim().replace(/,/g, '.') }),
      filtri: {
        ...(ids && ids.length > 0 ? { addebitiIds: ids } : {}),
        ...(this.categorieScelte().length > 0 ? { categorieIds: this.categorieScelte() } : {}),
        ...(this.tipiScelti().length > 0 ? { tipi: this.tipiScelti() } : {}),
        listini: this.listini(),
      },
    }
  }

  anteprima(): void {
    if (!this.puoAnteprima()) return
    const corpo = this.costruisciCorpo()
    this.richiesta?.unsubscribe()
    this.anteprimaCorrente.set(null)
    this.errore.set(null)
    this.inCorso.set(true)
    this.richiesta = this.servizio.addebiti.anteprimaVariazione(corpo).subscribe({
      next: a => {
        this.inCorso.set(false)
        this.corpo = corpo
        this.anteprimaCorrente.set(a)
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErrore(err, "Impossibile calcolare l'anteprima."))
      },
    })
  }

  /** Primo passo dell'applicazione: riepilogo e conferma (la variazione non si annulla). */
  avanti(): void {
    const a = this.anteprimaCorrente()
    if (!this.puoApplicare() || !a) return
    const v = this.form.getRawValue()
    const righe = [`Tipo: ${this.etichette[v.tipo]}`]
    if (this.sostituzioneIva()) {
      const nome = (id: string) => this.codiciIva().find(o => o.id === id)?.etichetta ?? 'scelto'
      righe.push(`Da ${nome(v.daCodiceIvaId)} a ${nome(v.aCodiceIvaId)}`)
    } else {
      righe.push(`Valore: ${v.valore.trim()}${v.tipo.endsWith('PERCENTUALE') ? ' %' : ' €'}`)
    }
    righe.push(`Listini: ${this.listini().join(', ')}`)
    const nomi = this.categorieScelte().map(
      id => this.categorie().find(o => o.id === id)?.etichetta ?? 'scelta'
    )
    righe.push(`Categorie: ${nomi.length > 0 ? nomi.join(', ') : 'tutte'}`)
    righe.push(
      `Tipi di addebito: ${this.tipiScelti().length > 0 ? this.tipiScelti().join(', ') : 'tutti'}`
    )
    if (this.addebitiIds?.length) righe.push('Solo l’addebito scelto dall’elenco')
    righe.push(`Prezzi da modificare: ${a.totale}`)
    this.riepilogo.set(righe)
    this.errore.set(null)
    this.inRiepilogo.set(true)
  }

  applica(): void {
    const a = this.anteprimaCorrente()
    const corpo = this.corpo
    if (!this.puoApplicare() || !this.inRiepilogo() || !a || !corpo) return
    this.inCorso.set(true)
    this.applicando.set(true)
    this.errore.set(null)
    this.applicazione = this.servizio.addebiti
      .applicaVariazione({ ...corpo, impronta: a.impronta })
      .subscribe({
        next: r => {
          this.inCorso.set(false)
          this.applicando.set(false)
          this.inRiepilogo.set(false)
          this.anteprimaCorrente.set(null)
          this.corpo = null
          this.esito.set(r.aggiornati)
          this.applicata.emit(r.aggiornati)
        },
        error: err => {
          this.inCorso.set(false)
          this.applicando.set(false)
          this.inRiepilogo.set(false)
          this.anteprimaCorrente.set(null)
          this.corpo = null
          this.errore.set(
            (err as { status?: number })?.status === 409
              ? MESSAGGIO_409
              : messaggioErrore(err, 'Impossibile applicare la variazione.')
          )
        },
      })
  }

  chiudi(): void {
    if (this.applicando()) return
    this.richiesta?.unsubscribe()
    this.visibleChange.emit(false)
  }
}
