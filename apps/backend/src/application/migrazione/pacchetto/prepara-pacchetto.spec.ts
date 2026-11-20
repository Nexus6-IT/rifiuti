import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { eseguiCli } from '../../../cli/migrazione-prepara'
import { mappaValida, U2 } from '../../../test-support/migrazione/mappa-di-prova'
import {
  scriviStagingClifor,
  scriviStagingDitteProva,
  StagingDitteProva,
} from '../../../test-support/migrazione/staging-ditte-di-prova'
import { apriStaging } from '../staging/lettore-staging'
import { apriPacchetto } from './lettore-pacchetto'
import { validaMappa } from './mappa-import'
import { preparaPacchetto } from './prepara-pacchetto'
import { writeFile } from 'fs/promises'

describe('migrazione:prepara (staging + mappa -> pacchetto)', () => {
  let radice: string
  let prova: StagingDitteProva
  let mappaFile: string

  function mappa(sovrascrivi: Record<string, unknown> = {}) {
    return {
      ...mappaValida(),
      agganci: [{ partitaIva: prova.pivaAgganciata, dittaId: U2 }],
      ...sovrascrivi,
    }
  }

  beforeEach(async () => {
    radice = await mkdtemp(join(tmpdir(), 'prepara-'))
    prova = await scriviStagingDitteProva(
      join(radice, 'staging'),
      4_100_000 + (Date.now() % 100_000)
    )
    mappaFile = join(radice, 'mappa-import.json')
    await writeFile(mappaFile, JSON.stringify(mappa()))
  })
  afterEach(() => rm(radice, { recursive: true, force: true }))

  it('scrive le ditte nuove, segnala i duplicati e gli scarti, esclude le agganciate', async () => {
    const staging = await apriStaging(prova.cartella)
    const rapporto = await preparaPacchetto(
      staging,
      validaMappa(mappa()),
      join(radice, 'pacchetto', 'WW00012026')
    )
    expect(rapporto.agganciate).toBe(1)
    const per = Object.fromEntries(rapporto.scarti.map(s => [s.codice, s.conteggio]))
    expect(per).toEqual({ DITTA_DUPLICATA: 1, PARTITA_IVA_NON_VALIDA: 1, FISCALE_ASSENTE: 1 })

    const p = await apriPacchetto(join(radice, 'pacchetto', 'WW00012026'))
    expect(p.manifest.hashStaging).toBe(staging.hashManifest)
    const ditte: Array<{
      legacyKey: string
      partitaIva: string | null
      codiceFiscale: string | null
    }> = []
    for await (const { record } of p.leggi('ANAGRAFICHE', 'ditte')) ditte.push(record as never)
    expect(ditte.map(d => d.legacyKey).sort()).toEqual(
      [`0001|FISC|${prova.pivaUno}`, `0001|FISC|${prova.cfPrivato}`].sort()
    )
    expect(ditte.find(d => d.codiceFiscale === prova.cfPrivato)!.partitaIva).toBeNull()
  })

  it('la mappa non contiene dati personali nemmeno dopo la preparazione', async () => {
    const staging = await apriStaging(prova.cartella)
    await preparaPacchetto(staging, validaMappa(mappa()), join(radice, 'p', 'WW00012026'))
    const testo = await readFile(join(radice, 'p', 'WW00012026', 'mappa-import.json'), 'utf8')
    expect(testo).not.toContain(prova.cfPrivato)
    expect(testo).not.toContain('PRIVATO DI PROVA')
  })

  it('rifiuta una mappa di un altra ditta o anno', async () => {
    const staging = await apriStaging(prova.cartella)
    await expect(
      preparaPacchetto(
        staging,
        validaMappa(mappa({ ditta: '0002' })),
        join(radice, 'p', 'WW00012026')
      )
    ).rejects.toMatchObject({ codice: 'MAPPA_DIVERSA' })
  })

  describe('duplicati su P.IVA e codice fiscale (I-2)', () => {
    const CF = 'ZZZZZZ00A00Z000Z'
    async function ditteScritte(righe: (string | null)[][]) {
      const cartella = await scriviStagingClifor(await mkdtemp(join(radice, 'cl-')), righe)
      const dest = join(await mkdtemp(join(radice, 'pd-')), 'WW00012026')
      const rapporto = await preparaPacchetto(
        await apriStaging(cartella),
        validaMappa(mappa({ agganci: [] })),
        dest
      )
      const p = await apriPacchetto(dest)
      let n = 0
      for await (const _ of p.leggi('ANAGRAFICHE', 'ditte')) n++
      return { n, scarti: Object.fromEntries(rapporto.scarti.map(s => [s.codice, s.conteggio])) }
    }

    it('A {P.IVA, CF} e B {solo CF}: entra solo A, B e segnalata', async () => {
      const r = await ditteScritte([
        ['C', '000001', 'UNO', null, CF, prova.pivaUno],
        ['F', '000002', 'UNO COME FORNITORE', null, CF, null],
      ])
      expect(r.n).toBe(1)
      expect(r.scarti).toEqual({ DITTA_DUPLICATA: 1 })
    })

    it('stessa identita come P.IVA in A e come CF in B (11 cifre): una sola ditta, duplicato con le chiavi CLIFOR', async () => {
      const cartella = await scriviStagingClifor(await mkdtemp(join(radice, 'cl-')), [
        ['C', '000001', 'UNO', null, null, prova.pivaUno],
        ['F', '000002', 'UNO COME FORNITORE', null, prova.pivaUno, null],
      ])
      const dest = join(await mkdtemp(join(radice, 'pd-')), 'WW00012026')
      const rapporto = await preparaPacchetto(
        await apriStaging(cartella),
        validaMappa(mappa({ agganci: [] })),
        dest
      )
      const p = await apriPacchetto(dest)
      let n = 0
      for await (const _ of p.leggi('ANAGRAFICHE', 'ditte')) n++
      expect(n).toBe(1)
      expect(rapporto.duplicati).toEqual([{ scartata: '0001|F|000002', tenuta: '0001|C|000001' }])
    })

    it('A {X, CF} e B {Z, stesso CF}: entra solo A', async () => {
      const r = await ditteScritte([
        ['C', '000001', 'UNO', null, CF, prova.pivaUno],
        ['F', '000002', 'DUE', null, CF, prova.pivaAgganciata],
      ])
      expect(r.n).toBe(1)
      expect(r.scarti).toEqual({ DITTA_DUPLICATA: 1 })
    })

    it('B {solo CF} prima di A {P.IVA, stesso CF}: entra solo la prima, nessuna collisione residua', async () => {
      const r = await ditteScritte([
        ['F', '000002', 'DUE', null, CF, null],
        ['C', '000001', 'UNO', null, CF, prova.pivaUno],
      ])
      expect(r.n).toBe(1)
      expect(r.scarti).toEqual({ DITTA_DUPLICATA: 1 })
    })
  })

  describe('CLI', () => {
    const uscita = () => {
      const out: string[] = []
      const err: string[] = []
      return {
        out,
        err,
        u: { scrivi: (m: string) => out.push(m), errore: (m: string) => err.push(m) },
      }
    }

    it('uso errato 64; ok 0; seconda volta senza --forza 1; con --forza 0', async () => {
      const dest = join(radice, 'dest')
      expect(await eseguiCli([], uscita().u)).toBe(64)
      expect(await eseguiCli([prova.cartella, '--mappa', mappaFile], uscita().u)).toBe(64)
      const a = uscita()
      expect(
        await eseguiCli([prova.cartella, '--mappa', mappaFile, '--destinazione', dest], a.u)
      ).toBe(0)
      expect(a.out.join('\n')).toContain('ANAGRAFICHE/ditte: 2 righe')
      expect(a.out.join('\n')).not.toContain(prova.pivaUno)
      expect(
        await eseguiCli([prova.cartella, '--mappa', mappaFile, '--destinazione', dest], uscita().u)
      ).toBe(1)
      expect(
        await eseguiCli(
          [prova.cartella, '--mappa', mappaFile, '--destinazione', dest, '--forza'],
          uscita().u
        )
      ).toBe(0)
    })

    it('mappa con un codice fiscale o mappa inesistente: uscita 2, senza scrivere il pacchetto', async () => {
      const cattiva = join(radice, 'cattiva.json')
      await writeFile(
        cattiva,
        JSON.stringify(mappa({ registri: [{ legacy: 'RSSMRA80A01H501U', registroId: U2 }] }))
      )
      const a = uscita()
      expect(
        await eseguiCli(
          [prova.cartella, '--mappa', cattiva, '--destinazione', join(radice, 'd2')],
          a.u
        )
      ).toBe(2)
      expect(a.err.join('\n')).not.toContain('RSSMRA80A01H501U')
      expect(
        await eseguiCli(
          [
            prova.cartella,
            '--mappa',
            join(radice, 'no.json'),
            '--destinazione',
            join(radice, 'd3'),
          ],
          uscita().u
        )
      ).toBe(2)
    })
  })
})
