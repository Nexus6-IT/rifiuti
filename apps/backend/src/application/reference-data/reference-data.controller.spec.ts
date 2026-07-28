import { ReferenceDataController } from './reference-data.controller'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

/**
 * I dati di riferimento sono manutenzione di piattaforma: dal 2026-07-28 sono
 * riservati al SUPER_ADMIN. Prima bastava un account qualsiasi per leggere
 * stato e ricerche.
 *
 * Questi controlli guardano i metadati del controller, non il sorgente a
 * occhio: nascondere la voce di menu e mettere un guard di rotta lato Angular
 * non protegge nulla: chiunque puo' chiamare l'API direttamente.
 */
describe('ReferenceDataController — autorizzazione', () => {
  const rolesDelControllore = () =>
    Reflect.getMetadata('roles', ReferenceDataController) as string[] | undefined

  const guardsDelControllore = () =>
    (Reflect.getMetadata('__guards__', ReferenceDataController) as unknown[]) ?? []

  it("l'intero controller è riservato al SUPER_ADMIN", () => {
    expect(rolesDelControllore()).toEqual(['SUPER_ADMIN'])
  })

  it('monta sia JwtAuthGuard sia RolesGuard (senza il secondo i ruoli non vengono applicati)', () => {
    const guards = guardsDelControllore()

    expect(guards).toContain(JwtAuthGuard)
    expect(guards).toContain(RolesGuard)
  })

  it.each(['status', 'searchComuni', 'searchAteco', 'searchNazioni', 'reseed'])(
    'il metodo %s non allenta i ruoli con un @Roles proprio',
    metodo => {
      const rolesDelMetodo = Reflect.getMetadata(
        'roles',
        (ReferenceDataController.prototype as unknown as Record<string, unknown>)[metodo] as object
      )

      // Nessun @Roles sul metodo => vale quello del controller. Se un giorno
      // qualcuno ne aggiunge uno piu' permissivo (es. includendo ADMIN),
      // questo test lo intercetta invece di lasciarlo passare inosservato.
      if (rolesDelMetodo !== undefined) {
        expect(rolesDelMetodo).toEqual(['SUPER_ADMIN'])
      }
    }
  )
})
