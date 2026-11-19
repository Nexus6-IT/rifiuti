/**
 * Corpi validi delle operazioni del FIR in viaggio, secondo i modelli del
 * contratto ufficiale (`docs/contracts/rentri/formulari.yaml`). Un solo posto,
 * come `corpoNuovoFormularioValido`: chi verifica un RIFIUTO parte da qui e
 * guasta il campo in esame.
 */
export const NUMERO_FIR_VIAGGIO = 'BCDFGH00020ZD'

export function corpoQuantitaValido(): Record<string, unknown> {
  return { quantita: { valore: 1250.5, unita_misura: 'kg' }, rinfusa: true }
}

export function corpoTrasportoTerrestreValido(): Record<string, unknown> {
  return {
    data_ora_inizio_trasporto: '2026-11-18T08:30:00Z',
    conducente: { nome: 'Mario', cognome: 'Rossi' },
    targa_automezzo: 'AB123CD',
  }
}

export function corpoAnnotazioneValido(): Record<string, unknown> {
  return {
    annotazione: 'Strada chiusa, percorso alternativo.',
    identificativo_soggetto: 'RSSMRA80A01H501U',
  }
}

export function corpoSostaTecnicaValido(): Record<string, unknown> {
  return {
    luogo_stazionamento: 'Area di servizio A1 km 120',
    data_ora_sospensione: '2026-11-18T10:00:00Z',
    data_ora_ripresa: '2026-11-18T12:00:00Z',
  }
}

export function corpoTrasbordoTotaleValido(): Record<string, unknown> {
  return {
    trasportatore: { num_iscr_sito: 'OP1234ABC000009-AB0009', tipo_trasporto: 'Terrestre' },
    presa_in_carico: corpoTrasportoTerrestreValido(),
  }
}

export function corpoTrasbordoParzialeValido(): Record<string, unknown> {
  return {
    numero_fir: 'BCDFGH00021ZD',
    trasportatore: { codice_fiscale: '01234567890', denominazione: 'Trasporti Verdi Srl' },
    quantita_residua: { valore: 400, unita_misura: 'kg' },
    causale: 'Guasto al mezzo',
  }
}

export function corpoDestinatarioSitoValido(): Record<string, unknown> {
  return { num_iscr_sito: 'OP1234ABC000002-AB0002' }
}
