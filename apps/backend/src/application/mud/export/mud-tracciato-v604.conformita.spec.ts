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
import { MudDichiarazioneExport, MudExportData, MudRifiutoLine } from './mud-export.types'
import {
  FILE_COMPLETO_2024,
  FILE_COMPLETO_2025,
  FILE_MINIMO_2024,
  FILE_MINIMO_2025,
  fixtureDatoCompleto,
  fixtureDatoMinimo,
} from './mud-tracciato-v604-legacy.fixture-spec'
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

  // (confutazione dopo l'esecuzione, A-W-05)
  it('il DR di un destinatario estero porta la nazione al posto del codice fiscale', () => {
    const campiDr = (c: string) =>
      righe(c)
        .find(l => l.startsWith('BB;') && l.includes(';DR;'))!
        .split(';')
    // tipo allegato, progressivo, CF, ragione sociale, ISTAT ×2, indirizzo, civico, CAP,
    // quantità e unità, poi il nome della nazione
    const nazione = (campi: string[]) => campi[campi.indexOf('DR') + 11]

    expect(nazione(campiDr(contenuto))).toBe(' '.repeat(20))

    const data = datasetCompleto(anno)
    data.rifiuti[0].dr = [
      { codiceFiscale: '', ragioneSociale: 'Recycling GmbH', nazione: 'Germania', quantitaKg: 5 },
    ]
    const campi = campiDr(tracciato.generate(data))
    expect(campi.join(';')).toHaveLength(LUNGHEZZE.BB)
    expect(nazione(campi)).toBe('GERMANIA'.padEnd(20, ' ')) // i campi alfanumerici escono maiuscoli
    expect(campi[campi.indexOf('DR') + 2]).toBe(' '.repeat(16)) // CF vuoto
  })

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

  it('con un MUD già presentato il record AA dichiara la sostituzione', () => {
    const data = datasetCompleto(anno)
    // 30/06/2026 alle 01:30 di Roma è ancora il 29 giugno in UTC: conta il giorno italiano
    data.sostituisce = { dataComunicazione: new Date('2026-06-29T23:30:00Z') }
    const aa = righe(tracciato.generate(data)).find(l => l.startsWith('AA;'))!
    expect(aa.endsWith(';1;20260630;')).toBe(true)
    expect(aa).toHaveLength(LUNGHEZZE.AA)
  })

  it('senza una presentazione precedente il record AA non sostituisce nulla', () => {
    const aa = linee.find(l => l.startsWith('AA;'))!
    expect(aa.endsWith(';0;00000000;')).toBe(true)
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

  it('conosce la scadenza di presentazione per anno dei dati, con il 30 aprile come ripiego', () => {
    expect(registry.scadenzaPresentazione(2024)).toEqual({ data: '2025-06-28', fonte: 'TRACCIATO' })
    expect(registry.scadenzaPresentazione(2025)).toEqual({ data: '2026-07-03', fonte: 'TRACCIATO' })
    expect(registry.scadenzaPresentazione(2030)).toEqual({ data: '2031-04-30', fonte: 'ORDINARIA' })
  })

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
  it('lancia anche su un tipo di record che la tabella non conosce', () => {
    class TracciatoTipoIgnoto extends MudTracciatoV604_2025 {
      protected recordBA(data: MudExportData, r: MudRifiutoLine, progressivo: number): string {
        return 'ZZ' + super.recordBA(data, r, progressivo).slice(2)
      }
    }
    expect(() => new TracciatoTipoIgnoto().generate(datasetCompleto(2025))).toThrow(
      'Record di tipo ZZ senza lunghezza nel tracciato: file MUD non conforme'
    )
  })
  it('la tabella delle lunghezze del codice coincide con quella del test', () => {
    expect(LUNGHEZZE_RECORD_V604).toEqual(LUNGHEZZE)
  })
})

describe.each([
  ['6.04/24', 2024, () => new MudTracciatoV604_2024(), FILE_COMPLETO_2024, FILE_MINIMO_2024],
  ['6.04/25', 2025, () => new MudTracciatoV604_2025(), FILE_COMPLETO_2025, FILE_MINIMO_2025],
])(
  'Tracciato MUD %s — una dichiarazione per unità locale',
  (_v, anno, factory, completo, minimo) => {
    const tracciato = factory()

    const riga = (cerCode: string, kg: number): MudRifiutoLine => ({
      cerCode,
      prodottoKg: kg,
      recuperoKg: kg,
      smaltimentoKg: 0,
      dr: [
        {
          codiceFiscale: '98765432109',
          ragioneSociale: 'Recuperi Sud S.p.A.',
          istatProvincia: '063',
          istatComune: '049',
          quantitaKg: kg,
        },
      ],
    })

    /** Due pacchetti: l'azienda (codice 1, con AU) e una sede (codice 2, senza AU). */
    function dueDichiarazioni(): MudExportData {
      const base = fixtureDatoCompleto(anno)
      base.rifiuti = [riga('170405', 1000)]
      const dichiarazioni: MudDichiarazioneExport[] = [
        {
          progressivoUnitaLocale: 1,
          unitaLocale: null,
          rifiuti: [riga('170405', 1000)],
          conAutorizzazioni: true,
          conAllegatiAzienda: true,
        },
        {
          progressivoUnitaLocale: 2,
          unitaLocale: {
            via: 'Via della Sede',
            civico: '5',
            cap: '30100',
            comune: 'VENEZIA',
            provincia: 'VE',
            comuneCode: '027042',
            numeroAddetti: 7,
          },
          rifiuti: [riga('150106', 2000)],
          conAutorizzazioni: false,
          conAllegatiAzienda: false,
        },
      ]
      return { ...base, dichiarazioni }
    }

    const linee = (c: string) => c.split('\r\n').filter(l => l.length > 0)
    const tipi = (c: string) => linee(c).map(l => l.slice(0, 2))

    it('senza dichiarazioni il file è byte-identico alla fixture (6.04/24 e 6.04/25)', () => {
      expect(tracciato.generate(fixtureDatoCompleto(anno))).toBe(completo)
      expect(tracciato.generate(fixtureDatoMinimo(anno))).toBe(minimo)
    })

    it("una dichiarazione di codice 1 e anagrafica dell'azienda = file della fixture", () => {
      const dato = fixtureDatoCompleto(anno)
      dato.dichiarazioni = [
        {
          progressivoUnitaLocale: 1,
          unitaLocale: null,
          rifiuti: dato.rifiuti,
          conAutorizzazioni: true,
          conAllegatiAzienda: true,
        },
      ]
      expect(tracciato.generate(dato)).toBe(completo)
    })

    it('due dichiarazioni: sequenza XX, AA, AB, AU, BA, BB, AA, AB, BA, BB', () => {
      expect(tipi(tracciato.generate(dueDichiarazioni()))).toEqual([
        'XX',
        'AA',
        'AB',
        'AU',
        'BA',
        'BB',
        'AA',
        'AB',
        'BA',
        'BB',
      ])
    })

    it('chiave di ogni record con il codice della sua unità locale', () => {
      const l = linee(tracciato.generate(dueDichiarazioni())).slice(1)
      const codici = l.map(r => r.split(';')[3])
      expect(codici).toEqual([
        '000000000000001',
        '000000000000001',
        '000000000000001',
        '000000000000001',
        '000000000000001',
        '000000000000002',
        '000000000000002',
        '000000000000002',
        '000000000000002',
      ])
    })

    it("AA della seconda sede: indirizzo della sede, sede legale dell'azienda, addetti della sede", () => {
      const aa = linee(tracciato.generate(dueDichiarazioni())).filter(r => r.startsWith('AA;'))[1]
      const c = aa.split(';')
      expect(c[6]).toBe('00007') // addetti della sede (l'azienda ne ha 42)
      expect([c[8], c[9]]).toEqual(['027', '042']) // ISTAT della sede
      expect(c[10]).toBe('VIA DELLA SEDE'.padEnd(30, ' '))
      expect(c[11]).toBe('5'.padEnd(6, ' '))
      expect(c[12]).toBe('30100')
      expect([c[15], c[16]]).toEqual(['028', '060']) // sede legale = azienda
      expect(c[17]).toBe('VIA CORSO UMBERTO I'.padEnd(30, ' '))
      expect(c[19]).toBe('35100')
      // il primo AA (azienda) ha invece gli addetti dell'azienda
      const aa1 = linee(tracciato.generate(dueDichiarazioni())).filter(r => r.startsWith('AA;'))[0]
      expect(aa1.split(';')[6]).toBe('00042')
      expect(aa).toHaveLength(LUNGHEZZE.AA)
    })

    it('AB del secondo pacchetto: 00 AUT e 00 RIC', () => {
      const ab = linee(tracciato.generate(dueDichiarazioni())).filter(r => r.startsWith('AB;'))
      // schede RIF, INT, ..., AUT, RIC: gli ultimi due campi prima del filler
      const coda = (r: string) => r.split(';').slice(-4, -2)
      expect(coda(ab[0])).toEqual(['01', '00'])
      expect(coda(ab[1])).toEqual(['00', '00'])
      expect(ab[1].split(';')[4]).toBe('000001') // una scheda RIF
    })

    it('AU nel pacchetto indicato anche se non è il primo', () => {
      const dato = dueDichiarazioni()
      dato.dichiarazioni![0].conAutorizzazioni = false
      dato.dichiarazioni![1].conAutorizzazioni = true
      expect(tipi(tracciato.generate(dato))).toEqual([
        'XX',
        'AA',
        'AB',
        'BA',
        'BB',
        'AA',
        'AB',
        'AU',
        'BA',
        'BB',
      ])
    })

    it('sostitutiva con più pacchetti: «annulla e sostituisce» solo nel pacchetto 1 (F1)', () => {
      const dato = dueDichiarazioni()
      dato.sostituisce = { dataComunicazione: new Date('2026-06-29T23:30:00Z') }
      const aa = linee(tracciato.generate(dato)).filter(r => r.startsWith('AA;'))
      expect(aa).toHaveLength(2)
      expect(aa[0].endsWith(';1;20260630;')).toBe(true)
      expect(aa[1].endsWith(';0;00000000;')).toBe(true)
      expect(aa[1]).toHaveLength(LUNGHEZZE.AA)
    })

    it('sostitutiva con un solo pacchetto: come prima, nel pacchetto unico', () => {
      const dato = fixtureDatoCompleto(anno)
      dato.sostituisce = { dataComunicazione: new Date('2026-06-29T23:30:00Z') }
      dato.dichiarazioni = [
        {
          progressivoUnitaLocale: 1,
          unitaLocale: null,
          rifiuti: dato.rifiuti,
          conAutorizzazioni: true,
          conAllegatiAzienda: true,
        },
      ]
      const aa = linee(tracciato.generate(dato)).filter(r => r.startsWith('AA;'))
      expect(aa).toHaveLength(1)
      expect(aa[0].endsWith(';1;20260630;')).toBe(true)
    })

    it('elenco di dichiarazioni vuoto: errore, mai un file senza pacchetti', () => {
      const dato = fixtureDatoCompleto(anno)
      dato.dichiarazioni = []
      expect(() => tracciato.generate(dato)).toThrow(/dichiarazioni vuot/i)
    })

    it('più di un pacchetto con le schede AU: errore (sarebbero duplicate)', () => {
      const dato = dueDichiarazioni()
      dato.dichiarazioni![1].conAutorizzazioni = true
      expect(() => tracciato.generate(dato)).toThrow(/AU/)
    })

    it('più di un pacchetto con gli allegati AR e INT: errore (sarebbero duplicati)', () => {
      const dato = dueDichiarazioni()
      dato.dichiarazioni![1].conAllegatiAzienda = true
      expect(() => tracciato.generate(dato)).toThrow(/AR e INT/)
    })

    it('XX conta i record di tutti i pacchetti', () => {
      const c = tracciato.generate(dueDichiarazioni())
      const xx = linee(c)[0].split(';')
      expect(Number(xx[5])).toBe(9) // totale record escluso XX
      expect([xx[6], xx[7], xx[8], xx[9]]).toEqual(['00002', '00002', '00002', '00002']) // AA AB BA BB
      expect(xx[34]).toBe('00001') // AU
    })

    it('lunghezze di tutti i record invariate', () => {
      for (const r of linee(tracciato.generate(dueDichiarazioni()))) {
        expect({ t: r.slice(0, 2), n: r.length }).toEqual({
          t: r.slice(0, 2),
          n: LUNGHEZZE[r.slice(0, 2)],
        })
      }
    })

    it('BA scrive le giacenze a recupero e a smaltimento; giacenza assente = 0', () => {
      const dato = dueDichiarazioni()
      dato.dichiarazioni![0].rifiuti = [
        {
          ...riga('170405', 1000),
          recuperoKg: 200,
          giacenzaRecuperoKg: 3000,
          giacenzaSmaltimentoKg: 1500,
        },
      ]
      dato.dichiarazioni![1].rifiuti = [
        { ...riga('150106', 2000), recuperoKg: 200, giacenzaRecuperoKg: 3000 },
      ]
      const ba = linee(tracciato.generate(dato)).filter(r => r.startsWith('BA;'))
      const code = ';0000200,000;1;0000000,000;1;'
      expect(ba[0].endsWith(';0003000,000;1;0001500,000;1' + code)).toBe(true)
      expect(ba[1].endsWith(';0003000,000;1;0000000,000;1' + code)).toBe(true)
    })
  }
)
