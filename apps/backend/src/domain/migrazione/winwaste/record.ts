import { C4Decodificato } from './c4'
import { CerDecodificato } from './cer'
import { OperDecodificata } from './oper'
import { RegistroProtocollo } from './registri'
import { DataIso } from './risultato'
import { SegmentoRelaz } from './relaz'
import { SoggettoMovimento } from './soggetto'

/**
 * Record WinWaste decodificati dal parser dello staging. Ogni record porta:
 *  - la chiave (`legacyKey` per movimenti e FIR, chiave naturale per le altre
 *    tabelle) e il numero di riga nello staging;
 *  - i valori decodificati;
 *  - `avvisi`: codici stabili delle anomalie non fatali (il record e' tenuto);
 *  - `grezzo`: i campi NON ancora mappati con un valore significativo (non
 *    vuoto e non zero), cosi' nulla di quanto estratto va perso in silenzio.
 */
export type CausaAnnullo = 'PREFISSO_ANNULLO' | 'NON_POSITIVA' | 'C7_ANNULLATO'

export interface RecordCorpoComune {
  readonly cod: number
  readonly riga: number
  readonly legacyKey: string
  readonly annullato: boolean
  readonly causaAnnullo: CausaAnnullo | null
  /** Data da `DTUK` (null se annullato senza data o nascosto). */
  readonly data: DataIso | null
  readonly causale: string
  readonly oper: OperDecodificata
  readonly posizione: string
  readonly dataRegistrazione: DataIso | null
  readonly cliente: string
  readonly contratto: string
  readonly produttore: SoggettoMovimento | null
  readonly trasportatore: SoggettoMovimento | null
  readonly destinatario: SoggettoMovimento | null
  readonly intermediario: SoggettoMovimento | null
  readonly mag1: string
  readonly mag2: string
  readonly moda: string
  readonly cer: CerDecodificato | null
  readonly tipologia: string
  readonly statoFisico: string
  readonly nettoKg: number | null
  readonly volumeM3: number | null
  readonly lordoKg: number | null
  readonly taraKg: number | null
  readonly c4: C4Decodificato | null
  readonly relaz: readonly SegmentoRelaz[]
  readonly avvisi: readonly string[]
  readonly grezzo: Readonly<Record<string, string>>
}

export interface RecordMovimento extends RecordCorpoComune {
  readonly tabella: 'MOVIMENTI'
  readonly registri: readonly RegistroProtocollo[]
  /** Netto numerico scritto dal server (kg). */
  readonly kgnum: number | null
  readonly mcnum: number | null
  /** Quantita' gia' scaricata da questo carico (kg). */
  readonly giascar: number | null
  /** Classe di giacenza + posizione + `$` se esaurito. */
  readonly stato: string
  readonly nfatt: string
}

export type StatoFormulario = 'EMESSO' | 'RICOPIATO' | 'ANNULLATO' | 'PORTALE'

export interface SerieFormulario {
  readonly serie: string
  readonly numero: number
  /** Ultime due cifre dell'anno (`/aa`). */
  readonly anno2: string
}

export interface RecordFormulario extends RecordCorpoComune {
  readonly tabella: 'FORMULARI'
  readonly formu: string
  /** Serie e numero fiscale (`<serie><numero>/<aa>`), null se il formato non combacia. */
  readonly serieNumero: SerieFormulario | null
  readonly dataDocumento: DataIso | null
  /** `C7` classificato (`docs/formulari.md` §2.3). */
  readonly statoFir: StatoFormulario
  readonly c7: string
  readonly digitale: boolean
  readonly kgnum: number | null
}

export interface RecordGiacenzaRifiuti {
  readonly tabella: 'GIACENZE RIFIUTI'
  readonly riga: number
  /** `UL|MAG|POS|CER|SF|RIF` (chiave primaria della tabella). */
  readonly chiaveNaturale: string
  readonly ul: string
  readonly mag: string
  readonly pos: string
  readonly cer: string
  readonly sf: string
  readonly rif: string
  /** Riga di compensazione del riporto d'anno: `UL` che inizia per `8`. */
  readonly compensazione: boolean
  /** Giacenze iniziali per classe: RR/RL = R13 da terzi/da lavorazioni, DR/DL = D15, DT = deposito temporaneo. */
  readonly giacenze: Readonly<Record<'RR' | 'RL' | 'DR' | 'DL' | 'DT', { kg: number; m3: number }>>
  readonly grezzo: Readonly<Record<string, string>>
}

export interface RecordCausaleRifiuti {
  readonly tabella: 'CAUSALI RIFIUTI'
  readonly riga: number
  readonly cod: string
  readonly descrizione: string
  readonly tip: string
  readonly ope: string
  readonly oper: OperDecodificata
  readonly flag: Readonly<Record<'cura' | 'reg' | 'mud' | 'fatt' | 'cost', string>>
  readonly posiz: string
  readonly avanz: string
}

export interface RecordRegistroRifiuti {
  readonly tabella: 'REGISTRI RIFIUTI'
  readonly riga: number
  readonly cod: string
  readonly descrizione: string
  /** Ultimo protocollo stampato. */
  readonly ultimoProtocollo: number | null
  /** Data dell'ultima stampa (`gg-mm`). */
  readonly ultimaStampa: string
  readonly modello: string
  /** `ASS = 1`: il protocollo e' assegnato alla registrazione. */
  readonly assegnaProtocollo: boolean
  readonly avvisi: readonly string[]
}

export interface RecordVersis {
  readonly tabella: 'VERSIS'
  readonly riga: number
  readonly cod: string
  /** Prefisso alfabetico di `COD` (`XRENTRI`, `HUBRW`, ...). */
  readonly prefisso: string
  readonly idsis: string
  readonly versis: string
  readonly vertot: string
  /** Riga con segreti (host, utente, password cifrata, licenza dell'hub): `C1..C5` non sono mai letti. */
  readonly sensibile: boolean
}

export interface RecordRenRegistrazione {
  readonly tabella: 'RENregistrazioni'
  readonly riga: number
  readonly codMovimento: number
  readonly annoMovimento: string
  readonly registro: string
  readonly protocollo: string
  /** `XSEINVIATO = 'X'`: registrazione trasmessa a RENTRI. */
  readonly inviata: boolean
  readonly idRentri: string
}
