/**
 * Metadata dei ruoli dei due controller dei legami (4.3b, Task 22): ogni rotta pubblica ha
 * `@Roles` esplicito, con il gruppo di ruoli previsto dalla spec §9.
 */
import 'reflect-metadata'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { LegamiMovimentoController } from './legami-movimento.controller'
import { MovimentoLegameController } from './movimento-legame.controller'

const LETTURA = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER']
const SCRITTURA = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR']
const AMMINISTRATORI = ['SUPER_ADMIN', 'ADMIN']

const reflector = new Reflector()
const metodi = (c: { prototype: object }) =>
  Object.getOwnPropertyNames(c.prototype).filter(
    n => n !== 'constructor' && typeof (c.prototype as any)[n] === 'function'
  )
const ruoli = (c: { prototype: object }, n: string) =>
  reflector.get<string[]>(ROLES_KEY, (c.prototype as any)[n])

describe('LegamiMovimentoController: ruoli', () => {
  const C = LegamiMovimentoController

  it.each(['proposta', 'lista', 'contatori', 'contatoriPerContratto', 'dettaglio'])(
    '%s: lettura a tutti i ruoli',
    n => {
      expect(ruoli(C, n)).toEqual(LETTURA)
    }
  )

  it.each(['modifica', 'conferma', 'escludi', 'riammetti', 'azioni', 'daMovimento'])(
    '%s: scrittura senza VIEWER',
    n => {
      expect(ruoli(C, n)).toEqual(SCRITTURA)
    }
  )

  it('aggiornaPrezzi: solo amministratori', () => {
    expect(ruoli(C, 'aggiornaPrezzi')).toEqual(AMMINISTRATORI)
  })

  it('ogni rotta pubblica ha @Roles esplicito (nessuna dimenticata)', () => {
    expect(metodi(C).sort()).toEqual(
      [
        'aggiornaPrezzi',
        'azioni',
        'conferma',
        'contatori',
        'contatoriPerContratto',
        'daMovimento',
        'dettaglio',
        'escludi',
        'lista',
        'modifica',
        'proposta',
        'riammetti',
      ].sort()
    )
    for (const n of metodi(C)) expect(ruoli(C, n)?.length).toBeGreaterThan(0)
  })
})

describe('MovimentoLegameController: ruoli', () => {
  it('ogni rotta pubblica ha @Roles esplicito; il legame del movimento si legge a tutti', () => {
    const C = MovimentoLegameController
    expect(metodi(C)).toEqual(['legame'])
    expect(ruoli(C, 'legame')).toEqual(LETTURA)
  })
})
