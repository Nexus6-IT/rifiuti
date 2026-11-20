import { mkdtemp, rm, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { eseguiCli } from '../../../cli/migrazione-prepara'
import { mappaValida, U1, U2 } from '../../../test-support/migrazione/mappa-di-prova'
import { StagingAnagraficheProva } from '../../../test-support/migrazione/staging-anagrafiche-di-prova'
import {
  CASI_FIR,
  scriviStagingFirProva,
} from '../../../test-support/migrazione/staging-fir-di-prova'
import { apriStaging } from '../staging/lettore-staging'
import { validaMappa } from './mappa-import'
import { preparaAnagrafiche } from './prepara-anagrafiche'
import { preparaFir, RisultatoFir } from './prepara-fir'
import { validaRecordFir, validaRecordFirDigitale } from './record-fir'

const SEDE_PROPRIA = '44444444-4444-4444-8444-444444444444'
const UL_PROPRIA = '55555555-5555-4555-8555-555555555555'

describe('I5 T1: FORMULARI -> record fir e fir-digitali (trasformazione pura, fixture SINTETICHE)', () => {
  let radice: string
  let prova: StagingAnagraficheProva
  let r: RisultatoFir
  const seme = 6_300_000 + (Date.now() % 100_000)

  const mappa = () =>
    validaMappa({
      ...mappaValida(),
      unitaLocali: [{ legacy: 'X1.0001', sedeId: SEDE_PROPRIA, unitaLocaleId: UL_PROPRIA }],
      agganci: [{ partitaIva: prova.piva.agganciata, dittaId: U2 }],
    })
  const scarto = (codice: string) => r.scarti.find(s => s.codice === codice)?.conteggio ?? 0
  const avviso = (codice: string) => r.avvisi.find(s => s.codice === codice)?.conteggio ?? 0
  const perChiave = (cod: number) => r.fir.find(f => f.legacyKey.endsWith(`|FORMULARI|${cod}`))!

  beforeAll(async () => {
    radice = await mkdtemp(join(tmpdir(), 'prep-fir-'))
    prova = await scriviStagingFirProva(radice, seme)
    const staging = await apriStaging(prova.cartella)
    const anag = await preparaAnagrafiche(staging, mappa())
    r = await preparaFir(staging, mappa(), anag)
  })
  afterAll(() => rm(radice, { recursive: true, force: true }))

  it('i record prodotti superano la validazione del server', () => {
    for (const f of r.fir) expect(() => validaRecordFir(f, mappa())).not.toThrow()
    for (const d of r.firDigitali) expect(() => validaRecordFirDigitale(d, mappa())).not.toThrow()
  })

  it('cartacei: C7 vuoto, R e 9 entrano; annullati, richieste del portale e digitali no', () => {
    const cod = r.fir.map(f => Number(f.legacyKey.split('|')[3])).sort((a, b) => a - b)
    expect(cod).toEqual([1, 2, 3, 10, 12, 13, 15])
    expect(scarto('FIR_ANNULLATO')).toBe(1)
    expect(scarto('RICHIESTA_PORTALE')).toBe(1)
  })

  it('firNumber importato com e (FORMU), anche duplicato: nessuna rinomina', () => {
    expect(perChiave(1).firNumber).toBe('A0001/26')
    expect(perChiave(10).firNumber).toBe('A0001/26')
    expect(avviso('FIR_NUMBER_DUPLICATO')).toBe(1)
  })

  it('stato dedotto: COMPLETED solo con data di fine e peso, altrimenti AWAITING_RECEIVER', () => {
    expect(perChiave(1)).toMatchObject({ stato: 'AWAITING_RECEIVER', dataFine: null })
    expect(perChiave(2)).toMatchObject({ stato: 'COMPLETED', dataFine: '2026-03-06' })
    expect(perChiave(3).stato).toBe('AWAITING_RECEIVER')
  })

  it('campi del documento: data, CER con asterisco, quantita, targa, recupero/smaltimento', () => {
    expect(perChiave(1)).toMatchObject({
      dataTrasporto: '2026-03-05',
      cerCode: '15 01 01',
      pericoloso: false,
      quantitaKg: 1200,
      targa: 'AB123CD',
      operazione: 'DISPOSAL',
      descrizione: 'IMBALLAGGI MISTI',
    })
    expect(perChiave(13)).toMatchObject({ cerCode: '13 02 05*', pericoloso: true })
    expect(perChiave(15).operazione).toBe('RECOVERY')
  })

  it('parti: ditta con sede e ruolo, sito proprio dalla mappa, ditta agganciata, trasportatore assente', () => {
    const f1 = perChiave(1)
    expect(f1.produttore).toEqual({
      tipo: 'ditta',
      dittaKey: `0001|FISC|${prova.piva.uno}`,
      dittaId: null,
      sedeKey: '0001|C|000001|0001',
      ruoloKey: '0001|C|000001',
    })
    expect(f1.trasportatore).toMatchObject({
      tipo: 'ditta',
      dittaKey: `0001|FISC|${prova.piva.due}`,
      sedeKey: '0001|F|000002|0001',
    })
    expect(f1.destinatario).toEqual({ tipo: 'propria', sedeId: SEDE_PROPRIA })
    expect(perChiave(13).produttore).toMatchObject({ dittaId: U2 })
    expect(perChiave(12).trasportatore).toBeNull()
  })

  it('unita locale senza sede importata: ripiega sulla sede predefinita della ditta e lo segnala', () => {
    // 000005 e' il doppione F della ditta 000001: la sua UL 0001 non esiste, vale la sede legale tenuta
    expect(perChiave(12).produttore).toMatchObject({ sedeKey: '0001|C|000001|SL' })
    expect(avviso('SEDE_NON_RISOLTA')).toBeGreaterThanOrEqual(1)
  })

  it('scarti tipati e contati, mai con valori', () => {
    expect(scarto('PRODUTTORE_NON_RISOLTO')).toBe(1) // 8
    expect(scarto('QUANTITA_ASSENTE')).toBe(1) // 9
    expect(scarto('DESTINATARIO_AMBIGUO')).toBe(1) // 11
    expect(scarto('DESTINATARIO_PROPRIO_NON_IN_MAPPA')).toBe(1) // 14
    expect(scarto('FORMU_ASSENTE')).toBe(1) // 16
    expect(JSON.stringify(r.scarti)).not.toMatch(/IMBALLAGGI|ZZZZZZ|\d{11}/)
  })

  it('digitali: non copiati, numero e IDRENTRI dal registro delle trasmissioni, unita locale dalla mappa', () => {
    expect(r.firDigitali).toEqual([
      {
        legacyKey: '0001|2026|FORMULARI|4',
        numeroFir: 'ABCDE1234567',
        idRentri: 'ID-RENTRI-0001',
        unitaLocaleId: UL_PROPRIA,
      },
      {
        legacyKey: '0001|2026|FORMULARI|5',
        numeroFir: 'FGHIJ7654321',
        idRentri: null,
        unitaLocaleId: UL_PROPRIA,
      },
    ])
    expect(r.fir.some(f => f.firNumber === 'ABCDE1234567')).toBe(false)
  })

  it('senza FORMULARI nello staging: nessun record e nessun errore', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prep-fir-vuoto-'))
    try {
      const p = await scriviStagingFirProva(dir, seme + 50, { casi: [] })
      const st = await apriStaging(p.cartella)
      const anag = await preparaAnagrafiche(st, mappa())
      const vuoto = await preparaFir(st, mappa(), anag)
      expect(vuoto.fir).toEqual([])
      expect(vuoto.firDigitali).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('i casi sono tutti coperti', () => {
    expect(CASI_FIR.length).toBe(16)
    expect(U1).toBeDefined()
  })
})

describe('I5: migrazione:prepara scrive le fasi FIR nel pacchetto', () => {
  it('fir.jsonl e fir-digitali.jsonl nel manifest; l elenco dei digitali nel rapporto', async () => {
    const radice = await mkdtemp(join(tmpdir(), 'prep-fir-cli-'))
    try {
      const seme = 6_400_000 + (Date.now() % 100_000)
      const prova = await scriviStagingFirProva(radice, seme)
      const mappaFile = join(radice, 'mappa.json')
      const { writeFile } = await import('fs/promises')
      await writeFile(
        mappaFile,
        JSON.stringify({
          ...mappaValida(),
          unitaLocali: [{ legacy: 'X1.0001', sedeId: SEDE_PROPRIA, unitaLocaleId: UL_PROPRIA }],
          agganci: [{ partitaIva: prova.piva.agganciata, dittaId: U2 }],
        })
      )
      const out: string[] = []
      const err: string[] = []
      const codice = await eseguiCli(
        [prova.cartella, '--mappa', mappaFile, '--destinazione', join(radice, 'pacchetti')],
        { scrivi: m => out.push(m), errore: m => err.push(m) }
      )
      expect(err).toEqual([])
      expect(codice).toBe(0)
      expect(out).toContain('FIR/fir: 7 righe')
      expect(out).toContain('FIR/fir-digitali: 2 righe')
      expect(out).toContain('fir-digitale ABCDE1234567 ID-RENTRI-0001')
      expect(out).toContain('fir-digitale FGHIJ7654321 -')
      expect(out.some(l => l.startsWith('scarto FORMULARI FIR_ANNULLATO'))).toBe(true)
      const manifest = JSON.parse(
        await readFile(join(radice, 'pacchetti', 'WW00012026', 'manifest.json'), 'utf8')
      )
      expect(
        manifest.file.map((f: { ambito: string; fase: string }) => `${f.ambito}/${f.fase}`)
      ).toEqual(expect.arrayContaining(['FIR/fir', 'FIR/fir-digitali']))
    } finally {
      await rm(radice, { recursive: true, force: true })
    }
  })
})
