import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { eseguiCli } from '../../../cli/migrazione-prepara'
import { mappaValida, U2 } from '../../../test-support/migrazione/mappa-di-prova'
import {
  scriviStagingAnagraficheProva,
  StagingAnagraficheProva,
} from '../../../test-support/migrazione/staging-anagrafiche-di-prova'
import { scriviStaging } from '../staging/scrittore-staging'
import { apriStaging } from '../staging/lettore-staging'
import { validaMappa } from './mappa-import'
import { preparaAnagrafiche, RisultatoAnagrafiche } from './prepara-anagrafiche'

describe('I4 T1/T2: trasformazione pura CLIFOR + SEDI LEGALI + UNITA LOCALI + AUTORIZZAZIONI + AUTOMEZZI', () => {
  let radice: string
  let prova: StagingAnagraficheProva
  let r: RisultatoAnagrafiche
  const seme = 6_100_000 + (Date.now() % 100_000)

  const mappa = () =>
    validaMappa({
      ...mappaValida(),
      agganci: [{ partitaIva: prova.piva.agganciata, dittaId: U2 }],
    })
  const conteggio = (tabella: string, codice: string) =>
    r.scarti.find(s => s.tabella === tabella && s.codice === codice)?.conteggio ?? 0
  const chiaviSedi = () => r.sedi.map(s => s.legacyKey).sort()

  beforeAll(async () => {
    radice = await mkdtemp(join(tmpdir(), 'prep-anag-'))
    prova = await scriviStagingAnagraficheProva(radice, seme)
    r = await preparaAnagrafiche(await apriStaging(prova.cartella), mappa())
  })
  afterAll(() => rm(radice, { recursive: true, force: true }))

  it('ditte: come in I2, duplicato segnalato con le chiavi, agganciata esclusa', () => {
    const k = r.ditte.map(d => d.legacyKey).sort()
    expect(k).toEqual(
      [
        prova.piva.uno,
        prova.piva.due,
        prova.piva.tre,
        prova.cfPrivato,
        prova.piva.ambiguaC,
        prova.piva.ambiguaF,
      ]
        .map(v => `0001|FISC|${v}`)
        .sort()
    )
    expect(r.duplicati.filter(d => !d.tabella)).toEqual([
      { scartata: '0001|F|000005', tenuta: '0001|C|000001' },
    ])
    expect(conteggio('CLIFOR', 'DITTA_DUPLICATA')).toBe(1)
    expect(r.agganciate).toBe(1)
  })

  it('sedi: legale da SEDI LEGALI (vince su CLIFOR), da CLIFOR, seconda sede, unita locali', () => {
    expect(chiaviSedi()).toEqual(
      [
        '0001|C|000001|SL',
        '0001|C|000001|0001',
        '0001|F|000002|SL',
        '0001|F|000002|0001',
        '0001|F|000003|SL',
        '0001|F|000003|S2',
        '0001|C|000006|SL',
        '0001|C|000007|SL',
        '0001|F|000007|SL',
      ].sort()
    )
    const uno = r.sedi.find(s => s.legacyKey === '0001|C|000001|SL')!
    expect(uno.comune).toBe('SALERNO') // SEDI LEGALI vince su CLIFOR (NAPOLI)
    expect(uno.principale).toBe(true)
    const due = r.sedi.find(s => s.legacyKey === '0001|F|000002|SL')!
    expect(due.civico).toBe('SNC')
    expect(due.provincia).toBe('RM')
    expect(due.telefono).toBe('0612345678')
    const seconda = r.sedi.find(s => s.legacyKey === '0001|F|000003|S2')!
    expect(seconda.principale).toBe(false)
    expect(seconda.denominazione).toBe('DEPOSITO TRE')
    const ul = r.sedi.find(s => s.legacyKey === '0001|C|000001|0001')!
    expect(ul.principale).toBe(false)
    expect(ul.denominazione).toBe('DEPOSITO UNO')
    // PRECOD di 6 caratteri (solo COD) o 7 (C/F davanti): entrambi risolti
    expect(chiaviSedi()).toContain('0001|F|000002|0001')
  })

  it('una ditta agganciata porta il suo id e le sue sedi non sono principali', () => {
    const s = r.sedi.find(x => x.legacyKey === '0001|C|000006|SL')!
    expect(s.dittaId).toBe(U2)
    expect(s.principale).toBe(false)
    expect(s.dittaKey).toBe(`0001|FISC|${prova.piva.agganciata}`)
  })

  it('sedi non importabili: contate per codice, senza valori', () => {
    expect(conteggio('UNITA LOCALI', 'UNITA_LOCALE_PROPRIA')).toBe(1)
    expect(conteggio('UNITA LOCALI', 'SOGGETTO_NON_RISOLTO')).toBe(1)
    expect(conteggio('UNITA LOCALI', 'SOGGETTO_AMBIGUO')).toBe(1)
    expect(conteggio('UNITA LOCALI', 'CODICE_UNITA_RISERVATO')).toBe(1)
    expect(conteggio('UNITA LOCALI', 'INDIRIZZO_INCOMPLETO')).toBe(1)
    // il privato senza CAP resta una ditta ma senza sede
    expect(r.sedi.some(s => s.legacyKey.startsWith('0001|C|000004'))).toBe(false)
    expect(conteggio('CLIFOR', 'SEDE_LEGALE_INCOMPLETA')).toBe(1)
    expect(JSON.stringify(r.scarti)).not.toContain('NAPOLI')
  })

  it("T2: l'unita locale dell'azienda non finisce fra le anagrafiche ne' fra i destinatari", () => {
    const tutte = JSON.stringify([r.sedi, r.produttori, r.trasportatori, r.destinatari])
    expect(tutte).not.toContain('X90001')
    expect(tutte).not.toContain('SITO PROPRIO')
  })

  it('ruoli dedotti dall uso nei movimenti, con numero e scadenza dell autorizzazione', () => {
    expect(r.produttori.map(p => p.legacyKey)).toEqual(['0001|C|000001', '0001|C|000006'])
    // il produttore di una ditta agganciata porta l'id esistente
    expect(r.produttori[1]).toMatchObject({ dittaId: U2, sedeKey: '0001|C|000006|SL' })
    expect(r.produttori[0]).toMatchObject({
      dittaKey: `0001|FISC|${prova.piva.uno}`,
      sedeKey: '0001|C|000001|SL',
      dittaId: null,
    })
    expect(r.trasportatori).toEqual([
      expect.objectContaining({
        legacyKey: '0001|F|000002',
        numeroIscrizione: 'NA/1234',
        scadenzaIscrizione: '2028-12-31',
        sedeKey: '0001|F|000002|SL',
      }),
    ])
    expect(r.destinatari).toEqual([
      expect.objectContaining({
        legacyKey: '0001|F|000003',
        numeroAutorizzazione: 'AUT-77',
        scadenzaAutorizzazione: null,
      }),
    ])
    expect(conteggio('MOVIMENTI', 'SOGGETTO_AMBIGUO')).toBe(1)
    expect(conteggio('MOVIMENTI', 'INTERMEDIARIO_SENZA_MODELLO')).toBe(1)
    // l'unita' locale propria, usata come produttore nei movimenti, non genera nulla
    expect(r.produttori.some(p => p.legacyKey.includes('X90001'))).toBe(false)
  })

  it('automezzi: normalizzati, rimorchi e doppioni segnalati, proprietario risolto', () => {
    const per = Object.fromEntries(r.automezzi.map(a => [a.legacyKey, a]))
    expect(Object.keys(per).sort()).toEqual(
      ['0001|MEZ|000002.0001|0001', '0001|MEZ|X90001.0001|0004', '0001|MEZ|000001.0001|0005'].sort()
    )
    expect(per['0001|MEZ|000002.0001|0001']).toMatchObject({
      targa: 'AB123CD',
      taraKg: 7500,
      trasportatoreKey: '0001|F|000002',
    })
    expect(per['0001|MEZ|X90001.0001|0004'].trasportatoreKey).toBeNull()
    expect(per['0001|MEZ|000001.0001|0005']).toMatchObject({ trasportatoreKey: null, taraKg: null })
    expect(conteggio('AUTOMEZZI', 'RIMORCHIO_NON_IMPORTATO')).toBe(1)
    expect(conteggio('AUTOMEZZI', 'TARGA_DUPLICATA')).toBe(1)
    expect(conteggio('AUTOMEZZI', 'TARGA_NON_VALIDA')).toBe(1)
    expect(r.duplicati).toContainEqual({
      tabella: 'AUTOMEZZI',
      scartata: '0001|MEZ|000002.0001|0003',
      tenuta: '0001|MEZ|000002.0001|0001',
    })
    expect(r.avvisi.find(a => a.codice === 'PROPRIETARIO_SENZA_RUOLO')?.conteggio).toBe(1)
  })

  it('senza MOVIMENTI ne FORMULARI i ruoli non si deducono: avviso, nessun ruolo inventato', async () => {
    const dir = await mkdtemp(join(radice, 'sm-'))
    const p = await scriviStagingAnagraficheProva(dir, seme + 50, { senzaMovimenti: true })
    const senza = await preparaAnagrafiche(await apriStaging(p.cartella), mappa())
    expect(senza.produttori).toEqual([])
    expect(senza.trasportatori).toEqual([])
    expect(senza.destinatari).toEqual([])
    expect(senza.avvisi.map(a => a.codice)).toContain('RUOLI_NON_DEDUCIBILI')
    // le sedi e gli automezzi ci sono comunque
    expect(senza.sedi.length).toBeGreaterThan(0)
    // senza ruolo trasportatore il proprietario non si risolve: automezzo importato senza
    expect(senza.automezzi.every(a => a.trasportatoreKey === null)).toBe(true)
  })

  it('i record prodotti passano tutti la validazione del server', async () => {
    const m = mappa()
    const {
      validaRecordSede,
      validaRecordProduttore,
      validaRecordTrasportatore,
      validaRecordDestinatario,
      validaRecordAutomezzo,
    } = await import('./record-anagrafiche')
    r.sedi.forEach(x => validaRecordSede(JSON.parse(JSON.stringify(x)), m))
    r.produttori.forEach(x => validaRecordProduttore(JSON.parse(JSON.stringify(x)), m))
    r.trasportatori.forEach(x => validaRecordTrasportatore(JSON.parse(JSON.stringify(x)), m))
    r.destinatari.forEach(x => validaRecordDestinatario(JSON.parse(JSON.stringify(x)), m))
    r.automezzi.forEach(x => validaRecordAutomezzo(JSON.parse(JSON.stringify(x)), m))
  })

  it('la CLI scrive le fasi nuove nel pacchetto e riporta scarti e avvisi senza valori', async () => {
    const mappaFile = join(radice, 'mappa-import.json')
    await writeFile(
      mappaFile,
      JSON.stringify({
        ...mappaValida(),
        agganci: [{ partitaIva: prova.piva.agganciata, dittaId: U2 }],
      })
    )
    const out: string[] = []
    const err: string[] = []
    const codice = await eseguiCli(
      [prova.cartella, '--mappa', mappaFile, '--destinazione', join(radice, 'dest')],
      { scrivi: m => out.push(m), errore: m => err.push(m) }
    )
    expect(codice).toBe(0)
    const testo = out.join('\n')
    for (const f of ['sedi', 'produttori', 'trasportatori', 'destinatari', 'automezzi'])
      expect(testo).toContain(`ANAGRAFICHE/${f}:`)
    expect(testo).toContain('avviso AUTOMEZZI PROPRIETARIO_SENZA_RUOLO: 1')
    expect(testo).toContain('scarto UNITA LOCALI UNITA_LOCALE_PROPRIA: 1')
    for (const vietato of ['NAPOLI', 'AB123CD', prova.piva.uno, prova.cfPrivato, 'NA/1234'])
      expect(testo).not.toContain(vietato)
  })

  it('ruoli dedotti: avviso con il conteggio per tipo (M-1)', () => {
    const per = Object.fromEntries(
      r.avvisi.filter(a => a.codice === 'RUOLO_DEDOTTO').map(a => [a.tabella, a.conteggio])
    )
    expect(per).toEqual({ PRODUTTORI: 2, TRASPORTATORI: 1, DESTINATARI: 1 })
  })

  describe('I-1: unita locali di righe CLIFOR duplicate (stessa P.IVA)', () => {
    const colCl = ['PRECOD', 'COD', 'DES', 'PIVA', 'IND', 'NUM', 'COM', 'CAP', 'PROV'] as const
    const colUl = ['PRECOD', 'COD', 'DES', 'IND', 'NUM', 'COM', 'CAP', 'PROV'] as const
    async function prepara(ordine: 'cf' | 'fc') {
      const dir = await mkdtemp(join(radice, 'dup-'))
      const piva = prova.piva.uno
      const cl = (p: string, c: string) => [
        p,
        c,
        'DITTA',
        piva,
        'VIA SEDE',
        '1',
        'ROMA',
        '00100',
        'RM',
      ]
      const ulC = ['000001', '0001', 'UL DEL CLIENTE', 'VIA CLIENTE', '1', 'NAPOLI', '80100', 'NA']
      const ulF = [
        '000005',
        '0001',
        'UL DEL FORNITORE',
        'VIA FORNITORE',
        '2',
        'MILANO',
        '20100',
        'MI',
      ]
      const { cartella } = await scriviStaging(
        dir,
        { ditta: '0001', anno: 2026, estrattoIl: '2026-11-14T00:00:00.000Z' },
        [
          { nome: 'CLIFOR', colonne: colCl, righe: [cl('C', '000001'), cl('F', '000005')] },
          {
            nome: 'UNITA LOCALI',
            colonne: colUl,
            righe: ordine === 'cf' ? [ulC, ulF] : [ulF, ulC],
          },
        ]
      )
      return preparaAnagrafiche(await apriStaging(cartella), mappa())
    }
    it.each(['cf', 'fc'] as const)(
      'ordine %s: due sedi distinte, indirizzi giusti, nessun SEDE_DUPLICATA',
      async ordine => {
        const x = await prepara(ordine)
        const c = x.sedi.find(s => s.legacyKey === '0001|C|000001|0001')!
        const f = x.sedi.find(s => s.legacyKey === '0001|F|000005|0001')!
        expect(c.comune).toBe('NAPOLI')
        expect(f.comune).toBe('MILANO')
        expect(c.dittaKey).toBe(f.dittaKey)
        expect(x.scarti.find(s => s.codice === 'SEDE_DUPLICATA')).toBeUndefined()
      }
    )
  })
})
