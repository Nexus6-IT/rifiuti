import {
  snapshotProduttore,
  snapshotTrasportatore,
  snapshotDestinatario,
  snapshotTratta,
} from './snapshot-parti'
import { Produttore } from '../../domain/registry/entities/produttore'
import { Trasportatore } from '../../domain/registry/entities/trasportatore'
import { Destinatario } from '../../domain/registry/entities/destinatario'
import { PartitaIVA } from '../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'
import { TipoTratta } from '../../domain/fir/aggregates/fir.aggregate'

const indirizzo = Indirizzo.create({
  via: 'Via Roma',
  civico: '1',
  cap: '00100',
  citta: 'Roma',
  provincia: 'RM',
})
const base = { createdAt: new Date(), updatedAt: new Date() }

describe('snapshot-parti', () => {
  it('produttore: congela id, ragione sociale, partita IVA, indirizzo e contatto (PEC prima di email)', () => {
    const p = Produttore.reconstitute({
      id: 'p-1',
      ragioneSociale: 'Produttore SpA',
      dittaId: 'ditta-1',
      sedeId: 'sede-1',
      partitaIVA: PartitaIVA.create('12345678901'),
      sedeLegale: indirizzo,
      pec: 'prod@pec.it',
      email: 'prod@mail.it',
      ...base,
    })
    expect(snapshotProduttore(p)).toEqual({
      registroId: 'p-1',
      ragioneSociale: 'Produttore SpA',
      partitaIva: '12345678901',
      indirizzo: indirizzo.getFormatted(),
      contatto: 'prod@pec.it',
    })
  })

  it('produttore: senza PEC né email il contatto è undefined', () => {
    const p = Produttore.reconstitute({
      id: 'p-2',
      ragioneSociale: 'Produttore SpA',
      dittaId: 'ditta-1',
      sedeId: 'sede-1',
      partitaIVA: PartitaIVA.create('12345678901'),
      sedeLegale: indirizzo,
      ...base,
    })
    expect(snapshotProduttore(p).contatto).toBeUndefined()
  })

  it('trasportatore e tratta: stessi dati anagrafici, la tratta aggiunge ordine, tipo e albo', () => {
    const t = Trasportatore.reconstitute({
      id: 't-1',
      ragioneSociale: 'Trasporti Srl',
      dittaId: 'ditta-1',
      sedeId: 'sede-1',
      partitaIVA: PartitaIVA.create('22345678901'),
      sedeLegale: indirizzo,
      numeroIscrizione: 'ALBO-123',
      email: 'trasp@mail.it',
      ...base,
    })
    expect(snapshotTrasportatore(t)).toEqual({
      registroId: 't-1',
      ragioneSociale: 'Trasporti Srl',
      partitaIva: '22345678901',
      indirizzo: indirizzo.getFormatted(),
      contatto: 'trasp@mail.it',
    })
    expect(snapshotTratta(t, 2, TipoTratta.MARITTIMA)).toEqual({
      ordine: 2,
      tipoTratta: TipoTratta.MARITTIMA,
      trasportatoreId: 't-1',
      denominazione: 'Trasporti Srl',
      partitaIva: '22345678901',
      numeroIscrizioneAlbo: 'ALBO-123',
    })
  })

  it('destinatario: usa la sede', () => {
    const d = Destinatario.reconstitute({
      id: 'd-1',
      ragioneSociale: 'Impianto Srl',
      dittaId: 'ditta-1',
      sedeId: 'sede-1',
      partitaIVA: PartitaIVA.create('32345678901'),
      sede: indirizzo,
      numeroAutorizzazione: 'AUT-999',
      pec: 'imp@pec.it',
      ...base,
    })
    expect(snapshotDestinatario(d)).toEqual({
      registroId: 'd-1',
      ragioneSociale: 'Impianto Srl',
      partitaIva: '32345678901',
      indirizzo: indirizzo.getFormatted(),
      contatto: 'imp@pec.it',
    })
  })
})
