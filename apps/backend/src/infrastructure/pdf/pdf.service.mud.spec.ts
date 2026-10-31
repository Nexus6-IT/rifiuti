import { PDFService } from './pdf.service'
import type { LoggerService } from '../../core/logger/logger.service'
import { controlliMud, riepilogaAvvisi } from '../../application/mud/aggregazione/mud-controlli'
import { MUDGeneratorService } from '../../application/mud/mud-generator.service'

const PRISMA_SENZA_REPORT = { mUDReport: { findUnique: async () => null } }

describe('PDFService.buildMUDContent - riepilogo dalla stessa aggregazione del file', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService

  const base = {
    year: 2025,
    totals: { produced: 1, recovery: 1, disposal: 0, recyclingRate: 1 },
    wasteProduced: [{ cerCode: '170405', totalQuantity: 1, count: 1 }],
    controlli: [],
  }

  const contenuto = (report: object) =>
    JSON.stringify((new PDFService(logger) as any).buildMUDContent(report))

  const m = {
    registroId: 'registro-1',
    progressiveNumber: 4,
    progressiveYear: 2025,
    cerCode: '17 04 05',
    causale: 'RICLASSIFICAZIONE',
    quantity: 30,
    unit: 'KG',
  }

  it('la tabella conta i movimenti, non i FIR', () => {
    const testo = contenuto(base)
    expect(testo).toContain('Movimenti')
    expect(testo).not.toContain('Numero FIR')
  })

  it('segnala un riepilogo con errori bloccanti', () => {
    const testo = contenuto({ ...base, controlli: [controlliMud.nessunMovimento(2025)] })
    expect(testo).toContain(
      'Riepilogo NON utilizzabile per la dichiarazione: ci sono errori da correggere (1).'
    )
  })

  it('elenca i messaggi degli errori bloccanti, come la pagina', () => {
    const bloccante = controlliMud.dichiaranteSenzaAteco()
    const testo = contenuto({
      ...base,
      controlli: [controlliMud.nessunMovimento(2025), bloccante, controlliMud.causaleEsclusa(m)],
    })
    expect(testo).toContain('Errori da correggere')
    const pezzo = (s: string) => JSON.stringify(s).slice(1, -1)
    const inizio = testo.indexOf('Errori da correggere')
    expect(testo.indexOf(pezzo(controlliMud.nessunMovimento(2025).messaggio))).toBeGreaterThan(
      inizio
    )
    expect(testo.indexOf(pezzo(bloccante.messaggio))).toBeGreaterThan(inizio)
    // l'avviso resta nella sua sezione, non fra gli errori
    expect(testo.indexOf(pezzo(controlliMud.causaleEsclusa(m).messaggio))).toBeGreaterThan(
      testo.indexOf('"Avvisi"')
    )
  })

  it('senza errori bloccanti non c è il paragrafo rosso', () => {
    expect(contenuto(base)).not.toContain('Riepilogo NON utilizzabile')
    expect(contenuto(base)).not.toContain('Errori da correggere')
  })

  it('elenca gli avvisi con i movimenti esclusi o segnalati', () => {
    const testo = contenuto({ ...base, controlli: [controlliMud.causaleEsclusa(m)] })
    expect(testo).toContain('Avvisi')
    expect(testo).toContain(JSON.stringify(controlliMud.causaleEsclusa(m).messaggio).slice(1, -1))
  })

  it('gli avvisi aprono con il testo del riepilogo e seguono l ordine delle voci', () => {
    const esclusa = controlliMud.causaleEsclusa(m)
    const nonDovuto = controlliMud.mudNonDovuto('esonero')
    // in ingresso l'avviso informativo viene prima; le voci mettono prima i kg esclusi
    const controlli = [nonDovuto, esclusa]
    const riepilogo = riepilogaAvvisi(controlli)
    const testo = contenuto({ ...base, controlli, riepilogoAvvisi: riepilogo })
    const posizione = (s: string) => testo.indexOf(JSON.stringify(s).slice(1, -1))
    expect(posizione(riepilogo.testo)).toBeGreaterThan(posizione('Avvisi'))
    expect(posizione(esclusa.messaggio)).toBeGreaterThan(posizione(riepilogo.testo))
    expect(posizione(nonDovuto.messaggio)).toBeGreaterThan(posizione(esclusa.messaggio))
  })

  it('azienda non tenuta al MUD: il PDF apre dicendolo', () => {
    const testo = contenuto({ ...base, mudNonDovuto: true })
    const frase = "L'azienda è segnata come non tenuta alla presentazione del MUD."
    expect(testo).toContain(frase)
    expect(testo.indexOf(frase)).toBeLessThan(testo.indexOf('RIEPILOGO ANNUALE'))
    expect(contenuto(base)).not.toContain(frase)
  })

  it('chiude con la riga fissa sui rifiuti prodotti fuori dall unità locale (RE)', () => {
    const testo = contenuto(base)
    const riga =
      "I rifiuti prodotti fuori dall'unità locale (cantieri, manutenzioni: modulo RE) non sono distinti: il file li attribuisce all'unità locale."
    expect(testo).toContain(riga)
    const contenutoArray = (new PDFService(logger) as any).buildMUDContent(base)
    expect(JSON.stringify(contenutoArray[contenutoArray.length - 1])).toContain(riga)
  })

  it('numeri in formato italiano con il raggruppamento anche a 4 cifre e CER leggibile', () => {
    const testo = contenuto({
      ...base,
      totals: { produced: 1234.5, recovery: 1000, disposal: 234.5, recyclingRate: 0.81 },
      wasteProduced: [{ cerCode: '170405', totalQuantity: 1234.5, count: 3 }],
    })
    expect(testo).toContain('1.234,5 kg')
    expect(testo).toContain('1.000 kg')
    expect(testo).toContain('"1.234,5"')
    expect(testo).toContain('17 04 05')
  })

  it("dal riepilogo al PDF il CER pericoloso resta con l'asterisco, l'altro senza", async () => {
    const aggregazione = {
      aggrega: jest.fn().mockResolvedValue({
        anno: 2025,
        righe: [
          { cerCode: '170405', prodottoKg: 10, recuperoKg: 10, smaltimentoKg: 0, dr: [], te: [] },
          { cerCode: '150101', prodottoKg: 5, recuperoKg: 5, smaltimentoKg: 0, dr: [], te: [] },
        ],
        movimentiPerCer: { '170405': 1, '150101': 1 },
        pericolosiPerCer: { '170405': true },
        dichiarante: { atecoNormalizzato: null, comuneCode: null },
        controlli: [],
        mudNonDovuto: false,
      }),
    }
    const report = await new MUDGeneratorService(
      aggregazione as any,
      logger,
      PRISMA_SENZA_REPORT as any
    ).generateMUDReport('t1', 2025)
    const testo = contenuto(report)
    expect(testo).toContain('"17 04 05*"')
    expect(testo).toContain('"15 01 01"')
    expect(testo).not.toContain('15 01 01*')
  })

  it('PDF: stesso contenuto con una sede', async () => {
    // la stessa azienda a una sede, prima e dopo F2-8: il riepilogo porta campi in più
    // (recupero, smaltimento, giacenze, dichiarazioni) che il PDF non stampa
    const righe = [
      {
        cerCode: '170405',
        prodottoKg: 1234.5,
        recuperoKg: 1000,
        smaltimentoKg: 234.5,
        dr: [],
        te: [],
      },
      { cerCode: '150101', prodottoKg: 5, recuperoKg: 5, smaltimentoKg: 0, dr: [], te: [] },
    ]
    const conGiacenze = righe.map(r => ({ ...r, giacenzaRecuperoKg: 77, giacenzaSmaltimentoKg: 8 }))
    const comune = {
      anno: 2025,
      movimentiPerCer: { '170405': 3, '150101': 1 },
      pericolosiPerCer: { '170405': true as const },
      dichiarante: { atecoNormalizzato: null, comuneCode: null },
      controlli: [],
      mudNonDovuto: false,
    }
    const genera = async (aggregato: object) => {
      const r = await new MUDGeneratorService(
        { aggrega: jest.fn().mockResolvedValue(aggregato) } as any,
        logger,
        PRISMA_SENZA_REPORT as any
      ).generateMUDReport('t1', 2025)
      return { ...r, generatedAt: new Date(0) }
    }
    const storico = await genera({ ...comune, righe })
    const nuovo = await genera({
      ...comune,
      righe: conGiacenze,
      versioneCalcolo: 2,
      dichiarazioni: [
        {
          codice: '000000000000001',
          progressivo: 1,
          unitaLocale: { id: 'ul-1', denominazione: 'Sede', numIscrSito: 'OP1', principale: true },
          anagrafica: null,
          numeroAddetti: 0,
          comuneCode: null,
          conAutorizzazioni: true,
          conAllegatiAzienda: true,
          righe: conGiacenze,
          movimentiPerCer: comune.movimentiPerCer,
          pericolosiPerCer: comune.pericolosiPerCer,
        },
      ],
    })
    expect(nuovo.wasteProduced[0].giacenzaRecuperoKg).toBe(77)
    expect(contenuto(nuovo)).toBe(contenuto(storico))
    expect(contenuto(nuovo)).toContain('"17 04 05*"')
  })
})
