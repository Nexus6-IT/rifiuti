import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { apriStaging } from '../staging/lettore-staging'
import { colonneDocumentate } from '../../../test-support/migrazione-sorgente'
import { scriviStaging, TabellaDaScrivere } from '../staging/scrittore-staging'
import { analizzaArchivio } from './analizza-archivio'
import { rapportoInMarkdown } from './rapporto-sorgente'

const FIXTURE = join(__dirname, '../../../../test/fixtures/winwaste/WW00012026')
const META = { ditta: '0001', anno: 2026, estrattoIl: '2026-11-14T00:00:00.000Z' }

describe('analizzaArchivio sulla fixture WW00012026', () => {
  it('coincide con il rapporto atteso committato', async () => {
    const r = await analizzaArchivio(await apriStaging(FIXTURE))
    const atteso = JSON.parse(await readFile(join(FIXTURE, 'rapporto-atteso.json'), 'utf8'))
    expect(JSON.parse(JSON.stringify(r))).toEqual(atteso)
  })

  it('confronto 1: conteggi per tabella, causale, OPER e stato', async () => {
    const { confronto1: c } = await analizzaArchivio(await apriStaging(FIXTURE))
    const mov = c.perTabella.find(t => t.tabella === 'MOVIMENTI')!
    expect(mov).toMatchObject({ righeLette: 18, record: 13, scartate: 5, conAvvisi: 2 })
    expect(c.movimentiPerCausale).toEqual([
      { causale: '01', attivi: 5, annullati: 1 },
      { causale: '05', attivi: 1, annullati: 0 },
      { causale: '10', attivi: 4, annullati: 0 },
      { causale: '18', attivi: 1, annullati: 0 },
      { causale: '50', attivi: 1, annullati: 0 },
    ])
    expect(c.movimentiPerOper.find(o => o.oper === '20')).toMatchObject({
      tipo: 'CARICO',
      attivi: 5,
      annullati: 1,
    })
    expect(c.formulariPerStato).toEqual([
      { stato: 'ANNULLATO', conteggio: 1 },
      { stato: 'EMESSO', conteggio: 1 },
      { stato: 'PORTALE', conteggio: 1 },
      { stato: 'RICOPIATO', conteggio: 2 },
    ])
  })

  it('confronto 2: kg e m3 sono somme separate, solo attivi', async () => {
    const { confronto2 } = await analizzaArchivio(await apriStaging(FIXTURE))
    const riga = (cer: string, tipo: string) =>
      confronto2.righe.find(r => r.cer === cer && r.tipo === tipo)!
    expect(riga('13 02 05*', 'CARICO')).toMatchObject({ movimenti: 1, kgnum: 1800, mcnum: 2 })
    // carichi 1 (1000) + 10 (KGNUM 900) del 15 01 10*: il 5 e annullato e non conta
    expect(riga('15 01 10*', 'CARICO')).toMatchObject({ movimenti: 1, kgnum: 1000 })
    expect(riga('17 05 04', 'CARICO').kgnum).toBe(900)
    expect(riga('(assente)', 'SOLO_FATTURAZIONE')).toMatchObject({ movimenti: 1, kgnum: 0 })
  })

  it('confronto 3: differenza fra GIASCAR e RELAZ, G e P a parte', async () => {
    const { confronto3: c } = await analizzaArchivio(await apriStaging(FIXTURE))
    expect(c.carichiEsaminati).toBe(6)
    expect(c.differenze).toEqual([
      {
        cod: 2,
        cer: '15 01 02',
        kgnum: 2000,
        giascar: 450,
        scaricatoDaRelaz: 500,
        differenza: -50,
      },
    ])
    expect(c.scaricatoDaGiacenzeIniziali).toEqual({ G0: 0, G1: 100, G2: 0, G3: 0, G4: 0, G5: 0 })
    expect(c.scaricatoDaAnnoPrecedente).toBe(50)
    expect(c.carichiCitatiInesistenti).toEqual([])
    const g = c.giacenzaAlTaglio.find(x => x.cer === '15 01 02' && x.classe === 'R')!
    expect(g).toMatchObject({
      carichi: 2,
      residuoDaRelaz: 1550,
      residuoDaGiascar: 1600,
      differenza: 50,
    })
  })

  it('confronto 4: primo, ultimo e buchi per registro; numeri dei FIR per serie', async () => {
    const { confronto4: c } = await analizzaArchivio(await apriStaging(FIXTURE))
    expect(c.registri).toEqual([
      {
        registro: '0002',
        anno: 2026,
        conteggio: 9,
        primo: 1,
        ultimo: 11,
        buchi: [5, 7],
        buchiTotali: 2,
        duplicati: [],
        ultimoStampato: 7,
      },
    ])
    expect(c.firPerSerie).toEqual([
      { serie: 'XRIF', anno2: '26', conteggio: 4, primo: 1, ultimo: 4 },
    ])
  })

  it('confronto 5: VERSIS e RENregistrazioni', async () => {
    const { confronto5: c } = await analizzaArchivio(await apriStaging(FIXTURE))
    expect(c.versis).toEqual({
      presente: true,
      righe: 3,
      perPrefisso: { HUBRW: 1, XRENTRI: 2 },
      righeSensibili: 1,
    })
    expect(c.renRegistrazioni).toEqual({
      presente: true,
      righe: 2,
      inviate: 1,
      conIdRentri: 1,
      inviateSenzaIdRentri: 0,
      movimentiRiferitiInesistenti: 0,
    })
  })

  it('il rapporto non contiene valori personali ne segreti', async () => {
    const r = await analizzaArchivio(await apriStaging(FIXTURE))
    const testo = JSON.stringify(r) + rapportoInMarkdown(r)
    for (const v of [
      'PASSWORD-CIFRATA-FINTA',
      'LICENZA-FINTA',
      'utente-finto',
      'hub.esempio.invalid',
      'RSSMRA80A01H501U',
      'DITTA PROVA',
      'ID-FINTO-0001',
      'Administrator',
    ]) {
      expect(testo).not.toContain(v)
    }
  })

  it('il markdown ha una sezione per ogni confronto', async () => {
    const md = rapportoInMarkdown(await analizzaArchivio(await apriStaging(FIXTURE)))
    for (const t of [
      '## Confronto 1',
      '## Confronto 2',
      '## Confronto 3',
      '## Confronto 4',
      '## Confronto 5',
      '## Corrispondenze dedotte',
      '## Avvisi dello staging',
    ]) {
      expect(md).toContain(t)
    }
    expect(md).toContain('2: 5, 7')
  })
})

// --- scenari costruiti in memoria ----------------------------------------------
describe('analizzaArchivio: scenari', () => {
  let radice: string
  beforeEach(async () => {
    radice = await mkdtemp(join(tmpdir(), 'analisi-test-'))
  })
  afterEach(async () => {
    await rm(radice, { recursive: true, force: true })
  })

  const riga = (tabella: string, v: Record<string, string | null>): (string | null)[] =>
    colonneDocumentate(tabella).map(c => (c in v ? v[c] : ''))
  const tab = (nome: string, righe: Record<string, string | null>[]): TabellaDaScrivere => ({
    nome,
    colonne: colonneDocumentate(nome),
    righe: righe.map(v => riga(nome, v)),
  })
  const mov = (o: Record<string, string | null>): Record<string, string | null> => ({
    CAUS: '01',
    OPER: '20',
    DTUK: '20260105',
    CER: '150102',
    TIPOL: 'S',
    NETTO: '100',
    KGNUM: '100.000000',
    MCNUM: '0.000000',
    GIASCAR: '0.000000',
    STATO: 'R001',
    MAG1: '001',
    MAG2: '001',
    ...o,
  })
  const analizza = async (tabelle: TabellaDaScrivere[]) => {
    const { cartella } = await scriviStaging(radice, META, tabelle)
    return analizzaArchivio(await apriStaging(cartella))
  }

  it('senza MOVIMENTI e senza tabelle RENTRI: sezioni vuote e nota esplicita', async () => {
    const r = await analizza([
      tab('CAUSALI RIFIUTI', [{ COD: '01', DES: 'x', TIP: '2', OPE: '0' }]),
    ])
    expect(r.confronto1.perTabella.find(t => t.tabella === 'MOVIMENTI')).toMatchObject({
      presente: false,
      record: 0,
    })
    expect(r.confronto2.righe).toEqual([])
    expect(r.confronto4.registri).toEqual([])
    expect(r.confronto5).toEqual({
      versis: { presente: false },
      renRegistrazioni: { presente: false, nota: 'tabelle RENTRI assenti dallo staging' },
    })
    expect(rapportoInMarkdown(r)).toContain('VERSIS: assente dallo staging.')
  })

  it('marca le corrispondenze OPER dedotte e senza KGNUM leggibile non somma i kg', async () => {
    const r = await analizza([
      tab('MOVIMENTI', [
        mov({ COD: '1', OPER: '27', KGNUM: 'x' }),
        mov({ COD: '2', OPER: '27', KGNUM: '10.000000', NETTO: '10' }),
        mov({ COD: '3', OPER: '52', DTUK: '$$260105' }),
      ]),
    ])
    expect(r.corrispondenzeDedotte).toEqual([
      { oper: '27', movimenti: 2 },
      { oper: '52', movimenti: 1 },
    ])
    const riga27 = r.confronto2.righe.find(x => x.tipo === 'NESSUNA_GIACENZA')!
    expect(riga27).toMatchObject({ movimenti: 2, kgnum: 10, senzaKgnum: 1 })
    expect(r.avvisiPerCodice).toEqual([
      { tabella: 'MOVIMENTI', codice: 'KGNUM_NON_VALIDO', conteggio: 1 },
    ])
  })

  it('carichi citati da RELAZ ma assenti, protocolli duplicati e registro stampato', async () => {
    const dodici = (n: number) => n.toFixed(3).replace('.', ',').padStart(12, ' ')
    const relaz = `C99999999R${dodici(5)}${dodici(0)}`
    const r = await analizza([
      tab('MOVIMENTI', [
        mov({ COD: '1', REG1: '0002', PROT1: '000003' }),
        mov({
          COD: '2',
          REG1: '0002',
          PROT1: '000003',
          CAUS: '10',
          OPER: '23',
          RELAZ: relaz,
          NETTO: '5',
          KGNUM: '5.000000',
        }),
        mov({ COD: '3', REG1: '0002', PROT1: '000001', DTUK: '20250105' }),
      ]),
      tab('REGISTRI RIFIUTI', [{ COD: '0002', DES: 'x', PRT: '000003', ASS: '1' }]),
    ])
    expect(r.confronto3.carichiCitatiInesistenti).toEqual([{ cod: 99999999, kg: 5 }])
    const g26 = r.confronto4.registri.find(g => g.anno === 2026)!
    expect(g26).toMatchObject({
      conteggio: 2,
      primo: 3,
      ultimo: 3,
      duplicati: [3],
      buchiTotali: 0,
      ultimoStampato: 3,
    })
    expect(r.confronto4.registri.map(g => g.anno)).toEqual([2025, 2026])
  })

  it('limita buchi e scarti elencati ma non i conteggi', async () => {
    const tabelle = () => [
      tab('MOVIMENTI', [
        mov({ COD: '1', REG1: '0002', PROT1: '000001' }),
        mov({ COD: '2', REG1: '0002', PROT1: '000100' }),
        mov({ COD: '3', OPER: '19' }),
        mov({ COD: '4', OPER: '19' }),
        mov({ COD: '5', OPER: '19' }),
      ]),
    ]
    const intero = await analizza(tabelle())
    const { cartella } = await scriviStaging(join(radice, 'b'), META, tabelle())
    const limitato = await analizzaArchivio(await apriStaging(cartella), {
      maxScartiElencati: 2,
      maxBuchi: 10,
    })
    expect(intero.scartiTroncati).toBe(false)
    expect(intero.scarti).toHaveLength(3)
    expect(limitato.scartiTroncati).toBe(true)
    expect(limitato.scarti).toHaveLength(2)
    expect(limitato.scartiPerCodice).toEqual([
      { tabella: 'MOVIMENTI', codice: 'OPER_SCONOSCIUTO', conteggio: 3 },
    ])
    expect(limitato.confronto4.registri[0]).toMatchObject({ buchiTotali: 98 })
    expect(limitato.confronto4.registri[0].buchi).toHaveLength(10)
    expect(rapportoInMarkdown(limitato)).toContain('...')
    expect(rapportoInMarkdown(limitato)).toContain('troncato')
  })

  it('RENregistrazioni: inviate senza IDRENTRI e movimenti riferiti inesistenti', async () => {
    const rr = (o: Record<string, string>) => ({
      ANNOMOVIMENTO: '2026',
      REGISTRO: '0002',
      XSEINVIATO: 'X',
      ...o,
    })
    const r = await analizza([
      tab('MOVIMENTI', [mov({ COD: '1' })]),
      tab('RENregistrazioni', [
        rr({ CODMOVIMENTO: '1', PROTOCOLLO: '000001', IDRENTRI: 'a' }),
        rr({ CODMOVIMENTO: '2', PROTOCOLLO: '000002', IDRENTRI: '' }),
        rr({
          CODMOVIMENTO: '3',
          PROTOCOLLO: '000003',
          IDRENTRI: '',
          XSEINVIATO: '',
          ANNOMOVIMENTO: '2025',
        }),
      ]),
    ])
    expect(r.confronto5.renRegistrazioni).toEqual({
      presente: true,
      righe: 3,
      inviate: 2,
      conIdRentri: 1,
      inviateSenzaIdRentri: 1,
      movimentiRiferitiInesistenti: 1,
    })
    expect(rapportoInMarkdown(r)).toContain('1 inviate senza IDRENTRI')
  })

  it('ENTRAMBI conta come carico; la classe T usa MAG1, la R usa MAG2', async () => {
    const r = await analizza([
      tab('MOVIMENTI', [
        mov({ COD: '1', OPER: '13', STATO: 'T002', MAG1: '0', MAG2: '009' }),
        mov({ COD: '2', OPER: '20', STATO: 'R003', MAG1: '007', MAG2: '009' }),
      ]),
    ])
    expect(r.confronto3.carichiEsaminati).toBe(2)
    expect(r.confronto3.giacenzaAlTaglio.map(g => [g.classe, g.posizione, g.magazzino])).toEqual([
      ['R', '003', '009'],
      ['T', '002', '0'],
    ])
  })
})
