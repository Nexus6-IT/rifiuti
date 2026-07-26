/**
 * Fixture statiche del servizio `anagrafiche` (`docs/contracts/rentri/anagrafiche.yaml`).
 * Copre solo i path in sola lettura di `Operatore`/`Soggetto delegato`
 * rilevanti per R4 — i `/registri` (apertura/modifica/chiusura registro)
 * restano fuori dall'ambito, sono registri cronologici esplicitamente
 * esclusi dal design del programma.
 */

export interface OperatoreFixture {
  numIscr: string
  identificativo: string // codice fiscale
  profiloSoggetto: 'Impresa' | 'Ente' | 'Altro' | 'AssociazioneCategoria' | 'Amministrazione'
  denominazione: string
  piva: string | null
  stato: 'Attivo' | 'Eliminato' | 'Sospeso' | 'Chiuso' | 'DaConfermare'
  autorizzazioneAlbo: {
    sezione: string
    numeroIscrizione: number
    attiva: boolean
    categorie: { categoria: string; classe: string; stato: 'Iscritta' | 'Sospesa' | 'Cancellata' }[]
  }
}

/** Operatore accreditato di riferimento, coerente con `operatore-test` accettato da `verificaJwt`. */
export const operatori: OperatoreFixture[] = [
  {
    numIscr: 'MI00001234',
    identificativo: 'RSSMRA80A01F205X',
    profiloSoggetto: 'Impresa',
    denominazione: 'Ecoservizi Lombardia S.r.l.',
    piva: '12345678901',
    stato: 'Attivo',
    autorizzazioneAlbo: {
      sezione: 'Ordinaria',
      numeroIscrizione: 12345,
      attiva: true,
      categorie: [{ categoria: '1', classe: 'B', stato: 'Iscritta' }],
    },
  },
]

export interface SoggettoDelegatoFixture {
  numIscrAss: string
  identificativo: string
  denominazione: string
  stato: 'Attivo' | 'Eliminato' | 'Sospeso' | 'Chiuso' | 'DaConfermare'
}

export const soggettiDelegati: SoggettoDelegatoFixture[] = [
  {
    numIscrAss: 'MI00009999',
    identificativo: '01234567890',
    denominazione: 'Consorzio Delegati Ambiente',
    stato: 'Attivo',
  },
]

export interface AutorizzazioneSito {
  tipoAutorizzazione: string
  autorizzazioneRif: string
  dataRilascio: string
  dataScadenza: string | null
  attivitaRecuperoSmaltimento: string[]
}

export interface SitoFixture {
  numIscrSito: string
  numIscrOperatore: string
  nome: string
  isSedeLegale: boolean
  comuneId: string
  provinciaId: string
  indirizzo: string
  civico: string
  attivita: string[]
  stato: 'Attivo' | 'Eliminato' | 'Sospeso' | 'Chiuso' | 'DaConfermare'
  autorizzazioni: AutorizzazioneSito[]
  /** Numeri iscrizione dei soggetti delegati abilitati su questa unità locale. */
  delegatoDaNumIscrAss: string[]
}

/** Unità locali dell'operatore di fixture: una sede legale e un deposito, in comuni diversi. */
export const siti: SitoFixture[] = [
  {
    numIscrSito: 'MI00001234-001',
    numIscrOperatore: 'MI00001234',
    nome: 'Sede legale - Milano',
    isSedeLegale: true,
    comuneId: '015146',
    provinciaId: '015',
    indirizzo: 'Via Ripamonti',
    civico: '88',
    attivita: ['Produzione'],
    stato: 'Attivo',
    autorizzazioni: [
      {
        tipoAutorizzazione: 'RecProcSemplificata',
        autorizzazioneRif: 'Prot. 12345/2023',
        dataRilascio: '2023-01-15T00:00:00Z',
        dataScadenza: '2028-01-15T00:00:00Z',
        attivitaRecuperoSmaltimento: ['R13'],
      },
    ],
    delegatoDaNumIscrAss: ['MI00009999'],
  },
  {
    numIscrSito: 'MI00001234-002',
    numIscrOperatore: 'MI00001234',
    nome: 'Deposito - Roma',
    isSedeLegale: false,
    comuneId: '058091',
    provinciaId: '058',
    indirizzo: 'Via Prenestina',
    civico: '210',
    attivita: ['Trasporto', 'Recupero'],
    stato: 'Attivo',
    autorizzazioni: [],
    delegatoDaNumIscrAss: [],
  },
]

export function trovaOperatorePerNumIscr(numIscr: string): OperatoreFixture | undefined {
  return operatori.find(o => o.numIscr === numIscr)
}

export function trovaOperatorePerIdentificativo(
  identificativo: string
): OperatoreFixture | undefined {
  return operatori.find(o => o.identificativo === identificativo)
}

export function trovaSoggettoDelegato(numIscrAss: string): SoggettoDelegatoFixture | undefined {
  return soggettiDelegati.find(s => s.numIscrAss === numIscrAss)
}

export function sitiDiOperatore(numIscr: string): SitoFixture[] {
  return siti.filter(s => s.numIscrOperatore === numIscr)
}

export function sitoDiOperatore(numIscr: string, numIscrSito: string): SitoFixture | undefined {
  return siti.find(s => s.numIscrOperatore === numIscr && s.numIscrSito === numIscrSito)
}

export function sitiDelegatiA(numIscrAss: string): SitoFixture[] {
  return siti.filter(s => s.delegatoDaNumIscrAss.includes(numIscrAss))
}

export function sitoDelegatoA(numIscrAss: string, numIscrSito: string): SitoFixture | undefined {
  return sitiDelegatiA(numIscrAss).find(s => s.numIscrSito === numIscrSito)
}
