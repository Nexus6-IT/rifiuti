/**
 * DTO di creazione delle controparti (F2-10, D2): almeno uno fra partitaIVA e codiceFiscale.
 */
import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import {
  CreateDestinatarioDto,
  CreateProduttoreDto,
  CreateTrasportatoreDto,
} from './create-registry.dto'
import { CF_PERSONA_VALIDO, PIVA_VALIDA } from '../../../test-support/anagrafiche-di-test'

const sede = { via: 'Via Roma', civico: '1', cap: '00100', comune: 'Roma', provincia: 'RM' }

async function errori(
  classe: new () => object,
  extra: Record<string, unknown>,
  proprieta: string
): Promise<string[]> {
  const dto = plainToInstance(classe, {
    ragioneSociale: 'Ditta',
    ...(classe === CreateDestinatarioDto
      ? { sede, numeroAutorizzazione: 'A1' }
      : { sedeLegale: sede }),
    ...(classe === CreateTrasportatoreDto ? { numeroIscrizione: 'N1' } : {}),
    ...extra,
  })
  const e = await validate(dto)
  return e.filter(x => x.property === proprieta).flatMap(x => Object.values(x.constraints ?? {}))
}

describe.each([
  ['produttore', CreateProduttoreDto],
  ['trasportatore', CreateTrasportatoreDto],
  ['destinatario', CreateDestinatarioDto],
])('DTO di creazione del %s: almeno un identificativo fiscale', (_nome, classe) => {
  it('accetta la sola partita IVA', async () => {
    expect(await errori(classe, { partitaIVA: PIVA_VALIDA }, 'partitaIVA')).toEqual([])
  })

  it('accetta il solo codice fiscale', async () => {
    expect(await errori(classe, { codiceFiscale: CF_PERSONA_VALIDO }, 'partitaIVA')).toEqual([])
  })

  it('rifiuta la richiesta senza alcun identificativo, senza riportare valori', async () => {
    const e = await errori(classe, {}, 'partitaIVA')
    expect(e).toEqual(['Indica la partita IVA oppure il codice fiscale della ditta'])
  })

  it('rifiuta stringhe vuote e partita IVA non stringa', async () => {
    expect(
      await errori(classe, { partitaIVA: '  ', codiceFiscale: '' }, 'partitaIVA')
    ).toHaveLength(1)
    expect(await errori(classe, { partitaIVA: 12345678903 }, 'partitaIVA')).toHaveLength(1)
  })
})
