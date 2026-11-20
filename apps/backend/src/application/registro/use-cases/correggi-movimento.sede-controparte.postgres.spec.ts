/**
 * Rettifica e annullamento con la sede della controparte (D3) contro un Postgres reale, COME
 * `wasteflow_app` dentro il `TenantContext`. Prove: la sede si propaga solo con nome e indirizzo
 * invariati, un nome cambiato la azzera, una sede esplicita di un'altra azienda da' 400 senza scrivere
 * nulla, l'annullamento copia, la verifica della catena resta integra. Le catene si creano con la
 * registrazione vera (hash v2); il proprietario pulisce per id esatti (movimenti prima delle sedi).
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

import { BadRequestException } from '@nestjs/common'
import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { annoSolareItaliano } from '../../../core/time/anno-italiano'
import { creaDittaConRuolo, partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import { RegistriService } from '../registri.service'
import { VerificaCatenaRegistroService } from '../verifica-catena-registro.service'
import { MSG_SEDE_CONTROPARTE_NON_TROVATA } from '../sede-controparte'
import { RegistraMovimentoUseCase } from './registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../commands/registra-movimento.command'
import { CorreggiMovimentoUseCase, DatiRettifica } from './correggi-movimento.use-case'

import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('Correzioni con sede della controparte: Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 09'
  const ANNO = annoSolareItaliano(new Date())
  const NOME = 'Comune di Calliano'
  const INDIRIZZO = 'Via Roma 1, Calliano (TN)'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registra: RegistraMovimentoUseCase
  let correggi: CorreggiMovimentoUseCase
  let verifica: VerificaCatenaRegistroService
  let cerCreato = false
  const tenantCreati: string[] = []

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  type Az = { tenantId: string; registroId: string; sedeId: string }

  async function azienda(): Promise<Az> {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Correzioni sede SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const registri = new RegistriService(app, loggerStub as never)
    const [registro] = await nelTenant(t.id, () => registri.assicuraRegistri(t.id))
    const ditta = await creaDittaConRuolo(owner, t.id, 'PRODUTTORE')
    return { tenantId: t.id, registroId: registro.id, sedeId: ditta.sedeId }
  }

  /** Ordinaria con sede, nome e indirizzo, registrata dal use-case vero. */
  async function ordinaria(az: Az, sede: string | null = az.sedeId) {
    const adesso = new Date()
    const r = await nelTenant(az.tenantId, () =>
      registra.execute(
        new RegistraMovimentoCommand(
          az.tenantId,
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
          NOME,
          INDIRIZZO,
          undefined,
          undefined,
          az.registroId,
          undefined,
          sede
        )
      )
    )
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
    return r.value
  }

  const dati = (o: Partial<DatiRettifica> = {}): DatiRettifica => ({
    movementDate: new Date(Date.now() - 3_600_000),
    causale: 'PRODUZIONE_INTERNA',
    cerCode: CER,
    quantity: 10,
    unit: 'KG',
    counterpartName: NOME,
    counterpartAddress: INDIRIZZO,
    ...o,
  })

  const rettifica = (az: Az, id: string, d: Partial<DatiRettifica> = {}) =>
    nelTenant(az.tenantId, () =>
      correggi.rettifica({
        tenantId: az.tenantId,
        userId: undefined as unknown as string,
        movimentoId: id,
        motivo: 'correzione',
        dati: dati(d),
      })
    )

  const sedeDi = async (id: string) =>
    (await owner.wasteMovement.findUniqueOrThrow({ where: { id } })).counterpartSedeId

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const registri = new RegistriService(app, loggerStub as never)
    registra = new RegistraMovimentoUseCase(app, loggerStub as never, registri)
    correggi = new CorreggiMovimentoUseCase(app, loggerStub as never)
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
    // Le catene si cancellano in un solo statement (FK NO ACTION), e i movimenti PRIMA delle sedi.
    await owner.wasteMovement.deleteMany({ where: dove })
    await owner.mUDReport.deleteMany({ where: dove })
    await owner.registroProgressivoIniziale.deleteMany({ where: dove })
    await owner.registroRifiuti.deleteMany({ where: dove })
    await cancellaAziendeDiProva(owner, tenantCreati)
    if (cerCreato) await owner.cERCode.deleteMany({ where: { code: CER } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('rettifica della sola quantita: la sede si propaga', async () => {
    const az = await azienda()
    const o = await ordinaria(az)
    const { movimento } = await rettifica(az, o.id, { quantity: 8 })
    expect(await sedeDi(movimento.id)).toBe(az.sedeId)
  })

  it('rettifica con nome cambiato: NULL', async () => {
    const az = await azienda()
    const o = await ordinaria(az)
    const { movimento } = await rettifica(az, o.id, { counterpartName: 'Comune di Trento' })
    expect(await sedeDi(movimento.id)).toBeNull()
  })

  it('rettifica con sede null esplicita: azzeramento; con sede esplicita: usata', async () => {
    const az = await azienda()
    const altra = await creaDittaConRuolo(owner, az.tenantId, 'PRODUTTORE')
    const o = await ordinaria(az)
    const r1 = await rettifica(az, o.id, { counterpartSedeId: null })
    expect(await sedeDi(r1.movimento.id)).toBeNull()
    const r2 = await rettifica(az, r1.movimento.id, { counterpartSedeId: altra.sedeId })
    expect(await sedeDi(r2.movimento.id)).toBe(altra.sedeId)
  })

  it("rettifica con sede esplicita di un'altra azienda: 400 e nessuna riga scritta", async () => {
    const a = await azienda()
    const b = await azienda()
    const o = await ordinaria(a)
    const prima = await owner.wasteMovement.count({ where: { tenantId: a.tenantId } })
    await expect(rettifica(a, o.id, { counterpartSedeId: b.sedeId })).rejects.toThrow(
      new BadRequestException(MSG_SEDE_CONTROPARTE_NON_TROVATA)
    )
    expect(await owner.wasteMovement.count({ where: { tenantId: a.tenantId } })).toBe(prima)
  })

  it('annullamento: copia la sede alla lettera', async () => {
    const az = await azienda()
    const o = await ordinaria(az)
    const { movimento } = await nelTenant(az.tenantId, () =>
      correggi.annulla({
        tenantId: az.tenantId,
        userId: undefined as unknown as string,
        movimentoId: o.id,
        motivo: 'inserito per errore',
      })
    )
    expect(movimento.tipoAnnotazione).toBe('ANNULLAMENTO')
    expect(await sedeDi(movimento.id)).toBe(az.sedeId)
  })

  it('verifica catena integra dopo ordinaria, rettifica che propaga, rettifica che azzera e annullamento', async () => {
    const az = await azienda()
    const o = await ordinaria(az)
    const r1 = await rettifica(az, o.id, { quantity: 7 })
    const r2 = await rettifica(az, r1.movimento.id, { counterpartName: 'Altro nome' })
    await nelTenant(az.tenantId, () =>
      correggi.annulla({
        tenantId: az.tenantId,
        userId: undefined as unknown as string,
        movimentoId: r2.movimento.id,
        motivo: 'annullo',
      })
    )
    const esito = await nelTenant(az.tenantId, () =>
      verifica.verifica(az.tenantId, az.registroId, ANNO)
    )
    expect(esito).toEqual({ verificate: 4, nonVerificabili: [], primoErrore: null })
  })
})
