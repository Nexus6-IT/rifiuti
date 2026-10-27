import { TenantContext } from '../../core/context/tenant-context'
import { RegistriService } from './registri.service'

/**
 * Unitari di RegistriService con un finto Prisma "con stato": sedi e registri stanno in
 * memoria, cosi' si prova anche l'idempotenza. Il comportamento sotto RLS e la concorrenza
 * sono nello spec Postgres.
 */
interface Sede {
  id: string
  tenantId: string
  numIscrSito: string
  denominazione: string
  principale: boolean
  attiva: boolean
}
interface Registro {
  id: string
  tenantId: string
  unitaLocaleId: string | null
  codice: string
  descrizione: string
  attivo: boolean
}

const T = 'tenant-1'
const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

function sede(id: string, extra: Partial<Sede> = {}): Sede {
  return {
    id,
    tenantId: T,
    numIscrSito: `OP-${id}`,
    denominazione: `Sede ${id}`,
    principale: false,
    attiva: true,
    ...extra,
  }
}
function registro(
  id: string,
  unitaLocaleId: string | null,
  extra: Partial<Registro> = {}
): Registro {
  return {
    id,
    tenantId: T,
    unitaLocaleId,
    codice: 'CARICO_SCARICO',
    descrizione: unitaLocaleId ? `Registro Sede ${unitaLocaleId}` : 'Registro cronologico',
    attivo: true,
    ...extra,
  }
}

function creaFinto(sedi: Sede[], registri: Registro[]) {
  const chiamate = {
    lock: 0,
    create: [] as Registro[],
    update: [] as unknown[],
    log: [] as Array<{ data: Record<string, unknown> }>,
  }
  let seq = 0
  const conSede = (r: Registro) => ({
    ...r,
    unitaLocale: sedi.find(s => s.id === r.unitaLocaleId) ?? null,
  })
  const filtra = <X extends { tenantId: string }>(
    righe: X[],
    where: Record<string, unknown> = {}
  ) =>
    righe.filter(r =>
      Object.entries(where).every(([k, v]) => (v === undefined ? true : (r as never)[k] === v))
    )
  const client = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn(async () => {
      chiamate.lock++
      return 1
    }),
    rentriUnitaLocale: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        filtra(sedi, where)
      ),
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) => filtra(sedi, where)[0] ?? null
      ),
    },
    registroRifiuti: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        filtra(registri, where).map(conSede)
      ),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const r = filtra(registri, where)[0]
        return r ? conSede(r) : null
      }),
      create: jest.fn(async ({ data }: { data: Partial<Registro> }) => {
        const r = registro(`nuovo-${++seq}`, data.unitaLocaleId ?? null, {
          descrizione: data.descrizione as string,
        })
        registri.push(r)
        chiamate.create.push(r)
        return r
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; unitaLocaleId: null }
          data: Partial<Registro>
        }) => {
          chiamate.update.push({ where, data })
          const r = registri.find(x => x.id === where.id && x.unitaLocaleId === null)
          if (!r) return { count: 0 }
          r.unitaLocaleId = data.unitaLocaleId as string
          return { count: 1 }
        }
      ),
    },
    activityLog: {
      create: jest.fn(async (arg: { data: Record<string, unknown> }) => {
        chiamate.log.push(arg)
        return {}
      }),
    },
  }
  const prisma = {
    ...client,
    $transaction: jest.fn(async (fn: (tx: typeof client) => Promise<unknown>) => fn(client)),
  }
  const service = new RegistriService(prisma as never, loggerStub as never)
  return { service, prisma, client, chiamate, registri }
}

describe('RegistriService', () => {
  describe('assicuraRegistri', () => {
    it('assicuraRegistri: azienda senza sedi né registri → un registro senza sede', async () => {
      const { service, chiamate } = creaFinto([], [])
      const viste = await service.assicuraRegistri(T)
      expect(chiamate.create).toHaveLength(1)
      expect(chiamate.create[0].unitaLocaleId).toBeNull()
      expect(chiamate.create[0].descrizione).toBe('Registro cronologico')
      expect(viste).toHaveLength(1)
      expect(viste[0]).toMatchObject({ unitaLocaleId: null, numIscrSito: null, principale: false })
      expect(chiamate.lock).toBe(1)
    })

    it('assicuraRegistri: due sedi attive → un registro per sede, idempotente alla seconda chiamata', async () => {
      const { service, chiamate } = creaFinto([sede('A', { principale: true }), sede('B')], [])
      const prima = await service.assicuraRegistri(T)
      expect(chiamate.create.map(r => r.unitaLocaleId).sort()).toEqual(['A', 'B'])
      expect(chiamate.create.map(r => r.descrizione).sort()).toEqual([
        'Registro Sede A',
        'Registro Sede B',
      ])
      const seconda = await service.assicuraRegistri(T)
      expect(chiamate.create).toHaveLength(2)
      expect(seconda.map(v => v.id).sort()).toEqual(prima.map(v => v.id).sort())
      expect(prima.find(v => v.unitaLocaleId === 'A')?.principale).toBe(true)
      expect(prima.find(v => v.unitaLocaleId === 'B')?.principale).toBe(false)
    })

    it('assicuraRegistri: registro senza sede + sede principale senza registro → il registro si lega alla sede e non se ne crea un secondo', async () => {
      const { service, chiamate, registri } = creaFinto(
        [sede('A', { principale: true })],
        [registro('R0', null)]
      )
      const viste = await service.assicuraRegistri(T)
      expect(chiamate.create).toHaveLength(0)
      expect(registri[0].unitaLocaleId).toBe('A')
      expect(viste).toHaveLength(1)
      expect(viste[0]).toMatchObject({ id: 'R0', unitaLocaleId: 'A', principale: true })
      expect(chiamate.log).toHaveLength(1)
      expect(chiamate.log[0].data).toMatchObject({
        tenantId: T,
        action: 'REGISTRO_COLLEGATO_SEDE',
        userId: null,
      })
      expect(chiamate.log[0].data.metadata).toMatchObject({ registroId: 'R0', unitaLocaleId: 'A' })
    })

    it('assicuraRegistri: la principale ha già un registro → il registro senza sede resta senza sede', async () => {
      const { service, chiamate, registri } = creaFinto(
        [sede('A', { principale: true })],
        [registro('R0', null), registro('RA', 'A')]
      )
      await service.assicuraRegistri(T)
      expect(chiamate.update).toHaveLength(0)
      expect(chiamate.create).toHaveLength(0)
      expect(chiamate.log).toHaveLength(0)
      expect(registri.find(r => r.id === 'R0')?.unitaLocaleId).toBeNull()
    })

    it('assicuraRegistri: sede disattivata → il suo registro resta e non ne nascono altri', async () => {
      const { service, chiamate, registri } = creaFinto(
        [sede('A', { principale: true }), sede('B', { attiva: false })],
        [registro('RA', 'A'), registro('RB', 'B')]
      )
      const viste = await service.assicuraRegistri(T)
      expect(chiamate.create).toHaveLength(0)
      expect(chiamate.update).toHaveLength(0)
      expect(registri.find(r => r.id === 'RB')?.attivo).toBe(true)
      expect(viste.map(v => v.id).sort()).toEqual(['RA', 'RB'])
    })

    it('assicuraRegistri: non cambia mai la sede di un registro già agganciato', async () => {
      // la principale (B) non ha registro; l'unico registro è agganciato ad A: non va spostato
      const { service, chiamate, registri } = creaFinto(
        [sede('A'), sede('B', { principale: true })],
        [registro('RA', 'A')]
      )
      await service.assicuraRegistri(T)
      expect(chiamate.update).toHaveLength(0)
      expect(registri.find(r => r.id === 'RA')?.unitaLocaleId).toBe('A')
      expect(chiamate.create.map(r => r.unitaLocaleId)).toEqual(['B'])
    })

    it('assicuraRegistri: la violazione dell indice unico (P2002) in una creazione concorrente porta a una rilettura, non a un errore', async () => {
      const { service, client } = creaFinto([sede('A', { principale: true })], [])
      const errore = Object.assign(new Error('Unique constraint'), { code: 'P2002' })
      client.registroRifiuti.create.mockRejectedValueOnce(errore)
      const viste = await service.assicuraRegistri(T)
      expect(viste).toHaveLength(1)
    })
  })

  describe('tenant del contesto', () => {
    it('contesto di un altro tenant → errore esplicito e nessuna scrittura (assicuraRegistri, preparaRegistri, elenca, sedeRentri)', async () => {
      const { service, prisma, chiamate } = creaFinto([sede('A', { principale: true })], [])
      await TenantContext.run({ tenantId: 'altro-tenant' }, async () => {
        await expect(service.assicuraRegistri(T)).rejects.toThrow(/non coincide/)
        await expect(service.preparaRegistri(T)).rejects.toThrow(/non coincide/)
        await expect(service.elenca(T)).rejects.toThrow(/non coincide/)
        await expect(service.sedeRentri(T, 'R')).rejects.toThrow(/non coincide/)
      })
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(chiamate.create).toHaveLength(0)
      expect(chiamate.log).toHaveLength(0)
    })

    it('senza contesto lavora dentro TenantContext.run col tenant richiesto; con il contesto giusto usa quello', async () => {
      const visto: Array<string | null> = []
      const { service, client } = creaFinto([sede('A', { principale: true })], [])
      client.registroRifiuti.create.mockImplementationOnce(async () => {
        visto.push(TenantContext.getStoreTenantId())
        return {} as never
      })
      await service.assicuraRegistri(T)
      expect(visto).toEqual([T])
      expect(TenantContext.getStoreTenantId()).toBeNull()
      await TenantContext.run({ tenantId: T }, async () => {
        await expect(service.elenca(T)).resolves.toBeDefined()
      })
    })
  })

  describe('preparaRegistri', () => {
    it('preparaRegistri: se il registro predefinito esiste non apre transazioni né prende lock', async () => {
      const { service, prisma, chiamate } = creaFinto(
        [sede('A', { principale: true })],
        [registro('RA', 'A')]
      )
      await service.preparaRegistri(T)
      await service.preparaRegistri(T, 'RA')
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(chiamate.lock).toBe(0)
    })

    it('preparaRegistri: se manca il registro richiesto chiama assicuraRegistri', async () => {
      const { service, chiamate } = creaFinto([sede('A', { principale: true })], [])
      const spia = jest.spyOn(service, 'assicuraRegistri')
      await service.preparaRegistri(T, 'inesistente')
      expect(spia).toHaveBeenCalledWith(T)
      expect(chiamate.create).toHaveLength(1)
    })

    it('preparaRegistri: senza registroId e senza registri chiama assicuraRegistri', async () => {
      const { service, chiamate } = creaFinto([sede('A', { principale: true })], [])
      await service.preparaRegistri(T)
      expect(chiamate.create).toHaveLength(1)
    })

    it('preparaRegistri: la sede principale attiva senza registro porta a assicuraRegistri anche se esiste un altro registro', async () => {
      const { service, chiamate } = creaFinto(
        [sede('A'), sede('B', { principale: true })],
        [registro('RA', 'A')]
      )
      await service.preparaRegistri(T)
      expect(chiamate.create.map(r => r.unitaLocaleId)).toEqual(['B'])
    })
  })

  describe('elenca', () => {
    it('elenca: non scrive mai (nessun create/update/lock)', async () => {
      const { service, prisma, chiamate } = creaFinto(
        [sede('A', { principale: true })],
        [registro('RA', 'A')]
      )
      const viste = await service.elenca(T)
      expect(viste).toHaveLength(1)
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(chiamate.lock).toBe(0)
      expect(chiamate.create).toHaveLength(0)
      expect(chiamate.update).toHaveLength(0)
      expect(chiamate.log).toHaveLength(0)
    })
  })

  describe('risolvi', () => {
    it('risolvi: senza registroId usa il registro della sede principale', async () => {
      const { service, client } = creaFinto(
        [sede('A'), sede('B', { principale: true })],
        [registro('RA', 'A'), registro('RB', 'B')]
      )
      const v = await service.risolvi(client as never, T)
      expect(v.id).toBe('RB')
      expect(v.principale).toBe(true)
      expect(v.numIscrSito).toBe('OP-B')
    })

    it('risolvi: senza principale e con un solo registro attivo usa quello', async () => {
      const { service, client } = creaFinto(
        [],
        [registro('R0', null), registro('RX', null, { attivo: false })]
      )
      const v = await service.risolvi(client as never, T)
      expect(v.id).toBe('R0')
    })

    it('risolvi: due registri e nessuna principale → RegistroDaIndicareError', async () => {
      const { service, client } = creaFinto(
        [sede('A'), sede('B')],
        [registro('RA', 'A'), registro('RB', 'B')]
      )
      await expect(service.risolvi(client as never, T)).rejects.toMatchObject({
        name: 'RegistroDaIndicareError',
        message: "L'azienda ha più registri e nessuna sede principale: indica il registro.",
      })
    })

    it("risolvi: registroId di un'altra azienda → RegistroNonTrovatoError", async () => {
      const { service, client } = creaFinto(
        [sede('A', { principale: true })],
        [registro('RA', 'A'), registro('RALTRO', null, { tenantId: 'altro-tenant' })]
      )
      await expect(service.risolvi(client as never, T, 'RALTRO')).rejects.toMatchObject({
        name: 'RegistroNonTrovatoError',
        message: 'Registro non trovato o non attivo.',
      })
    })

    it('risolvi: registro non attivo o assente → RegistroNonTrovatoError, e non crea nulla', async () => {
      const { service, client, chiamate } = creaFinto(
        [sede('A', { principale: true })],
        [registro('RA', 'A', { attivo: false })]
      )
      await expect(service.risolvi(client as never, T, 'RA')).rejects.toMatchObject({
        name: 'RegistroNonTrovatoError',
      })
      await expect(service.risolvi(client as never, T)).rejects.toMatchObject({
        name: 'RegistroNonTrovatoError',
      })
      expect(chiamate.create).toHaveLength(0)
      expect(chiamate.lock).toBe(0)
    })
  })

  describe('risolviInLettura', () => {
    it('risolve in una transazione nel contesto del tenant, senza scrivere', async () => {
      const { service, prisma, chiamate } = creaFinto(
        [sede('A', { principale: true })],
        [registro('RA', 'A')]
      )
      const v = await service.risolviInLettura(T)
      expect(v.id).toBe('RA')
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(chiamate.create).toHaveLength(0)
      expect(chiamate.log).toHaveLength(0)
    })

    it('registroId di un altro registro attivo dell azienda lo risolve; inesistente e RegistroNonTrovatoError', async () => {
      const { service } = creaFinto(
        [sede('A', { principale: true }), sede('B')],
        [registro('RA', 'A'), registro('RB', 'B')]
      )
      expect((await service.risolviInLettura(T, 'RB')).id).toBe('RB')
      await expect(service.risolviInLettura(T, 'RX')).rejects.toMatchObject({
        name: 'RegistroNonTrovatoError',
      })
    })
  })

  describe('sede principale disattivata', () => {
    it('risolvi e risolviPerFir ignorano la principale non attiva (vista.principale = principale E attiva)', async () => {
      const { service, client } = creaFinto(
        [sede('A', { principale: true, attiva: false }), sede('B')],
        [registro('RA', 'A'), registro('RB', 'B')]
      )
      await expect(service.risolvi(client as never, T)).rejects.toMatchObject({
        name: 'RegistroDaIndicareError',
      })
      expect((await service.risolviPerFir(client as never, T, 'RB')).id).toBe('RB')
      const viste = await service.elenca(T)
      expect(viste.find(v => v.id === 'RA')?.principale).toBe(false)
    })
  })

  describe('risolviPerFir', () => {
    it('risolviPerFir: usa il registro della principale; registroId diverso → RegistroNonCoerenteConFirError col messaggio esatto', async () => {
      const { service, client } = creaFinto(
        [sede('A'), sede('B', { principale: true })],
        [registro('RA', 'A'), registro('RB', 'B')]
      )
      expect((await service.risolviPerFir(client as never, T)).id).toBe('RB')
      expect((await service.risolviPerFir(client as never, T, 'RB')).id).toBe('RB')
      await expect(service.risolviPerFir(client as never, T, 'RA')).rejects.toMatchObject({
        name: 'RegistroNonCoerenteConFirError',
        message:
          'Un movimento collegato a un FIR si registra nel registro della sede principale, la stessa trasmessa a RENTRI nel FIR.',
      })
    })

    it('risolviPerFir: più registri e nessuna principale → accetta il registroId indicato', async () => {
      const { service, client } = creaFinto(
        [sede('A'), sede('B')],
        [registro('RA', 'A'), registro('RB', 'B')]
      )
      expect((await service.risolviPerFir(client as never, T, 'RB')).id).toBe('RB')
      await expect(service.risolviPerFir(client as never, T)).rejects.toMatchObject({
        name: 'RegistroDaIndicareError',
      })
    })
  })

  describe('sedeRentri', () => {
    it('sedeRentri: restituisce il numIscrSito della sede del registro, non quello della principale', async () => {
      const { service } = creaFinto(
        [sede('A', { principale: true }), sede('B')],
        [registro('RA', 'A'), registro('RB', 'B')]
      )
      expect(await service.sedeRentri(T, 'RB')).toEqual({
        numIscrSito: 'OP-B',
        denominazione: 'Sede B',
      })
    })

    it('sedeRentri: registro senza sede → RegistroSenzaSedeRentriError col messaggio esatto', async () => {
      const { service } = creaFinto([], [registro('R0', null)])
      await expect(service.sedeRentri(T, 'R0')).rejects.toMatchObject({
        name: 'RegistroSenzaSedeRentriError',
        message:
          'Il registro non ha una sede RENTRI collegata: imposta una sede principale nella sezione Unità locali.',
      })
    })

    it('sedeRentri: registro inesistente o di un altro tenant → RegistroNonTrovatoError', async () => {
      const { service } = creaFinto([], [registro('R0', null, { tenantId: 'altro' })])
      await expect(service.sedeRentri(T, 'R0')).rejects.toMatchObject({
        name: 'RegistroNonTrovatoError',
      })
    })
  })
})
