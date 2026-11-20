/**
 * Pezzo I5: wiring Nest di `migrazione:riacquisisci-fir`. Il modulo si compila e il servizio legge dal
 * client del TENANT (`PrismaService`, RLS), mai dal client di sistema (`PrismaSistemaService`): se il
 * servizio lo toccasse, il test fallirebbe perche' qui il client di sistema e' una finta che esplode.
 * Il client di sistema esiste nel contesto solo perche' lo porta il sottosistema RENTRI (i suoi job
 * sono elencati in `punti-di-sistema.spec.ts`); questo modulo non lo nomina.
 */
import { Test } from '@nestjs/testing'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PrismaSistemaService } from '../../../infrastructure/persistence/prisma-sistema.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { mappaValida, T_PROVA, U2 } from '../../../test-support/migrazione/mappa-di-prova'
import { apriPacchetto } from '../pacchetto/lettore-pacchetto'
import { validaMappa } from '../pacchetto/mappa-import'
import { scriviPacchetto } from '../pacchetto/scrittore-pacchetto'
import { RiacquisizioneFirModule } from './riacquisizione-fir.module'
import { RiacquisisciFirService } from './riacquisisci-fir.service'

const UL = '55555555-5555-4555-8555-555555555555'

describe('RiacquisizioneFirModule', () => {
  let radice: string
  beforeAll(async () => {
    radice = await mkdtemp(join(tmpdir(), 'riacq-modulo-'))
  })
  afterAll(() => rm(radice, { recursive: true, force: true }))

  it('compila e il servizio legge dal client del tenant, mai da quello di sistema', async () => {
    const tenant = {
      fIR: { count: jest.fn(async () => 0) },
      rentriUnitaLocale: {
        findFirst: jest.fn(async () => ({ numIscrSito: 'OP1234ABC123456-RM1234' })),
      },
      user: { findFirst: jest.fn() },
    }
    const sistema = new Proxy(
      {},
      {
        get: (_t, nome) => {
          if (nome === 'then' || /^(on|before)(Module|Application)/.test(String(nome)))
            return undefined
          throw new Error(`client di sistema toccato: ${String(nome)}`)
        },
      }
    )
    const ref = await Test.createTestingModule({ imports: [RiacquisizioneFirModule] })
      .overrideProvider(PrismaService)
      .useValue(tenant)
      .overrideProvider(PrismaSistemaService)
      .useValue(sistema)
      .compile()
    const servizio = ref.get(RiacquisisciFirService)

    const cartella = join(radice, 'WW00012026')
    await scriviPacchetto({
      cartella,
      archivio: 'WW00012026',
      hashStaging: 'a'.repeat(64),
      mappa: validaMappa({
        ...mappaValida(),
        tenantId: T_PROVA,
        unitaLocali: [{ legacy: 'X1.0001', sedeId: U2, unitaLocaleId: UL }],
      }),
      fasi: [
        {
          ambito: 'FIR',
          fase: 'fir-digitali',
          record: [
            {
              legacyKey: '0001|2026|FORMULARI|4',
              numeroFir: 'ABCDE1234567',
              idRentri: null,
              unitaLocaleId: UL,
            },
          ],
        },
      ],
    })
    const r = await servizio.esegui({
      tenantId: T_PROVA,
      userId: '66666666-6666-4666-8666-666666666666',
      pacchetto: await apriPacchetto(cartella),
      esegui: false,
      pausaMs: 1000,
      massimo: 1,
    })
    expect(r.conteggi).toEqual({ SIMULATO: 1 })
    expect(tenant.fIR.count).toHaveBeenCalledWith({
      where: { tenantId: T_PROVA, rentriNumeroFir: 'ABCDE1234567' },
    })
    expect(tenant.rentriUnitaLocale.findFirst).toHaveBeenCalled()
    await ref.close()
  })

  it('i sorgenti del modulo e del servizio non nominano il client di sistema', async () => {
    for (const f of [
      'riacquisizione-fir.module.ts',
      'riacquisisci-fir.service.ts',
      'archivio-riacquisizione.prisma.ts',
    ]) {
      const testo = await readFile(join(__dirname, f), 'utf8')
      expect(testo).not.toMatch(/PrismaSistema|prisma-sistema|DATABASE_URL_SISTEMA/)
    }
  })
})
