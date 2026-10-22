/**
 * Conformità dei tracciati MUD famiglia 6.04 alle specifiche ufficiali.
 *
 * Riferimenti:
 *  - 6.04/24 → MUD 2025 (dati 2024), DPCM 29/1/2025, GU 49 del 28/2/2025.
 *    Allegato 4: docs/20250129_TracciatiRecord_MUD_V604-24-rev01.pdf
 *  - 6.04/25 → MUD 2026 (dati 2025), DPCM 30/1/2026, GU 53 del 5/3/2026.
 *
 * Il controllo più importante è la **lunghezza esatta di ogni record**: il file
 * è a lunghezza fissa con separatore `;` dopo ogni campo (ultimo incluso) e la
 * procedura di acquisizione verifica i separatori nelle posizioni convenute.
 * Un record di lunghezza sbagliata fa scartare l'intero file.
 */

import { MudTracciatoV604_2024 } from './versions/mud-tracciato-v604-2024'
import { MudTracciatoV604_2025 } from './versions/mud-tracciato-v604-2025'
import { MudVersionRegistry } from './mud-version.registry'
import { MudExportData, MudRifiutoLine } from './mud-export.types'
import { LUNGHEZZE_RECORD_V604 } from './versions/mud-tracciato-v604-base'

/** Lunghezze totali dei record, da «Lunghezza totale record X» del tracciato. */
const LUNGHEZZE: Record<string, number> = {
  XX: 488,
  AA: 338,
  AB: 257,
  AU: 327,
  AR: 201,
  BA: 217,
  BB: 310,
  BC: 83,
  BD: 245,
  BE: 268,
  DA: 93,
  DB: 221,
}

/** Dataset che esercita TUTTI i record implementati. */
function datasetCompleto(year: number): MudExportData {
  return {
    year,
    generatedAt: new Date(2026, 5, 15, 10, 30, 0),
    azienda: {
      ragioneSociale: 'Società Rifiuti Città di Verità S.p.A.',
      partitaIva: '12345678901',
      codiceFiscale: 'RSSMRA80A01H501U',
      via: 'Via Còrso Umberto I',
      civico: '12/A',
      comune: 'PADOVA',
      provincia: 'PD',
      cap: '35100',
      pec: 'info@example.it',
      telefono: '0498765432',
      atecoCode: '381100',
      comuneCode: '028060',
      reaNumber: '123456',
      numeroAddetti: 42,
      legaleRappresentanteNome: 'Mario',
      legaleRappresentanteCognome: 'Rossi',
    },
    autorizzazioni: [
      {
        estremi: 'AUT-2024/0012',
        dataRilascio: new Date(2024, 0, 15),
        dataScadenza: new Date(2034, 0, 14),
        enteAutorizzante: 2,
        tipoAutorizzazione: 1,
        rinnovoAutocertificazione: false,
        operazioniRecupero: ['R3', 'R4', 'R13'],
        operazioniSmaltimento: ['D4', 'D5', 'D12'],
        gestisceVFU: false,
        gestisceRAEE: true,
        autorizzazioneEoW: true,
        impiantoIncenerimento: false,
        capacitaComplessivaTa: 50000,
        capacitaPericolosiTa: 10000,
        capacitaNonPericolosiTa: 40000,
        impiantoCoincenerimento: false,
        discariche: [{ classificazione: 7, capacitaResiduaMc: 250000 }],
        emasPrimaRegistrazione: new Date(2020, 3, 1),
        emasNumeroRegistrazione: 'IT-001234',
        iso14001Emissione: new Date(2023, 8, 30),
      },
    ],
    riciclaggio: [
      {
        frazione: 6,
        operazioni: { r4: true, r13: true },
        urbani: {
          trattataKg: 120000,
          scartiPreliminariKg: 5000,
          finaleRiciclaggioKg: 110000,
          scartiFinaliKg: 5000,
          preparataRiutilizzoKg: 1000,
        },
        imballaggi: { trattataKg: 30000, finaleRiciclaggioKg: 28000 },
      },
    ],
    rifiuti: [
      {
        cerCode: '170405',
        prodottoKg: 250000,
        recuperoKg: 200000,
        smaltimentoKg: 50000,
        statoFisico: 'SOLIDO_NON_POLVERULENTO',
        trasportatoDalDichiaranteKg: 10000,
        giacenzaRecuperoKg: 3000,
        giacenzaSmaltimentoKg: 1500,
        rt: [
          {
            codiceFiscale: 'BNCLGU75B02F205Z',
            ragioneSociale: 'Metalli Nord S.r.l.',
            istatProvincia: '015',
            istatComune: '146',
            indirizzo: 'Via Milano',
            civico: '3',
            cap: '20100',
            quantitaKg: 80000,
            ricevutoDaPrivati: true,
            origineUrbana: false,
            pileAccumulatori: false,
          },
        ],
        dr: [
          {
            codiceFiscale: '98765432109',
            ragioneSociale: 'Recuperi Sud S.p.A.',
            istatProvincia: '063',
            istatComune: '049',
            indirizzo: 'Via Napoli',
            civico: '7',
            cap: '80100',
            quantitaKg: 200000,
          },
        ],
        te: [{ codiceFiscale: '11122233344', ragioneSociale: 'Trasporti Veloci S.r.l.' }],
        re: [{ istatProvincia: '028', istatComune: '060', attivitaOrigine: 6, quantitaKg: 15000 }],
        mg: [
          {
            tipologiaImpianto: 27,
            smaltimentoSuOrdinanza: false,
            classificazioneDiscarica: 7,
            quantitaDiscaricaTon: 120,
            smaltimento: { D1: 0, D9: 25000, D15: 5000 } as any,
            recupero: { R4: 180000, R13: 20000 },
            giacenzaRecuperoKg: 3000,
            giacenzaSmaltimentoKg: 1500,
          },
        ],
      },
    ],
    intermediazioni: [
      {
        cerCode: '150106',
        statoFisico: 'SOLIDO_NON_POLVERULENTO',
        quantitaIntermediataKg: 45000,
        uo: [
          {
            codiceFiscale: '55566677788',
            ragioneSociale: 'Origine S.r.l.',
            istatProvincia: '028',
            istatComune: '060',
            indirizzo: 'Via Roma',
            civico: '1',
            quantitaKg: 45000,
          },
        ],
        ud: [
          {
            codiceFiscale: '99988877766',
            ragioneSociale: 'Destinazione GmbH',
            paeseEstero: 'GERMANIA',
            quantitaKg: 45000,
          },
        ],
      },
    ],
  }
}

/** Righe del file, senza il terminatore finale. */
function righe(contenuto: string): string[] {
  return contenuto.split('\r\n').filter(l => l.length > 0)
}

describe.each([
  ['6.04/24', 2024, () => new MudTracciatoV604_2024()],
  ['6.04/25', 2025, () => new MudTracciatoV604_2025()],
])('Tracciato MUD %s', (versione, anno, factory) => {
  const tracciato = factory()
  const contenuto = tracciato.generate(datasetCompleto(anno))
  const linee = righe(contenuto)

  it('una quantità di 10.000.000 kg esce in tonnellate senza allungare il record BA', () => {
    const data = datasetCompleto(anno)
    data.rifiuti[0].prodottoKg = 10000000
    const ba = righe(tracciato.generate(data)).find(l => l.startsWith('BA;'))!
    expect(ba.length).toBe(217)
    expect(ba).toContain(';0010000,000;2;')
  })

  it('dichiara versione e anno dei dati corretti', () => {
    expect(tracciato.version).toBe(versione)
    expect(tracciato.year).toBe(anno)
  })

  it('riporta la costante di release nella testata XX', () => {
    const xx = linee[0]
    expect(xx.startsWith('XX;')).toBe(true)
    // Campo 2 del record XX: costante release, alfa 7.
    expect(xx.split(';')[1]).toBe(versione.padEnd(7, ' '))
  })

  it('ogni record ha la lunghezza esatta prevista dal tracciato', () => {
    // Le lunghezze del tracciato NON includono i 2 byte del terminatore CRLF.
    for (const linea of linee) {
      const tipo = linea.slice(0, 2)
      expect(LUNGHEZZE[tipo]).toBeDefined()
      expect({ tipo, len: linea.length }).toEqual({ tipo, len: LUNGHEZZE[tipo] })
    }
  })

  it('emette tutti i tipi di record implementati', () => {
    const tipi = new Set(linee.map(l => l.slice(0, 2)))
    expect([...tipi].sort()).toEqual(
      ['AA', 'AB', 'AR', 'AU', 'BA', 'BB', 'BC', 'BD', 'BE', 'DA', 'DB', 'XX'].sort()
    )
  })

  it('termina ogni record con il separatore e il file con CRLF', () => {
    for (const linea of linee) expect(linea.endsWith(';')).toBe(true)
    expect(contenuto.endsWith('\r\n')).toBe(true)
  })

  it('XX è il primo e unico record di testata', () => {
    expect(linee[0].startsWith('XX;')).toBe(true)
    expect(linee.filter(l => l.startsWith('XX;'))).toHaveLength(1)
  })

  it('i contatori della testata XX corrispondono ai record emessi', () => {
    const campi = linee[0].split(';')
    // Campo 6 = nr totale record esclusa la testata; poi i 30 contatori.
    expect(Number(campi[5])).toBe(linee.length - 1)
    const ordine = [
      'AA',
      'AB',
      'BA',
      'BB',
      'BC',
      'BD',
      'BE',
      'DA',
      'DB',
      'RA',
      'RB',
      'RC',
      'RD',
      'RE',
      'RF',
      'VC',
      'VD',
      'VE',
      'VF',
      'VG',
      'VH',
      'IA',
      'IB',
      'IC',
      'ID',
      'IE',
      'IF',
      'MA',
      'AU',
      'AR',
    ]
    ordine.forEach((tipo, i) => {
      const atteso = linee.filter(l => l.startsWith(`${tipo};`)).length
      expect({ tipo, n: Number(campi[6 + i]) }).toEqual({ tipo, n: atteso })
    })
  })

  it('i campi ISTAT sono numerici zero-paddati, mai spazi', () => {
    // ISTAT provincia/comune sono `num 3` da tracciato: uno spazio in un campo
    // numerico fa scartare il file in acquisizione.
    const aa = linee.find(l => l.startsWith('AA;'))!.split(';')
    // AA: provincia UL in posizione 8, comune UL in 9 (0-based sul tipo record).
    expect(aa[8]).toMatch(/^\d{3}$/)
    expect(aa[9]).toMatch(/^\d{3}$/)

    const bc = linee.find(l => l.startsWith('BC;'))!.split(';')
    expect(bc[7]).toMatch(/^\d{3}$/)
    expect(bc[8]).toMatch(/^\d{3}$/)
  })

  it('rispetta la precedenza dei record agganciati alla scheda RIF', () => {
    const idx = (t: string) => linee.findIndex(l => l.startsWith(`${t};`))
    // BA deve precedere i suoi allegati BB/BC/BD; BE deve seguire BD.
    expect(idx('BA')).toBeLessThan(idx('BB'))
    expect(idx('BA')).toBeLessThan(idx('BC'))
    expect(idx('BA')).toBeLessThan(idx('BD'))
    expect(idx('BD')).toBeLessThan(idx('BE'))
    // AA precede tutto il resto della dichiarazione.
    expect(idx('AA')).toBeLessThan(idx('AU'))
    expect(idx('AA')).toBeLessThan(idx('BA'))
    // DA precede i suoi moduli UO/UD.
    expect(idx('DA')).toBeLessThan(idx('DB'))
  })

  it('non contiene caratteri fuori dall ASCII stampabile', () => {
    // Il file è ASCII ISO 646: gli accenti diventano vocale + apice.
    expect(contenuto.replace(/\r\n/g, '')).toMatch(/^[\x20-\x7E]*$/)
    expect(contenuto).toContain("SOCIETA'")
  })
})

describe('Registry versioni MUD', () => {
  const registry = new MudVersionRegistry()

  it('espone entrambe le annualità', () => {
    expect(registry.listVersions()).toEqual(
      expect.arrayContaining([
        { year: 2024, version: '6.04/24' },
        { year: 2025, version: '6.04/25' },
      ])
    )
  })

  it('risolve il tracciato per anno dei dati', () => {
    expect(registry.getForYear(2024).version).toBe('6.04/24')
    expect(registry.getForYear(2025).version).toBe('6.04/25')
  })

  it('ordina gli anni supportati dal più recente', () => {
    expect(registry.supportedYears()).toEqual([2025, 2024])
  })

  it('rifiuta un anno non supportato', () => {
    expect(() => registry.getForYear(2019)).toThrow(/non disponibile/)
  })
})

describe('Record AU — tipi di autorizzazione per annualità', () => {
  /** Estrae il campo «tipo di autorizzazione» dal record AU. */
  function tipoAut(
    tracciato: { generate: (d: MudExportData) => string },
    anno: number,
    tipo: number
  ) {
    const data = datasetCompleto(anno)
    data.autorizzazioni![0].tipoAutorizzazione = tipo as any
    const au = righe(tracciato.generate(data)).find(l => l.startsWith('AU;'))!
    // AU: tipo autorizzazione è il 9° campo dopo la costante di tipo record.
    return au.split(';')[9]
  }

  it('il 6.04/24 non ammette i tipi 7, 8, 9 e li riporta a ND', () => {
    const t = new MudTracciatoV604_2024()
    // Il tipo 8 (ordinanze art. 191) è introdotto solo dal 6.04/25: dichiararlo
    // su un tracciato che non lo prevede farebbe fallire la validazione.
    expect(tipoAut(t, 2024, 8)).toBe('0')
    expect(tipoAut(t, 2024, 5)).toBe('5')
  })

  it('il 6.04/25 ammette i nuovi tipi 7, 8 e 9', () => {
    const t = new MudTracciatoV604_2025()
    expect(tipoAut(t, 2025, 7)).toBe('7')
    expect(tipoAut(t, 2025, 8)).toBe('8')
    expect(tipoAut(t, 2025, 9)).toBe('9')
  })
})

describe('Controllo di lunghezza in generate()', () => {
  class TracciatoRotto extends MudTracciatoV604_2025 {
    protected recordBA(data: MudExportData, r: MudRifiutoLine, progressivo: number): string {
      return super.recordBA(data, r, progressivo) + 'X'
    }
  }
  it('lancia se un record non ha la lunghezza del tracciato', () => {
    expect(() => new TracciatoRotto().generate(datasetCompleto(2025))).toThrow(
      'Record BA di 218 caratteri invece di 217: file MUD non conforme'
    )
  })
  it('la tabella delle lunghezze del codice coincide con quella del test', () => {
    expect(LUNGHEZZE_RECORD_V604).toEqual(LUNGHEZZE)
  })
})
