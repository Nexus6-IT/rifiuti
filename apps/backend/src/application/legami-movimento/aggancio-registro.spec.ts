import {
  agganciaLegameSenzaFallire,
  applicaModificheAllaProposta,
  validaDatiLegame,
  type DatiAggancio,
} from './aggancio-registro'
import { validaModifiche } from './conferma-legame-righe'
import type { PropostaVista, RigaPropostaVista } from './proposta-legame.service'

function txFinta(fatturazioneDa: string | null) {
  return {
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([{ da: fatturazioneDa }]),
    activityLog: { create: jest.fn() },
  }
}

const dati = (o: Partial<DatiAggancio> = {}): DatiAggancio => ({
  tenantId: 't',
  userId: 'u',
  registroId: 'r',
  type: 'CARICO',
  movimentoId: 'm',
  fatturabile: true,
  causale: 'INGRESSO_ESTERNO',
  causaleAziendaId: null,
  cerCode: '20 03 01',
  movementDate: new Date('2026-03-10T10:00:00Z'),
  unit: 'KG',
  quantity: '100',
  firId: null,
  proposta: { proponiEScrivi: jest.fn() } as never,
  ...o,
})

describe('agganciaLegameSenzaFallire — casi senza savepoint', () => {
  it('causale non fatturabile: nessuna query e nessun SAVEPOINT', async () => {
    const tx = txFinta('2026-01-01')
    const e = await agganciaLegameSenzaFallire(tx as never, dati({ fatturabile: false }))
    expect(e).toEqual({ avvisi: [], fatturazione: null })
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled()
  })

  it('fatturazione spenta: solo la lettura della data, nessun SAVEPOINT', async () => {
    const tx = txFinta(null)
    const d = dati()
    const e = await agganciaLegameSenzaFallire(tx as never, d)
    expect(e.fatturazione).toBeNull()
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled()
    expect(d.proposta.proponiEScrivi).not.toHaveBeenCalled()
  })

  it('movimento prima di «fatturazione da»: nessun SAVEPOINT', async () => {
    const tx = txFinta('2026-06-01')
    const e = await agganciaLegameSenzaFallire(tx as never, dati())
    expect(e.fatturazione).toBeNull()
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled()
  })

  it('il giorno è quello italiano: 23:30 UTC del 31/05 è già il 01/06', async () => {
    const tx = txFinta('2026-06-01')
    const d = dati({ movementDate: new Date('2026-05-31T23:30:00Z') })
    ;(d.proposta.proponiEScrivi as jest.Mock).mockResolvedValue({
      legameId: null,
      creato: false,
      stato: null,
      proposta: null,
    })
    tx.$queryRaw.mockResolvedValueOnce([{ da: '2026-06-01' }]).mockResolvedValue([{ v: '0' }])
    await agganciaLegameSenzaFallire(tx as never, d)
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith('SAVEPOINT legame')
  })
})

describe('validaDatiLegame', () => {
  it('senza blocco: nessuna modifica', () => {
    expect(validaDatiLegame(undefined).righe.size).toBe(0)
  })
  it('azione sconosciuta: 400', () => {
    expect(() => validaDatiLegame({ azione: 'BOH' as never })).toThrow()
  })
  it('numeri non validi: 400 (virgola, zero, quattro decimali)', () => {
    const r = (quantita: string) => () =>
      validaDatiLegame({
        azione: 'CONFERMA',
        righe: [{ rigaAddebitoId: '11111111-1111-4111-8111-111111111111', quantita }],
      })
    expect(r('1,5')).toThrow()
    expect(r('0')).toThrow()
    expect(r('1.2345')).toThrow()
    expect(r('1.5')).not.toThrow()
  })
  it('togliere righe in registrazione: 400', () => {
    expect(() =>
      validaDatiLegame({
        azione: 'CONFERMA',
        righe: [{ rigaAddebitoId: '11111111-1111-4111-8111-111111111111', rimuovi: true }],
      })
    ).toThrow()
  })
})

describe('applicaModificheAllaProposta', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const riga = (o: Partial<RigaPropostaVista> = {}): RigaPropostaVista => ({
    rigaAddebitoId: id,
    codiceIvaId: 'iva',
    ordine: 1,
    origine: 'PRINCIPALE',
    tipo: 'CER',
    descrizione: null,
    tipoQuantita: 'PESO_NETTO',
    unitaMisura: 'KG',
    quantita: '100',
    quantitaOrigine: 'DA_MOVIMENTO',
    prezzoSpeciale: false,
    prezzo: '1',
    sconto: null,
    prezzoManuale: false,
    aliquotaIva: '22',
    naturaIva: null,
    congelataIl: null,
    importo: '100',
    ...o,
  })
  const proposta = (righe: RigaPropostaVista[], motivi: PropostaVista['motivi'] = []) =>
    ({
      fatturabile: true,
      attiva: true,
      stato: motivi.length ? 'DA_COLLEGARE' : 'PROPOSTO',
      cliente: { id: 'c', etichetta: 'C', fonte: 'FIR' },
      dettaglioCliente: null,
      contratto: { id: 'k', etichetta: 'K' },
      elenco: { id: 'e', etichetta: 'E' },
      righe,
      motivi,
      avvisi: [],
      candidati: { contratti: [], elenchi: [], righe: [] },
    }) as PropostaVista

  it('senza modifiche: la stessa proposta', () => {
    const p = proposta([riga()])
    expect(applicaModificheAllaProposta(p, validaModifiche(undefined))).toBe(p)
  })

  it('quantità e prezzo a mano: MANUALE, avviso PREZZO_MANUALE, importo ricalcolato', () => {
    const m = validaModifiche({ righe: [{ rigaAddebitoId: id, quantita: '2.5', prezzo: '12.5' }] })
    const p = applicaModificheAllaProposta(proposta([riga()]), m)
    expect(p.righe[0]).toMatchObject({
      quantita: '2.5',
      quantitaOrigine: 'MANUALE',
      prezzo: '12.5',
      prezzoManuale: true,
      importo: '31.25',
    })
    expect(p.avvisi).toEqual(['PREZZO_MANUALE'])
    expect(p.stato).toBe('PROPOSTO')
  })

  it('una quantità a mano toglie SENZA_QUANTITA e una proposta incompleta diventa completa', () => {
    const p0 = proposta(
      [riga({ quantita: null, quantitaOrigine: null, importo: null })],
      ['SENZA_QUANTITA']
    )
    const m = validaModifiche({ righe: [{ rigaAddebitoId: id, quantita: '3' }] })
    const p = applicaModificheAllaProposta(p0, m)
    expect(p.motivi).toEqual([])
    expect(p.stato).toBe('PROPOSTO')
  })

  it('riga non nella proposta: 400', () => {
    const m = validaModifiche({
      righe: [{ rigaAddebitoId: '22222222-2222-4222-8222-222222222222', quantita: '1' }],
    })
    expect(() => applicaModificheAllaProposta(proposta([riga()]), m)).toThrow()
  })
})
