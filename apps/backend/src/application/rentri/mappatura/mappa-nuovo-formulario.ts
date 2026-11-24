import {
  mappaProduttore,
  mappaDestinatario,
  mappaTrasportatore,
  DatoMancantePerRentriError,
  RisolutoreComune,
  TipoTrasporto,
  DatiProduttoreParte,
  DatiDestinatarioParte,
  DatiTrasportatoreParte,
} from './mappa-parti'
import { mappaRifiuto, DatiRifiutoFIR, ProvenienzaRifiutoRentri } from './mappa-rifiuto'
import { normalizzaCaratteristichePericolo } from './mappa-quantita'
import {
  DatiQuantitaInput,
  DatiTrasportoTerrestreInput,
  mappaDatiTrasportoTerrestre,
  mappaQuantitaRifiuto,
} from './mappa-viaggio'

/**
 * Composizione del corpo di `POST /formulari/v1.0/` a partire da un FIR interno.
 *
 * Questo modulo sostituisce il segnaposto storico `convertFIRToPayload`, che
 * spediva a RENTRI due identificativi nostri (`{ firId, firNumber }`) dentro
 * una struttura che il contratto non definisce. Nessun test diventava rosso
 * perche' l'oracolo accettava qualunque corpo: ora lo stesso validatore usato
 * dal finto RENTRI giudica questo risultato nello spec accanto.
 *
 * Resta FAIL-CLOSED come i due mappatori che compone: un FIR incompleto
 * solleva un errore invece di produrre un formulario con campi inventati.
 * Verso un ente pubblico, rifiutare l'invio e' sempre preferibile a spedire
 * un dato falso.
 */

/** Ingresso del mappatore: il FIR con le parti gia' lette dai registri. */
export interface DatiFirPerRentri {
  /** Numero di iscrizione dell'unita' locale del tenant che emette il FIR. */
  numIscrSito: string
  /**
   * Urbano o Speciale. Non e' un dato che il modello FIR possiede oggi:
   * arriva dal chiamante e, se manca, l'invio viene rifiutato.
   */
  provenienza: ProvenienzaRifiutoRentri | null | undefined
  /**
   * Terrestre, Ferroviario o Marittimo. Nemmeno questo e' nel modello FIR:
   * stessa regola della provenienza.
   */
  tipoTrasporto: TipoTrasporto | null | undefined
  produttore: DatiProduttoreParte
  destinatario: DatiDestinatarioParte
  trasportatori: DatiTrasportatoreParte[]
  rifiuto: DatiRifiutoFIR
  /**
   * Quantita' e colli/rinfusa, SOLO se noti (FIR in viaggio P2, decisione D2): se presenti finiscono
   * in `rifiuto.quantita` & co.; se mancano il formulario nasce senza quantita' e la riceve da
   * `POST /{numero_fir}/quantita`.
   */
  quantita?: DatiQuantitaInput | null
  /** Classi HP del FIR (`HP4,HP14`): normalizzate in `HPnn`. */
  caratteristichePericolo?: string | null
  /**
   * Dati del trasporto terrestre della prima tratta, SOLO se noti: diventano `dati_trasporto_partenza`.
   * Se mancano, arrivano da `POST /{numero_fir}/trasporto`.
   */
  datiTrasportoPartenza?: DatiTrasportoTerrestreInput | null
}

export async function mappaNuovoFormulario(
  fir: DatiFirPerRentri,
  risolutoreComune: RisolutoreComune
): Promise<Record<string, unknown>> {
  if (!fir.numIscrSito?.trim()) {
    throw new DatoMancantePerRentriError('formulario', 'numIscrSito')
  }

  // Il contratto vuole `minItems: 1` sui trasportatori: senza almeno uno il
  // formulario non esiste, e dirlo qui produce un messaggio comprensibile
  // invece di un errore di validazione a valle.
  if (!fir.trasportatori || fir.trasportatori.length === 0) {
    throw new DatoMancantePerRentriError('formulario', 'trasportatore')
  }

  if (!fir.tipoTrasporto) {
    throw new DatoMancantePerRentriError('trasportatore', 'tipo_trasporto')
  }

  const produttore = await mappaProduttore(fir.produttore, risolutoreComune)
  const destinatario = await mappaDestinatario(fir.destinatario, risolutoreComune)
  // Ogni tratta ha la sua modalita' (FIR intermodale); senza indicazione vale quella del formulario.
  const trasportatori = fir.trasportatori.map(trasportatore =>
    mappaTrasportatore(trasportatore, trasportatore.tipoTrasporto ?? fir.tipoTrasporto)
  )
  const caratteristichePericolo = normalizzaCaratteristichePericolo(fir.caratteristichePericolo)
  const rifiuto = {
    ...mappaRifiuto(fir.rifiuto, fir.provenienza),
    ...(caratteristichePericolo ? { caratteristiche_pericolo: caratteristichePericolo } : {}),
    // `QuantitaRifiutoModel` e `DatiRifiutoModel` condividono quantita/colli/rinfusa/verifica.
    ...(fir.quantita ? mappaQuantitaRifiuto(fir.quantita) : {}),
  }

  return {
    num_iscr_sito: fir.numIscrSito,
    dati_partenza: {
      produttore,
      destinatario,
      trasportatori,
      rifiuto,
    },
    ...(fir.datiTrasportoPartenza
      ? { dati_trasporto_partenza: mappaDatiTrasportoTerrestre(fir.datiTrasportoPartenza) }
      : {}),
  }
}
