/**
 * Conferma di consegna del FIR con il netto di un accesso di pesa (feature `pese`).
 *
 * Interruttore "Prendi il peso da un accesso di pesa": acceso, elenca gli accessi CHIUSI in
 * CARICO con un netto calcolato (quelli con la targa del FIR per primi) che non sono collegati
 * a nessun documento o sono gia' collegati a questo FIR. Per l'accesso scelto mostra il netto
 * in kg, il valore nell'unita' del FIR (stessa conversione del backend, `nettoNellUnitaFir`) e
 * lo scostamento con la quantita' dichiarata. L'invio e le regole (FIR in transito, non legato a
 * RENTRI, accesso non collegato altrove) restano del backend: i suoi messaggi si mostrano
 * testuali. I permessi arrivano solo da `puoOperare` della risposta, mai dal ruolo.
 */
import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core'
import { catchError, forkJoin, of } from 'rxjs'
import { FIR } from '../../shared/models/fir.model'
import {
  dataItalianaDa,
  formattaKg,
  messaggioErrorePese,
  normalizzaTarga,
} from '../pese/pese-formato'
import { AccessoRiepilogo, PeseService } from '../pese/pese.service'
import { messaggioUnitaNonConvertibile, nettoNellUnitaFir, unitaDiMassa } from './netto-unita-fir'
import {
  calcolaScostamentoPeso,
  formattaNumero,
  formattaPercentuale,
  testoAvvisoScostamento,
} from './scostamento-peso'

export interface SceltaConsegna {
  attivo: boolean
  /** Presente solo se l'accesso scelto ha un netto convertibile nell'unita' del FIR. */
  accessoId: string | null
  convertito: number | null
}

interface Candidato {
  riga: AccessoRiepilogo
  stessaTarga: boolean
}

@Component({
  selector: 'app-consegna-da-accesso',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="cda">
      <label class="cda__interruttore">
        <input
          type="checkbox"
          id="cda-interruttore"
          [checked]="attivo()"
          [disabled]="!abilitato()"
          [attr.aria-describedby]="spiegazione() ? 'cda-spiegazione' : null"
          (change)="alCambioInterruttore($any($event.target).checked)"
          data-testid="cda-interruttore"
        />
        Prendi il peso da un accesso di pesa
      </label>
      <small
        *ngIf="spiegazione() as s"
        id="cda-spiegazione"
        class="cda__nota"
        data-testid="cda-spiegazione"
        >{{ s }}</small
      >

      <ng-container *ngIf="attivo()">
        <p *ngIf="caricamento()" role="status" class="cda__nota">Caricamento degli accessi…</p>
        <p
          *ngIf="erroreElenco() as e"
          role="alert"
          class="cda__errore"
          data-testid="cda-errore-elenco"
        >
          {{ e }}
        </p>
        <fieldset
          class="cda__elenco"
          *ngIf="!caricamento() && !erroreElenco()"
          data-testid="cda-elenco"
        >
          <legend class="cda__nota">Accessi chiusi in carico</legend>
          <label
            class="cda__voce"
            *ngFor="let c of candidati()"
            [attr.data-testid]="'cda-accesso-' + c.riga.id"
          >
            <input
              type="radio"
              name="cda-accesso"
              [value]="c.riga.id"
              [checked]="scelto() === c.riga.id"
              (change)="scegli(c.riga.id)"
              [attr.data-testid]="'cda-radio-' + c.riga.id"
            />
            <span
              >{{ c.riga.numero }} — {{ c.riga.targa || 'senza targa' }} —
              {{ data(c.riga.apertoIl) }} — netto {{ kg(c.riga.nettoKg!)
              }}<ng-container *ngIf="c.stessaTarga"> — stessa targa del FIR</ng-container></span
            >
          </label>
          <p class="cda__nota" *ngIf="!candidati().length" data-testid="cda-vuoto">
            Nessun accesso chiuso in carico disponibile per questa consegna.
          </p>
        </fieldset>

        <div *ngIf="anteprima() as a" class="cda__anteprima" data-testid="cda-anteprima">
          <p class="cda__riga">
            Netto della pesa: <strong>{{ kg(a.riga.nettoKg!) }}</strong>
            <ng-container *ngIf="a.valore !== null">
              = <strong>{{ numero(a.valore!) }} {{ unita }}</strong> nel FIR (dichiarata:
              {{ numero(fir.rifiuto.quantita) }} {{ unita }})
            </ng-container>
          </p>
          <p
            *ngIf="a.errore as errore"
            role="alert"
            class="cda__errore"
            data-testid="cda-errore-conversione"
          >
            {{ errore }}
          </p>
          <p *ngIf="a.differenza as d" class="cda__riga" data-testid="cda-scostamento">
            Scostamento dalla quantità dichiarata: {{ d }}
          </p>
          <p *ngIf="a.avviso as v" role="status" class="cda__avviso" data-testid="cda-avviso">
            {{ v }}
          </p>
        </div>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .cda {
        margin-bottom: var(--spacing-base, 1rem);
      }
      .cda__interruttore {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .cda__nota {
        display: block;
        color: var(--text-color-secondary, #555);
      }
      .cda__errore {
        color: var(--red-700, #b91c1c);
      }
      .cda__avviso {
        color: var(--orange-700, #b45309);
      }
      .cda__elenco {
        border: 1px solid var(--surface-border, #ccc);
        max-height: 200px;
        overflow: auto;
        padding: 0.5rem;
        margin: 0.5rem 0;
      }
      .cda__voce {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        padding: 0.25rem 0;
      }
    `,
  ],
})
export class ConsegnaDaAccessoComponent implements OnInit {
  private readonly pese = inject(PeseService)

  @Input({ required: true }) fir!: FIR
  @Output() cambio = new EventEmitter<SceltaConsegna>()

  readonly attivo = signal(false)
  readonly caricamento = signal(false)
  readonly erroreElenco = signal<string | null>(null)
  readonly candidati = signal<Candidato[]>([])
  readonly scelto = signal<string | null>(null)
  readonly puoOperare = signal(true)

  readonly kg = formattaKg
  readonly data = dataItalianaDa
  readonly numero = formattaNumero

  get unita(): string {
    return this.fir.rifiuto.unitaMisura
  }

  ngOnInit(): void {
    if (unitaDiMassa(this.unita)) this.carica()
  }

  abilitato(): boolean {
    return unitaDiMassa(this.unita) && this.puoOperare()
  }

  spiegazione(): string | null {
    if (!unitaDiMassa(this.unita)) return messaggioUnitaNonConvertibile(this.unita)
    if (!this.puoOperare())
      return 'Il tuo ruolo nell’azienda selezionata non consente di usare le pese.'
    return null
  }

  anteprima() {
    const id = this.scelto()
    const c = this.candidati().find(x => x.riga.id === id)
    if (!c || c.riga.nettoKg === null) return null
    const conversione = nettoNellUnitaFir(c.riga.nettoKg, this.unita)
    let avviso: string | null = null
    let differenza: string | null = null
    if (conversione.ok) {
      const s = calcolaScostamentoPeso(this.fir.rifiuto.quantita, conversione.valore, this.unita)
      if (s.percentuale !== null) differenza = formattaPercentuale(s.percentuale)
      if (s.oltreSoglia) avviso = testoAvvisoScostamento(s, this.fir.rifiuto.quantita)
    }
    return {
      riga: c.riga,
      valore: conversione.ok ? conversione.valore : null,
      errore: conversione.ok ? null : conversione.messaggio,
      avviso,
      differenza,
    }
  }

  alCambioInterruttore(acceso: boolean): void {
    this.attivo.set(acceso)
    this.scelto.set(null)
    this.emetti()
  }

  scegli(id: string): void {
    this.scelto.set(id)
    this.emetti()
  }

  private emetti(): void {
    const a = this.attivo() ? this.anteprima() : null
    const ok = a ? a.valore : null
    this.cambio.emit({
      attivo: this.attivo(),
      accessoId: ok !== null && a ? a.riga.id : null,
      convertito: ok,
    })
  }

  /** Rilegge l'elenco (dopo un rifiuto del backend, ad esempio un 409). */
  ricarica(): void {
    this.scelto.set(null)
    this.carica()
    this.emetti()
  }

  private carica(): void {
    const targa = normalizzaTarga(this.fir.trasportatore?.targaVeicolo ?? '')
    this.caricamento.set(true)
    this.erroreElenco.set(null)
    forkJoin([
      this.pese.elencaAccessi({ stato: 'CHIUSO' }),
      targa ? this.pese.elencaAccessi({ stato: 'CHIUSO', targa }) : of(null),
    ]).subscribe({
      next: ([generale, conTarga]) => {
        this.puoOperare.set(generale.puoOperare)
        const righe = [...(conTarga?.righe ?? []), ...generale.righe]
        const viste = new Set<string>()
        const candidati: Candidato[] = []
        for (const riga of righe) {
          if (viste.has(riga.id)) continue
          viste.add(riga.id)
          if (riga.verso !== 'CARICO' || riga.nettoKg === null) continue
          candidati.push({ riga, stessaTarga: !!targa && riga.targa === targa })
        }
        candidati.sort((a, b) => Number(b.stessaTarga) - Number(a.stessaTarga))
        this.filtraCollegati(candidati)
      },
      error: err => {
        this.caricamento.set(false)
        this.erroreElenco.set(messaggioErrorePese(err, 'Impossibile leggere gli accessi di pesa.'))
      },
    })
  }

  /** Un accesso gia' collegato resta solo se il legame attivo e' proprio con questo FIR. */
  private filtraCollegati(candidati: Candidato[]): void {
    const collegati = candidati.filter(c => c.riga.collegato)
    if (!collegati.length) {
      this.candidati.set(candidati)
      this.caricamento.set(false)
      return
    }
    forkJoin(
      collegati.map(c => this.pese.dettaglioAccesso(c.riga.id).pipe(catchError(() => of(null))))
    ).subscribe(dettagli => {
      const daTenere = new Set<string>()
      dettagli.forEach((d, i) => {
        const legato = d?.collegamenti.some(
          l => !l.revocatoIl && l.tipo === 'FIR' && l.fir?.id === this.fir.id
        )
        if (legato) daTenere.add(collegati[i].riga.id)
      })
      this.candidati.set(candidati.filter(c => !c.riga.collegato || daTenere.has(c.riga.id)))
      this.caricamento.set(false)
    })
  }
}
