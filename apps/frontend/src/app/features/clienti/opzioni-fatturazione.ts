import { FormControl } from '@angular/forms'
import { signal, computed } from '@angular/core'
import { Subscription } from 'rxjs'
import { AggiuntaInLinea } from './aggiunta-in-linea'
import {
  Agente,
  CondizionePagamento,
  ContoCorrente,
  RegistroIva,
  Rif,
  SpesaAccessoria,
} from './clienti.model'
import { ClientiService } from './clienti.service'
import { TabelleFatturazioneService } from './tabelle-fatturazione.service'
import { messaggioErrore } from './tabelle/tabella-comune'

/** Voce di un select: mai l'id a video. */
export interface Opzione {
  id: string
  etichetta: string
}

export type SubDialog = 'condizione' | 'conto' | 'spese' | 'bollo' | 'registro' | 'agente'

/** I sei campi del form che scelgono una tabella (valore = id, '' = nessuno). */
export interface ControlliOpzioni {
  condizione: FormControl<string>
  conto: FormControl<string>
  spese: FormControl<string>
  bollo: FormControl<string>
  registro: FormControl<string>
  agente: FormControl<string>
}

/** Le voci correnti di un record già salvato (cliente, contratto): possono non essere più attive. */
export interface RiferimentiCorrenti {
  condizionePagamento: Rif | null
  contoCorrente: Rif | null
  speseIncasso: Rif | null
  bollo: Rif | null
  registroIva: Rif | null
  agente: Rif | null
}

export const MESSAGGIO_REGISTRO_SPLIT =
  'Registro delle ricevute split: non utilizzabile qui, resta nella tabella dei registri.'

export const etichettaCodice = (codice: string | null, descrizione: string): string =>
  codice ? `${codice} - ${descrizione}` : descrizione

/** Aggiunge la voce corrente se non è fra quelle attive (disattivata dopo la scelta). */
export function conCorrente(lista: Opzione[], r: Rif | null | undefined): Opzione[] {
  if (!r || lista.some(o => o.id === r.id)) return lista
  return [
    ...lista,
    { id: r.id, etichetta: `${etichettaCodice(r.codice, r.descrizione)} (non più disponibile)` },
  ]
}

const etichettaSpesa = (s: SpesaAccessoria): Opzione => ({
  id: s.id,
  etichetta: `${etichettaCodice(s.codice, s.descrizione)} (€ ${s.importo})`,
})

const etichettaAgente = (a: Agente): string =>
  a.codice ? `${a.ditta.ragioneSociale} (${a.codice})` : a.ditta.ragioneSociale

/**
 * I sei campi "scelgo una tabella, oppure ne creo una nuova" di cliente e contratto: condizione
 * di pagamento, conto corrente, spese di incasso, bollo, registro IVA e agente. Tiene le liste
 * delle sole voci attive, la voce corrente di un record già salvato, l'autocomplete degli agenti e
 * lo stato dei sub-dialog "Nuovo …" (`AggiuntaInLinea`). Il componente che la usa la costruisce
 * con i propri controlli, chiama `carica()` all'apertura e `azzera()` alla chiusura, e mostra i
 * sub-dialog con `app-sotto-dialog-fatturazione`.
 */
export class OpzioniFatturazione {
  readonly inLinea = new AggiuntaInLinea<SubDialog>()

  private readonly condizioni = signal<Opzione[]>([])
  private readonly conti = signal<Opzione[]>([])
  private readonly spese = signal<Opzione[]>([])
  private readonly bolli = signal<Opzione[]>([])
  private readonly registri = signal<Opzione[]>([])
  private readonly correnti = signal<RiferimentiCorrenti | null>(null)

  readonly opzCondizioni = computed(() =>
    conCorrente(this.condizioni(), this.correnti()?.condizionePagamento)
  )
  readonly opzConti = computed(() => conCorrente(this.conti(), this.correnti()?.contoCorrente))
  readonly opzSpese = computed(() => conCorrente(this.spese(), this.correnti()?.speseIncasso))
  readonly opzBolli = computed(() => conCorrente(this.bolli(), this.correnti()?.bollo))
  readonly opzRegistri = computed(() => conCorrente(this.registri(), this.correnti()?.registroIva))

  readonly suggerimentiAgenti = signal<Opzione[]>([])
  agenteSelezionato: Opzione | null = null

  private lettureOpzioni?: Subscription
  private ricercaAgenti?: Subscription

  constructor(
    private readonly tabelle: TabelleFatturazioneService,
    private readonly clienti: ClientiService,
    private readonly controlli: ControlliOpzioni,
    /** Messaggio informativo all'utente (toast). */
    private readonly avvisa: (messaggio: string) => void,
    /** Errore di caricamento delle liste. */
    private readonly errore: (messaggio: string) => void
  ) {}

  /** Solo le voci attive: le spese per tipo, i registri senza le ricevute split. */
  carica(): void {
    this.lettureOpzioni?.unsubscribe()
    const s = new Subscription()
    this.lettureOpzioni = s
    const errore = (err: unknown) =>
      this.errore(messaggioErrore(err, 'Impossibile caricare le tabelle di fatturazione.'))
    s.add(
      this.tabelle.condizioni.list().subscribe({
        next: l =>
          this.condizioni.set(
            l.map(c => ({ id: c.id, etichetta: etichettaCodice(c.codice, c.descrizione) }))
          ),
        error: errore,
      })
    )
    s.add(
      this.tabelle.conti.list().subscribe({
        next: l =>
          this.conti.set(
            l.map(c => ({ id: c.id, etichetta: etichettaCodice(c.codice, c.descrizione) }))
          ),
        error: errore,
      })
    )
    s.add(
      this.tabelle.spese.list({ tipo: 'INCASSO' }).subscribe({
        next: l => this.spese.set(l.map(etichettaSpesa)),
        error: errore,
      })
    )
    s.add(
      this.tabelle.spese.list({ tipo: 'BOLLO' }).subscribe({
        next: l => this.bolli.set(l.map(etichettaSpesa)),
        error: errore,
      })
    )
    s.add(
      this.tabelle.registri.list().subscribe({
        next: l =>
          this.registri.set(
            l
              .filter(r => !r.ricevuteSplit)
              .map(r => ({ id: r.id, etichetta: etichettaCodice(r.codice, r.descrizione) }))
          ),
        error: errore,
      })
    )
  }

  /** Dopo la lettura di un record salvato: le sue voci correnti restano scelte anche se disattivate. */
  impostaCorrenti(r: RiferimentiCorrenti): void {
    this.correnti.set(r)
    this.agenteSelezionato = r.agente
      ? { id: r.agente.id, etichetta: etichettaCodice(null, r.agente.descrizione) }
      : null
  }

  azzera(): void {
    this.lettureOpzioni?.unsubscribe()
    this.ricercaAgenti?.unsubscribe()
    this.correnti.set(null)
    this.suggerimentiAgenti.set([])
    this.agenteSelezionato = null
    this.inLinea.aperto = null
  }

  // ─── Agente (autocomplete) ───────────────────────────────────────────────

  cercaAgenti(ev: { query: string }): void {
    this.ricercaAgenti?.unsubscribe()
    const testo = ev.query.trim()
    this.ricercaAgenti = this.clienti.agenti
      .list({ pagina: 1, dimensione: 20, soloAttivi: true, ...(testo ? { testo } : {}) })
      .subscribe({
        next: p =>
          this.suggerimentiAgenti.set(
            p.elementi.map(a => ({ id: a.id, etichetta: etichettaAgente(a) }))
          ),
        error: () => this.suggerimentiAgenti.set([]),
      })
  }

  scegliAgente(voce: Opzione | null): void {
    this.agenteSelezionato = voce
    this.controlli.agente.setValue(voce?.id ?? '')
  }

  /**
   * Il modello dell'autocomplete cambia anche senza `onSelect` / `onClear` (testo digitato,
   * `forceSelection` che svuota al blur): l'id nel form segue sempre il modello, o resterebbe
   * l'agente precedente.
   */
  cambiaModelloAgente(valore: unknown): void {
    this.agenteSelezionato = valore as Opzione | null
    const id = (valore as Opzione | null)?.id
    this.controlli.agente.setValue(typeof id === 'string' ? id : '')
  }

  // ─── Aggiunta in linea ───────────────────────────────────────────────────

  chiudiSub(visibile: boolean): void {
    if (!visibile) this.inLinea.chiudi()
  }

  private aggiungi(
    lista: { update(f: (v: Opzione[]) => Opzione[]): void },
    campo: FormControl<string>,
    voce: Opzione
  ): void {
    lista.update(v => [...v.filter(o => o.id !== voce.id), voce])
    this.inLinea.salvato(voce, id => campo.setValue(id), false)
  }

  dopoCondizione(c: CondizionePagamento): void {
    this.aggiungi(this.condizioni, this.controlli.condizione, {
      id: c.id,
      etichetta: etichettaCodice(c.codice, c.descrizione),
    })
  }

  dopoConto(c: ContoCorrente): void {
    this.aggiungi(this.conti, this.controlli.conto, {
      id: c.id,
      etichetta: etichettaCodice(c.codice, c.descrizione),
    })
  }

  dopoSpese(s: SpesaAccessoria): void {
    this.aggiungi(this.spese, this.controlli.spese, etichettaSpesa(s))
  }

  dopoBollo(s: SpesaAccessoria): void {
    this.aggiungi(this.bolli, this.controlli.bollo, etichettaSpesa(s))
  }

  dopoRegistro(r: RegistroIva): void {
    if (r.ricevuteSplit) {
      this.avvisa(MESSAGGIO_REGISTRO_SPLIT)
      return
    }
    this.aggiungi(this.registri, this.controlli.registro, {
      id: r.id,
      etichetta: etichettaCodice(r.codice, r.descrizione),
    })
  }

  dopoAgente(a: Agente): void {
    this.inLinea.salvato(
      a,
      () => this.scegliAgente({ id: a.id, etichetta: etichettaAgente(a) }),
      false
    )
  }
}
