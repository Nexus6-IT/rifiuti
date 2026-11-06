/**
 * DocumentiFatturaController (4.4b1, Task 25a): ruoli e passaggio intatto dei valori dei servizi.
 * `POST /:id/emesso`, XML, PDF ed export sono del Task 25b.
 */
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { DocumentiFatturaController } from './documenti-fattura.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000002'
const ID = '6b6b6b6b-0000-4000-8000-000000000003'
const req: any = { tenantId: TENANT, user: { id: 'utente-1', tenantId: 'altro-tenant' } }

describe('DocumentiFatturaController', () => {
  const reflector = new Reflector()
  const proto = DocumentiFatturaController.prototype as any
  const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

  it('lettura a tutti i ruoli, annullo e storno solo agli amministratori', () => {
    expect(ruoli('lista')).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    expect(ruoli('dettaglio')).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    expect(ruoli('annulla')).toEqual(['SUPER_ADMIN', 'ADMIN'])
    expect(ruoli('storno')).toEqual(['SUPER_ADMIN', 'ADMIN'])
  })

  it('passa tenant e utente e restituisce il valore del servizio', async () => {
    const documenti = { lista: jest.fn(), dettaglio: jest.fn().mockResolvedValue({ id: ID, x: 1 }) }
    const annullo = {
      annulla: jest.fn().mockResolvedValue({ id: ID, stato: 'ANNULLATO' }),
      storna: jest.fn().mockResolvedValue({ id: 'nuovo' }),
    }
    const c = new DocumentiFatturaController(documenti as never, annullo as never)
    expect(await c.dettaglio(req, { id: ID })).toEqual({ id: ID, x: 1 })
    expect(documenti.dettaglio).toHaveBeenCalledWith(TENANT, ID)
    expect(await c.annulla(req, { id: ID }, { motivo: 'errore', versione: 2 })).toEqual({
      id: ID,
      stato: 'ANNULLATO',
    })
    expect(annullo.annulla).toHaveBeenCalledWith(TENANT, 'utente-1', ID, {
      motivo: 'errore',
      versione: 2,
    })
    const corpo = {
      motivo: 'reso',
      dataDocumento: '2026-05-01',
      rifatturabile: true,
      versione: 2,
    }
    expect(await c.storno(req, { id: ID }, corpo)).toEqual({ id: 'nuovo' })
    expect(annullo.storna).toHaveBeenCalledWith(TENANT, 'utente-1', ID, corpo)
  })
})
