import { Directive, inject, signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { Subscription } from 'rxjs'
import { ToastService } from '../../../core/services/toast.service'
import { ApiCodifiche, CodificaBase, VocabolarioCodifiche } from './codifica-comune'
import {
  chiediConferma,
  eseguiERicarica,
  messaggioErrore,
  permessoScrittura,
  cambiaStatoConConferma,
} from './tabella-comune'

/**
 * Logica comune delle schede delle codifiche (R25): elenco, apertura del dialog, cambio di stato
 * ed eliminazione con conferma. La scheda concreta fornisce rotte, vocabolario e genere corrente;
 * il suo template resta suo (titolo o selettore del genere, `data-testid`).
 */
@Directive()
export abstract class CodificheTabellaBase<T extends CodificaBase<G>, G extends string> {
  protected abstract readonly api: ApiCodifiche<T, G>
  protected abstract readonly vocabolario: VocabolarioCodifiche<G>
  protected abstract genereCorrente(): G

  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)
  private lettura?: Subscription

  readonly puoScrivere = permessoScrittura()
  readonly righe = signal<T[]>([])
  readonly erroreElenco = signal<string | null>(null)
  readonly dialogoAperto = signal(false)
  readonly selezionata = signal<T | null>(null)

  concordanza(): { nuovo: string; articolo: string } {
    return this.vocabolario.concordanza(this.genereCorrente())
  }

  /** Una risposta in ritardo del genere precedente non deve riempire l'elenco del corrente. */
  carica(): void {
    this.lettura?.unsubscribe()
    this.lettura = this.api.list(this.genereCorrente(), true).subscribe({
      next: r => {
        this.righe.set(r)
        this.erroreElenco.set(null)
      },
      error: err => this.erroreElenco.set(messaggioErrore(err, "Impossibile caricare l'elenco.")),
    })
  }

  apri(c: T | null): void {
    this.selezionata.set(c)
    this.dialogoAperto.set(true)
  }

  /** «Disattiva» chiede conferma, «Riattiva» no. */
  chiediCambiaStato(c: T): void {
    const g = this.vocabolario.etichetta(c.genere).toLowerCase()
    cambiaStatoConConferma(
      this.conferma,
      c.attiva,
      `${this.vocabolario.concordanza(c.genere).articolo} ${g} "${c.codice} - ${c.descrizione}"`,
      () => this.cambiaStato(c)
    )
  }

  cambiaStato(c: T): void {
    eseguiERicarica(
      this.api.modifica(c.id, { attiva: !c.attiva, versione: c.versione }),
      this.toast,
      'Impossibile cambiare lo stato.',
      () => this.carica()
    )
  }

  elimina(c: T): void {
    const g = this.vocabolario.etichetta(c.genere).toLowerCase()
    chiediConferma(
      this.conferma,
      `Eliminare ${this.vocabolario.concordanza(c.genere).articolo} ${g} "${c.codice} - ${c.descrizione}"?`,
      () => this.eliminaConfermata(c)
    )
  }

  eliminaConfermata(c: T): void {
    eseguiERicarica(
      this.api.elimina(c.id, c.versione),
      this.toast,
      "Impossibile eliminare l'elemento.",
      () => this.carica()
    )
  }
}
