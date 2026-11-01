import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import {
  CreaCondizionePagamentoDto,
  ModificaCondizionePagamentoDto,
} from './condizione-pagamento.dto'
import { CreaTestoFatturazioneDto, ModificaTestoFatturazioneDto } from './testo-fatturazione.dto'

async function messaggi<T extends object>(
  classe: new () => T,
  corpo: object,
  campo: string
): Promise<string[]> {
  const errori = await validate(plainToInstance(classe, corpo))
  return errori.filter(e => e.property === campo).flatMap(e => Object.values(e.constraints ?? {}))
}

describe('messaggi in italiano sugli array dei DTO clienti', () => {
  const condizione = { codice: 'RD', descrizione: 'Rimessa', modalita: 'BONIFICO', fineMese: false }

  it('condizione: giorniRate vuoto risponde in italiano (crea e modifica)', async () => {
    for (const classe of [CreaCondizionePagamentoDto, ModificaCondizionePagamentoDto]) {
      const m = await messaggi(
        classe as new () => object,
        { ...condizione, giorniRate: [] },
        'giorniRate'
      )
      expect(m.join(' ')).toContain('Indicare almeno una rata')
      expect(m.join(' ')).not.toMatch(/must contain/i)
    }
  })

  it('condizione: più di 8 rate risponde in italiano', async () => {
    const m = await messaggi(
      CreaCondizionePagamentoDto,
      { ...condizione, giorniRate: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
      'giorniRate'
    )
    expect(m.join(' ')).toContain('al massimo 8')
  })

  it('testo: righe vuote o oltre 16 rispondono in italiano (crea e modifica)', async () => {
    for (const classe of [CreaTestoFatturazioneDto, ModificaTestoFatturazioneDto]) {
      const vuote = await messaggi(
        classe as new () => object,
        { codice: 'AB', titolo: 'T', righe: [] },
        'righe'
      )
      expect(vuote.join(' ')).toContain('almeno una riga')
      const troppe = await messaggi(
        classe as new () => object,
        { codice: 'AB', titolo: 'T', righe: Array.from({ length: 17 }, () => 'x') },
        'righe'
      )
      expect(troppe.join(' ')).toContain('al massimo 16')
    }
  })
})
