/**
 * Elenco delle rotte di recupero: sono le sole che rispondono con una selezione d'azienda
 * non più valida. Il test fissa l'elenco, così un'aggiunta o una rimozione è una scelta
 * visibile in review e non un effetto collaterale.
 */

import { Reflector } from '@nestjs/core'
import { CONSENTI_SELEZIONE_NON_VALIDA } from './consenti-selezione-non-valida.decorator'
import { MembershipController } from '../../api/me/membership.controller'
import { ConsultantController } from '../../api/permissions/consultant.controller'
import { AuthController } from '../../auth/controllers/auth.controller'
import { DevAuthController } from '../../auth/controllers/dev-auth.controller'
import { RegistroController } from '../../api/registro/registro.controller'

const reflector = new Reflector()
const consentita = (classe: any, metodo: string): boolean =>
  reflector.getAllAndOverride<boolean>(CONSENTI_SELEZIONE_NON_VALIDA, [
    classe.prototype[metodo],
    classe,
  ]) === true

describe('@ConsentiSelezioneNonValida — rotte di recupero', () => {
  it.each([
    [MembershipController, 'listTenants'],
    [MembershipController, 'switchTenant'],
    [ConsultantController, 'listTenants'],
    [ConsultantController, 'switchTenant'],
    [AuthController, 'refresh'],
    [AuthController, 'logout'],
    [AuthController, 'getProfile'],
    [DevAuthController, 'devLogin'],
  ] as const)('%p.%s è una rotta di recupero', (classe, metodo) => {
    expect(typeof (classe as any).prototype[metodo]).toBe('function')
    expect(consentita(classe, metodo)).toBe(true)
  })

  it.each([
    [MembershipController, 'getCompany'],
    [ConsultantController, 'getDashboard'],
    [RegistroController, 'registra'],
    [RegistroController, 'lista'],
  ] as const)(
    "%p.%s legge o scrive dati di un'azienda: non è una rotta di recupero",
    (classe, metodo) => {
      expect(typeof (classe as any).prototype[metodo]).toBe('function')
      expect(consentita(classe, metodo)).toBe(false)
    }
  )
})
