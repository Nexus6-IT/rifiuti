import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { Observable } from 'rxjs'
import { SceltaConNuovoComponent } from '../clienti/scelta-con-nuovo.component'
import { CodificaRentri } from './listino.model'
import { ChiaveOpzione, OpzioniListino } from './opzioni-listino'
import { RigaCampoComponent } from './riga-campo.component'
import { RigaForm } from './riga-modulo'
import { RigaRicercaComponent, VoceRicerca } from './riga-ricerca.component'
import {
  CampoRiga,
  ETICHETTE_FAMIGLIA,
  OPZIONI_TIPO_PROVVIGIONE,
  OPZIONI_TIPO_QUANTITA,
  OPZIONI_TIPOLOGIA_RIFIUTO,
  TIPI_ELENCABILI,
} from './vocabolario-listino'

export interface RichiestaNuovo {
  chiave: ChiaveOpzione
  evento: unknown
}

const CONDIZIONI = [1, 2, 3, 4, 5, 6, 7, 8, 9]

/**
 * Prima parte del dialog della riga: la scelta del CER o dell'addebito, il tipo, i dati, la
 * quantità, il prezzo, il codice IVA, i dati del rifiuto, la classificazione e le note. I campi
 * fuori famiglia non compaiono (`stato.abilitato`); sotto ogni campo c'è il messaggio del backend.
 * La sezione non parla con il backend: scelta e "Nuovo …" salgono al dialog.
 */
@Component({
  selector: 'app-riga-dati-sezione',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    SceltaConNuovoComponent,
    RigaCampoComponent,
    RigaRicercaComponent,
  ],
  template: `
    <div [formGroup]="stato.form" class="sezioni">
      <fieldset class="gruppo" data-testid="riga-sezione-dati">
        <legend>Riga</legend>
        <div class="riga">
          <div class="campo campo--largo">
            <span class="etichetta" id="riga-scelta-etichetta">CER o addebito</span>
            <p class="scelta" data-testid="riga-scelta" aria-live="polite">
              {{ stato.sceltaTesto() || 'Nessuna scelta' }}
            </p>
            <div class="scelta__ricerca">
              <app-riga-ricerca
                inputId="riga-ricerca"
                testid="riga-ricerca"
                ariaLabel="CER o addebito"
                segnaposto="Cerca un codice CER o un addebito"
                [cerca]="cerca"
                [disabilitato]="soloLettura"
                (scelta)="sceltaVoce.emit($event)"
              />
              <p-button
                *ngIf="puoCreare && !soloLettura"
                label="Nuovo addebito"
                icon="pi pi-plus"
                [text]="true"
                size="small"
                (onClick)="nuovoAddebito.emit($event)"
                data-testid="riga-nuovo-addebito"
              />
            </div>
            <small
              *ngFor="let e of erroriScelta()"
              role="alert"
              class="field-error"
              data-testid="riga-errore-scelta"
              >{{ e }}</small
            >
          </div>
          <app-riga-campo
            campoId="riga-tipo"
            etichetta="Tipo"
            campo="tipo"
            [errori]="stato.erroriDi('tipo')"
          >
            <select
              id="riga-tipo"
              formControlName="tipo"
              class="p-inputtext"
              [attr.disabled]="tipoBloccato() ? '' : null"
              data-testid="riga-tipo"
            >
              <option value="">—</option>
              <option value="CER">CER - {{ famiglie.CER }}</option>
              <option *ngFor="let t of tipi" [value]="t.tipo">
                {{ t.tipo }} - {{ t.etichetta }}
              </option>
            </select>
          </app-riga-campo>
          <app-riga-campo
            *ngIf="chiedeCifre()"
            campoId="riga-tipo-cifre"
            etichetta="Categoria (tre cifre)"
            campo="tipoCifre"
          >
            <input
              pInputText
              id="riga-tipo-cifre"
              formControlName="tipoCifre"
              [attr.disabled]="tipoBloccato() ? '' : null"
              maxlength="3"
              inputmode="numeric"
              data-testid="riga-tipo-cifre"
            />
          </app-riga-campo>
        </div>
        <p *ngIf="stato.famiglia() as f" class="field-hint" data-testid="riga-famiglia">
          {{ famiglie[f] }}
        </p>
        <div class="riga" *ngIf="stato.famiglia()">
          <app-riga-campo
            *ngIf="ab('riferimento')"
            campoId="riga-riferimento"
            etichetta="Riferimento"
            campo="riferimento"
            [errori]="stato.erroriDi('riferimento')"
          >
            <input
              pInputText
              id="riga-riferimento"
              formControlName="riferimento"
              maxlength="8"
              data-testid="riga-riferimento"
            />
          </app-riga-campo>
          <app-riga-campo
            *ngIf="ab('descrizione')"
            class="campo--largo"
            campoId="riga-descrizione"
            etichetta="Descrizione"
            campo="descrizione"
            [errori]="stato.erroriDi('descrizione')"
          >
            <input
              pInputText
              id="riga-descrizione"
              formControlName="descrizione"
              maxlength="45"
              data-testid="riga-descrizione"
            />
          </app-riga-campo>
        </div>
      </fieldset>

      <ng-container *ngIf="stato.famiglia()">
        <fieldset class="gruppo" data-testid="riga-sezione-quantita">
          <legend>Quantità</legend>
          <div class="riga">
            <app-riga-campo
              *ngIf="ab('tipoQuantita')"
              campoId="riga-tipo-quantita"
              etichetta="Quantità"
              campo="tipoQuantita"
              [errori]="stato.erroriDi('tipoQuantita')"
            >
              <select
                id="riga-tipo-quantita"
                formControlName="tipoQuantita"
                class="p-inputtext"
                data-testid="riga-tipo-quantita"
              >
                <option value="">—</option>
                <option *ngFor="let o of tipiQuantita" [value]="o.value">{{ o.label }}</option>
              </select>
            </app-riga-campo>
            <app-riga-campo
              *ngIf="ab('quantitaFissa')"
              campoId="riga-quantita-fissa"
              etichetta="Quantità fissa (vuota = 1)"
              campo="quantitaFissa"
              [errori]="stato.erroriDi('quantitaFissa')"
            >
              <input
                pInputText
                id="riga-quantita-fissa"
                formControlName="quantitaFissa"
                inputmode="decimal"
                data-testid="riga-quantita-fissa"
              />
            </app-riga-campo>
            <app-riga-campo
              *ngIf="ab('unitaMisura')"
              campoId="riga-unita"
              etichetta="Unità di misura"
              campo="unitaMisura"
              [errori]="stato.erroriDi('unitaMisura')"
            >
              <input
                pInputText
                id="riga-unita"
                formControlName="unitaMisura"
                maxlength="3"
                data-testid="riga-unita"
              />
            </app-riga-campo>
            <app-riga-campo
              *ngIf="ab('stimaAnnuaKg')"
              campoId="riga-stima"
              etichetta="Stima annua (kg)"
              campo="stimaAnnuaKg"
              [errori]="stato.erroriDi('stimaAnnuaKg')"
            >
              <input
                pInputText
                id="riga-stima"
                formControlName="stimaAnnuaKg"
                inputmode="decimal"
                data-testid="riga-stima"
              />
            </app-riga-campo>
          </div>
        </fieldset>

        <fieldset class="gruppo" data-testid="riga-sezione-prezzo">
          <legend>Prezzo</legend>
          <div class="riga">
            <app-riga-campo
              *ngIf="ab('prezzo')"
              campoId="riga-prezzo"
              etichetta="Prezzo"
              campo="prezzo"
              [errori]="stato.erroriDi('prezzo')"
            >
              <input
                pInputText
                id="riga-prezzo"
                formControlName="prezzo"
                inputmode="decimal"
                data-testid="riga-prezzo"
              />
            </app-riga-campo>
            <app-riga-campo
              *ngIf="ab('sconto')"
              campoId="riga-sconto"
              etichetta="Sconto (es. 10+5)"
              campo="sconto"
              [errori]="stato.erroriDi('sconto')"
            >
              <input
                pInputText
                id="riga-sconto"
                formControlName="sconto"
                data-testid="riga-sconto"
              />
            </app-riga-campo>
            <app-riga-campo
              *ngIf="ab('provvigione')"
              campoId="riga-provvigione"
              etichetta="Provvigione (%)"
              campo="provvigione"
              [errori]="stato.erroriDi('provvigione')"
            >
              <input
                pInputText
                id="riga-provvigione"
                formControlName="provvigione"
                data-testid="riga-provvigione"
              />
            </app-riga-campo>
            <app-riga-campo
              *ngIf="ab('tipoProvvigione')"
              campoId="riga-tipo-provvigione"
              etichetta="Provvigione calcolata"
              campo="tipoProvvigione"
              [errori]="stato.erroriDi('tipoProvvigione')"
            >
              <select
                id="riga-tipo-provvigione"
                formControlName="tipoProvvigione"
                class="p-inputtext"
                data-testid="riga-tipo-provvigione"
              >
                <option value="">—</option>
                <option *ngFor="let o of tipiProvvigione" [value]="o.value">{{ o.label }}</option>
              </select>
            </app-riga-campo>
            <app-riga-campo
              *ngIf="ab('condizione')"
              campoId="riga-condizione"
              etichetta="Condizione"
              campo="condizione"
              [errori]="stato.erroriDi('condizione')"
            >
              <select
                id="riga-condizione"
                formControlName="condizione"
                class="p-inputtext"
                data-testid="riga-condizione"
              >
                <option value="">—</option>
                <option *ngFor="let c of condizioni" [value]="c">{{ c }}</option>
              </select>
            </app-riga-campo>
          </div>
          <div class="riga">
            <label class="spunta" *ngIf="ab('prezzoSpeciale')" for="riga-prezzo-speciale">
              <input
                type="checkbox"
                id="riga-prezzo-speciale"
                formControlName="prezzoSpeciale"
                data-testid="riga-prezzo-speciale"
              />
              Prezzo speciale (a fasce)
            </label>
            <small
              *ngFor="let e of stato.erroriDi('prezzoSpeciale')"
              role="alert"
              class="field-error"
              data-testid="riga-errore-prezzoSpeciale"
              >{{ e }}</small
            >
            <app-riga-campo
              *ngIf="ab('minimoFatturabile')"
              campoId="riga-minimo"
              etichetta="Minimo fatturabile"
              campo="minimoFatturabile"
              [errori]="stato.erroriDi('minimoFatturabile')"
            >
              <input
                pInputText
                id="riga-minimo"
                formControlName="minimoFatturabile"
                inputmode="decimal"
                data-testid="riga-minimo"
              />
              <small
                *ngIf="stato.minimoBloccato()"
                class="field-hint"
                data-testid="riga-minimo-nota"
              >
                Con il prezzo speciale il minimo non si indica.
              </small>
            </app-riga-campo>
            <label class="spunta" *ngIf="ab('minimoPerCategoria')" for="riga-minimo-categoria">
              <input
                type="checkbox"
                id="riga-minimo-categoria"
                formControlName="minimoPerCategoria"
                data-testid="riga-minimo-categoria"
              />
              Minimo per categoria
            </label>
            <small
              *ngFor="let e of stato.erroriDi('minimoPerCategoria')"
              role="alert"
              class="field-error"
              data-testid="riga-errore-minimoPerCategoria"
              >{{ e }}</small
            >
          </div>
          <div class="riga">
            <div class="campo">
              <app-scelta-con-nuovo
                inputId="riga-iva"
                testid="riga-iva"
                etichetta="Codice IVA"
                [controllo]="stato.form.controls.codiceIvaId"
                [opzioni]="opzioni.lista['IVA']()"
                nuovoEtichetta="Nuovo codice IVA"
                nuovoTestid="riga-nuovo-iva"
                [puoCreare]="puoCreare && !soloLettura"
                (nuovo)="nuovo.emit({ chiave: 'IVA', evento: $event })"
              />
              <small
                *ngFor="let e of stato.erroriDi('codiceIvaId')"
                role="alert"
                class="field-error"
                data-testid="riga-errore-codiceIvaId"
                >{{ e }}</small
              >
            </div>
          </div>
        </fieldset>

        <fieldset class="gruppo" *ngIf="ab('tipologiaRifiuto')" data-testid="riga-sezione-rifiuto">
          <legend>Rifiuto</legend>
          <div class="riga">
            <app-riga-campo
              campoId="riga-tipologia"
              etichetta="Tipologia"
              campo="tipologiaRifiuto"
              [errori]="stato.erroriDi('tipologiaRifiuto')"
            >
              <select
                id="riga-tipologia"
                formControlName="tipologiaRifiuto"
                class="p-inputtext"
                data-testid="riga-tipologia"
              >
                <option value="">—</option>
                <option *ngFor="let o of tipologie" [value]="o.value">{{ o.label }}</option>
              </select>
            </app-riga-campo>
            <app-riga-campo
              campoId="riga-stato-fisico"
              etichetta="Stato fisico"
              campo="statoFisico"
              [errori]="stato.erroriDi('statoFisico')"
            >
              <select
                id="riga-stato-fisico"
                formControlName="statoFisico"
                class="p-inputtext"
                data-testid="riga-stato-fisico"
              >
                <option value="">—</option>
                <option
                  *ngFor="let o of conCorrente(statiFisici, 'statoFisico'); trackBy: perCodice"
                  [value]="o.codice"
                >
                  {{ o.descrizione ? o.codice + ' - ' + o.descrizione : o.codice }}
                </option>
              </select>
            </app-riga-campo>
            <app-riga-campo
              campoId="riga-operazione"
              etichetta="Operazione"
              campo="operazione"
              [errori]="stato.erroriDi('operazione')"
            >
              <select
                id="riga-operazione"
                formControlName="operazione"
                class="p-inputtext"
                data-testid="riga-operazione"
              >
                <option value="">—</option>
                <option
                  *ngFor="let o of conCorrente(operazioni, 'operazione'); trackBy: perCodice"
                  [value]="o.codice"
                >
                  {{ o.descrizione ? o.codice + ' - ' + o.descrizione : o.codice }}
                </option>
              </select>
            </app-riga-campo>
          </div>
        </fieldset>

        <fieldset class="gruppo" data-testid="riga-sezione-classificazione">
          <legend>Classificazione</legend>
          <div class="riga">
            <div class="campo" *ngIf="ab('categoriaId')">
              <app-scelta-con-nuovo
                inputId="riga-categoria"
                testid="riga-categoria"
                etichetta="Categoria"
                [controllo]="stato.form.controls.categoriaId"
                [opzioni]="opzioni.lista['CATEGORIA']()"
                nuovoEtichetta="Nuova categoria"
                nuovoTestid="riga-nuova-categoria"
                [puoCreare]="puoCreare && !soloLettura"
                (nuovo)="nuovo.emit({ chiave: 'CATEGORIA', evento: $event })"
              />
              <small
                *ngFor="let e of stato.erroriDi('categoriaId')"
                role="alert"
                class="field-error"
                data-testid="riga-errore-categoriaId"
                >{{ e }}</small
              >
            </div>
            <div class="campo" *ngIf="ab('centroRicavoId')">
              <app-scelta-con-nuovo
                inputId="riga-centro"
                testid="riga-centro"
                etichetta="Centro di ricavo"
                [controllo]="stato.form.controls.centroRicavoId"
                [opzioni]="opzioni.lista['CENTRO_RICAVO']()"
                nuovoEtichetta="Nuovo centro di ricavo"
                nuovoTestid="riga-nuovo-centro"
                [puoCreare]="puoCreare && !soloLettura"
                (nuovo)="nuovo.emit({ chiave: 'CENTRO_RICAVO', evento: $event })"
              />
              <small
                *ngFor="let e of stato.erroriDi('centroRicavoId')"
                role="alert"
                class="field-error"
                data-testid="riga-errore-centroRicavoId"
                >{{ e }}</small
              >
            </div>
          </div>
        </fieldset>

        <fieldset class="gruppo" data-testid="riga-sezione-note">
          <legend>Note</legend>
          <div class="riga">
            <app-riga-campo
              *ngIf="ab('appunti')"
              campoId="riga-appunti"
              etichetta="Appunti"
              campo="appunti"
              [errori]="stato.erroriDi('appunti')"
            >
              <input
                pInputText
                id="riga-appunti"
                formControlName="appunti"
                maxlength="135"
                data-testid="riga-appunti"
              />
            </app-riga-campo>
            <app-riga-campo
              *ngIf="ab('notaUsoInterno')"
              campoId="riga-nota"
              etichetta="Nota d'uso interno"
              campo="notaUsoInterno"
              [errori]="stato.erroriDi('notaUsoInterno')"
            >
              <input
                pInputText
                id="riga-nota"
                formControlName="notaUsoInterno"
                maxlength="45"
                data-testid="riga-nota"
              />
            </app-riga-campo>
          </div>
        </fieldset>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .sezioni {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .gruppo {
        border: 1px solid var(--surface-border, #ddd);
        border-radius: 6px;
        padding: 0.5rem 0.75rem 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        min-width: 0;
      }
      .riga {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: flex-start;
      }
      .campo {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        flex: 1 1 14rem;
        min-width: 0;
      }
      .campo--largo {
        flex: 3 1 18rem;
      }
      .scelta {
        margin: 0;
        font-weight: 600;
      }
      .scelta__ricerca {
        display: flex;
        gap: 0.5rem;
        align-items: flex-start;
      }
      .scelta__ricerca app-riga-ricerca {
        flex: 1 1 auto;
      }
      .spunta {
        display: inline-flex;
        gap: 0.4rem;
        align-items: center;
        align-self: center;
      }
    `,
  ],
})
export class RigaDatiSezioneComponent {
  @Input({ required: true }) stato!: RigaForm
  @Input({ required: true }) opzioni!: OpzioniListino
  @Input({ required: true }) cerca!: (testo: string) => Observable<VoceRicerca[]>
  @Input() statiFisici: readonly CodificaRentri[] = []
  @Input() operazioni: readonly CodificaRentri[] = []
  @Input() puoCreare = false
  @Input() soloLettura = false
  /** Scelta di un CER o di un addebito dalla ricerca. */
  @Output() sceltaVoce = new EventEmitter<VoceRicerca>()
  @Output() nuovoAddebito = new EventEmitter<unknown>()
  @Output() nuovo = new EventEmitter<RichiestaNuovo>()

  readonly famiglie = ETICHETTE_FAMIGLIA
  readonly tipi = TIPI_ELENCABILI
  readonly tipiQuantita = OPZIONI_TIPO_QUANTITA
  readonly tipiProvvigione = OPZIONI_TIPO_PROVVIGIONE
  readonly tipologie = OPZIONI_TIPOLOGIA_RIFIUTO
  readonly condizioni = CONDIZIONI

  perCodice(_i: number, c: CodificaRentri): string {
    return c.codice
  }

  ab(campo: CampoRiga): boolean {
    return this.stato.abilitato(campo)
  }

  /** Scelto un addebito, il tipo è il suo (m7): per cambiarlo si sceglie un altro addebito o un CER. */
  tipoBloccato(): boolean {
    const v = this.stato.form.getRawValue()
    return v.addebitoId !== '' && !this.soloLettura
  }

  chiedeCifre(): boolean {
    return this.stato.form.controls.tipo.value.endsWith('???')
  }

  /** Gli errori della scelta: del CER o dell'addebito, secondo il tipo. */
  erroriScelta(): string[] {
    return [...this.stato.erroriDi('cerCode'), ...this.stato.erroriDi('addebitoId')]
  }

  /** La voce già salvata resta fra le opzioni anche se non è più nell'elenco delle codifiche. */
  conCorrente(
    lista: readonly CodificaRentri[],
    campo: 'statoFisico' | 'operazione'
  ): readonly CodificaRentri[] {
    const corrente = this.stato.form.controls[campo].value
    return corrente === '' || lista.some(c => c.codice === corrente)
      ? lista
      : [...lista, { codice: corrente, descrizione: '' }]
  }
}
