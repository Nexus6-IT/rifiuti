/**
 * Cache dei loghi (revisione finale I2): con una modifica concorrente fra la lettura dei metadati
 * e quella del logo, la cache non deve tenere il logo di una versione sotto la chiave di un'altra.
 */
import { TenantContext } from '../../core/context/tenant-context'
import { ModelliStampaService } from './modelli-stampa.service'

const TENANT = 'tenant-a'
const riga = (versione: number, logoBase64: string | null = null) => ({
  id: 'm1',
  tenantId: TENANT,
  name: `Modello v${versione}`,
  ambito: 'FIR',
  copie: 1,
  headerText: null,
  footerText: null,
  primaryColor: '#000000',
  secondaryColor: '#ffffff',
  isDefault: false,
  versione,
  logoBase64,
})
const metadati = (versione: number) => {
  const { logoBase64: _x, ...r } = riga(versione)
  return r
}

describe('ModelliStampaService — cache loghi con modifica concorrente', () => {
  it('non salva il logo di V+1 sotto la chiave di V e restituisce una riga coerente', async () => {
    const findFirst = jest.fn()
    const findMany = jest.fn()
    const prisma = { companyTemplate: { findFirst, findMany } } as any
    const service = new ModelliStampaService(prisma)

    // Prima lettura: metadati V1, ma nel frattempo il modello e' passato a V2 con un altro logo.
    findFirst.mockResolvedValueOnce(metadati(1))
    findMany.mockResolvedValueOnce([riga(2, 'LOGO_V2')])
    const primo = await TenantContext.run({ tenantId: TENANT }, () =>
      service.getById(TENANT, 'm1')
    )
    expect(primo.versione).toBe(2)
    expect(primo.nome).toBe('Modello v2')
    expect(primo.logoBase64).toBe('LOGO_V2')

    // Seconda lettura con metadati V1 (stale): la chiave V1 NON deve contenere il logo di V2.
    findFirst.mockResolvedValueOnce(metadati(1))
    findMany.mockResolvedValueOnce([riga(1, 'LOGO_V1')])
    const secondo = await TenantContext.run({ tenantId: TENANT }, () =>
      service.getById(TENANT, 'm1')
    )
    expect(findMany).toHaveBeenCalledTimes(2) // V1 non era in cache
    expect(secondo.logoBase64).toBe('LOGO_V1')

    // V2 e' in cache col suo logo: nessuna nuova query dei loghi.
    findFirst.mockResolvedValueOnce(metadati(2))
    const terzo = await TenantContext.run({ tenantId: TENANT }, () =>
      service.getById(TENANT, 'm1')
    )
    expect(findMany).toHaveBeenCalledTimes(2)
    expect(terzo.logoBase64).toBe('LOGO_V2')
  })
})
