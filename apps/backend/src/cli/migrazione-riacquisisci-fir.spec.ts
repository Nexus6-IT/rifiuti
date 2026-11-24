import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { mappaValida, T_PROVA } from '../test-support/migrazione/mappa-di-prova'
import { validaMappa } from '../application/migrazione/pacchetto/mappa-import'
import { scriviPacchetto } from '../application/migrazione/pacchetto/scrittore-pacchetto'
import { UtenteNonAbilitatoError } from '../application/migrazione/riacquisizione/riacquisisci-fir.service'
import {
  eseguiCli,
  leggiArgomenti,
  MASSIMO_DEFAULT,
  PAUSA_MS_DEFAULT,
} from './migrazione-riacquisisci-fir'

const U = '66666666-6666-4666-8666-666666666666'
const base = ['--tenant', T_PROVA, '--pacchetto', '/p/WW00012026', '--utente', U]

describe('migrazione:riacquisisci-fir, argomenti', () => {
  it('default prudenti: simulazione, pausa di 3 secondi, 25 FIR', () => {
    expect(leggiArgomenti(base)).toMatchObject({
      esegui: false,
      pausaMs: PAUSA_MS_DEFAULT,
      massimo: MASSIMO_DEFAULT,
    })
    expect(leggiArgomenti([...base, '--esegui'])?.esegui).toBe(true)
  })

  it.each([
    ['senza utente', ['--tenant', T_PROVA, '--pacchetto', '/p']],
    ['utente non UUID', ['--tenant', T_PROVA, '--pacchetto', '/p', '--utente', 'x']],
    ['pausa sotto il minimo', [...base, '--pausa-ms', '10']],
    ['massimo zero', [...base, '--massimo', '0']],
    ['massimo oltre il limite', [...base, '--massimo', '501']],
    ['opzione sconosciuta', [...base, '--forza']],
    ['valore ripetuto', [...base, '--massimo', '1', '--massimo', '2']],
  ])('uso errato: %s', (_n, argv) => {
    expect(leggiArgomenti(argv)).toBeNull()
  })
})

describe('migrazione:riacquisisci-fir, esecuzione', () => {
  let radice: string
  let cartella: string
  beforeAll(async () => {
    radice = await mkdtemp(join(tmpdir(), 'cli-riacq-'))
    cartella = join(radice, 'WW00012026')
    await scriviPacchetto({
      cartella,
      archivio: 'WW00012026',
      hashStaging: 'a'.repeat(64),
      mappa: validaMappa({ ...mappaValida(), tenantId: T_PROVA }),
      fasi: [{ ambito: 'FIR', fase: 'fir-digitali', record: [] }],
    })
  })
  afterAll(() => rm(radice, { recursive: true, force: true }))

  const uscita = () => {
    const out: string[] = []
    const err: string[] = []
    return {
      out,
      err,
      u: { scrivi: (m: string) => out.push(m), errore: (m: string) => err.push(m) },
    }
  }
  const args = (...altri: string[]) => [
    '--tenant',
    T_PROVA,
    '--pacchetto',
    cartella,
    '--utente',
    U,
    ...altri,
  ]
  const esito = (conteggi: object, interrotto = false) => ({
    esegui: jest.fn(async () => ({
      esiti: [{ numeroFir: 'N1', esito: 'RIACQUISITO' }],
      conteggi,
      interrotto,
    })),
  })

  it('uso errato: 64 senza aprire nulla', async () => {
    const u = uscita()
    expect(await eseguiCli(['--tenant', 'x'], u.u, esito({}) as any)).toBe(64)
  })

  it('simulazione: lo dice, passa esegui=false al servizio, uscita 0', async () => {
    const s = esito({ SIMULATO: 1 })
    const u = uscita()
    expect(await eseguiCli(args(), u.u, s as any)).toBe(0)
    expect(u.out).toContain('modalita: SIMULAZIONE')
    expect(s.esegui).toHaveBeenCalledWith(
      expect.objectContaining({ esegui: false, tenantId: T_PROVA })
    )
  })

  it('--esegui con tutto riacquisito: uscita 0; stampa solo numeri, esiti e conteggi', async () => {
    const s = esito({ RIACQUISITO: 1 })
    const u = uscita()
    expect(
      await eseguiCli(args('--esegui', '--massimo', '5', '--pausa-ms', '2000'), u.u, s as any)
    ).toBe(0)
    expect(s.esegui).toHaveBeenCalledWith(
      expect.objectContaining({ esegui: true, massimo: 5, pausaMs: 2000 })
    )
    expect(u.out).toEqual([
      'modalita: ESECUZIONE (sola lettura su RENTRI)',
      'N1 RIACQUISITO',
      'RIACQUISITO: 1',
    ])
  })

  it('interrotto dall ente o con FIR falliti: uscita 1', async () => {
    expect(
      await eseguiCli(args('--esegui'), uscita().u, esito({ INTERROTTO_ENTE: 1 }, true) as any)
    ).toBe(1)
    expect(await eseguiCli(args('--esegui'), uscita().u, esito({ FALLITO: 1 }) as any)).toBe(1)
    expect(
      await eseguiCli(args('--esegui'), uscita().u, esito({ VISIBILITA_NON_ACQUISITA: 1 }) as any)
    ).toBe(1)
  })

  it('utente non abilitato: uscita 2; la mappa di un altra azienda: uscita 2', async () => {
    const s = { esegui: jest.fn().mockRejectedValue(new UtenteNonAbilitatoError()) }
    expect(await eseguiCli(args('--esegui'), uscita().u, s as any)).toBe(2)
    const altra = uscita()
    const r = await eseguiCli(
      ['--tenant', '99999999-9999-4999-8999-999999999999', '--pacchetto', cartella, '--utente', U],
      altra.u,
      esito({}) as any
    )
    expect(r).toBe(2)
  })

  it('errore imprevisto: solo il nome della classe, mai il messaggio', async () => {
    const s = { esegui: jest.fn().mockRejectedValue(new TypeError('SEGRETO')) }
    const u = uscita()
    expect(await eseguiCli(args('--esegui'), u.u, s as any)).toBe(1)
    expect(u.err.join('\n')).toContain('TypeError')
    expect(u.err.join('\n')).not.toContain('SEGRETO')
  })
})
