import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { mappaValida } from '../../../test-support/migrazione/mappa-di-prova'
import { PacchettoError } from './errori-pacchetto'
import { apriPacchetto } from './lettore-pacchetto'
import { improntaMappa, validaMappa } from './mappa-import'
import { scriviPacchetto } from './scrittore-pacchetto'

const HASH = 'a'.repeat(64)

describe('pacchetto: scrittura e lettura', () => {
  let base: string
  let cartella: string
  const mappa = validaMappa(mappaValida())

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'pacchetto-'))
    cartella = join(base, 'WW00012026')
    await scriviPacchetto({
      cartella,
      archivio: 'WW00012026',
      hashStaging: HASH,
      mappa,
      fasi: [
        {
          ambito: 'ANAGRAFICHE',
          fase: 'ditte',
          record: [
            { legacyKey: '0001|FISC|00000000000', ragioneSociale: 'Uno  SRL', partitaIva: null, codiceFiscale: null },
            { legacyKey: '0001|FISC|00000000001', ragioneSociale: 'Due', partitaIva: null, codiceFiscale: null },
          ],
        },
      ],
    })
  })
  afterEach(() => rm(base, { recursive: true, force: true }))

  async function rifiuta(codice: string, opzioni = {}): Promise<void> {
    try {
      await apriPacchetto(cartella, opzioni)
    } catch (e) {
      expect(e).toBeInstanceOf(PacchettoError)
      expect((e as PacchettoError).codice).toBe(codice)
      return
    }
    throw new Error('doveva essere rifiutato')
  }

  it('lo legge in streaming, con i record intatti e gli estremi del manifest', async () => {
    const p = await apriPacchetto(cartella)
    expect(p.manifest.formato).toBe('wasteflow-pacchetto/1')
    expect(p.manifest.hashMappa).toBe(improntaMappa(mappa))
    expect(p.manifest.hashStaging).toBe(HASH)
    expect(p.fasi('ANAGRAFICHE')).toHaveLength(1)
    const letti: Array<{ ragioneSociale: string }> = []
    for await (const { record } of p.leggi('ANAGRAFICHE', 'ditte')) letti.push(record as { ragioneSociale: string })
    expect(letti.map(r => r.ragioneSociale)).toEqual(['Uno  SRL', 'Due'])
  })

  it('rifiuta un file con impronta diversa', async () => {
    const f = join(cartella, 'anagrafiche-ditte.jsonl')
    await writeFile(f, (await readFile(f, 'utf8')).replace('Due', 'Tre'))
    await rifiuta('HASH_NON_CORRISPONDE')
  })

  it('rifiuta un file con righe diverse da quelle dichiarate', async () => {
    const mp = join(cartella, 'manifest.json')
    const m = JSON.parse(await readFile(mp, 'utf8'))
    m.file[0].righe = 5
    await writeFile(mp, JSON.stringify(m))
    await rifiuta('RIGHE_NON_CORRISPONDENTI')
  })

  it('rifiuta un file mancante, un formato sconosciuto e un manifest assente', async () => {
    const mp = join(cartella, 'manifest.json')
    const m = JSON.parse(await readFile(mp, 'utf8'))
    await writeFile(mp, JSON.stringify({ ...m, formato: 'wasteflow-pacchetto/9' }))
    await rifiuta('FORMATO_SCONOSCIUTO')
    await writeFile(mp, JSON.stringify(m))
    await rm(join(cartella, 'anagrafiche-ditte.jsonl'))
    await rifiuta('FILE_ASSENTE')
    await rm(mp)
    await rifiuta('MANIFEST_ASSENTE')
  })

  it('rifiuta una mappa diversa da quella dichiarata e una diversa da quella attesa', async () => {
    await rifiuta('MAPPA_DIVERSA', { hashMappaAttesa: 'b'.repeat(64) })
    const altra = { ...mappaValida(), dataTaglio: '2026-07-01' }
    await writeFile(join(cartella, 'mappa-import.json'), JSON.stringify(altra))
    await rifiuta('MAPPA_DIVERSA')
  })

  it('rifiuta una mappa che contiene un codice fiscale', async () => {
    const altra = { ...mappaValida(), registri: [{ legacy: 'RSSMRA80A01H501U', registroId: '11111111-1111-4111-8111-111111111111' }] }
    await writeFile(join(cartella, 'mappa-import.json'), JSON.stringify(altra))
    await rifiuta('MAPPA_NON_VALIDA')
  })

  it('rifiuta una cartella con nome diverso dall archivio', async () => {
    const { rename } = await import('fs/promises')
    const nuova = join(base, 'WW00022026')
    await rename(cartella, nuova)
    cartella = nuova
    await rifiuta('MANIFEST_NON_VALIDO')
  })
})
