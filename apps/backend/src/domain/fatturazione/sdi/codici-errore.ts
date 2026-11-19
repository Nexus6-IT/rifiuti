/**
 * Descrizione in italiano dei codici di errore SDI piu' comuni (NS). Tabella PARZIALE: un codice
 * non presente non riceve una descrizione inventata, si mostra il codice (`descrizioneErroreSdi`).
 */
const CODICI_ERRORE_SDI: Readonly<Record<string, string>> = {
  '00001': 'Il file è vuoto',
  '00002': 'Nome file già ricevuto dallo SDI (nome file duplicato)',
  '00200': 'Il file non è conforme al formato FatturaPA',
  '00201': 'Il nome del file non è valido',
  '00305': 'Partita IVA non valida',
  '00311': 'Codice destinatario non valido',
  '00400': 'Dati di riepilogo non coerenti con le righe',
  '00403': 'La data del documento è successiva alla data di ricezione',
  '00404': 'Fattura duplicata: lo SDI ha già ricevuto un documento con gli stessi dati',
  '00411': 'Natura IVA mancante per un’aliquota pari a zero',
  '00417': 'Identificativo fiscale del cessionario/committente assente',
}

export function descrizioneErroreSdi(codice: string): string {
  return CODICI_ERRORE_SDI[codice] ?? `Codice SDI ${codice}`
}
