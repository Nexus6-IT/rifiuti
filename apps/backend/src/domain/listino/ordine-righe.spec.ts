import { ordinaRigheListino, type RigaOrdinabile } from './ordine-righe'

const r = (id: string, tipo: string, codice: string | null, riferimento: string | null = null) =>
  ({
    id,
    tipo,
    cerCode: tipo === 'CER' ? codice : null,
    addebito: tipo === 'CER' || codice === null ? null : { codice },
    riferimento,
  }) satisfies RigaOrdinabile

describe('ordinaRigheListino (come riempitavola: ORDER BY TIPO, addeb)', () => {
  it('prima il tipo di riga, poi il CER o il codice dell’addebito', () => {
    const righe = [
      r('1', 'V', '00020'),
      r('2', 'CER', '20 03 01'),
      r('3', 'F', '00005'),
      r('4', 'CER', '15 01 01'),
      r('5', 'V', '00003'),
      r('6', '$A', '00009'),
    ]
    expect(ordinaRigheListino(righe).map(x => x.id)).toEqual(['6', '4', '2', '3', '5', '1'])
  })

  it('a parità decide il riferimento, poi l’id; la lista di partenza non cambia', () => {
    const righe = [
      r('b', 'CER', '20 03 01', '2'),
      r('a', 'CER', '20 03 01', '2'),
      r('c', 'CER', '20 03 01', null),
    ]
    expect(ordinaRigheListino(righe).map(x => x.id)).toEqual(['c', 'a', 'b'])
    expect(righe.map(x => x.id)).toEqual(['b', 'a', 'c'])
  })

  it('un CER pericoloso con asterisco segue quello senza', () => {
    const righe = [r('2', 'CER', '16 01 21*'), r('1', 'CER', '16 01 21')]
    expect(ordinaRigheListino(righe).map(x => x.id)).toEqual(['1', '2'])
  })
})
