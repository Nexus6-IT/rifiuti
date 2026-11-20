import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { eseguiCli } from '../../../cli/migrazione-prepara'
import { mappaValida, U1 } from '../../../test-support/migrazione/mappa-di-prova'
import { scriviStagingGiacenzeProva } from '../../../test-support/migrazione/staging-giacenze-di-prova'
import { apriStaging } from '../staging/lettore-staging'
import { validaMappa } from './mappa-import'
import { preparaGiacenze, RisultatoGiacenzePacchetto } from './prepara-giacenze'
import { validaRecordGiacenza } from './record-giacenze'

const REG_B = '66666666-6666-4666-8666-666666666666'

/** I6 T1-T2: MOVIMENTI + GIACENZE RIFIUTI -> fase `giacenze` (fixture SINTETICHE, nessun `.bak`). */
describe('I6: preparaGiacenze (trasformazione pura)', () => {
  let radice: string
  let cartella: string
  let r: RisultatoGiacenzePacchetto
  const seme = 6_900_000 + (Date.now() % 100_000)
  const mappa = () =>
    validaMappa({
      ...mappaValida(),
      registri: [
        { legacy: 'REG1', registroId: U1 },
        { legacy: '001', registroId: U1 },
        { legacy: '002', registroId: REG_B },
      ],
    })
  const scarto = (tabella: string, codice: string) =>
    r.scarti.find(s => s.tabella === tabella && s.codice === codice)?.conteggio ?? 0
  const avviso = (codice: string) => r.avvisi.find(s => s.codice === codice)?.conteggio ?? 0
  const famiglia = (registro: string, cer: string) =>
    r.giacenze.find(g => g.registroId === registro && g.cerCode === cer)

  beforeAll(async () => {
    radice = await mkdtemp(join(tmpdir(), 'prep-giac-'))
    cartella = (await scriviStagingGiacenzeProva(radice, seme)).cartella
    r = await preparaGiacenze(await apriStaging(cartella), mappa())
  })
  afterAll(() => rm(radice, { recursive: true, force: true }))

  it('una riga per famiglia, con le quantita attese e dataRiferimento = taglio', () => {
    expect(r.giacenze.map(g => [g.registroId, g.cerCode, g.quantita]).sort()).toEqual(
      [
        [U1, '13 02 05*', 100],
        [U1, '15 01 01', 720],
        [U1, '20 03 01', 300],
        [REG_B, '15 01 02', 80],
      ].sort()
    )
    for (const g of r.giacenze) expect(g.dataRiferimento).toBe('2026-06-30')
  })

  it('i record superano la validazione del server', () => {
    for (const g of r.giacenze) expect(() => validaRecordGiacenza(g, mappa())).not.toThrow()
  })

  it('origini dei carichi con anno e protocollo; l apertura non ne ha', () => {
    expect(famiglia(U1, '15 01 01')?.origini).toEqual([
      { anno: 2026, protocollo: 12, quantita: 600 },
    ])
    expect(famiglia(U1, '20 03 01')?.origini).toEqual([
      { anno: 2026, protocollo: 13, quantita: 300 },
    ])
    expect(famiglia(REG_B, '15 01 02')?.origini).toEqual([])
    expect(avviso('ORIGINI_APERTURA_NON_NOTE')).toBe(2)
  })

  it('differenza GIASCAR nel rapporto: il carico 4 dichiara 30 ma nessuno scarico lo cita', () => {
    expect(r.differenzeGiascar).toEqual([{ cod: 4, giascarKg: 30, ricalcolatoKg: 0 }])
  })

  it('scarti e avvisi tipati e contati', () => {
    expect(scarto('GIACENZE', 'MAGAZZINO_NON_IN_MAPPA')).toBe(1)
    expect(avviso('CARICO_DOPO_IL_TAGLIO')).toBe(1)
    expect(avviso('RIGHE_COMPENSAZIONE_NON_SOMMATE')).toBe(1)
  })

  it('senza GIACENZE RIFIUTI (o senza MOVIMENTI) non si prepara nulla', async () => {
    const solo = await mkdtemp(join(tmpdir(), 'prep-giac-v-'))
    try {
      const { cartella: c2 } = await scriviStagingGiacenzeProva(solo, seme + 50, { righe: [] })
      const vuoto = await preparaGiacenze(await apriStaging(c2), mappa())
      // con zero righe di apertura restano solo i carichi
      expect(vuoto.giacenze.map(g => g.quantita).sort((a, b) => a - b)).toEqual([100, 300, 600])
    } finally {
      await rm(solo, { recursive: true, force: true })
    }
  })

  it('CLI prepara: la fase giacenze e scritta nel pacchetto e il rapporto elenca le differenze GIASCAR', async () => {
    const dest = await mkdtemp(join(tmpdir(), 'prep-giac-d-'))
    const mappaFile = join(dest, 'mappa.json')
    const { writeFile } = await import('fs/promises')
    await writeFile(mappaFile, JSON.stringify(mappa()))
    const righe: string[] = []
    try {
      const codice = await eseguiCli(
        [cartella, '--mappa', mappaFile, '--destinazione', join(dest, 'out')],
        { scrivi: m => righe.push(m), errore: m => righe.push(`ERR ${m}`) }
      )
      expect(codice).toBe(0)
      const archivio = righe
        .find(l => l.startsWith('archivio '))
        ?.split(' ')[1]
        .replace(':', '') as string
      expect(righe).toContain('GIACENZE/giacenze: 4 righe')
      expect(righe).toContain('differenza-giascar 4 30 0')
      expect(righe.some(l => l.startsWith('scarto GIACENZE MAGAZZINO_NON_IN_MAPPA'))).toBe(true)
      const jsonl = await readFile(join(dest, 'out', archivio, 'giacenze-giacenze.jsonl'), 'utf8')
      expect(jsonl.trim().split('\n')).toHaveLength(4)
    } finally {
      await rm(dest, { recursive: true, force: true })
    }
  })
})
