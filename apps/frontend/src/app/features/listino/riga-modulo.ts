// Modulo del dialog della riga di addebito (4.2b, Task 27). Un controllo per ogni campo di
// `CampoRiga` (stesse chiavi del corpo del backend) più `tipoCifre`, che completa `T???`/`M???`.
// I campi fuori famiglia si svuotano e spariscono (`adatta`); i valori proposti riempiono solo i
// campi vuoti; gli errori 400 (R36) si smistano per `campo`, mai per parole chiave. Il backend
// resta l'arbitro delle regole: qui si riproducono solo quelle che decidono quali campi mostrare.
import { signal } from '@angular/core'
import { AbstractControl, FormControl, FormGroup } from '@angular/forms'
import {
  DatiRiga,
  PropostaRiga,
  RiferimentoCodifica,
  RigaAddebito,
  Scadenza,
  Scaglione,
} from './listino.model'
import { cascataItaliana, decimaleItaliano, messaggiErrore } from './listino-calcoli'
import {
  CampoRiga,
  FamigliaAddebito,
  campoAbilitato,
  famigliaTipo,
  tipoAddebitoValido,
} from './vocabolario-listino'

const stringa = () => new FormControl('', { nonNullable: true })
const vero = () => new FormControl(false, { nonNullable: true })

/** Etichette dei campi per i messaggi che non hanno un campo sotto cui comparire (come il BE). */
export const ETICHETTE_CAMPI_RIGA: Readonly<Record<CampoRiga, string>> = {
  tipo: 'Tipo',
  cerCode: 'Codice CER',
  addebitoId: 'Addebito',
  riferimento: 'Riferimento',
  descrizione: 'Descrizione',
  tipoQuantita: 'Quantità',
  quantitaFissa: 'Quantità fissa',
  unitaMisura: 'Unità di misura',
  prezzo: 'Prezzo',
  prezzoSpeciale: 'Prezzo speciale',
  sconto: 'Sconto',
  codiceIvaId: 'Codice IVA',
  provvigione: 'Provvigione',
  tipoProvvigione: 'Tipo provvigione',
  tipologiaRifiuto: 'Tipologia del rifiuto',
  statoFisico: 'Stato fisico',
  operazione: 'Operazione',
  categoriaId: 'Categoria',
  centroRicavoId: 'Centro di ricavo',
  applicaA: 'Il prezzo speciale si applica a',
  condizione: 'Condizione',
  condizioniRiferite: 'Condizioni riferite',
  minimoFatturabile: 'Minimo fatturabile',
  minimoPerCategoria: 'Minimo per categoria',
  riferimentoGiorno: 'Giorno di riferimento',
  riferimentoMese: 'Mese di riferimento',
  periodoScadenze: 'Periodo delle scadenze',
  periodoExtraDal: 'Periodo extra dal',
  periodoExtraAl: 'Periodo extra al',
  stimaAnnuaKg: 'Stima annua (kg)',
  cerProposta: 'CER proposti',
  addebitiProposti: 'Addebiti proposti',
  appunti: 'Appunti',
  notaUsoInterno: 'Nota per uso interno',
  scaglioni: 'Fasce del prezzo speciale',
  scadenze: 'Scadenze',
}

const TUTTI_I_CAMPI = Object.keys(ETICHETTE_CAMPI_RIGA) as CampoRiga[]

/**
 * Campi che il dialog mostra con una sezione propria. Un errore su un altro campo compare in
 * testa con l'etichetta del campo, così non si perde. Task 28 aggiunge qui le sue chiavi
 * (`RigaForm.mostrati`) quando disegna prezzo speciale e scadenze.
 */
export const CAMPI_PARTE_1: readonly CampoRiga[] = [
  'tipo',
  'cerCode',
  'addebitoId',
  'riferimento',
  'descrizione',
  'tipoQuantita',
  'quantitaFissa',
  'unitaMisura',
  'stimaAnnuaKg',
  'prezzo',
  'prezzoSpeciale',
  'sconto',
  'provvigione',
  'tipoProvvigione',
  'codiceIvaId',
  'condizione',
  'minimoFatturabile',
  'minimoPerCategoria',
  'tipologiaRifiuto',
  'statoFisico',
  'operazione',
  'categoriaId',
  'centroRicavoId',
  'cerProposta',
  'addebitiProposti',
  'appunti',
  'notaUsoInterno',
]

/** Il tipo del menu (`T???`, `M???`) e le tre cifre che lo completano. */
export function tipoPerMenu(tipo: string): { tipo: string; cifre: string } {
  return /^[TM]\d{3}$/.test(tipo)
    ? { tipo: `${tipo[0]}???`, cifre: tipo.slice(1) }
    : { tipo, cifre: '' }
}

/** Virgola → punto, spazi tolti, vuoto → null: il backend valida, qui non si arrotonda. */
const decimale = (v: string): string | null => {
  const t = v.trim().replace(/,/g, '.')
  return t === '' ? null : t
}
const testo = (v: string): string | null => (v.trim() === '' ? null : v.trim())
const intero = (v: string): number | null => {
  const n = Number.parseInt(v.trim(), 10)
  return Number.isNaN(n) ? null : n
}

const DECIMALI: readonly CampoRiga[] = [
  'prezzo',
  'quantitaFissa',
  'minimoFatturabile',
  'sconto',
  'provvigione',
  'stimaAnnuaKg',
]
const INTERI: readonly CampoRiga[] = ['condizione', 'riferimentoGiorno', 'riferimentoMese']
const LISTE: readonly CampoRiga[] = ['cerProposta', 'addebitiProposti', 'scaglioni', 'scadenze']
const BOOLEANI: readonly CampoRiga[] = ['prezzoSpeciale', 'minimoPerCategoria']

export class RigaForm {
  readonly form = new FormGroup({
    tipo: stringa(),
    tipoCifre: stringa(),
    cerCode: stringa(),
    addebitoId: stringa(),
    riferimento: stringa(),
    descrizione: stringa(),
    tipoQuantita: stringa(),
    quantitaFissa: stringa(),
    unitaMisura: stringa(),
    prezzo: stringa(),
    prezzoSpeciale: vero(),
    sconto: stringa(),
    codiceIvaId: stringa(),
    provvigione: stringa(),
    tipoProvvigione: stringa(),
    tipologiaRifiuto: stringa(),
    statoFisico: stringa(),
    operazione: stringa(),
    categoriaId: stringa(),
    centroRicavoId: stringa(),
    applicaA: stringa(),
    condizione: stringa(),
    condizioniRiferite: stringa(),
    minimoFatturabile: stringa(),
    minimoPerCategoria: vero(),
    riferimentoGiorno: stringa(),
    riferimentoMese: stringa(),
    periodoScadenze: stringa(),
    periodoExtraDal: stringa(),
    periodoExtraAl: stringa(),
    stimaAnnuaKg: stringa(),
    cerProposta: new FormControl<string[]>([], { nonNullable: true }),
    addebitiProposti: new FormControl<string[]>([], { nonNullable: true }),
    appunti: stringa(),
    notaUsoInterno: stringa(),
    scaglioni: new FormControl<Scaglione[]>([], { nonNullable: true }),
    scadenze: new FormControl<Scadenza[]>([], { nonNullable: true }),
  })

  /** Errori del backend per campo (R36) e quelli senza campo (o con un campo non disegnato). */
  readonly errori = signal<Partial<Record<string, string[]>>>({})
  readonly generali = signal<string[]>([])
  /** Campi che il dialog disegna: gli altri errori vanno in testa (Task 28 ne aggiunge). */
  readonly mostrati = new Set<string>(CAMPI_PARTE_1)
  /** Descrizioni scelte, per il riepilogo "CER o addebito" (non viaggiano al backend). */
  etichettaCer = ''
  etichettaAddebito = ''
  private soloLettura = false

  private controllo(campo: string): AbstractControl {
    return this.form.get(campo) as AbstractControl
  }

  // --- famiglia e campi abilitati ----------------------------------------------------------

  /** Il tipo come lo conosce il backend: `T???` + `123` → `T123`. */
  tipoEffettivo(): string {
    const { tipo, tipoCifre } = this.form.getRawValue()
    return tipo.endsWith('???') ? `${tipo[0]}${tipoCifre.trim()}` : tipo
  }

  /** null finché il tipo non è scelto o completo. */
  famiglia(): FamigliaAddebito | null {
    const t = this.tipoEffettivo()
    return tipoAddebitoValido(t) ? famigliaTipo(t) : null
  }

  /**
   * Il campo vale per la famiglia scelta (`CAMPI_PER_FAMIGLIA`) e per le due regole fra campi:
   * la provvigione non c'è nelle detrazioni e negli anticipi (`$D`, `$R`) e, con il prezzo
   * speciale, l'importo del minimo si disabilita. `minimoPerCategoria` resta ammesso (WinWaste).
   */
  abilitato(campo: CampoRiga): boolean {
    const f = this.famiglia()
    if (f === null) return false
    if (!campoAbilitato(f, campo)) return false
    const t = this.tipoEffettivo()
    if (campo === 'provvigione' && (t === '$D' || t === '$R')) return false
    return true
  }

  /** Il minimo fatturabile si vede ma non si scrive con il prezzo speciale. */
  minimoBloccato(): boolean {
    return this.form.controls.prezzoSpeciale.value
  }

  /**
   * Dopo un cambio di tipo o del prezzo speciale: i campi fuori famiglia si svuotano (e le liste
   * si azzerano), l'importo del minimo si disabilita con il prezzo speciale. Con il tipo ancora
   * incompleto non tocca nulla: chi scrive le tre cifre di `T???` non perde i dati.
   */
  adatta(): void {
    if (this.famiglia() === null) return
    for (const campo of TUTTI_I_CAMPI) {
      if (campo === 'tipo' || this.abilitato(campo)) continue
      this.controllo(campo).setValue(vuotoForm(campo), { emitEvent: false })
    }
    if (this.minimoBloccato()) {
      this.form.controls.minimoFatturabile.setValue('', { emitEvent: false })
    }
    const minimo = this.form.controls.minimoFatturabile
    if (this.soloLettura || this.minimoBloccato()) minimo.disable({ emitEvent: false })
    else minimo.enable({ emitEvent: false })
  }

  impostaSolaLettura(v: boolean): void {
    this.soloLettura = v
    if (v) this.form.disable({ emitEvent: false })
    else this.form.enable({ emitEvent: false })
    this.adatta()
  }

  azzera(): void {
    this.form.enable({ emitEvent: false })
    this.form.reset(undefined, { emitEvent: false })
    this.errori.set({})
    this.generali.set([])
    this.etichettaCer = ''
    this.etichettaAddebito = ''
    this.soloLettura = false
  }

  // --- lettura e proposta ------------------------------------------------------------------

  riempi(r: RigaAddebito): void {
    const m = tipoPerMenu(r.tipo)
    this.form.reset(
      {
        tipo: m.tipo,
        tipoCifre: m.cifre,
        cerCode: r.cerCode ?? '',
        addebitoId: r.addebito?.id ?? '',
        riferimento: r.riferimento ?? '',
        descrizione: r.descrizione ?? '',
        tipoQuantita: r.tipoQuantita ?? '',
        quantitaFissa: decimaleItaliano(r.quantitaFissa),
        unitaMisura: r.unitaMisura,
        prezzo: decimaleItaliano(r.prezzo),
        prezzoSpeciale: r.prezzoSpeciale,
        sconto: cascataItaliana(r.sconto),
        codiceIvaId: r.codiceIva.id,
        provvigione: cascataItaliana(r.provvigione),
        tipoProvvigione: r.tipoProvvigione ?? '',
        tipologiaRifiuto: r.tipologiaRifiuto ?? '',
        statoFisico: r.statoFisico ?? '',
        operazione: r.operazione ?? '',
        categoriaId: r.categoria?.id ?? '',
        centroRicavoId: r.centroRicavo?.id ?? '',
        applicaA: r.applicaA ?? '',
        condizione: r.condizione === null ? '' : String(r.condizione),
        condizioniRiferite: r.condizioniRiferite ?? '',
        minimoFatturabile: decimaleItaliano(r.minimoFatturabile, 2),
        minimoPerCategoria: r.minimoPerCategoria,
        riferimentoGiorno: r.riferimentoGiorno === null ? '' : String(r.riferimentoGiorno),
        riferimentoMese: r.riferimentoMese === null ? '' : String(r.riferimentoMese),
        periodoScadenze: r.periodoScadenze ?? '',
        periodoExtraDal: r.periodoExtraDal ?? '',
        periodoExtraAl: r.periodoExtraAl ?? '',
        stimaAnnuaKg: decimaleItaliano(r.stimaAnnuaKg),
        cerProposta: [...r.cerProposta],
        addebitiProposti: [...r.addebitiProposti],
        appunti: r.appunti ?? '',
        notaUsoInterno: r.notaUsoInterno ?? '',
        scaglioni: r.scaglioni.map(s => ({ ...s })),
        scadenze: r.scadenze.map(s => ({
          ordine: s.ordine,
          giorno: s.giorno,
          mese: s.mese,
          anno: s.anno,
        })),
      },
      { emitEvent: false }
    )
    this.etichettaCer = r.cerCode ?? ''
    this.etichettaAddebito = r.addebito ? `${r.addebito.codice} - ${r.addebito.descrizione}` : ''
    this.adatta()
  }

  /** Riepilogo di ciò che è scelto: il CER o l'addebito, secondo il tipo. */
  sceltaTesto(): string {
    const v = this.form.getRawValue()
    if (v.cerCode !== '') return this.etichettaCer || v.cerCode
    if (v.addebitoId !== '') return this.etichettaAddebito || 'Addebito scelto'
    return ''
  }

  /**
   * Valori proposti alla scelta del CER o dell'addebito (D6, D7): solo nei campi che valgono per
   * la famiglia e sono ancora vuoti. Restituisce i riferimenti da aggiungere alle liste di scelta.
   */
  applicaProposta(p: PropostaRiga): {
    IVA: RiferimentoCodifica | null
    CATEGORIA: RiferimentoCodifica | null
    CENTRO_RICAVO: RiferimentoCodifica | null
  } {
    const vuoto = (c: CampoRiga) => (this.controllo(c).value as string).trim() === ''
    const metti = (c: CampoRiga, valore: string | null | undefined) => {
      if (valore === null || valore === undefined || valore === '') return
      if (this.abilitato(c) && vuoto(c)) this.controllo(c).setValue(valore)
    }
    metti('descrizione', p.descrizione)
    metti('unitaMisura', p.unitaMisura)
    metti('codiceIvaId', p.codiceIva?.id)
    metti('categoriaId', p.categoria?.id)
    metti('centroRicavoId', p.centroRicavo?.id)
    metti('prezzo', decimaleItaliano(p.prezzo))
    metti('sconto', cascataItaliana(p.sconto))
    metti('provvigione', cascataItaliana(p.provvigione))
    metti('tipoProvvigione', p.tipoProvvigione)
    metti('tipologiaRifiuto', p.tipologiaRifiuto)
    return { IVA: p.codiceIva, CATEGORIA: p.categoria, CENTRO_RICAVO: p.centroRicavo }
  }

  // --- corpo della richiesta ---------------------------------------------------------------

  /**
   * Il corpo di creazione o modifica. I campi fuori famiglia viaggiano vuoti (null, `false`, `[]`):
   * il backend li normalizza (R37) e in modifica svuota quelli del tipo precedente.
   */
  dati(): DatiRiga {
    const v = this.form.getRawValue() as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const campo of TUTTI_I_CAMPI) {
      out[campo] = campo === 'tipo' ? this.tipoEffettivo() : this.valoreInviato(campo, v[campo])
    }
    return out as DatiRiga
  }

  private valoreInviato(campo: CampoRiga, valore: unknown): unknown {
    if (!this.abilitato(campo))
      return LISTE.includes(campo) ? [] : BOOLEANI.includes(campo) ? false : null
    if (LISTE.includes(campo)) return Array.isArray(valore) ? [...valore] : []
    if (BOOLEANI.includes(campo)) return valore === true
    const s = String(valore ?? '')
    if (DECIMALI.includes(campo)) return decimale(s)
    if (INTERI.includes(campo)) return intero(s)
    if (campo === 'unitaMisura') return testo(s)?.toUpperCase() ?? null
    return testo(s)
  }

  // --- errori del backend (R36) ------------------------------------------------------------

  pulisciErrori(): void {
    this.errori.set({})
    this.generali.set([])
  }

  /**
   * Smista un 400: ogni `errori[].campo` sotto il suo campo; `campo: null`, o un campo che il
   * dialog non disegna, in testa (questo con l'etichetta del campo). Senza `errori` (altri 400,
   * 404, 500) vale il messaggio del backend.
   */
  impostaErrori(err: unknown, ripiego: string): void {
    const lista = (err as { error?: { errori?: unknown } } | null)?.error?.errori
    if (!Array.isArray(lista) || lista.length === 0) {
      this.errori.set({})
      this.generali.set(messaggiErrore(err, ripiego))
      return
    }
    const perCampo: Record<string, string[]> = {}
    const generali: string[] = []
    for (const e of lista as { campo?: string | null; messaggio?: string }[]) {
      const messaggio = e?.messaggio
      if (typeof messaggio !== 'string' || messaggio.trim() === '') continue
      const campo = e.campo ?? null
      if (campo !== null && this.mostrati.has(campo)) (perCampo[campo] ??= []).push(messaggio)
      else if (campo !== null) {
        const et = (ETICHETTE_CAMPI_RIGA as Record<string, string>)[campo]
        generali.push(et ? `${et}: ${messaggio}` : messaggio)
      } else generali.push(messaggio)
    }
    this.errori.set(perCampo)
    this.generali.set(
      generali.length > 0 || Object.keys(perCampo).length > 0 ? generali : [ripiego]
    )
  }

  erroriDi(campo: string): string[] {
    return this.errori()[campo] ?? []
  }
}

function vuotoForm(campo: CampoRiga): string | boolean | never[] {
  if (LISTE.includes(campo)) return []
  if (BOOLEANI.includes(campo)) return false
  return ''
}
