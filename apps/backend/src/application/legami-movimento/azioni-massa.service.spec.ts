import { HttpException } from '@nestjs/common'
import { MOTIVO_ESCLUSIONE_DATA } from '../../domain/legami-movimento/codici'
import {
  MAX_ELEMENTI_AZIONE_MASSA,
  validaRichiestaAzioneMassa,
  type RichiestaAzioneMassa,
} from './azioni-massa.service'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const elementi = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ legameId: uuid(i + 1), versione: 1 }))

function codice(r: unknown): string | undefined {
  try {
    validaRichiestaAzioneMassa(r as RichiestaAzioneMassa)
  } catch (e) {
    if (e instanceof HttpException) {
      expect(e.getStatus()).toBe(400)
      return (e.getResponse() as { error: string }).error
    }
    throw e
  }
  return undefined
}

describe('validaRichiestaAzioneMassa', () => {
  it('accetta da 1 a 500 elementi e porta il motivo senza spazi ai bordi', () => {
    expect(
      validaRichiestaAzioneMassa({ azione: 'CONFERMA', elementi: elementi(1) }).motivo
    ).toBeNull()
    const r = validaRichiestaAzioneMassa({
      azione: 'ESCLUDI',
      motivo: '  Conto lavoro ',
      elementi: elementi(MAX_ELEMENTI_AZIONE_MASSA),
    })
    expect(r.motivo).toBe('Conto lavoro')
    expect(r.elementi).toHaveLength(500)
  })

  it('CONFERMA ignora il motivo (anche se non valido)', () => {
    expect(
      validaRichiestaAzioneMassa({ azione: 'CONFERMA', motivo: '', elementi: elementi(2) }).motivo
    ).toBeNull()
  })

  it.each([
    ['azione ignota', { azione: 'ALTRO', elementi: elementi(1) }, 'AZIONE_NON_VALIDA'],
    ['senza corpo', undefined, 'AZIONE_NON_VALIDA'],
    ['nessun elemento', { azione: 'CONFERMA', elementi: [] }, 'ELEMENTI_NON_VALIDI'],
    ['elementi non lista', { azione: 'CONFERMA', elementi: 'x' }, 'ELEMENTI_NON_VALIDI'],
    ['501 elementi', { azione: 'CONFERMA', elementi: elementi(501) }, 'TROPPI_ELEMENTI'],
    [
      'id non valido',
      { azione: 'CONFERMA', elementi: [{ legameId: 'x', versione: 1 }] },
      'ELEMENTO_NON_VALIDO',
    ],
    [
      'versione non intera',
      { azione: 'CONFERMA', elementi: [{ legameId: uuid(1), versione: 1.5 }] },
      'ELEMENTO_NON_VALIDO',
    ],
    [
      'versione come stringa',
      { azione: 'CONFERMA', elementi: [{ legameId: uuid(1), versione: '1' }] },
      'ELEMENTO_NON_VALIDO',
    ],
    [
      'doppione',
      {
        azione: 'CONFERMA',
        elementi: [
          { legameId: uuid(1), versione: 1 },
          { legameId: uuid(1), versione: 2 },
        ],
      },
      'ELEMENTO_DUPLICATO',
    ],
    [
      'ESCLUDI senza motivo',
      { azione: 'ESCLUDI', elementi: elementi(1) },
      'MOTIVO_ESCLUSIONE_NON_VALIDO',
    ],
    [
      'ESCLUDI con motivo vuoto',
      { azione: 'ESCLUDI', motivo: '   ', elementi: elementi(1) },
      'MOTIVO_ESCLUSIONE_NON_VALIDO',
    ],
    [
      'ESCLUDI con motivo oltre 200 caratteri',
      { azione: 'ESCLUDI', motivo: 'a'.repeat(201), elementi: elementi(1) },
      'MOTIVO_ESCLUSIONE_NON_VALIDO',
    ],
    [
      'ESCLUDI con il testo di un motivo automatico',
      { azione: 'ESCLUDI', motivo: MOTIVO_ESCLUSIONE_DATA, elementi: elementi(1) },
      'MOTIVO_ESCLUSIONE_NON_VALIDO',
    ],
  ])('400: %s', (_nome, richiesta, atteso) => {
    expect(codice(richiesta)).toBe(atteso)
  })
})
