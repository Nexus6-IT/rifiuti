import type { ConfigurazioneOrr } from '../../domain/comunicazioni/configurazione-sede'
import { configurazionePredefinita } from '../../domain/comunicazioni/configurazione-sede'
import { validaFileOrr } from '../../domain/comunicazioni/orr/serializza-orr'
import type { ContestoPreparazione } from './comunicazioni-tracciato.port'
import {
  chiaveComune,
  costruisciFileOrr,
  formattaAtecoOrr,
  type ExtraPreparazioneOrr,
} from './costruisci-file-orr'
import type { DettagliTracciato, FirDettaglio, SedeDettaglio } from './lettore-dettagli-tracciato'
import type { MovimentoOrso } from './lettore-movimenti-orso'
import { validaRichiestaOrr } from './preparatore-orr'

const comeData = (g: string | null) => (g ? new Date(`${g}T00:00:00.000Z`) : null)

function sedeTerza(
  id: string,
  o: {
    nome: string
    comune?: string
    provincia?: string
    cap?: string
    piva?: string | null
    ateco?: string | null
    istat?: string | null
    esclusa?: boolean
    albo?: { data: string | null; classi: string | null }
    autData?: string | null
  }
): SedeDettaglio {
  return {
    id,
    dittaId: `ditta-${id}`,
    denominazione: null,
    via: 'Via Roma',
    civico: '1',
    cap: o.cap ?? '80100',
    comune: o.comune ?? 'Napoli',
    provincia: o.provincia ?? 'NA',
    telefono: null,
    principale: true,
    ditta: {
      id: `ditta-${id}`,
      ragioneSociale: o.nome,
      partitaIva: o.piva === undefined ? '01234567890' : o.piva,
      codiceFiscale: null,
    },
    anagrafica: {
      id: `ana-${id}`,
      tenantId: 't',
      sedeDittaId: id,
      eComune: false,
      codiceIstatComune: o.istat === undefined ? '063049' : o.istat,
      codiceAteco: o.ateco === undefined ? '38.21.09' : o.ateco,
      codiceOrso: null,
      alboDataIscrizione: comeData(o.albo?.data === undefined ? '2020-03-15' : o.albo.data),
      alboClassi: o.albo?.classi === undefined ? '1 2 4' : o.albo.classi,
      autorizzazioneData: comeData(o.autData === undefined ? '2019-06-10' : o.autData),
      legaleRappresentanteCognome: null,
      legaleRappresentanteNome: null,
      esclusaOrr: o.esclusa ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as SedeDettaglio
}

const mov = (id: string, o: Partial<MovimentoOrso> = {}): MovimentoOrso =>
  ({
    id,
    registroId: 'reg',
    tipo: 'CARICO',
    movementDate: new Date('2025-01-15T09:00:00Z'),
    cer: '150110',
    pericoloso: true,
    descrizione: null,
    quantita: 1250.5,
    unita: 'KG',
    kg: 1250.5,
    ruolo: 'RICEVUTO_DA_TERZI',
    operazione: 'R',
    origineOperazione: 'MOVIMENTO',
    operationCode: 'R13',
    conFir: true,
    firId: `fir-${id}`,
    provinciaConferitore: 'NA',
    provinciaDaIndirizzo: false,
    numero: `${id}/2025`,
    radiceId: id,
    causale: 'INGRESSO_ESTERNO',
    controparte: null,
    indirizzoControparte: null,
    firNumero: 'AB1234567890123',
    ...o,
  }) as MovimentoOrso

const firDi = (id: string, o: Partial<FirDettaglio> = {}): FirDettaglio => ({
  id,
  firNumero: 'AB1234567890123',
  transportDate: new Date('2025-01-15T08:00:00Z'),
  actualArrivalDate: null,
  producerSedeId: 'prod',
  receiverSedeId: null,
  producerCodiceFiscale: null,
  carrierCodiceFiscale: null,
  receiverCodiceFiscale: null,
  producerPartitaIva: '',
  carrierPartitaIva: '98765432109',
  receiverPartitaIva: '',
  producerName: 'Produttore',
  carrierName: 'Trasporti',
  receiverName: '',
  producerAddress: '',
  receiverAddress: '',
  carrierId: 'tr1',
  receiverId: null,
  carrierVehiclePlate: 'AB123CD',
  wasteOperationCode: 'R13',
  trasportatore1: null,
  ...o,
})

const EXTRA: ExtraPreparazioneOrr = {
  sedeLegalePropria: {
    indirizzo: 'Corso Umberto',
    civico: '5',
    cap: '80133',
    comune: 'Napoli',
    provincia: 'NA',
  },
  autorizzazionePropria: { estremi: 'AUT-2019-0042', data: '2019-06-10' },
  autorizzazioneAmbigua: false,
  istatPerComune: new Map([
    [chiaveComune('Napoli', 'NA'), '063049'],
    [chiaveComune('Marcianise', 'CE'), '061053'],
  ]),
}

interface Scenario {
  movimenti: MovimentoOrso[]
  fir: Record<string, FirDettaglio>
  sedi: SedeDettaglio[]
  cfg?: Partial<ConfigurazioneOrr>
  attivita?: string
  extra?: Partial<ExtraPreparazioneOrr>
  dati?: Record<string, unknown>
  tipoImpianto?: ConfigurazioneOrr['tipoImpianto']
  provinciaSede?: string
  progressivoMud?: number | null
  trasportatori?: Record<string, { sedeId: string | null; numeroIscrizione: string }>
  destinatari?: Record<string, { sedeId: string | null; numeroAutorizzazione: string }>
}

function esegui(s: Scenario) {
  const sedi = new Map(s.sedi.map(x => [x.id, x]))
  const dettagli: DettagliTracciato = {
    fir: new Map(Object.entries(s.fir)),
    sedi,
    sedeLegalePerDitta: new Map(s.sedi.map(x => [x.dittaId, x])),
    trasportatori: new Map(
      Object.entries(
        s.trasportatori ?? { tr1: { sedeId: 'tra', numeroIscrizione: 'NA012345' } }
      ).map(([id, v]) => [id, { id, dittaId: null, ...v }])
    ),
    destinatari: new Map(
      Object.entries(s.destinatari ?? {}).map(([id, v]) => [id, { id, dittaId: null, ...v }])
    ),
    datiTracciato: new Map(Object.entries(s.dati ?? {}) as Array<[string, never]>),
  }
  const cfg: ConfigurazioneOrr = {
    ...configurazionePredefinita('ORR'),
    tipoImpianto: s.tipoImpianto ?? 'STO',
    ...s.cfg,
  }
  const ctx: ContestoPreparazione<ConfigurazioneOrr> = {
    tenantId: 't',
    azienda: {
      partitaIva: '98765432109',
      codiceFiscale: null,
      ragioneSociale: 'Impianto Società Verde S.r.l.',
      atecoCode: '381109',
      legaleRappresentanteCognome: null,
      legaleRappresentanteNome: null,
    },
    unita: {
      id: 'u',
      denominazione: 'Sede',
      numIscrSito: 'X',
      indirizzo: 'Z.I. Asi',
      civico: '8',
      cap: '81025',
      comune: 'Marcianise',
      provincia: s.provinciaSede ?? 'CE',
      progressivoMud: s.progressivoMud === undefined ? 1 : s.progressivoMud,
    },
    periodo: { da: '2025-01-01', a: '2025-01-31' },
    parametri: { attivita: s.attivita ?? 'STO' },
    movimenti: s.movimenti,
    dettagli,
    configurazione: cfg,
    catalogo: {} as never,
  }
  return costruisciFileOrr(ctx, { ...EXTRA, ...s.extra })
}

const base = (): Scenario => ({
  movimenti: [mov('1')],
  fir: { 'fir-1': firDi('fir-1') },
  sedi: [
    sedeTerza('prod', { nome: 'Rossi Imballaggi S.r.l.' }),
    sedeTerza('tra', { nome: 'Trasporti Veloci S.p.A.', piva: '09876543210' }),
  ],
})

const codici = (r: ReturnType<typeof esegui>, bloccanti = true) =>
  r.avvisi.filter(a => a.bloccante === bloccanti).map(a => a.codice)

describe('formattaAtecoOrr', () => {
  it('NN.NN.NN o 6 cifre; altro = null', () => {
    expect(formattaAtecoOrr('38.21.09')).toBe('38.21.09')
    expect(formattaAtecoOrr('382109')).toBe('38.21.09')
    expect(formattaAtecoOrr('38.21')).toBeNull()
    expect(formattaAtecoOrr(null)).toBeNull()
    expect(formattaAtecoOrr('')).toBeNull()
  })
})

describe('validaRichiestaOrr (mesi interi dello stesso anno)', () => {
  const r = (da: string, a: string, attivita = 'STO') => ({
    consorzio: 'ORR',
    unitaLocaleId: 'u',
    da,
    a,
    parametri: { attivita },
  })
  it('un mese e piu mesi interi dello stesso anno sono validi', () => {
    expect(validaRichiestaOrr(r('2025-01-01', '2025-01-31'))).toEqual([])
    expect(validaRichiestaOrr(r('2025-02-01', '2025-04-30'))).toEqual([])
    expect(validaRichiestaOrr(r('2024-02-01', '2024-02-29'))).toEqual([])
    expect(validaRichiestaOrr(r('2025-01-01', '2025-12-31'))).toEqual([])
  })
  it('periodo non a mesi interi o su due anni: errore', () => {
    expect(validaRichiestaOrr(r('2025-01-05', '2025-01-31')).join()).toContain('primo giorno')
    expect(validaRichiestaOrr(r('2025-01-01', '2025-01-30')).join()).toContain('ultimo giorno')
    expect(validaRichiestaOrr(r('2024-12-01', '2025-01-31')).join()).toContain('un solo anno')
  })
  it('attivita assente o non valida: errore', () => {
    expect(
      validaRichiestaOrr({
        consorzio: 'ORR',
        unitaLocaleId: 'u',
        da: '2025-01-01',
        a: '2025-01-31',
      }).join()
    ).toContain('attività')
    expect(validaRichiestaOrr(r('2025-01-01', '2025-01-31', 'XXX')).join()).toContain('attività')
  })
})

describe('costruisciFileOrr: stoccaggio ricevuto da terzi', () => {
  it('un record STO completo, destinatario noi con la nostra autorizzazione', () => {
    const r = esegui(base())
    expect(codici(r)).toEqual([])
    expect(r.dati.record).toHaveLength(1)
    const rec = r.dati.record[0]
    expect(rec).toMatchObject({
      anno: 2025,
      mese: 1,
      formulario: 'AB1234567890123',
      dataFormulario: '2025-01-15',
      tipoDichiarante: 'STO',
      cer: '150110',
      quantitaKg: 1250.5,
      destinazione: 'R13',
    })
    expect(rec.detentore).toMatchObject({ ateco: '38.21.09', tipo: 'PRO', codice: '01234567890' })
    expect(rec.destinatario).toMatchObject({
      ragioneSociale: 'Impianto Società Verde S.r.l.',
      codice: '98765432109',
      indirizzoSedeLegale: 'Corso Umberto, 5',
      istatSedeLegale: '063049',
      indirizzoUnitaLocale: 'Z.I. Asi, 8',
      istatUnitaLocale: '061053',
      autorizzazioneNumero: 'AUT-2019-0042',
      autorizzazioneData: '2019-06-10',
      tipoImpianto: 'STO',
    })
    // Il trasportatore e il produttore sono terzi, il file valido per il serializzatore.
    expect(rec.trasportatore).toMatchObject({ alboNumero: 'NA012345', alboClassi: '1 2 4' })
    expect(validaFileOrr(r.dati)).toEqual([])
    expect(r.movimentiInFile.map(m => m.id)).toEqual(['1'])
  })

  it('lo stesso movimento (trasportato da noi) va anche nel file T, con e13 derivato da R13', () => {
    const s = base()
    s.fir['fir-1'] = firDi('fir-1', { carrierCodiceFiscale: '98765432109' })
    const t = esegui({ ...s, attivita: 'TRA' })
    expect(codici(t)).toEqual([])
    expect(t.dati.record).toHaveLength(1)
    expect(t.dati.record[0].tipoDichiarante).toBe('TRA')
    expect(t.dati.record[0].destinatario.tipoImpianto).toBe('STO')
    const sto = esegui(s)
    expect(sto.dati.record).toHaveLength(1)
    // Un file non contiene i movimenti dell'altra attivita.
    expect(esegui({ ...s, attivita: 'REC' }).dati.record).toHaveLength(0)
  })

  it('senza movimenti per l attivita: avviso informativo, nessun bloccante', () => {
    const r = esegui({ ...base(), attivita: 'SMA' })
    expect(r.dati.record).toHaveLength(0)
    expect(codici(r)).toEqual([])
    expect(codici(r, false)).toContain('NESSUN_DATO')
  })

  it('ordina per data e numero del movimento', () => {
    const s = base()
    s.movimenti = [
      mov('2', {
        movementDate: new Date('2025-01-20T09:00:00Z'),
        numero: '2/2025',
        firId: 'fir-1',
      }),
      mov('1', {
        movementDate: new Date('2025-01-10T09:00:00Z'),
        numero: '1/2025',
        firId: 'fir-1',
      }),
    ]
    expect(esegui(s).dati.record.map(x => x.movimento)).toEqual(['1/2025', '2/2025'])
  })
})

describe('costruisciFileOrr: attivita per tipo impianto e flag', () => {
  it('R/S: D -> SMA, R -> REC', () => {
    const s = base()
    s.tipoImpianto = 'R/S'
    s.movimenti = [mov('1', { operazione: 'D', operationCode: 'D15', firId: 'fir-1' })]
    expect(esegui({ ...s, attivita: 'SMA' }).dati.record).toHaveLength(1)
    expect(esegui({ ...s, attivita: 'REC' }).dati.record).toHaveLength(0)
    expect(esegui({ ...s, attivita: 'SMA' }).dati.record[0].destinatario.tipoImpianto).toBe('SMA')
  })

  it('il flag FRA dei dati del movimento sposta il movimento nel file FRA', () => {
    const s = base()
    s.dati = { '1': { attivita: 'FRA' } }
    expect(esegui({ ...s, attivita: 'FRA' }).dati.record).toHaveLength(1)
    expect(esegui({ ...s, attivita: 'STO' }).dati.record).toHaveLength(0)
  })

  it('AUT: bloccante (dati di pedana fuori ambito)', () => {
    const s = base()
    s.dati = { '1': { attivita: 'AUT' } }
    const r = esegui({ ...s, attivita: 'AUT' })
    expect(codici(r)).toContain('AUTODEMOLITORE_NON_SUPPORTATO')
    expect(r.avvisi.find(a => a.codice === 'AUTODEMOLITORE_NON_SUPPORTATO')?.movimentoIds).toEqual([
      '1',
    ])
  })

  it('senza tipo impianto in configurazione: bloccante nei file di impianto, non nel T', () => {
    const s = base()
    s.fir['fir-1'] = firDi('fir-1', { carrierCodiceFiscale: '98765432109' })
    const cfg = { tipoImpianto: undefined }
    const sto = esegui({ ...s, attivita: 'STO', cfg })
    expect(codici(sto)).toContain('TIPO_IMPIANTO_MANCANTE')
    const t = esegui({ ...s, attivita: 'TRA', cfg })
    expect(codici(t)).not.toContain('TIPO_IMPIANTO_MANCANTE')
  })
})

describe('costruisciFileOrr: esclusioni e regola del file T', () => {
  it('una controparte «esclusa O.R.R.» toglie il movimento e lo dice', () => {
    const s = base()
    s.sedi = [
      sedeTerza('prod', { nome: 'Rossi', esclusa: true }),
      sedeTerza('tra', { nome: 'Trasporti', piva: '09876543210' }),
    ]
    const r = esegui(s)
    expect(r.dati.record).toHaveLength(0)
    expect(codici(r, false)).toContain('MOVIMENTI_ESCLUSI_ORR')
  })

  it('file T: ne produttore ne destinatario in Campania -> il movimento non entra', () => {
    const s: Scenario = {
      movimenti: [mov('1', { tipo: 'SCARICO', ruolo: 'AVVIATO', operazione: 'R', firId: 'fir-1' })],
      fir: {
        'fir-1': firDi('fir-1', {
          carrierCodiceFiscale: '98765432109',
          producerSedeId: 'prod',
          receiverSedeId: 'dest',
          receiverId: 'd1',
        }),
      },
      sedi: [
        sedeTerza('prod', {
          nome: 'Milano Srl',
          comune: 'Milano',
          provincia: 'MI',
          istat: '015146',
        }),
        sedeTerza('dest', {
          nome: 'Torino Srl',
          comune: 'Torino',
          provincia: 'TO',
          istat: '001272',
        }),
        sedeTerza('tra', { nome: 'Trasporti', piva: '09876543210' }),
      ],
      destinatari: { d1: { sedeId: 'dest', numeroAutorizzazione: 'X1' } },
      attivita: 'TRA',
    }
    expect(esegui(s).dati.record).toHaveLength(0)
    // Con il destinatario a Napoli il trasporto va comunicato.
    s.sedi[1] = sedeTerza('dest', { nome: 'Napoli Srl' })
    expect(esegui(s).dati.record).toHaveLength(1)
  })

  it('file T: ISTAT del produttore sconosciuto e l altra parte fuori Campania -> il movimento resta e l errore emerge', () => {
    const s: Scenario = {
      movimenti: [mov('1', { tipo: 'SCARICO', ruolo: 'AVVIATO', firId: 'fir-1' })],
      fir: {
        'fir-1': firDi('fir-1', {
          carrierCodiceFiscale: '98765432109',
          receiverSedeId: 'dest',
          receiverId: 'd1',
        }),
      },
      sedi: [
        sedeTerza('prod', {
          nome: 'Ignoto Srl',
          comune: 'Paperopoli',
          provincia: 'MI',
          istat: null,
        }),
        sedeTerza('dest', {
          nome: 'Torino Srl',
          comune: 'Torino',
          provincia: 'TO',
          istat: '001272',
        }),
        sedeTerza('tra', { nome: 'Trasporti', piva: '09876543210' }),
      ],
      destinatari: { d1: { sedeId: 'dest', numeroAutorizzazione: 'X1' } },
      attivita: 'TRA',
    }
    const r = esegui(s)
    expect(r.dati.record).toHaveLength(1)
    expect(codici(r)).toContain('DATI_SEDE_CONTROPARTE')
  })

  it('sede propria fuori dalla Campania, o senza progressivo MUD: bloccante', () => {
    expect(codici(esegui({ ...base(), provinciaSede: 'MI' }))).toContain('SEDE_NON_IN_CAMPANIA')
    expect(codici(esegui({ ...base(), progressivoMud: null }))).toContain('CODICE_SEDE_MANCANTE')
    expect(codici(esegui(base()))).toEqual([])
  })
})

describe('costruisciFileOrr: bloccanti con link alla correzione (D14)', () => {
  const avvisoDi = (r: ReturnType<typeof esegui>, codice: string) =>
    r.avvisi.find(a => a.codice === codice && a.bloccante)

  it('ISTAT mancante del produttore: link all anagrafica della sede', () => {
    const s = base()
    s.sedi[0] = sedeTerza('prod', {
      nome: 'Rossi',
      comune: 'Paperopoli',
      provincia: 'NA',
      istat: null,
    })
    const a = avvisoDi(esegui(s), 'DATI_SEDE_CONTROPARTE')
    expect(a?.messaggio).toContain('Rossi')
    expect(a?.messaggio).toContain('ISTAT')
    expect(a?.correzione).toEqual({ tipo: 'ANAGRAFICA_SEDE', sedeDittaId: 'prod' })
    expect(a?.movimentoIds).toEqual(['1'])
  })

  it('ATECO del produttore mancante: bloccante, oppure 00 con atecoProduttoreMancanteComeZero', () => {
    const s = base()
    s.sedi[0] = sedeTerza('prod', { nome: 'Rossi', ateco: null })
    expect(avvisoDi(esegui(s), 'ATECO_PRODUTTORE')?.correzione).toEqual({
      tipo: 'ANAGRAFICA_SEDE',
      sedeDittaId: 'prod',
    })
    const r = esegui({ ...s, cfg: { atecoProduttoreMancanteComeZero: true } })
    expect(codici(r)).toEqual([])
    expect(r.dati.record[0].detentore?.ateco).toBe('00')
  })

  it('Albo del trasportatore: numero, data e classi', () => {
    const s = base()
    s.sedi[1] = sedeTerza('tra', {
      nome: 'Trasporti',
      piva: '09876543210',
      albo: { data: null, classi: '' },
    })
    s.trasportatori = { tr1: { sedeId: 'tra', numeroIscrizione: '' } }
    const r = esegui(s)
    const messaggi = r.avvisi
      .filter(a => a.codice === 'ALBO_TRASPORTATORE')
      .map(a => a.messaggio)
      .join('|')
    expect(messaggi).toContain('numero di iscrizione')
    expect(messaggi).toContain('data di iscrizione')
    expect(messaggi).toContain('classi')
  })

  it('la nostra autorizzazione manca o e ambigua: link alla configurazione', () => {
    const s = base()
    const mancante = esegui({ ...s, extra: { autorizzazionePropria: null } })
    expect(avvisoDi(mancante, 'AUTORIZZAZIONE_IMPIANTO_MANCANTE')?.correzione).toEqual({
      tipo: 'CONFIGURAZIONE_SEDE',
    })
    const ambigua = esegui({
      ...s,
      extra: { autorizzazionePropria: null, autorizzazioneAmbigua: true },
    })
    expect(avvisoDi(ambigua, 'AUTORIZZAZIONE_IMPIANTO_MANCANTE')?.messaggio).toContain(
      'più autorizzazioni'
    )
  })

  it('destinatario di terzi (scarico da noi): numero e data dell autorizzazione dall anagrafica', () => {
    const s: Scenario = {
      movimenti: [mov('1', { tipo: 'SCARICO', ruolo: 'AVVIATO', operazione: 'D', firId: 'fir-1' })],
      fir: {
        'fir-1': firDi('fir-1', {
          carrierCodiceFiscale: '98765432109',
          producerSedeId: null,
          receiverSedeId: 'dest',
          receiverId: 'd1',
        }),
      },
      sedi: [
        sedeTerza('dest', { nome: 'Discarica Srl', autData: null }),
        sedeTerza('tra', { nome: 'Trasporti', piva: '09876543210' }),
      ],
      destinatari: { d1: { sedeId: 'dest', numeroAutorizzazione: '' } },
      attivita: 'TRA',
    }
    const r = esegui(s)
    const m = r.avvisi
      .filter(a => a.codice === 'AUTORIZZAZIONE_DESTINATARIO')
      .map(a => a.messaggio)
      .join('|')
    expect(m).toContain('numero dell’autorizzazione')
    expect(m).toContain('data dell’autorizzazione')
    // Lo scarico e prodotto da noi: il detentore e la nostra azienda, ATECO dal tenant.
    expect(r.dati.record[0].detentore?.ateco).toBe('38.11.09')
    expect(r.dati.record[0].detentore?.codice).toBe('98765432109')
  })

  it('movimento senza FIR: produttore non identificato e formulario mancante', () => {
    const s = base()
    s.movimenti = [mov('1', { firId: null, firNumero: null })]
    const r = esegui(s)
    expect(codici(r)).toEqual(
      expect.arrayContaining(['PRODUTTORE_NON_IDENTIFICATO', 'MANCA_FORMULARIO'])
    )
    expect(r.dati.record).toHaveLength(0)
  })

  it('FIR senza numero: il formulario viene dai dati O.R.R. del movimento', () => {
    const s = base()
    s.movimenti = [mov('1', { firNumero: null })]
    s.fir['fir-1'] = firDi('fir-1', { firNumero: null })
    expect(codici(esegui(s))).toContain('MANCA_FORMULARIO')
    s.dati = { '1': { formulario: { numero: 'X123', data: '2025-01-14' } } }
    const r = esegui(s)
    expect(codici(r)).toEqual([])
    expect(r.dati.record[0].formulario).toBe('X123')
  })

  it('quantita non convertibile: bloccante con il movimento', () => {
    const s = base()
    s.movimenti = [mov('1', { kg: null })]
    expect(codici(esegui(s))).toContain('QUANTITA_NON_CONVERTIBILE')
  })

  it('dati O.R.R. del movimento non validi: bloccante', () => {
    const s = base()
    s.dati = { '1': { attivita: 'XXX' } }
    expect(codici(esegui(s))).toContain('DATI_ORR_NON_VALIDI')
  })

  it('dati della sede propria mancanti: bloccanti con link alla configurazione', () => {
    const r = esegui({
      ...base(),
      extra: {
        sedeLegalePropria: {
          indirizzo: null,
          civico: null,
          cap: null,
          comune: null,
          provincia: null,
        },
      },
    })
    const a = r.avvisi.filter(x => x.codice === 'DATI_SEDE_PROPRIA')
    expect(a.length).toBeGreaterThan(0)
    expect(a.every(x => x.correzione?.tipo === 'CONFIGURAZIONE_SEDE')).toBe(true)
  })
})
