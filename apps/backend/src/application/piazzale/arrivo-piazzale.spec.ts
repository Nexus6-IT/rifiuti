import {
  FIR,
  FIRStato,
  TipoTratta,
  type StatoFormulario,
} from '../../domain/fir/aggregates/fir.aggregate'
import {
  STATI_RENTRI_FUORI_PIAZZALE,
  corrispondeRicercaPiazzale,
  eAziendaStessa,
  eArrivoPiazzale,
  normalizzaRicercaPiazzale,
} from './arrivo-piazzale'

const PIVA = '01234567897'
const codici = new Set([PIVA])

const firma = () => ({
  firmatario: 'Firmatario di prova',
  timestamp: new Date(),
  certificato: 'certificato-di-prova',
})

function creaFir(opzioni?: {
  partitaIvaDestinatario?: string
  targa?: string
  tratte?: { mezzo: string }[]
}): FIR {
  return FIR.create({
    tenantId: 't1',
    produttoreId: 'produttore',
    trasportatoreId: 'trasportatore',
    destinatarioId: 'destinatario',
    produttore: { ragioneSociale: 'Produttore SRL', partitaIva: '11111111111' },
    trasportatore: {
      ragioneSociale: 'Trasporti SRL',
      partitaIva: '22222222222',
      targaVeicolo: opzioni?.targa,
    },
    destinatario: {
      ragioneSociale: 'Impianto SRL',
      partitaIva: opzioni?.partitaIvaDestinatario ?? PIVA,
    },
    trasportatoriAggiuntivi: (opzioni?.tratte ?? []).map((t, i) => ({
      ordine: i + 2,
      tipoTratta: TipoTratta.TERRESTRE,
      denominazione: 'Altro trasportatore',
      mezzo: t.mezzo,
    })),
    rifiuto: { cerCode: '150101', quantita: 100 },
  } as any)
}

function locale(stato: 'EMESSO' | 'IN_TRANSITO', opz?: Parameters<typeof creaFir>[0]) {
  const fir = creaFir(opz)
  fir.emetti('FIR-000001', firma())
  if (stato !== 'EMESSO') fir.presaInCarico(new Date(), firma())
  return fir
}

function legato(stato: StatoFormulario | null, opz?: Parameters<typeof creaFir>[0]) {
  const fir = creaFir(opz)
  fir.agganciaFormularioAcquisito('BCDFG000001BC')
  if (stato) fir.applyRentriStato(stato)
  return fir
}

describe('eArrivoPiazzale', () => {
  it('locale IN_TRANSITO destinato a me: entra', () => {
    const fir = locale('IN_TRANSITO')
    expect(fir.stato).toBe(FIRStato.IN_TRANSITO)
    expect(eArrivoPiazzale(fir, codici)).toBe(true)
  })

  it('locale IN_TRANSITO con P.IVA "IT01234567897" e spazi: entra (normalizzazione A-W-13)', () => {
    const fir = locale('IN_TRANSITO', { partitaIvaDestinatario: ' IT 01234567897 ' })
    expect(eArrivoPiazzale(fir, codici)).toBe(true)
  })

  it('locale IN_TRANSITO destinato ad altri: non entra', () => {
    const fir = locale('IN_TRANSITO', { partitaIvaDestinatario: '99999999999' })
    expect(eArrivoPiazzale(fir, codici)).toBe(false)
  })

  it('locale EMESSO o CONSEGNATO: non entra', () => {
    expect(eArrivoPiazzale(locale('EMESSO'), codici)).toBe(false)
    const consegnato = legato('Accettato')
    expect(consegnato.stato).toBe(FIRStato.CONSEGNATO)
    expect(eArrivoPiazzale(consegnato, codici)).toBe(false)
  })

  it('legato IN_TRANSITO in InserimentoAccettazione: entra', () => {
    const fir = legato('InserimentoAccettazione')
    expect(fir.stato).toBe(FIRStato.IN_TRANSITO)
    expect(eArrivoPiazzale(fir, codici)).toBe(true)
  })

  it('legato in FirmaAccettazione: non entra (accettazione gia registrata)', () => {
    const fir = legato('FirmaAccettazione')
    expect(STATI_RENTRI_FUORI_PIAZZALE).toContain(fir.rentriStatoFormulario)
    expect(eArrivoPiazzale(fir, codici)).toBe(false)
  })

  it('legato in BOZZA mai riconciliato (rentriStatoFormulario null): entra', () => {
    const fir = legato(null)
    expect(fir.stato).toBe(FIRStato.BOZZA)
    expect(fir.rentriStatoFormulario).toBeNull()
    expect(eArrivoPiazzale(fir, codici)).toBe(true)
  })

  it('locale in BOZZA: non entra', () => {
    expect(eArrivoPiazzale(creaFir(), codici)).toBe(false)
  })

  it('codici vuoti: nessun FIR entra', () => {
    expect(eArrivoPiazzale(locale('IN_TRANSITO'), new Set())).toBe(false)
    expect(eArrivoPiazzale(legato('InserimentoAccettazione'), new Set())).toBe(false)
  })
})

describe('eAziendaStessa', () => {
  it('confronta la P.IVA normalizzata con i codici dell azienda', () => {
    expect(eAziendaStessa({ partitaIva: 'it 01234567897' } as any, codici)).toBe(true)
    expect(eAziendaStessa({ partitaIva: '99999999999' } as any, codici)).toBe(false)
  })

  it('parte assente o senza P.IVA: false', () => {
    expect(eAziendaStessa(null, codici)).toBe(false)
    expect(eAziendaStessa(undefined, codici)).toBe(false)
    expect(eAziendaStessa({ partitaIva: '' } as any, codici)).toBe(false)
    expect(eAziendaStessa({ partitaIva: '' } as any, new Set(['']))).toBe(false)
  })
})

describe('ricerca', () => {
  it('numero progressivo, numero RENTRI, targa principale e mezzo di una tratta', () => {
    const fir = locale('IN_TRANSITO', { targa: 'AB123CD', tratte: [{ mezzo: 'tr 77' }] })
    expect(corrispondeRicercaPiazzale(fir, normalizzaRicercaPiazzale('ab 123 cd'))).toBe(true)
    expect(corrispondeRicercaPiazzale(fir, normalizzaRicercaPiazzale(''))).toBe(true)
    expect(corrispondeRicercaPiazzale(fir, normalizzaRicercaPiazzale('ZZ999'))).toBe(false)
    expect(corrispondeRicercaPiazzale(fir, normalizzaRicercaPiazzale('fir-000001'))).toBe(true)
    expect(corrispondeRicercaPiazzale(fir, normalizzaRicercaPiazzale('TR77'))).toBe(true)

    const rentri = legato('InserimentoAccettazione')
    expect(corrispondeRicercaPiazzale(rentri, normalizzaRicercaPiazzale('bcdfg000001'))).toBe(true)
  })

  it('normalizza null e undefined in stringa vuota', () => {
    expect(normalizzaRicercaPiazzale(null)).toBe('')
    expect(normalizzaRicercaPiazzale(undefined)).toBe('')
  })
})
