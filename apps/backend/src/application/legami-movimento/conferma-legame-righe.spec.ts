import { BadRequestException, ConflictException } from '@nestjs/common'
import {
  applicaModificheRighe,
  fondiRighe,
  validaModifiche,
  type RigaMem,
} from './conferma-legame-righe'
import type { RigaPropostaVista } from './proposta-legame.service'

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const IVA = '33333333-3333-4333-8333-333333333333'

const riga = (o: Partial<RigaMem> = {}): RigaMem => ({
  id: 'id-' + (o.rigaAddebitoId ?? R1),
  rigaAddebitoId: R1,
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
  codiceIvaId: IVA,
  aliquotaIva: '22',
  naturaIva: null,
  congelata: false,
  ...o,
})

const proposta = (o: Partial<RigaPropostaVista> = {}): RigaPropostaVista => ({
  rigaAddebitoId: R1,
  codiceIvaId: IVA,
  ordine: 1,
  origine: 'PRINCIPALE',
  tipo: 'CER',
  descrizione: null,
  tipoQuantita: 'PESO_NETTO',
  unitaMisura: 'KG',
  quantita: '100',
  quantitaOrigine: 'DA_MOVIMENTO',
  prezzoSpeciale: false,
  prezzo: '2',
  sconto: null,
  prezzoManuale: false,
  aliquotaIva: '22',
  naturaIva: null,
  congelataIl: null,
  importo: null,
  ...o,
})

describe('validaModifiche', () => {
  it('senza modifiche: nessuna riga', () => {
    expect(validaModifiche(undefined).righe.size).toBe(0)
    expect(validaModifiche({}).righe.size).toBe(0)
  })

  it('normalizza i numeri (zeri iniziali, zeri finali) e accetta lo zero del prezzo', () => {
    const m = validaModifiche({
      righe: [{ rigaAddebitoId: R1, quantita: '007.50', prezzo: '0', sconto: '10+5' }],
    })
    expect(m.righe.get(R1)).toEqual({
      quantita: '7.5',
      prezzo: '0',
      sconto: '10+5',
      rimuovi: false,
    })
  })

  it('quantita null e sconto null restano null (togliere), undefined resta assente', () => {
    const m = validaModifiche({ righe: [{ rigaAddebitoId: R1, quantita: null, sconto: null }] })
    expect(m.righe.get(R1)).toEqual({ quantita: null, sconto: null, rimuovi: false })
  })

  it.each([
    ['quantita 0', { quantita: '0' }, 'QUANTITA_NON_VALIDA'],
    ['quantita negativa', { quantita: '-1' }, 'QUANTITA_NON_VALIDA'],
    ['quantita con la virgola', { quantita: '1,5' }, 'QUANTITA_NON_VALIDA'],
    ['quantita con 4 decimali', { quantita: '1.2345' }, 'QUANTITA_NON_VALIDA'],
    ['prezzo negativo', { prezzo: '-1' }, 'PREZZO_NON_VALIDO'],
    ['prezzo con 7 decimali', { prezzo: '1.1234567' }, 'PREZZO_NON_VALIDO'],
    ['prezzo numero JSON', { prezzo: 5 as unknown as string }, 'PREZZO_NON_VALIDO'],
    ['sconto non valido', { sconto: 'abc' }, 'SCONTO_NON_VALIDO'],
    ['riga da togliere con altre modifiche', { rimuovi: true, prezzo: '1' }, 'RIGA_NON_VALIDA'],
  ])('%s: 400 %s', (_n, mod, codice) => {
    try {
      validaModifiche({ righe: [{ rigaAddebitoId: R1, ...mod }] })
      throw new Error('doveva fallire')
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException)
      expect((e as BadRequestException).getResponse()).toMatchObject({ error: codice })
    }
  })

  it('id non validi o righe duplicate: 400', () => {
    expect(() => validaModifiche({ clienteId: 'x' })).toThrow(BadRequestException)
    expect(() => validaModifiche({ righe: [{ rigaAddebitoId: 'x' }] })).toThrow(BadRequestException)
    expect(() =>
      validaModifiche({ righe: [{ rigaAddebitoId: R1 }, { rigaAddebitoId: R1 }] })
    ).toThrow(BadRequestException)
  })
})

describe('fondiRighe', () => {
  const opz = { stessoElenco: true, riderivaQuantita: new Set<string>() }

  it('con un elenco diverso le righe sono tutte nuove (prezzi manuali persi)', () => {
    const r = fondiRighe([riga({ prezzoManuale: true, prezzo: '9' })], [proposta()], {
      ...opz,
      stessoElenco: false,
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: null, prezzo: '2', prezzoManuale: false })
  })

  it('stesso elenco: una riga non manuale e non congelata si riallinea al listino', () => {
    const r = fondiRighe([riga({ prezzo: '1' })], [proposta({ prezzo: '2' })], opz)
    expect(r[0]).toMatchObject({ id: 'id-' + R1, prezzo: '2', prezzoManuale: false })
  })

  it('stesso elenco: prezzo manuale e valori congelati non si sovrascrivono', () => {
    const manuale = fondiRighe([riga({ prezzoManuale: true, prezzo: '9' })], [proposta()], opz)
    expect(manuale[0]).toMatchObject({ prezzo: '9', prezzoManuale: true })
    const congelata = fondiRighe([riga({ congelata: true, prezzo: '7' })], [proposta()], opz)
    expect(congelata[0]).toMatchObject({ prezzo: '7', congelata: true })
  })

  it('la quantita MANUALE resta, quella derivata segue il movimento, salvo richiesta esplicita', () => {
    const manuale = riga({ quantita: '12.5', quantitaOrigine: 'MANUALE' })
    expect(fondiRighe([manuale], [proposta({ quantita: '100' })], opz)[0]).toMatchObject({
      quantita: '12.5',
      quantitaOrigine: 'MANUALE',
    })
    expect(
      fondiRighe([manuale], [proposta({ quantita: '100' })], {
        ...opz,
        riderivaQuantita: new Set([R1]),
      })[0]
    ).toMatchObject({ quantita: '100', quantitaOrigine: 'DA_MOVIMENTO' })
    expect(
      fondiRighe([riga({ quantita: '999' })], [proposta({ quantita: '100' })], opz)[0].quantita
    ).toBe('100')
  })

  it('una proposta senza righe (elenco scaduto) lascia le righe com’erano; una riga assente e nuova', () => {
    const esistenti = [riga()]
    expect(fondiRighe(esistenti, [], opz)).toEqual(esistenti)
    const r = fondiRighe(esistenti, [proposta(), proposta({ rigaAddebitoId: R2, ordine: 2 })], opz)
    expect(r.map(x => x.id)).toEqual(['id-' + R1, null])
  })

  it('una riga tolta dalla selezione non c’e piu', () => {
    const r = fondiRighe([riga(), riga({ rigaAddebitoId: R2, id: 'id-2' })], [proposta()], opz)
    expect(r.map(x => x.rigaAddebitoId)).toEqual([R1])
  })
})

describe('applicaModificheRighe', () => {
  const mods = (m: Parameters<typeof validaModifiche>[0]) => validaModifiche(m)

  it('quantita manuale: origine MANUALE e cambio registrato', () => {
    const { righe, cambi } = applicaModificheRighe(
      [riga()],
      mods({ righe: [{ rigaAddebitoId: R1, quantita: '12.5' }] }),
      'PROPOSTO'
    )
    expect(righe[0]).toMatchObject({ quantita: '12.5', quantitaOrigine: 'MANUALE' })
    expect(cambi).toEqual([{ rigaAddebitoId: R1, quantita: { prima: '100', dopo: '12.5' } }])
  })

  it('prezzo e sconto: prezzo_manuale, cambi prima/dopo', () => {
    const { righe, cambi } = applicaModificheRighe(
      [riga()],
      mods({ righe: [{ rigaAddebitoId: R1, prezzo: '12.5', sconto: '10' }] }),
      'CONFERMATO'
    )
    expect(righe[0]).toMatchObject({ prezzo: '12.5', sconto: '10', prezzoManuale: true })
    expect(cambi[0]).toMatchObject({
      prezzo: { prima: '1', dopo: '12.5' },
      sconto: { prima: null, dopo: '10' },
    })
  })

  it('riga a prezzo speciale: 400 PREZZO_SPECIALE_NON_MODIFICABILE', () => {
    expect(() =>
      applicaModificheRighe(
        [riga({ prezzoSpeciale: true, prezzo: null })],
        mods({ righe: [{ rigaAddebitoId: R1, prezzo: '3' }] }),
        'PROPOSTO'
      )
    ).toThrow(BadRequestException)
  })

  it('stato non modificabile: 409; sconto da solo su riga senza prezzo: 400', () => {
    expect(() =>
      applicaModificheRighe(
        [riga()],
        mods({ righe: [{ rigaAddebitoId: R1, prezzo: '3' }] }),
        'FATTURATO'
      )
    ).toThrow(ConflictException)
    expect(() =>
      applicaModificheRighe(
        [riga({ prezzo: null })],
        mods({ righe: [{ rigaAddebitoId: R1, sconto: '10' }] }),
        'PROPOSTO'
      )
    ).toThrow(BadRequestException)
  })

  it('le righe non nominate e le righe da togliere restano com’erano', () => {
    const { righe, cambi } = applicaModificheRighe(
      [riga(), riga({ rigaAddebitoId: R2 })],
      mods({ righe: [{ rigaAddebitoId: R2, rimuovi: true }] }),
      'PROPOSTO'
    )
    expect(righe).toHaveLength(2)
    expect(cambi).toEqual([])
  })
})
