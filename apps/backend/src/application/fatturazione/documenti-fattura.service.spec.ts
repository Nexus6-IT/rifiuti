import { BadRequestException } from '@nestjs/common'
import { MESSAGGI_AVVISO, MESSAGGI_ERRORE } from '../../domain/fatturazione/codici'
import { annullabilita, DocumentiFatturaService } from './documenti-fattura.service'

const base = {
  stato: 'DEFINITIVO' as const,
  tipoDocumento: 'TD01',
  emessoIl: null,
  numero: 5,
  ultimoNumero: 5,
  haStorno: false,
}

describe('annullabilita (funzione pura, ordine di Q9)', () => {
  it('DEFINITIVO ultimo non emesso senza storno: annullabile', () => {
    expect(annullabilita(base)).toEqual({ annullabile: true, motivo: null })
  })
  it('numero intermedio: NON_ULTIMO', () => {
    expect(annullabilita({ ...base, ultimoNumero: 6 })).toEqual({
      annullabile: false,
      motivo: 'NON_ULTIMO',
    })
  })
  it('emesso: EMESSO', () => {
    expect(annullabilita({ ...base, emessoIl: '2026-03-01T10:00:00.000Z' }).motivo).toBe('EMESSO')
  })
  it.each(['BOZZA', 'ANNULLATO'] as const)('%s: NON_DEFINITIVO', stato => {
    expect(annullabilita({ ...base, stato, numero: null })).toEqual({
      annullabile: false,
      motivo: 'NON_DEFINITIVO',
    })
  })
  it('TD04 ultimo non emesso: NOTA_DI_CREDITO', () => {
    expect(annullabilita({ ...base, tipoDocumento: 'TD04' }).motivo).toBe('NOTA_DI_CREDITO')
  })
  it('storno presente su un ultimo non emesso: STORNATO', () => {
    expect(annullabilita({ ...base, haStorno: true }).motivo).toBe('STORNATO')
  })
  it('emesso e stornato: STORNATO (viene prima di EMESSO)', () => {
    expect(
      annullabilita({ ...base, haStorno: true, emessoIl: '2026-03-01T10:00:00.000Z' }).motivo
    ).toBe('STORNATO')
  })
  it('TD04 anche non ultimo: NOTA_DI_CREDITO prima di NON_ULTIMO', () => {
    expect(annullabilita({ ...base, tipoDocumento: 'TD04', ultimoNumero: 9 }).motivo).toBe(
      'NOTA_DI_CREDITO'
    )
  })
  it('BOZZA con TD04 e storno: NON_DEFINITIVO per primo', () => {
    expect(
      annullabilita({ ...base, stato: 'BOZZA', tipoDocumento: 'TD04', haStorno: true }).motivo
    ).toBe('NON_DEFINITIVO')
  })
})

describe('DocumentiFatturaService: validazioni prima del database', () => {
  const servizio = new DocumentiFatturaService({
    $transaction: (fn: (tx: unknown) => unknown) => fn({}),
  } as never)
  const T = 'aaaaaaaa-0000-4000-8000-000000000001'

  it.each([
    { pagina: 0, dimensione: 25 },
    { pagina: 1, dimensione: 0 },
    { pagina: 1, dimensione: 101 },
    { pagina: 1.5, dimensione: 25 },
  ])('paginazione %j: 400', async p => {
    await expect(servizio.lista(T, p)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('data del filtro non valida: 400', async () => {
    await expect(
      servizio.lista(T, { pagina: 1, dimensione: 25, dataDa: '2026-02-30' })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('id di filtro non uuid: 400', async () => {
    await expect(
      servizio.lista(T, { pagina: 1, dimensione: 25, clienteId: 'x' })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('dettaglio con id non uuid: 404 senza toccare il database', async () => {
    await expect(servizio.dettaglio(T, 'non-un-uuid')).rejects.toMatchObject({ status: 404 })
  })

  it('i messaggi delle segnalazioni coprono tutti i codici', () => {
    expect(Object.keys(MESSAGGI_ERRORE).length).toBeGreaterThan(18)
    expect(Object.keys(MESSAGGI_AVVISO)).toHaveLength(7)
  })
})
