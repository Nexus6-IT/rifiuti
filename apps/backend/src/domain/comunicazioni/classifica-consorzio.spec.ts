import {
  CONSORZI,
  classificaConsorzi,
  normalizzaCerRegola,
  regoleEfficaci,
  type MovimentoDaClassificare,
  type RegolaConsorzioDef,
} from './classifica-consorzio'
import { REGOLE_CONSORZIO_DI_SISTEMA } from './regole-consorzio-sistema'

const mov = (o: Partial<MovimentoDaClassificare> = {}): MovimentoDaClassificare => ({
  radiceId: 'm1',
  registroId: 'r1',
  verso: 'CARICO',
  cer: '13 02 05*',
  causale: 'INGRESSO_ESTERNO',
  giorno: '2026-06-15',
  ...o,
})

const regola = (o: Partial<RegolaConsorzioDef> = {}): RegolaConsorzioDef => ({
  id: 'g1',
  consorzio: 'CONOU',
  verso: null,
  cerPrefisso: '13',
  cerEsatto: null,
  causaleCodice: null,
  registroId: null,
  attiva: true,
  validaDal: '2026-01-01',
  ...o,
})

describe('classificaConsorzi', () => {
  it('marca il movimento il cui CER comincia col prefisso della regola', () => {
    const esito = classificaConsorzi(mov(), [regola()], [])
    expect(esito.marcature).toEqual([{ consorzio: 'CONOU', origine: 'REGOLA', regolaId: 'g1' }])
    expect(esito.esclusi).toEqual([])
  })

  it('confronta le sole cifre del CER, con o senza spazi e asterisco', () => {
    for (const cer of ['130205', '13 02 05*', '13.02.05']) {
      expect(classificaConsorzi(mov({ cer }), [regola()], []).marcature).toHaveLength(1)
    }
  })

  it('non marca un CER di un altro capitolo, e un prefisso non e un confronto a meta cifra', () => {
    expect(classificaConsorzi(mov({ cer: '16 01 03' }), [regola()], []).marcature).toEqual([])
    expect(
      classificaConsorzi(mov({ cer: '13 02 05*' }), [regola({ cerPrefisso: '1302' })], []).marcature
    ).toHaveLength(1)
    expect(
      classificaConsorzi(mov({ cer: '13 03 05*' }), [regola({ cerPrefisso: '1302' })], []).marcature
    ).toEqual([])
  })

  it('il CER esatto vuole tutte e sei le cifre', () => {
    const r = regola({ consorzio: 'COBAT', cerPrefisso: null, cerEsatto: '160601' })
    expect(classificaConsorzi(mov({ cer: '16 06 01*' }), [r], []).marcature[0].consorzio).toBe(
      'COBAT'
    )
    expect(classificaConsorzi(mov({ cer: '16 06 02*' }), [r], []).marcature).toEqual([])
  })

  it('verso, causale e registro, se indicati, restringono la regola', () => {
    expect(
      classificaConsorzi(mov({ verso: 'SCARICO' }), [regola({ verso: 'CARICO' })], []).marcature
    ).toEqual([])
    expect(
      classificaConsorzi(mov({ verso: 'CARICO' }), [regola({ verso: 'CARICO' })], []).marcature
    ).toHaveLength(1)
    expect(
      classificaConsorzi(mov(), [regola({ causaleCodice: 'RACCOLTA' })], []).marcature
    ).toEqual([])
    expect(
      classificaConsorzi(mov({ causale: 'RACCOLTA' }), [regola({ causaleCodice: 'RACCOLTA' })], [])
        .marcature
    ).toHaveLength(1)
    expect(classificaConsorzi(mov(), [regola({ registroId: 'r2' })], []).marcature).toEqual([])
    expect(classificaConsorzi(mov(), [regola({ registroId: 'r1' })], []).marcature).toHaveLength(1)
  })

  it('una regola disattiva o non ancora valida non marca', () => {
    expect(classificaConsorzi(mov(), [regola({ attiva: false })], []).marcature).toEqual([])
    expect(classificaConsorzi(mov({ giorno: '2025-12-31' }), [regola()], []).marcature).toEqual([])
    expect(
      classificaConsorzi(mov({ giorno: '2026-01-01' }), [regola()], []).marcature
    ).toHaveLength(1)
  })

  it('piu regole dello stesso consorzio danno una sola marcatura (la prima)', () => {
    const esito = classificaConsorzi(
      mov(),
      [regola({ id: 'a' }), regola({ id: 'b', cerPrefisso: '1302' })],
      []
    )
    expect(esito.marcature).toEqual([{ consorzio: 'CONOU', origine: 'REGOLA', regolaId: 'a' }])
  })

  it('l override manuale marca anche senza regola', () => {
    const esito = classificaConsorzi(
      mov({ cer: '20 01 01' }),
      [],
      [{ consorzio: 'COREPLA', escluso: false }]
    )
    expect(esito.marcature).toEqual([{ consorzio: 'COREPLA', origine: 'MANUALE' }])
  })

  it('l esclusione manuale toglie il movimento anche se la regola lo prende, e lo dichiara', () => {
    const esito = classificaConsorzi(mov(), [regola()], [{ consorzio: 'CONOU', escluso: true }])
    expect(esito.marcature).toEqual([])
    expect(esito.esclusi).toEqual(['CONOU'])
  })

  it('un override di un consorzio non tocca gli altri', () => {
    const regole = [regola(), regola({ id: 'c', consorzio: 'COBAT', cerPrefisso: '13' })]
    const esito = classificaConsorzi(mov(), regole, [{ consorzio: 'COBAT', escluso: true }])
    expect(esito.marcature.map(m => m.consorzio)).toEqual(['CONOU'])
  })

  it('non muta gli argomenti ed e deterministica nell ordine dei consorzi', () => {
    const regole = [regola({ id: 'c', consorzio: 'COBAT' }), regola()]
    const copia = JSON.stringify(regole)
    const esito = classificaConsorzi(mov(), regole, [])
    expect(JSON.stringify(regole)).toBe(copia)
    expect(esito.marcature.map(m => m.consorzio)).toEqual(['CONOU', 'COBAT'])
    expect(CONSORZI).toEqual(['CONOU', 'COBAT', 'COREPLA'])
  })
})

describe('regoleEfficaci e regole di sistema', () => {
  it('le regole di sistema sono CONOU 13 xx xx, COBAT 16 06 01* e 20 01 33*', () => {
    expect(REGOLE_CONSORZIO_DI_SISTEMA.map(r => [r.consorzio, r.cerPrefisso, r.cerEsatto])).toEqual(
      [
        ['CONOU', '13', null],
        ['COBAT', null, '160601'],
        ['COBAT', null, '200133'],
      ]
    )
  })

  it('un consorzio senza regole dell azienda usa quelle di sistema', () => {
    const efficaci = regoleEfficaci([], REGOLE_CONSORZIO_DI_SISTEMA)
    expect(efficaci).toHaveLength(3)
    expect(classificaConsorzi(mov(), efficaci, []).marcature[0].consorzio).toBe('CONOU')
    expect(classificaConsorzi(mov({ cer: '16 06 01*' }), efficaci, []).marcature[0].consorzio).toBe(
      'COBAT'
    )
    expect(classificaConsorzi(mov({ cer: '20 01 33*' }), efficaci, []).marcature[0].consorzio).toBe(
      'COBAT'
    )
  })

  it('le regole dell azienda per un consorzio sostituiscono quelle di sistema di quel consorzio, anche se disattive', () => {
    const propria = regola({
      id: 'x',
      consorzio: 'CONOU',
      cerPrefisso: null,
      cerEsatto: '130205',
      attiva: false,
    })
    const efficaci = regoleEfficaci([propria], REGOLE_CONSORZIO_DI_SISTEMA)
    expect(efficaci.filter(r => r.consorzio === 'CONOU')).toEqual([propria])
    expect(efficaci.filter(r => r.consorzio === 'COBAT')).toHaveLength(2)
    expect(classificaConsorzi(mov(), efficaci, []).marcature).toEqual([])
  })
})

describe('normalizzaCerRegola', () => {
  it('2 o 4 cifre sono un prefisso, 6 cifre un codice esatto, qualunque sia la forma scritta', () => {
    expect(normalizzaCerRegola('13')).toEqual({ cerPrefisso: '13', cerEsatto: null })
    expect(normalizzaCerRegola('13 xx xx')).toEqual({
      cerPrefisso: '13',
      cerEsatto: null,
    })
    expect(normalizzaCerRegola('16 06')).toEqual({ cerPrefisso: '1606', cerEsatto: null })
    expect(normalizzaCerRegola('16 06 01*')).toEqual({ cerPrefisso: null, cerEsatto: '160601' })
    expect(normalizzaCerRegola(' 200133 ')).toEqual({ cerPrefisso: null, cerEsatto: '200133' })
  })

  it('rifiuta lunghezze diverse da 2, 4 e 6 cifre e il testo senza cifre', () => {
    for (const t of ['', '1', '131', '13020', '1302051', 'abc']) {
      expect(normalizzaCerRegola(t)).toBeNull()
    }
  })
})
