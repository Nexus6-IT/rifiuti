/**
 * Integrazione degli abbinamenti con registrazione e correzioni (4.6, Task 7) contro un Postgres
 * reale, COME `wasteflow_app` dentro il `TenantContext`. Pulizia per id esatti.
 */
import { PrismaClient, Prisma } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55442/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { RegistriService } from '../registro/registri.service'
import { RegistraMovimentoUseCase } from '../registro/use-cases/registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../registro/commands/registra-movimento.command'
import { CorreggiMovimentoUseCase } from '../registro/use-cases/correggi-movimento.use-case'
import { formattaQuantita } from '../../core/format/formatta-quantita'
import * as lettore from './lettore-abbinamenti'
import { salvaAbbinamentoManuale } from './abbinamenti-scrittura'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('Abbinamenti con registrazione e correzioni - Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 13'
  const CER2 = '99 99 14'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registri: RegistriService
  let registra: RegistraMovimentoUseCase
  let correggi: CorreggiMovimentoUseCase
  let userId: string
  const cerCreati: string[] = []
  const tenantCreati: string[] = []
  let n = 0

  type Az = { tenantId: string; registroId: string }
  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())
  const inTx = <R>(az: Az, fn: (tx: Prisma.TransactionClient) => Promise<R>) =>
    nelTenant(az.tenantId, () => app.$transaction(tx => fn(tx)))

  async function azienda(): Promise<Az> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: {
        partitaIva: `SC${suffisso}`,
        ragioneSociale: 'Scritture abbinamenti SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001SC${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const [registro] = await nelTenant(t.id, () => registri.assicuraRegistri(t.id))
    return { tenantId: t.id, registroId: registro.id }
  }

  async function movimento(
    az: Az,
    o: {
      type: 'CARICO' | 'SCARICO'
      giorno: string
      quantita: number
      op?: string
      causale?: string
      cer?: string
      unita?: string
    }
  ): Promise<string> {
    const r = await nelTenant(az.tenantId, () =>
      registra.execute(
        new RegistraMovimentoCommand(
          az.tenantId,
          undefined as unknown as string,
          o.type,
          new Date(`${o.giorno}T10:00:00Z`),
          new Date(),
          o.causale ?? (o.type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'AVVIO_RECUPERO'),
          o.cer ?? CER,
          undefined,
          o.quantita,
          o.unita ?? 'KG',
          undefined,
          undefined,
          o.op,
          undefined,
          undefined,
          undefined,
          undefined,
          az.registroId
        )
      )
    )
    if (!r.isSuccess) throw new Error(`registrazione fallita: ${r.error}`)
    return r.value.id
  }

  const carico = (az: Az, giorno: string, q: number, op = 'R13') =>
    movimento(az, { type: 'CARICO', giorno, quantita: q, op })
  const scarico = (
    az: Az,
    giorno: string,
    q: number,
    extra: { causale?: string; op?: string } = {}
  ) => movimento(az, { type: 'SCARICO', giorno, quantita: q, ...extra })

  const righeDi = (az: Az) =>
    owner.abbinamentoCaricoScarico.findMany({
      where: { tenantId: az.tenantId },
      orderBy: [{ createdAt: 'asc' }, { quantita: 'desc' }],
    })

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    registri = new RegistriService(app, loggerStub as never)
    registra = new RegistraMovimentoUseCase(app, loggerStub as never, registri)
    correggi = new CorreggiMovimentoUseCase(app, loggerStub as never)
    for (const code of [CER, CER2]) {
      if ((await owner.cERCode.count({ where: { code } })) === 0) cerCreati.push(code)
      await owner.cERCode.upsert({
        where: { code },
        create: { code, description: 'CER di test', category: '99', subcategory: '' },
        update: {},
      })
    }
    const primo = await azienda()
    userId = (
      await owner.user.create({
        data: {
          tenantId: primo.tenantId,
          keycloakId: `keycloak-abbinamenti-${Date.now()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `abbinamenti-${Date.now()}@example.com`,
          role: 'ADMIN',
        },
      })
    ).id
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.abbinamentoCaricoScarico.deleteMany({
        where: { tenantId: { in: tenantCreati } },
      })
      await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.giacenzaIniziale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.registroProgressivoIniziale.deleteMany({
        where: { tenantId: { in: tenantCreati } },
      })
      await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.rentriUnitaLocale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      if (userId) await owner.user.deleteMany({ where: { id: userId } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  // ---------- helper ----------
  const numeroDi = async (id: string) => {
    const m = await owner.wasteMovement.findUniqueOrThrow({ where: { id } })
    return `${m.progressiveNumber}/${m.progressiveYear}`
  }
  const righeScarico = async (az: Az, scaricoId: string) =>
    (await righeDi(az)).filter(r => r.scaricoId === scaricoId)
  const audit = (az: Az, action: string) =>
    owner.activityLog.findMany({ where: { tenantId: az.tenantId, action } })
  const nMovimenti = (az: Az) => owner.wasteMovement.count({ where: { tenantId: az.tenantId } })

  const annulla = (az: Az, id: string) =>
    nelTenant(az.tenantId, () =>
      correggi.annulla({
        tenantId: az.tenantId,
        userId,
        movimentoId: id,
        motivo: 'inserito per errore',
      })
    )
  const rettifica = (
    az: Az,
    id: string,
    d: {
      giorno: string
      quantita: number
      tipo: 'CARICO' | 'SCARICO'
      op?: string
      cer?: string
      unita?: string
      note?: string
    }
  ) =>
    nelTenant(az.tenantId, () =>
      correggi.rettifica({
        tenantId: az.tenantId,
        userId,
        movimentoId: id,
        motivo: 'dati errati',
        dati: {
          movementDate: new Date(`${d.giorno}T10:00:00Z`),
          causale: d.tipo === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'AVVIO_RECUPERO',
          cerCode: d.cer ?? CER,
          quantity: d.quantita,
          unit: d.unita ?? 'KG',
          operationCode: d.op,
          notes: d.note,
        },
      })
    )
  const manuale = (
    az: Az,
    scaricoRadiceId: string,
    righe: Array<{ caricoId: string; quantita: number }>
  ) =>
    inTx(az, tx =>
      salvaAbbinamentoManuale(tx, { tenantId: az.tenantId, scaricoRadiceId, userId, righe })
    )

  // ---------- registrazione ----------
  describe('registrazione di uno scarico', () => {
    it('scarico registrato con FIFO automatico: le righe ci sono a fine transazione', async () => {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      const c2 = await carico(az, '2026-03-02', 100)
      const s = await scarico(az, '2026-03-10', 150)
      const righe = await righeScarico(az, s)
      expect(righe.map(r => [r.caricoId, Number(r.quantita), r.origine])).toEqual([
        [c1, 100, 'AUTOMATICO'],
        [c2, 50, 'AUTOMATICO'],
      ])
    })

    it('registro ordinario: nessuna riga, nessun avviso e il lettore non viene chiamato', async () => {
      const az = await azienda()
      await carico(az, '2026-03-01', 100, 'R1')
      const spia = jest.spyOn(lettore, 'leggiAmbitiAbbinamento')
      try {
        const s = await scarico(az, '2026-03-10', 10)
        expect(spia).not.toHaveBeenCalled()
        expect(await righeScarico(az, s)).toHaveLength(0)
      } finally {
        spia.mockRestore()
      }
    })

    it('il primo scarico R13 dopo un carico R13 si abbina (il pre-controllo non lo esclude)', async () => {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      const spia = jest.spyOn(lettore, 'leggiAmbitiAbbinamento')
      try {
        const s = await scarico(az, '2026-03-10', 30)
        expect(spia).toHaveBeenCalled()
        expect((await righeScarico(az, s)).map(r => [r.caricoId, Number(r.quantita)])).toEqual([
          [c1, 30],
        ])
      } finally {
        spia.mockRestore()
      }
    })

    it('un carico non scrive righe', async () => {
      const az = await azienda()
      await carico(az, '2026-03-01', 100)
      expect(await righeDi(az)).toHaveLength(0)
    })

    it('scarico in litri: prende il lock e si abbina nella sua famiglia', async () => {
      const az = await azienda()
      const cl = await movimento(az, {
        type: 'CARICO',
        giorno: '2026-03-01',
        quantita: 100,
        op: 'R13',
        unita: 'L',
      })
      await carico(az, '2026-03-01', 500)
      const s = await movimento(az, {
        type: 'SCARICO',
        giorno: '2026-03-10',
        quantita: 40,
        unita: 'L',
      })
      const righe = await righeScarico(az, s)
      expect(righe.map(r => [r.caricoId, Number(r.quantita)])).toEqual([[cl, 40]])
      expect(righe[0].famiglia).not.toBe('KG')
    })

    it('un errore del lettore fa fallire la registrazione: rollback, nessun movimento', async () => {
      const az = await azienda()
      await carico(az, '2026-03-01', 100)
      const prima = await nMovimenti(az)
      const spia = jest
        .spyOn(lettore, 'leggiAmbitiAbbinamento')
        .mockRejectedValueOnce(new Error('lettore guasto'))
      try {
        await expect(scarico(az, '2026-03-10', 10)).rejects.toThrow()
      } finally {
        spia.mockRestore()
      }
      expect(await nMovimenti(az)).toBe(prima)
      expect(await righeDi(az)).toHaveLength(0)
    })
  })

  // ---------- correzioni di scarico ----------
  describe('correzioni di scarico', () => {
    it('annullamento libera le righe: audit e avviso', async () => {
      const az = await azienda()
      await carico(az, '2026-03-01', 100)
      const s = await scarico(az, '2026-03-10', 60)
      expect(await righeScarico(az, s)).toHaveLength(1)
      const esito = await annulla(az, s)
      expect(await righeDi(az)).toHaveLength(0)
      expect(esito.avvisi).toContain('Abbinamenti liberati: 1 carico torna disponibile.')
      const a = await audit(az, 'ABBINAMENTI_LIBERATI')
      expect(a).toHaveLength(1)
      expect(JSON.stringify(a[0].metadata)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    })

    it('annullamento di uno scarico non abbinato: nessun avviso e nessun audit', async () => {
      const az = await azienda()
      await carico(az, '2026-03-01', 100, 'R1')
      const s2 = await scarico(az, '2026-03-10', 10)
      const esito = await annulla(az, s2)
      expect(esito.avvisi.filter(a => a.startsWith('Abbinamenti liberati'))).toEqual([])
      expect(await audit(az, 'ABBINAMENTI_LIBERATI')).toHaveLength(0)
    })

    it('rettifica solo note: le righe manuali restano identiche', async () => {
      const az = await azienda()
      await carico(az, '2026-03-01', 100)
      const c2 = await carico(az, '2026-03-02', 100)
      const s = await scarico(az, '2026-03-10', 80)
      await manuale(az, s, [{ caricoId: c2, quantita: 80 }])
      const prima = await righeScarico(az, s)
      const esito = await rettifica(az, s, {
        tipo: 'SCARICO',
        giorno: '2026-03-10',
        quantita: 80,
        note: 'solo una nota',
      })
      expect(esito.avvisi.filter(a => /bbinamento/.test(a))).toEqual([])
      expect((await righeScarico(az, s)).map(r => r.id)).toEqual(prima.map(r => r.id))
      expect((await righeScarico(az, s)).map(r => r.origine)).toEqual(['MANUALE'])
      expect(await audit(az, 'ABBINAMENTO_SCARICO_RICALCOLATO')).toHaveLength(0)
    })

    it('rettifica con manuale ancora valido e quantità cambiata: le righe restano', async () => {
      const az = await azienda()
      await carico(az, '2026-03-01', 100)
      const c2 = await carico(az, '2026-03-02', 100)
      const s = await scarico(az, '2026-03-10', 80)
      await manuale(az, s, [{ caricoId: c2, quantita: 80 }])
      const prima = await righeScarico(az, s)
      await rettifica(az, s, { tipo: 'SCARICO', giorno: '2026-03-10', quantita: 90 })
      const dopo = await righeScarico(az, s)
      expect(dopo.map(r => r.id)).toEqual(prima.map(r => r.id))
      expect(dopo.map(r => r.origine)).toEqual(['MANUALE'])
      expect(await audit(az, 'ABBINAMENTO_SCARICO_RICALCOLATO')).toHaveLength(0)
    })

    it('rettifica della quantità con righe automatiche: riproposte col FIFO', async () => {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      const s = await scarico(az, '2026-03-10', 60)
      const esito = await rettifica(az, s, { tipo: 'SCARICO', giorno: '2026-03-10', quantita: 80 })
      expect(esito.avvisi).toContain('Abbinamento ricalcolato con FIFO.')
      expect(
        (await righeScarico(az, s)).map(r => [r.caricoId, Number(r.quantita), r.origine])
      ).toEqual([[c1, 80, 'AUTOMATICO']])
      expect(await audit(az, 'ABBINAMENTO_SCARICO_RICALCOLATO')).toHaveLength(1)
    })

    it('rettifica che rende invalido il manuale: riproposto col FIFO e avviso', async () => {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      const c2 = await carico(az, '2026-03-02', 100)
      const s = await scarico(az, '2026-03-10', 80)
      await manuale(az, s, [{ caricoId: c2, quantita: 80 }])
      const esito = await rettifica(az, s, { tipo: 'SCARICO', giorno: '2026-03-10', quantita: 50 })
      expect(esito.avvisi).toContain(
        "L'abbinamento manuale non era più valido: ricalcolato con FIFO, verificalo."
      )
      expect(
        (await righeScarico(az, s)).map(r => [r.caricoId, Number(r.quantita), r.origine])
      ).toEqual([[c1, 50, 'AUTOMATICO']])
    })

    it('rettifica del CER: le righe passano al nuovo ambito', async () => {
      const az = await azienda()
      await carico(az, '2026-03-01', 100)
      const cB = await movimento(az, {
        type: 'CARICO',
        giorno: '2026-03-01',
        quantita: 100,
        op: 'R13',
        cer: CER2,
      })
      const s = await scarico(az, '2026-03-10', 60)
      await rettifica(az, s, { tipo: 'SCARICO', giorno: '2026-03-10', quantita: 60, cer: CER2 })
      expect(
        (await righeScarico(az, s)).map(r => [r.caricoId, Number(r.quantita), r.origine])
      ).toEqual([[cB, 60, 'AUTOMATICO']])
    })
  })

  // ---------- correzioni di carico ----------
  describe('correzioni di carico', () => {
    it('rettifica in aumento ammessa: riga sulla radice, residuo aumentato per il nuovo scarico', async () => {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      const s1 = await scarico(az, '2026-03-10', 60)
      await rettifica(az, c1, { tipo: 'CARICO', op: 'R13', giorno: '2026-03-01', quantita: 150 })
      const s2 = await scarico(az, '2026-03-12', 90)
      expect((await righeScarico(az, s1)).map(r => [r.caricoId, Number(r.quantita)])).toEqual([
        [c1, 60],
      ])
      expect((await righeScarico(az, s2)).map(r => [r.caricoId, Number(r.quantita)])).toEqual([
        [c1, 90],
      ])
    })

    it('rettifica sotto l abbinato: 409 col testo esatto e nessuna nuova annotazione', async () => {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      const s = await scarico(az, '2026-03-10', 60)
      const prima = await nMovimenti(az)
      await expect(
        rettifica(az, c1, { tipo: 'CARICO', op: 'R13', giorno: '2026-03-01', quantita: 50 })
      ).rejects.toMatchObject({
        status: 409,
        message:
          `Il carico n. ${await numeroDi(c1)} è abbinato agli scarichi n. ${await numeroDi(s)}: ` +
          `la nuova quantità è inferiore a quella già abbinata (${formattaQuantita(60)}). ` +
          "Modifica prima l'abbinamento di quegli scarichi (Giacenze → Abbinamenti).",
      })
      expect(await nMovimenti(az)).toBe(prima)
    })

    it('l elenco degli scarichi si ferma a 5 con "e altri n"', async () => {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      const ss: string[] = []
      for (let i = 0; i < 6; i++) ss.push(await scarico(az, `2026-03-1${i}`, 10))
      let messaggio = ''
      try {
        await rettifica(az, c1, { tipo: 'CARICO', op: 'R13', giorno: '2026-03-01', quantita: 50 })
      } catch (e) {
        messaggio = (e as Error).message
      }
      expect(messaggio).toContain(
        `${await numeroDi(ss[0])}, ${await numeroDi(ss[1])}, ${await numeroDi(ss[2])}, ${await numeroDi(ss[3])}, ${await numeroDi(ss[4])} e altri 1`
      )
    })

    it('data dopo lo scarico: 409', async () => {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      await scarico(az, '2026-03-10', 60)
      const prima = await nMovimenti(az)
      await expect(
        rettifica(az, c1, { tipo: 'CARICO', op: 'R13', giorno: '2026-03-15', quantita: 100 })
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining(
          'la nuova data è successiva a quella di uno scarico che lo usa'
        ),
      })
      expect(await nMovimenti(az)).toBe(prima)
    })

    it('operazione da R13 a R1 con righe: 409', async () => {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      await scarico(az, '2026-03-10', 60)
      const prima = await nMovimenti(az)
      await expect(
        rettifica(az, c1, { tipo: 'CARICO', op: 'R1', giorno: '2026-03-01', quantita: 100 })
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("cambia il rifiuto, l'unità o l'operazione di stoccaggio"),
      })
      expect(await nMovimenti(az)).toBe(prima)
    })

    it('cambio di CER o di unità di un carico abbinato: 409', async () => {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      await scarico(az, '2026-03-10', 60)
      const prima = await nMovimenti(az)
      const motivo = "cambia il rifiuto, l'unità o l'operazione di stoccaggio"
      await expect(
        rettifica(az, c1, {
          tipo: 'CARICO',
          op: 'R13',
          giorno: '2026-03-01',
          quantita: 100,
          cer: CER2,
        })
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining(motivo) })
      await expect(
        rettifica(az, c1, {
          tipo: 'CARICO',
          op: 'R13',
          giorno: '2026-03-01',
          quantita: 100,
          unita: 'L',
        })
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining(motivo) })
      expect(await nMovimenti(az)).toBe(prima)
    })

    it('annullamento con righe: 409; senza righe ammesso', async () => {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      const libero = await carico(az, '2026-03-01', 30)
      await scarico(az, '2026-03-10', 60)
      const prima = await nMovimenti(az)
      await expect(annulla(az, c1)).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('non si può annullare'),
      })
      expect(await nMovimenti(az)).toBe(prima)
      // il secondo carico non e usato dal FIFO (il primo copre tutto): si annulla
      await expect(annulla(az, libero)).resolves.toBeDefined()
    })
  })
})
