/**
 * ElaborazioniController (4.4b1, Task 25a): ruoli di ogni rotta (spec §12) e passaggio intatto
 * del valore dei servizi. Niente Postgres: i servizi sono finti.
 */
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { CedenteController } from './cedente.controller'
import { DocumentiFatturaController } from './documenti-fattura.controller'
import { ElaborazioniController } from './elaborazioni.controller'
import { NumerazioniController } from './numerazioni.controller'
import { ScostamentiController } from './scostamenti.controller'

const AMMINISTRATORI = ['SUPER_ADMIN', 'ADMIN']
const SCRITTURA = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR']
const LETTURA = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER']

const TENANT = '5a5a5a5a-0000-4000-8000-000000000002'
const UTENTE = 'utente-1'
const ID = '6b6b6b6b-0000-4000-8000-000000000003'
const DOC = '6b6b6b6b-0000-4000-8000-000000000004'
const req: any = { tenantId: TENANT, user: { id: UTENTE, tenantId: 'altro-tenant' } }

/** Metodi che sono rotte HTTP (hanno il metadato `method` di Nest). */
function rotte(controller: { prototype: object }): string[] {
  const proto = controller.prototype as Record<string, unknown>
  return Object.getOwnPropertyNames(proto).filter(
    n =>
      n !== 'constructor' &&
      typeof proto[n] === 'function' &&
      Reflect.getMetadata('method', proto[n] as object) !== undefined
  )
}

describe('ogni rotta ha @Roles esplicito', () => {
  const reflector = new Reflector()
  it.each([
    ['ElaborazioniController', ElaborazioniController],
    ['DocumentiFatturaController', DocumentiFatturaController],
    ['ScostamentiController', ScostamentiController],
    ['CedenteController', CedenteController],
    ['NumerazioniController', NumerazioniController],
  ])('%s', (_nome, controller) => {
    const elenco = rotte(controller)
    expect(elenco.length).toBeGreaterThan(0)
    for (const nome of elenco) {
      const ruoli = reflector.get<string[]>(
        ROLES_KEY,
        (controller.prototype as unknown as Record<string, never>)[nome]
      )
      expect([nome, Array.isArray(ruoli) && ruoli.length > 0]).toEqual([nome, true])
    }
  })
})

describe('ElaborazioniController', () => {
  const reflector = new Reflector()
  const proto = ElaborazioniController.prototype as any
  const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

  it('rotte e ruoli (§12): lettura a tutti, preparare agli operatori, definitiva agli amministratori', () => {
    expect(rotte(ElaborazioniController).sort()).toEqual(
      [
        'avvia',
        'lista',
        'dettaglio',
        'documenti',
        'ricalcola',
        'scarta',
        'escludi',
        'riammetti',
        'definitiva',
      ].sort()
    )
    for (const n of ['lista', 'dettaglio', 'documenti']) expect([n, ruoli(n)]).toEqual([n, LETTURA])
    for (const n of ['avvia', 'ricalcola', 'scarta', 'escludi', 'riammetti']) {
      expect([n, ruoli(n)]).toEqual([n, SCRITTURA])
    }
    expect(ruoli('definitiva')).toEqual(AMMINISTRATORI)
  })

  describe('passaggio dei valori', () => {
    let s: Record<string, jest.Mock>
    let c: ElaborazioniController
    beforeEach(() => {
      s = {
        avvia: jest.fn().mockResolvedValue({ id: ID }),
        lista: jest.fn().mockResolvedValue({ elementi: [], totale: 0, pagina: 1, dimensione: 50 }),
        dettaglio: jest.fn().mockResolvedValue({ id: ID, extra: 1 }),
        documenti: jest
          .fn()
          .mockResolvedValue({ elementi: [], totale: 0, pagina: 1, dimensione: 5 }),
        ricalcola: jest.fn().mockResolvedValue(undefined),
        scarta: jest.fn().mockResolvedValue({ id: ID }),
        escludi: jest.fn().mockResolvedValue({ id: DOC }),
        chiediDefinitiva: jest.fn().mockResolvedValue({ id: ID }),
      }
      c = new ElaborazioniController(s as never)
    })

    it('l`azienda e` quella selezionata, mai quella del token', async () => {
      await c.dettaglio(req, { id: ID })
      expect(s.dettaglio).toHaveBeenCalledWith(TENANT, ID)
    })

    it('avvia passa utente e parametri; risponde il valore del servizio', async () => {
      const dto: any = { periodoDal: '2026-01-01' }
      expect(await c.avvia(req, dto)).toEqual({ id: ID })
      expect(s.avvia).toHaveBeenCalledWith(TENANT, UTENTE, dto)
    })

    it('dettaglio restituisce il valore del servizio senza aggiungere ne togliere chiavi', async () => {
      expect(await c.dettaglio(req, { id: ID })).toEqual({ id: ID, extra: 1 })
    })

    it('ricalcola risponde { id } (il servizio non restituisce nulla)', async () => {
      expect(await c.ricalcola(req, { id: ID }, { versione: 3 })).toEqual({ id: ID })
      expect(s.ricalcola).toHaveBeenCalledWith(TENANT, UTENTE, ID, 3)
    })

    it('scarta, escludi, riammetti, definitiva', async () => {
      expect(await c.scarta(req, { id: ID }, { versione: 2 })).toEqual({ id: ID })
      expect(s.scarta).toHaveBeenCalledWith(TENANT, UTENTE, ID, 2)
      await c.escludi(req, { id: ID, documentoId: DOC })
      expect(s.escludi).toHaveBeenLastCalledWith(TENANT, ID, DOC, true)
      await c.riammetti(req, { id: ID, documentoId: DOC })
      expect(s.escludi).toHaveBeenLastCalledWith(TENANT, ID, DOC, false)
      await c.definitiva(req, { id: ID }, { impronta: 'a'.repeat(64), versione: 4 })
      expect(s.chiediDefinitiva).toHaveBeenCalledWith(TENANT, UTENTE, ID, {
        impronta: 'a'.repeat(64),
        versione: 4,
      })
    })
  })
})

describe('FatturazioneModule (scansione P43)', () => {
  it('registra i tre controller e i servizi dei Task 20 e 21 una volta sola', async () => {
    const { FatturazioneModule } = await import('./fatturazione.module')
    const { AnnulloStornoService } = await import(
      '../../application/fatturazione/annullo-storno.service'
    )
    const { ScostamentiService } = await import(
      '../../application/fatturazione/scostamenti.service'
    )
    const controllers = Reflect.getMetadata('controllers', FatturazioneModule) as unknown[]
    expect(controllers).toEqual(
      expect.arrayContaining([
        ElaborazioniController,
        DocumentiFatturaController,
        ScostamentiController,
      ])
    )
    const providers = Reflect.getMetadata('providers', FatturazioneModule) as unknown[]
    expect(providers.filter(p => p === AnnulloStornoService)).toHaveLength(1)
    expect(providers.filter(p => p === ScostamentiService)).toHaveLength(1)
  })
})
