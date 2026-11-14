import { ComunicazioneConBloccantiError } from './comunicazioni-orso.port'
import { ComunicazioniOrrService } from './comunicazioni-orr.service'
import type {
  AnteprimaTracciato,
  AvvisoTracciato,
  ComunicazioniTracciatoPort,
} from './comunicazioni-tracciato.port'

const anteprimaDi = (
  attivita: string,
  o: { record?: number; avvisi?: AvvisoTracciato[] } = {}
): AnteprimaTracciato => {
  const avvisi = o.avvisi ?? []
  return {
    unitaLocale: { id: 'u', nome: 'Sede' },
    consorzio: 'ORR',
    periodo: { da: '2026-05-01', a: '2026-05-31' },
    tracciato: `xrec718-${attivita}`,
    versione: 'xrec718-ww1',
    affidabilita: 'RICAVATO_WINWASTE',
    notaAffidabilita: 'n',
    numeroRecord: o.record ?? 0,
    numeroMovimenti: o.record ?? 0,
    avvisi,
    bloccanti: avvisi.some(a => a.bloccante),
    hashDati: `h-${attivita}`,
  }
}

const bloccante = (codice: string): AvvisoTracciato => ({
  codice,
  messaggio: codice,
  movimentoIds: ['1'],
  bloccante: true,
})

describe('ComunicazioniOrrService', () => {
  let tracciato: jest.Mocked<ComunicazioniTracciatoPort>
  let servizio: ComunicazioniOrrService
  const richiesta = { unitaLocaleId: 'u', da: '2026-05-01', a: '2026-05-31' }
  const configura = (perAttivita: Record<string, AnteprimaTracciato>) => {
    tracciato.anteprima.mockImplementation(async (_t, r) => {
      const a = r.parametri?.attivita ?? ''
      return perAttivita[a] ?? anteprimaDi(a, { avvisi: [bloccante('DATI_NON_VALIDI')] })
    })
  }

  beforeEach(() => {
    tracciato = {
      anteprima: jest.fn(),
      genera: jest.fn(async (_t, _u, r) => ({ id: `id-${r.parametri?.attivita}` }) as never),
      elenca: jest.fn(),
      file: jest.fn(),
      consorzioDi: jest.fn(),
      manifest: jest.fn(),
      segnaInviata: jest.fn(),
    } as never
    servizio = new ComunicazioniOrrService(tracciato)
  })

  it('anteprima: un file per ogni attivita con movimenti, le altre non compaiono', async () => {
    configura({ TRA: anteprimaDi('TRA', { record: 2 }), STO: anteprimaDi('STO', { record: 3 }) })
    const a = await servizio.anteprima('t', richiesta)
    expect(a.file.map(f => [f.attivita, f.numeroRecord])).toEqual([
      ['TRA', 2],
      ['STO', 3],
    ])
    expect(tracciato.anteprima).toHaveBeenCalledTimes(7)
    expect(a).toMatchObject({ bloccanti: false, nessunDato: false, avvisiGenerali: [] })
  })

  it('nessuna attivita con movimenti: nessunDato, il file vuoto non e un errore generale', async () => {
    configura({})
    const a = await servizio.anteprima('t', richiesta)
    expect(a).toMatchObject({ file: [], avvisiGenerali: [], nessunDato: true, bloccanti: false })
  })

  it('i bloccanti generali (es. sede non campana) vengono dalle attivita vuote, senza doppioni', async () => {
    const v = bloccante('SEDE_NON_IN_CAMPANIA')
    configura(
      Object.fromEntries(
        ['TRA', 'STO', 'SMA', 'REC', 'FRA', 'ROT', 'AUT'].map(x => [
          x,
          anteprimaDi(x, { avvisi: [v, bloccante('DATI_NON_VALIDI')] }),
        ])
      )
    )
    const a = await servizio.anteprima('t', richiesta)
    expect(a.avvisiGenerali.map(x => x.codice)).toEqual(['SEDE_NON_IN_CAMPANIA'])
    expect(a).toMatchObject({ bloccanti: true, nessunDato: false })
  })

  it('con una sola attivita richiesta legge solo quella', async () => {
    configura({ STO: anteprimaDi('STO', { record: 1 }) })
    const a = await servizio.anteprima('t', { ...richiesta, attivita: 'STO' })
    expect(tracciato.anteprima).toHaveBeenCalledTimes(1)
    expect(a.file).toHaveLength(1)
  })

  it('genera: un file per attivita, nell ordine, con l attivita nella vista', async () => {
    configura({ TRA: anteprimaDi('TRA', { record: 1 }), SMA: anteprimaDi('SMA', { record: 1 }) })
    const viste = await servizio.genera('t', 'utente', richiesta)
    expect(viste.map(v => [v.attivita, v.id])).toEqual([
      ['TRA', 'id-TRA'],
      ['SMA', 'id-SMA'],
    ])
    expect(tracciato.genera).toHaveBeenCalledWith('t', 'utente', {
      consorzio: 'ORR',
      unitaLocaleId: 'u',
      da: '2026-05-01',
      a: '2026-05-31',
      parametri: { attivita: 'TRA' },
    })
  })

  it('genera: un bloccante in un file ferma TUTTI i file (D14), nessuna generazione', async () => {
    configura({
      TRA: anteprimaDi('TRA', { record: 1 }),
      STO: anteprimaDi('STO', { record: 1, avvisi: [bloccante('ATECO_PRODUTTORE')] }),
    })
    const err = await servizio.genera('t', 'u', richiesta).catch(e => e)
    expect(err).toBeInstanceOf(ComunicazioneConBloccantiError)
    expect((err as ComunicazioneConBloccantiError).avvisi.map(a => a.codice)).toEqual([
      'ATECO_PRODUTTORE',
    ])
    expect(tracciato.genera).not.toHaveBeenCalled()
  })

  it('genera senza dati: errore «Non ci sono dati da comunicare»', async () => {
    configura({})
    const err = await servizio.genera('t', 'u', richiesta).catch(e => e)
    expect(err).toBeInstanceOf(ComunicazioneConBloccantiError)
    expect((err as ComunicazioneConBloccantiError).avvisi[0].messaggio).toBe(
      'Non ci sono dati da comunicare.'
    )
    expect(tracciato.genera).not.toHaveBeenCalled()
  })

  it('elenca: filtra il consorzio ORR e ricava l attivita dal tracciato', async () => {
    tracciato.elenca.mockResolvedValue([
      { id: 'a', tracciato: 'xrec718-REC', stato: 'GENERATA' } as never,
    ])
    const e = await servizio.elenca('t', { unitaLocaleId: 'u' })
    expect(tracciato.elenca).toHaveBeenCalledWith('t', { consorzio: 'ORR', unitaLocaleId: 'u' })
    expect(e).toEqual([{ id: 'a', tracciato: 'xrec718-REC', stato: 'GENERATA', attivita: 'REC' }])
  })

  it('elenca: per le inviate rilegge il periodo esatto, cosi arriva «modificata dopo l invio»', async () => {
    const inviata = {
      id: 'i',
      tracciato: 'xrec718-STO',
      stato: 'INVIATA',
      periodoDa: '2026-05-01',
      periodoA: '2026-05-31',
      modificataDopoInvio: false,
    }
    tracciato.elenca.mockImplementation(async (_t, f) =>
      f.da
        ? [{ ...inviata, modificataDopoInvio: true } as never]
        : [inviata as never, { id: 'g', tracciato: 'xrec718-TRA', stato: 'GENERATA' } as never]
    )
    const e = await servizio.elenca('t', { unitaLocaleId: 'u' })
    expect(tracciato.elenca).toHaveBeenCalledWith('t', {
      consorzio: 'ORR',
      unitaLocaleId: 'u',
      da: '2026-05-01',
      a: '2026-05-31',
    })
    expect(e.map(x => [x.id, x.modificataDopoInvio, x.attivita])).toEqual([
      ['i', true, 'STO'],
      ['g', undefined, 'TRA'],
    ])
  })
})
