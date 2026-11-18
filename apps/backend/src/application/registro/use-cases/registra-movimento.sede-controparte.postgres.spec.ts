/**
 * Registrazione con la sede della ditta controparte (`counterpart_sede_id`) contro un Postgres reale,
 * collegato COME `wasteflow_app` dentro il `TenantContext` dell'azienda. Prova: colonna salvata, sede di
 * un'altra azienda rifiutata senza scrivere nulla, nessuna sede = NULL, hash e verifica catena
 * invariati. Il proprietario prepara i dati e pulisce, solo per id esatti (movimenti prima delle sedi:
 * la FK e' NO ACTION).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { annoSolareItaliano } from '../../../core/time/anno-italiano'
import { creaDittaConRuolo, partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import { RegistraMovimentoUseCase } from './registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../commands/registra-movimento.command'
import { RegistriService } from '../registri.service'
import { VerificaCatenaRegistroService } from '../verifica-catena-registro.service'
import { MSG_SEDE_CONTROPARTE_NON_TROVATA } from '../sede-controparte'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('Registrazione con sede della controparte: Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 06'
  const ANNO = annoSolareItaliano(new Date())
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registri: RegistriService
  let useCase: RegistraMovimentoUseCase
  let verifica: VerificaCatenaRegistroService
  let cerCreato = false
  const tenantCreati: string[] = []

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda() {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Sede controparte SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const viste = await nelTenant(t.id, () => registri.assicuraRegistri(t.id))
    const ditta = await creaDittaConRuolo(owner, t.id, 'PRODUTTORE')
    return { tenantId: t.id, registroId: viste[0].id, sedeId: ditta.sedeId }
  }

  function comando(
    tenantId: string,
    registroId: string,
    sede: string | null | undefined,
    nome = 'Comune di Calliano'
  ) {
    const adesso = new Date()
    return new RegistraMovimentoCommand(
      tenantId,
      undefined as unknown as string,
      'CARICO',
      new Date(adesso.getTime() - 3_600_000),
      adesso,
      'PRODUZIONE_INTERNA',
      CER,
      undefined,
      10,
      'KG',
      undefined,
      undefined,
      undefined,
      nome,
      'Via Roma 1, Calliano (TN)',
      undefined,
      undefined,
      registroId,
      undefined,
      sede
    )
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    registri = new RegistriService(app, loggerStub as never)
    useCase = new RegistraMovimentoUseCase(app, loggerStub as never, registri)
    verifica = new VerificaCatenaRegistroService(app)
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
    cerCreato = (await owner.cERCode.count({ where: { code: CER } })) === 0
    await owner.cERCode.upsert({
      where: { code: CER },
      create: { code: CER, description: 'CER di test', category: '99', subcategory: '' },
      update: {},
    })
  })

  afterAll(async () => {
    const dove = { tenantId: { in: tenantCreati } }
    await owner.activityLog.deleteMany({ where: dove })
    // Movimenti PRIMA delle sedi: la FK e' NO ACTION.
    await owner.wasteMovement.deleteMany({ where: dove })
    await owner.registroProgressivoIniziale.deleteMany({ where: dove })
    await owner.registroRifiuti.deleteMany({ where: dove })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    if (cerCreato) await owner.cERCode.deleteMany({ where: { code: CER } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('registra con la sede: la colonna viene salvata', async () => {
    const az = await azienda()
    const r = await nelTenant(az.tenantId, () =>
      useCase.execute(comando(az.tenantId, az.registroId, az.sedeId))
    )
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
    const riga = await owner.wasteMovement.findUniqueOrThrow({ where: { id: r.value.id } })
    expect(riga.counterpartSedeId).toBe(az.sedeId)
  })

  it('senza sede (assente o null) la colonna resta NULL', async () => {
    const az = await azienda()
    for (const v of [undefined, null]) {
      const r = await nelTenant(az.tenantId, () =>
        useCase.execute(comando(az.tenantId, az.registroId, v))
      )
      expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
      const riga = await owner.wasteMovement.findUniqueOrThrow({ where: { id: r.value.id } })
      expect(riga.counterpartSedeId).toBeNull()
    }
  })

  it("la sede di un'altra azienda: failure, nessuna riga scritta e progressivo non consumato", async () => {
    const a = await azienda()
    const b = await azienda()
    const r = await nelTenant(a.tenantId, () =>
      useCase.execute(comando(a.tenantId, a.registroId, b.sedeId))
    )
    expect(r.isFailure).toBe(true)
    expect(r.error).toBe(MSG_SEDE_CONTROPARTE_NON_TROVATA)
    expect(await owner.wasteMovement.count({ where: { tenantId: a.tenantId } })).toBe(0)
    // Il progressivo non e' stato consumato: la prima registrazione valida e' la numero 1.
    const ok = await nelTenant(a.tenantId, () =>
      useCase.execute(comando(a.tenantId, a.registroId, a.sedeId))
    )
    expect(ok.value.progressiveNumber).toBe(1)
  })

  it('una sede disattivata si accetta (solo il controllo di appartenenza)', async () => {
    const az = await azienda()
    await owner.sedeDitta.update({
      where: { id: az.sedeId },
      data: { attiva: false, principale: false },
    })
    const r = await nelTenant(az.tenantId, () =>
      useCase.execute(comando(az.tenantId, az.registroId, az.sedeId))
    )
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
  })

  it("l'hash non dipende dalla sede e la verifica catena resta integra con righe con e senza sede", async () => {
    const az = await azienda()
    const con = await nelTenant(az.tenantId, () =>
      useCase.execute(comando(az.tenantId, az.registroId, az.sedeId))
    )
    const senza = await nelTenant(az.tenantId, () =>
      useCase.execute(comando(az.tenantId, az.registroId, undefined))
    )
    expect(con.isSuccess && senza.isSuccess).toBe(true)
    // Le righe salvate hanno la versione 2 e un hash di 64 caratteri; la verifica lo ricalcola
    // senza la sede: se la colonna entrasse nell'hash, l'esito non sarebbe integro.
    const righe = await owner.wasteMovement.findMany({
      where: { registroId: az.registroId },
      orderBy: { progressiveNumber: 'asc' },
    })
    expect(righe.map(r => r.hashVersione)).toEqual([2, 2])
    expect(righe[0].counterpartSedeId).toBe(az.sedeId)
    expect(righe[1].counterpartSedeId).toBeNull()
    const esito = await nelTenant(az.tenantId, () =>
      verifica.verifica(az.tenantId, az.registroId, ANNO)
    )
    expect(esito).toEqual({ verificate: 2, nonVerificabili: [], primoErrore: null })
  })
})
