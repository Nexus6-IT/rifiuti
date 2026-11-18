import type { AnagraficaComunicazioniSede } from '@prisma/client'
import type { RisoluzioneIstat } from './anagrafica-comunicazioni.port'
import type { FirDettaglio, SedeDettaglio } from './lettore-dettagli-tracciato'
import { codfisPivaSoggetto, risolviSoggettiOrso } from './soggetti-orso'

function sede(
  id: string,
  o: Partial<SedeDettaglio> = {},
  ana: Partial<AnagraficaComunicazioniSede> | null = null
): SedeDettaglio {
  return {
    id,
    dittaId: `d-${id}`,
    denominazione: null,
    via: 'Via Roma',
    civico: '12',
    cap: '20100',
    comune: 'Milano',
    provincia: 'MI',
    telefono: null,
    principale: false,
    attiva: true,
    ditta: {
      id: `d-${id}`,
      ragioneSociale: `Ditta ${id}`,
      partitaIva: '01234567890',
      codiceFiscale: null,
    },
    anagrafica: ana
      ? ({ eComune: false, codiceOrso: null, ...ana } as AnagraficaComunicazioniSede)
      : null,
    ...o,
  }
}

function fir(
  id: string,
  producerSedeId: string | null,
  receiverSedeId: string | null
): [string, FirDettaglio] {
  return [id, { id, producerSedeId, receiverSedeId } as FirDettaglio]
}

const ISTAT: Record<string, RisoluzioneIstat> = {
  s1: { codice: '015146', origine: 'DA_NOME' },
  s2: { codice: '016024', origine: 'FORZATO' },
  s3: { codice: '015146', origine: 'DA_NOME' },
  s4: { codice: '016024', origine: 'DA_NOME' },
  'legale-d-s1': { codice: '015200', origine: 'DA_NOME' },
}

const mov = (
  id: string,
  tipo: 'CARICO' | 'SCARICO',
  firId: string | null,
  controparte: {
    nome: string | null
    indirizzo?: string | null
    sedeControparteId?: string | null
  } = { nome: null }
) => ({
  id,
  tipo,
  firId,
  controparte: controparte.nome,
  indirizzoControparte: controparte.indirizzo ?? null,
  sedeControparteId: controparte.sedeControparteId ?? null,
})

function dettagli(
  sedi: SedeDettaglio[],
  firs: Array<[string, FirDettaglio]>,
  legali: SedeDettaglio[] = [],
  extra: {
    destinatari?: Array<{ id: string; sedeId: string | null }>
    produttori?: Array<{ id: string; sedeId: string }>
    controparti?: Array<[string, SedeDettaglio[]]>
  } = {}
) {
  return {
    fir: new Map(firs),
    sedi: new Map(sedi.map(s => [s.id, s])),
    sedeLegalePerDitta: new Map(legali.map(s => [s.dittaId, s])),
    destinatari: new Map((extra.destinatari ?? []).map(d => [d.id, d])) as never,
    produttori: new Map((extra.produttori ?? []).map(p => [p.id, p])),
    sediPerControparte: new Map(extra.controparti ?? []),
  }
}

describe('codfisPivaSoggetto', () => {
  it.each([
    [null, '1234567890', '01234567890'],
    ['01234567890', null, '01234567890'],
    ['rssmra70a01f205x', '01234567890', 'RSSMRA70A01F205X'],
    [null, '123456789012', null],
    ['ABC', null, null],
    [null, null, null],
    ['  ', '  ', null],
  ])('cf %p piva %p -> %p', (cf, piva, atteso) => {
    expect(codfisPivaSoggetto(cf, piva)).toBe(atteso)
  })
})

describe('risolviSoggettiOrso', () => {
  const istat = jest.fn(
    async (id: string): Promise<RisoluzioneIstat> =>
      ISTAT[id] ?? { codice: null, motivo: 'COMUNE_NON_TROVATO' }
  )
  beforeEach(() => istat.mockClear())

  it('una sede senza codice ARPA diventa Inew con indirizzo UL, SL e ISTAT spezzato in 3+3', async () => {
    const s1 = sede('s1', { civico: '12/A bis', cap: '4100' })
    const legale = sede('legale-d-s1', {
      dittaId: 'd-s1',
      via: 'Corso Italia',
      civico: '1',
      cap: '20121',
    })
    const r = await risolviSoggettiOrso(
      [mov('m1', 'CARICO', 'f1')],
      dettagli([s1], [fir('f1', 's1', null)], [legale]),
      istat
    )
    expect(r.errori).toEqual([])
    expect(r.soggetti.get('m1')).toEqual({
      tipo: 'Inew',
      chiave: 's1',
      impianto: {
        ragioneSociale: 'Ditta s1',
        codfisPiva: '01234567890',
        indirizzoSL: {
          nome: 'Corso Italia',
          civico: '1',
          cap: '20121',
          provincia: '015',
          comune: '200',
        },
        // civico troncato a 5 caratteri, CAP portato a 5 cifre
        indirizzoUL: {
          nome: 'Via Roma',
          civico: '12/A',
          cap: '04100',
          provincia: '015',
          comune: '146',
        },
      },
    })
  })

  it('un codice ARPA nell’anagrafica fa un impianto I (anche in uscita)', async () => {
    const s2 = sede('s2', {}, { codiceOrso: '123456' })
    const r = await risolviSoggettiOrso(
      [mov('m1', 'CARICO', 'f1'), mov('m2', 'SCARICO', 'f2')],
      dettagli([s2], [fir('f1', 's2', null), fir('f2', null, 's2')]),
      istat
    )
    expect(r.soggetti.get('m1')).toMatchObject({ tipo: 'I', codice: '123456' })
    expect(r.soggetti.get('m2')).toMatchObject({ tipo: 'I', codice: '123456' })
  })

  it('un comune è C fra i conferitori e Inew fra i destinatari (l’XSD non ammette C in uscita)', async () => {
    const c = sede('s1', {}, { eComune: true })
    const r = await risolviSoggettiOrso(
      [mov('m1', 'CARICO', 'f1'), mov('m2', 'SCARICO', 'f2')],
      dettagli([c], [fir('f1', 's1', null), fir('f2', null, 's1')]),
      istat
    )
    expect(r.soggetti.get('m1')).toMatchObject({ tipo: 'C', istat: '015146' })
    expect(r.soggetti.get('m2')).toMatchObject({ tipo: 'Inew', chiave: 's1' })
  })

  it('il carico usa la sede del produttore, lo scarico quella del destinatario', async () => {
    const r = await risolviSoggettiOrso(
      [mov('m1', 'CARICO', 'f1'), mov('m2', 'SCARICO', 'f1')],
      dettagli([sede('s1'), sede('s2', {}, { codiceOrso: '9' })], [fir('f1', 's1', 's2')]),
      istat
    )
    expect(r.soggetti.get('m1')).toMatchObject({ tipo: 'Inew', chiave: 's1' })
    expect(r.soggetti.get('m2')).toMatchObject({ tipo: 'I', codice: '9' })
  })

  it('senza FIR, senza sede sul FIR o con sede sconosciuta il soggetto resta assente, senza errore', async () => {
    const r = await risolviSoggettiOrso(
      [
        mov('a', 'CARICO', null),
        mov('b', 'CARICO', 'f1'),
        mov('c', 'CARICO', 'f2'),
        mov('d', 'CARICO', 'fx'),
      ],
      dettagli([sede('s1')], [fir('f1', null, null), fir('f2', 'sconosciuta', null)]),
      istat
    )
    expect(r.soggetti.size).toBe(0)
    expect(r.errori).toEqual([])
  })

  it('ISTAT non risolto: errore bloccante con la sede, il motivo e i movimenti', async () => {
    const r = await risolviSoggettiOrso(
      [mov('b', 'CARICO', 'f1'), mov('a', 'CARICO', 'f1')],
      dettagli([sede('ignota')], [fir('f1', 'ignota', null)]),
      istat
    )
    expect(r.soggetti.size).toBe(0)
    expect(r.errori).toEqual([
      {
        codice: 'ISTAT_SOGGETTO_NON_VALIDO',
        dettaglio: 'Ditta ignota (Milano): comune non trovato nell’elenco ISTAT',
        movimentoIds: ['a', 'b'],
      },
    ])
  })

  it('ISTAT con meno di 6 cifre è un errore (come WinWaste)', async () => {
    const r = await risolviSoggettiOrso(
      [mov('a', 'CARICO', 'f1')],
      dettagli([sede('s1')], [fir('f1', 's1', null)]),
      async () => ({ codice: '1514', origine: 'FORZATO' })
    )
    expect(r.errori[0]).toMatchObject({
      codice: 'ISTAT_SOGGETTO_NON_VALIDO',
      dettaglio: expect.stringContaining('non di 6 cifre'),
    })
  })

  it('codice fiscale o partita IVA non utilizzabile: errore bloccante', async () => {
    const s = sede('s1', {
      ditta: { id: 'd-s1', ragioneSociale: 'Ditta s1', partitaIva: null, codiceFiscale: 'XYZ' },
    })
    const r = await risolviSoggettiOrso(
      [mov('a', 'CARICO', 'f1')],
      dettagli([s], [fir('f1', 's1', null)]),
      istat
    )
    expect(r.errori).toEqual([
      expect.objectContaining({
        codice: 'CODICE_FISCALE_SOGGETTO_NON_VALIDO',
        movimentoIds: ['a'],
      }),
    ])
  })

  it('un comune senza ISTAT valido è un errore; un impianto I non ne ha bisogno', async () => {
    const c = sede('ignota', {}, { eComune: true })
    const i = sede('s3', {}, { codiceOrso: '5' })
    const r = await risolviSoggettiOrso(
      [mov('a', 'CARICO', 'f1'), mov('b', 'CARICO', 'f2')],
      dettagli([c, i], [fir('f1', 'ignota', null), fir('f2', 's3', null)]),
      istat
    )
    expect(r.soggetti.get('b')).toMatchObject({ tipo: 'I', codice: '5' })
    expect(r.errori).toEqual([
      expect.objectContaining({ codice: 'ISTAT_SOGGETTO_NON_VALIDO', movimentoIds: ['a'] }),
    ])
  })

  it('la sede legale senza ISTAT valido si omette (è facoltativa nell’XSD)', async () => {
    const legale = sede('legale-sconosciuta', { dittaId: 'd-s1' })
    const r = await risolviSoggettiOrso(
      [mov('a', 'CARICO', 'f1')],
      dettagli([sede('s1')], [fir('f1', 's1', null)], [legale]),
      istat
    )
    const s = r.soggetti.get('a')
    expect(s?.tipo === 'Inew' && s.impianto.indirizzoSL).toBeUndefined()
    expect(s?.tipo === 'Inew' && s.impianto.indirizzoUL.comune).toBe('146')
  })

  it('l’ISTAT di ogni sede si risolve una volta sola, anche con molti movimenti', async () => {
    const mm = Array.from({ length: 50 }, (_, i) => mov(`m${i}`, 'CARICO', 'f1'))
    await risolviSoggettiOrso(mm, dettagli([sede('s1')], [fir('f1', 's1', null)]), istat)
    expect(istat).toHaveBeenCalledTimes(1)
  })

  it('un movimento della stessa sede già in errore finisce nello stesso elenco', async () => {
    const r = await risolviSoggettiOrso(
      [mov('a', 'CARICO', 'f1'), mov('b', 'CARICO', 'f1')],
      dettagli([sede('ignota')], [fir('f1', 'ignota', null)]),
      istat
    )
    expect(r.errori).toHaveLength(1)
    expect(r.errori[0].movimentoIds).toEqual(['a', 'b'])
  })

  describe('ripiego per i FIR senza sede (creati prima del 31/10)', () => {
    it('lo scarico usa il destinatario del FIR, il carico il produttore', async () => {
      const dd = dettagli(
        [sede('s1'), sede('s2', {}, { codiceOrso: '9' })],
        [
          [
            'f1',
            {
              id: 'f1',
              producerSedeId: null,
              producerId: 'p1',
              receiverSedeId: null,
              receiverId: 'r1',
            } as FirDettaglio,
          ],
        ],
        [],
        { destinatari: [{ id: 'r1', sedeId: 's2' }], produttori: [{ id: 'p1', sedeId: 's1' }] }
      )
      const r = await risolviSoggettiOrso(
        [mov('m1', 'CARICO', 'f1'), mov('m2', 'SCARICO', 'f1')],
        dd,
        istat
      )
      expect(r.soggetti.get('m1')).toMatchObject({ tipo: 'Inew', chiave: 's1' })
      expect(r.soggetti.get('m2')).toMatchObject({ tipo: 'I', codice: '9' })
    })

    it('la sede del FIR, se c’è, ha la precedenza sul ripiego', async () => {
      const dd = dettagli(
        [sede('s1'), sede('s2', {}, { codiceOrso: '9' })],
        [
          [
            'f1',
            {
              id: 'f1',
              producerSedeId: 's2',
              producerId: 'p1',
              receiverSedeId: null,
            } as FirDettaglio,
          ],
        ],
        [],
        { produttori: [{ id: 'p1', sedeId: 's1' }] }
      )
      const r = await risolviSoggettiOrso([mov('m1', 'CARICO', 'f1')], dd, istat)
      expect(r.soggetti.get('m1')).toMatchObject({ tipo: 'I', codice: '9' })
    })
  })

  describe('movimenti senza FIR: soggetto dalla controparte del registro', () => {
    const rossi = sede('s1', { comune: 'Milano', via: 'Via Roma' }, { codiceOrso: '55' })
    const rossiBo = sede('s2', {
      dittaId: 'd-s1',
      comune: 'Bologna',
      via: 'Via Emilia',
      ditta: rossi.ditta,
    })

    it('una sola sede: si usa, senza guardare l’indirizzo (maiuscole e spazi non contano)', async () => {
      const r = await risolviSoggettiOrso(
        [mov('m1', 'CARICO', null, { nome: 'Ditta s1' })],
        dettagli([rossi], [], [], { controparti: [['ditta s1', [rossi]]] }),
        istat
      )
      expect(r.errori).toEqual([])
      expect(r.soggetti.get('m1')).toMatchObject({ tipo: 'I', codice: '55' })
    })

    it('una sola ditta ma comune dell’indirizzo diverso: non identificata (review N1)', async () => {
      const dd = dettagli([rossi], [], [], { controparti: [['ditta s1', [rossi]]] })
      const r = await risolviSoggettiOrso(
        [
          mov('a', 'CARICO', null, { nome: 'Ditta s1', indirizzo: 'Via Roma 1, Torino (TO)' }),
          mov('b', 'CARICO', null, { nome: 'Ditta s1', indirizzo: 'VIA ROMA 1,  MILANO (MI)' }),
          mov('c', 'CARICO', null, { nome: 'Ditta s1', indirizzo: 'Via Roma 1, Milano (MI)' }),
        ],
        dd,
        istat
      )
      expect(r.soggetti.has('a')).toBe(false)
      expect(r.soggetti.get('b')).toMatchObject({ tipo: 'I', codice: '55' })
      expect(r.soggetti.has('c')).toBe(true)
    })

    it('più sedi: le distingue l’indirizzo, altrimenti il soggetto resta assente', async () => {
      const dd = dettagli([rossi, rossiBo], [], [], {
        controparti: [['ditta s1', [rossi, rossiBo]]],
      })
      const r = await risolviSoggettiOrso(
        [
          mov('a', 'CARICO', null, { nome: 'Ditta s1', indirizzo: 'Via Emilia 3, Bologna (BO)' }),
          mov('b', 'CARICO', null, { nome: 'Ditta s1', indirizzo: 'Via Roma 1, Milano (MI)' }),
          mov('c', 'CARICO', null, { nome: 'Ditta s1' }),
          mov('d', 'CARICO', null, { nome: 'Ditta s1', indirizzo: 'Piazza Unica, Torino (TO)' }),
        ],
        dd,
        istat
      )
      expect(r.soggetti.get('a')).toMatchObject({ tipo: 'Inew', chiave: 's2' })
      expect(r.soggetti.get('b')).toMatchObject({ tipo: 'I', codice: '55' })
      expect(r.soggetti.has('c')).toBe(false)
      expect(r.soggetti.has('d')).toBe(false)
    })

    it('controparte assente o sconosciuta: nessun soggetto e nessun errore di sede', async () => {
      const r = await risolviSoggettiOrso(
        [mov('a', 'CARICO', null, { nome: null }), mov('b', 'CARICO', null, { nome: 'Ignota' })],
        dettagli([rossi], []),
        istat
      )
      expect(r.soggetti.size).toBe(0)
      expect(r.errori).toEqual([])
    })
  })

  describe('sede della controparte scelta nel form (ordine: colonna, FIR, nome)', () => {
    const ditta = (id: string, nome: string) => ({
      id: `d-${id}`,
      ragioneSociale: nome,
      partitaIva: '01234567890',
      codiceFiscale: null,
    })
    // Due ditte omonime in comuni omonimi di province diverse (review N1).
    const calliTn = sede('s1', {
      comune: 'Calliano',
      provincia: 'TN',
      ditta: ditta('s1', 'Comune di Calliano'),
    })
    const calliAt = sede('s2', {
      dittaId: 'd-s2',
      comune: 'Calliano',
      provincia: 'AT',
      ditta: ditta('s2', 'Comune di Calliano'),
    })

    it("N1: una sola candidata per nome (TN) ma sede scelta un'altra (AT): vince la sede scelta", async () => {
      const dd = dettagli([calliTn, calliAt], [], [], {
        controparti: [['comune di calliano', [calliTn]]],
      })
      const r = await risolviSoggettiOrso(
        [
          mov('m1', 'CARICO', null, {
            nome: 'Comune di Calliano',
            indirizzo: 'Via Roma 1, Calliano (AT)',
            sedeControparteId: 's2',
          }),
        ],
        dd,
        istat
      )
      expect(r.soggetti.get('m1')).toMatchObject({ tipo: 'Inew', chiave: 's2' })
    })

    it('la colonna vince sul FIR quando i due sono diversi', async () => {
      const dd = dettagli([calliTn, calliAt], [fir('f1', 's1', 's1')])
      const r = await risolviSoggettiOrso(
        [mov('m1', 'CARICO', 'f1', { nome: null, sedeControparteId: 's2' })],
        dd,
        istat
      )
      expect(r.soggetti.get('m1')).toMatchObject({ tipo: 'Inew', chiave: 's2' })
    })

    it('colonna con id non caricato: ripiego sul FIR, poi sul nome', async () => {
      const dd = dettagli([calliTn], [fir('f1', 's1', 's1')], [], {
        controparti: [['comune di calliano', [calliTn]]],
      })
      const r = await risolviSoggettiOrso(
        [
          mov('perFir', 'CARICO', 'f1', { nome: null, sedeControparteId: 'sconosciuta' }),
          mov('perNome', 'CARICO', null, {
            nome: 'Comune di Calliano',
            sedeControparteId: 'sconosciuta',
          }),
        ],
        dd,
        istat
      )
      expect(r.soggetti.get('perFir')).toMatchObject({ tipo: 'Inew', chiave: 's1' })
      expect(r.soggetti.get('perNome')).toMatchObject({ tipo: 'Inew', chiave: 's1' })
    })

    it('una sede scelta e poi disattivata si usa lo stesso', async () => {
      const chiusa = sede('s3', { attiva: false, ditta: ditta('s3', 'Ditta chiusa') })
      const r = await risolviSoggettiOrso(
        [mov('m1', 'CARICO', null, { nome: 'Ditta chiusa', sedeControparteId: 's3' })],
        dettagli([chiusa], []),
        istat
      )
      expect(r.soggetti.get('m1')).toMatchObject({ tipo: 'Inew', chiave: 's3' })
    })

    it('N2: nome con doppi spazi nel movimento e sede nella colonna: soggetto trovato senza il nome', async () => {
      const r = await risolviSoggettiOrso(
        [mov('m1', 'CARICO', null, { nome: '  Comune   di  Calliano ', sedeControparteId: 's1' })],
        // nessuna entry in sediPerControparte: il nome non serve
        dettagli([calliTn], []),
        istat
      )
      expect(r.soggetti.get('m1')).toMatchObject({ tipo: 'Inew', chiave: 's1' })
    })
  })

  describe('ripiego per nome: si preferiscono le sedi attive (N3)', () => {
    const base = sede('s1', { comune: 'Milano', via: 'Via Roma' }, { codiceOrso: '55' })
    const chiusa = sede('s2', {
      dittaId: 'd-s1',
      comune: 'Bologna',
      via: 'Via Emilia',
      attiva: false,
      ditta: base.ditta,
    })
    const altraAttiva = sede('s4', {
      dittaId: 'd-s1',
      comune: 'Bologna',
      via: 'Via Emilia',
      ditta: base.ditta,
    })

    it('una attiva e una disattivata, indirizzo vuoto: la sola attiva', async () => {
      const r = await risolviSoggettiOrso(
        [mov('m1', 'CARICO', null, { nome: 'Ditta s1' })],
        dettagli([base, chiusa], [], [], { controparti: [['ditta s1', [base, chiusa]]] }),
        istat
      )
      expect(r.soggetti.get('m1')).toMatchObject({ tipo: 'I', codice: '55' })
    })

    it("due attive e una disattivata: decide l'indirizzo come oggi", async () => {
      const dd = dettagli([base, chiusa, altraAttiva], [], [], {
        controparti: [['ditta s1', [base, chiusa, altraAttiva]]],
      })
      const r = await risolviSoggettiOrso(
        [
          mov('a', 'CARICO', null, { nome: 'Ditta s1', indirizzo: 'Via Emilia 3, Bologna (BO)' }),
          mov('b', 'CARICO', null, { nome: 'Ditta s1' }),
        ],
        dd,
        istat
      )
      expect(r.soggetti.get('a')).toMatchObject({ tipo: 'Inew', chiave: 's4' })
      expect(r.soggetti.has('b')).toBe(false)
    })

    it('solo sedi disattivate: comportamento di oggi su tutte', async () => {
      const chiusa1 = { ...base, attiva: false }
      const dd = dettagli([chiusa1, chiusa], [], [], {
        controparti: [['ditta s1', [chiusa1, chiusa]]],
      })
      const r = await risolviSoggettiOrso(
        [
          mov('a', 'CARICO', null, { nome: 'Ditta s1', indirizzo: 'Via Emilia 3, Bologna (BO)' }),
          mov('b', 'CARICO', null, { nome: 'Ditta s1' }),
        ],
        dd,
        istat
      )
      expect(r.soggetti.get('a')).toMatchObject({ tipo: 'Inew', chiave: 's2' })
      expect(r.soggetti.has('b')).toBe(false)
    })
  })

  it('due sedi con lo stesso nome ma errori diversi non si scambiano i movimenti (review M1)', async () => {
    const ditta = (id: string, cf: string | null) => ({
      id: `d-${id}`,
      ragioneSociale: 'Uguale',
      partitaIva: cf,
      codiceFiscale: null,
    })
    const a = sede('a', { ditta: ditta('a', 'XYZ') })
    const b = sede('b', { ditta: ditta('b', '01234567890') })
    const r = await risolviSoggettiOrso(
      [
        mov('m1', 'CARICO', 'f1'),
        mov('m2', 'CARICO', 'f2'),
        mov('m3', 'CARICO', 'f1'),
        mov('m4', 'CARICO', 'f2'),
      ],
      dettagli([a, b], [fir('f1', 'a', null), fir('f2', 'b', null)]),
      istat
    )
    const per = Object.fromEntries(r.errori.map(e => [e.codice, e.movimentoIds]))
    expect(per).toEqual({
      CODICE_FISCALE_SOGGETTO_NON_VALIDO: ['m1', 'm3'],
      ISTAT_SOGGETTO_NON_VALIDO: ['m2', 'm4'],
    })
  })
})
