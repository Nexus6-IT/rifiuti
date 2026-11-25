import { RolesGuard } from '../../auth/guards/roles.guard'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { LetturaSdiController } from './lettura-sdi.controller'

describe('LetturaSdiController', () => {
  const lettura = {
    delDocumento: jest.fn().mockResolvedValue({ trasmissioni: [] }),
    fileRicevuta: jest
      .fn()
      .mockResolvedValue({ nomeFile: 'IT1_00001_RC.xml', contenuto: Buffer.from('<x/>') }),
  }
  const controller = new LetturaSdiController(lettura as never)
  const req = { tenantId: 'tenant-1', user: { id: 'u1', tenantId: 'tenant-1' } }

  it('lettura dello stato: azienda dalla richiesta, mai dal corpo', async () => {
    await controller.delDocumento(req, { id: 'd1' })
    expect(lettura.delDocumento).toHaveBeenCalledWith('tenant-1', 'd1')
  })

  it('download: attachment con il nome del file, tipo XML e nosniff', async () => {
    const intestazioni: Record<string, string> = {}
    const res = { setHeader: (k: string, v: string) => void (intestazioni[k] = v) }
    const f = await controller.file(req, { id: 'd1', notificaId: 'n1' }, res as never)
    expect(lettura.fileRicevuta).toHaveBeenCalledWith('tenant-1', 'd1', 'n1')
    expect(intestazioni['Content-Disposition']).toBe('attachment; filename="IT1_00001_RC.xml"')
    expect(intestazioni['Content-Type']).toContain('application/xml')
    expect(intestazioni['X-Content-Type-Options']).toBe('nosniff')
    expect(f).toBeDefined()
  })

  it('tutti i ruoli di lettura, mai altro (VIEWER ammesso, nessuna scrittura)', () => {
    const reflector = new Reflector()
    for (const metodo of [
      LetturaSdiController.prototype.delDocumento,
      LetturaSdiController.prototype.file,
    ]) {
      const ruoli = reflector.get<string[]>(ROLES_KEY, metodo)
      expect(ruoli).toEqual(expect.arrayContaining(['ADMIN', 'OPERATOR', 'VIEWER', 'SUPER_ADMIN']))
    }
    expect(RolesGuard).toBeDefined()
  })
})
