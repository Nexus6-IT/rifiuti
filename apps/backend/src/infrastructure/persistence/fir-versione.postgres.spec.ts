/**
 * Versione del FIR e scritture condizionate (Fase 2 pezzo 4, Task 2a) contro un Postgres reale,
 * collegato COME `wasteflow_app` (RLS attiva) e dentro il `TenantContext` dell'azienda. Il
 * proprietario (`wasteflow`) prepara l'azienda e legge cio' che e' stato scritto; la pulizia toglie
 * solo le righe create qui.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono queste due variabili, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
process.env.DATABASE_URL_SISTEMA = urlComeRuolo(
  'wasteflow_sistema',
  process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import { PrismaService, creaPrismaServiceApplicativo } from './prisma.service'
import { PrismaSistemaService } from './prisma-sistema.service'
import { FIRPrismaRepository } from './fir-prisma.repository'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { FirModificatoNelFrattempoError, FirNonTrovatoError } from '../../core/domain/errors'

describe('FIR: versione e scritture condizionate (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let repo: FIRPrismaRepository
  let tenantId = ''
  let userId = ''
  const sfx = Date.now().toString().slice(-8)

  const nelTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    sistema = new PrismaSistemaService()
    repo = new FIRPrismaRepository(app, sistema)
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')

    tenantId = (
      await owner.tenant.create({
        data: { partitaIva: `FV${sfx}`.slice(0, 11), ragioneSociale: `Versione FIR ${sfx}` },
      })
    ).id
    userId = (
      await owner.user.create({
        data: {
          tenantId,
          keycloakId: `kc-fir-versione-${sfx}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `fir-versione-${sfx}@example.it`,
          role: 'ADMIN',
        },
      })
    ).id
  })

  afterAll(async () => {
    // Senza id (beforeAll fallito) Prisma toglierebbe il filtro: non si cancella nulla.
    if (tenantId) {
      await owner.fIR.deleteMany({ where: { tenantId } })
      await owner.user.deleteMany({ where: { tenantId } })
      await owner.tenant.deleteMany({ where: { id: tenantId } })
    }
    await Promise.all([owner.$disconnect(), app.onModuleDestroy(), sistema.onModuleDestroy()])
  })

  const nuovoBozza = () =>
    FIR.create({
      produttoreId: '11111111-1111-4111-8111-111111111111',
      rifiuto: { cerCode: '150101', quantita: 100 },
      trasportatoreId: '22222222-2222-4222-8222-222222222222',
      destinatarioId: '33333333-3333-4333-8333-333333333333',
      tenantId,
      creatoDaUserId: userId,
    })

  const firma = () => ({
    firmatario: 'Mario Rossi',
    timestamp: new Date(),
    certificato: 'x',
    userId,
  })

  async function bozzaSalvata(): Promise<FIR> {
    const fir = nuovoBozza()
    await nelTenant(() => repo.save(fir))
    return fir
  }

  const carica = async (id: string) => (await nelTenant(() => repo.findById(id)))!
  const riga = (id: string) => owner.fIR.findUniqueOrThrow({ where: { id } })

  /** Cambia le annotazioni come farebbe una modifica (qui via riflessione: campo readonly). */
  const conAnnotazioni = (fir: FIR, testo: string) =>
    Object.assign(fir, { _annotazioni: testo }) as FIR

  it('la creazione scrive versione 1 e ogni save la incrementa, allineando la versione dell aggregate', async () => {
    const fir = nuovoBozza()
    expect(fir.versione).toBe(0)

    await nelTenant(() => repo.save(fir))
    expect(fir.versione).toBe(1)
    expect((await riga(fir.id)).versione).toBe(1)

    await nelTenant(() => repo.save(fir))
    await nelTenant(() => repo.save(fir, { verificaVersione: true }))
    expect(fir.versione).toBe(3)
    expect((await riga(fir.id)).versione).toBe(3)
    expect((await carica(fir.id)).versione).toBe(3)
  })

  it('due copie: la prima annulla, la seconda col controllo di versione riceve il conflitto', async () => {
    const fir = await bozzaSalvata()
    const prima = await carica(fir.id)
    const seconda = await carica(fir.id)

    prima.annulla('Errore di compilazione')
    await nelTenant(() => repo.save(prima, { verificaVersione: true }))

    seconda.annulla('Altro motivo')
    await expect(
      nelTenant(() => repo.save(seconda, { verificaVersione: true }))
    ).rejects.toBeInstanceOf(FirModificatoNelFrattempoError)

    // Il conflitto non fa avanzare la versione dell'aggregate perdente.
    expect(seconda.versione).toBe(1)
    const r = await riga(fir.id)
    expect(r.status).toBe('CANCELLED')
    expect(r.motivoAnnullamento).toBe('Errore di compilazione')
    expect(r.versione).toBe(2)
  })

  it('corsa vera: A tiene il lock della riga, B resta in attesa e dopo il commit di A prende il conflitto', async () => {
    const fir = await bozzaSalvata()
    const b = conAnnotazioni(await carica(fir.id), 'copia B')

    let rilascia!: () => void
    const via = new Promise<void>(r => (rilascia = r))
    let lockPreso!: () => void
    const lockPronto = new Promise<void>(r => (lockPreso = r))
    // A: stessa sequenza di un save (lock FOR NO KEY UPDATE, poi scrittura con versione + 1),
    // ma la transaction resta aperta finche' non la si rilascia: la sovrapposizione e' certa.
    const transazioneA = owner.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT versione FROM firs WHERE id = ${fir.id}::uuid AND tenant_id = ${tenantId}::uuid FOR NO KEY UPDATE`
        await tx.$executeRaw`UPDATE firs SET waste_notes = 'copia A', versione = versione + 1 WHERE id = ${fir.id}::uuid`
        lockPreso()
        await via
      },
      { timeout: 20_000 }
    )
    await lockPronto

    let esitoB: 'riuscito' | 'rifiutato' | undefined
    let erroreB: unknown
    const saveB = nelTenant(() => repo.save(b, { verificaVersione: true })).then(
      () => (esitoB = 'riuscito'),
      e => {
        esitoB = 'rifiutato'
        erroreB = e
      }
    )
    await new Promise(r => setTimeout(r, 500))
    expect(esitoB).toBeUndefined() // B e' in attesa del lock di A

    rilascia()
    await transazioneA
    await saveB

    expect(esitoB).toBe('rifiutato')
    expect(erroreB).toBeInstanceOf(FirModificatoNelFrattempoError)
    const r = await riga(fir.id)
    expect(r.versione).toBe(2)
    expect(r.wasteNotes).toBe('copia A')
  })

  it('save con controllo di versione su una riga sparita: FirNonTrovatoError, nessuna riga ricreata', async () => {
    const fir = await bozzaSalvata()
    const copia = await carica(fir.id)
    await owner.fIR.delete({ where: { id: fir.id } })

    await expect(
      nelTenant(() => repo.save(copia, { verificaVersione: true }))
    ).rejects.toBeInstanceOf(FirNonTrovatoError)
    expect(await owner.fIR.findUnique({ where: { id: fir.id } })).toBeNull()
  })

  it('emissione con un aggregate letto prima di un altro save: conflitto e numero non consumato', async () => {
    const fir = await bozzaSalvata()
    const vecchia = await carica(fir.id)
    const nuova = conAnnotazioni(await carica(fir.id), 'annotazioni nuove')
    await nelTenant(() => repo.save(nuova, { verificaVersione: true }))

    await expect(
      nelTenant(() => repo.emettiConNumerazione(vecchia, 2031, n => vecchia.emetti(n, firma())))
    ).rejects.toBeInstanceOf(FirModificatoNelFrattempoError)

    const r = await riga(fir.id)
    expect(r.firNumber).toBeNull()
    expect(r.status).toBe('DRAFT')
    expect(r.wasteNotes).toBe('annotazioni nuove')
  })

  it('emissione con aggregate aggiornato: riesce e incrementa la versione', async () => {
    const fir = await bozzaSalvata()
    const copia = await carica(fir.id)

    const numero = await nelTenant(() =>
      repo.emettiConNumerazione(copia, 2032, n => copia.emetti(n, firma()))
    )

    const r = await riga(fir.id)
    expect(r.firNumber).toBe(numero)
    expect(r.versione).toBe(2)
    expect(copia.versione).toBe(2)
  })

  it('aggancio manuale su una copia vecchia: conflitto, annotazioni nuove conservate, nessun legame', async () => {
    const fir = await bozzaSalvata()
    const vecchia = await carica(fir.id)
    const nuova = conAnnotazioni(await carica(fir.id), 'annotazioni diverse')
    await nelTenant(() => repo.save(nuova, { verificaVersione: true }))

    vecchia.agganciaManualmente(`RENTRI-VER-${sfx}`)
    await expect(
      nelTenant(() => repo.save(vecchia, { verificaVersione: true }))
    ).rejects.toBeInstanceOf(FirModificatoNelFrattempoError)

    const r = await riga(fir.id)
    expect(r.wasteNotes).toBe('annotazioni diverse')
    expect(r.rentriNumeroFir).toBeNull()
  })

  it('save senza verificaVersione (percorso RENTRI) dopo una scrittura concorrente: riesce e incrementa', async () => {
    const fir = await bozzaSalvata()
    const vecchia = await carica(fir.id)
    const nuova = conAnnotazioni(await carica(fir.id), 'scritta dall altra copia')
    await nelTenant(() => repo.save(nuova, { verificaVersione: true }))

    await expect(nelTenant(() => repo.save(vecchia))).resolves.toBeUndefined()

    const r = await riga(fir.id)
    expect(r.versione).toBe(3)
    expect(vecchia.versione).toBe(3)
  })

  it('delete (annullamento soft) incrementa la versione', async () => {
    const fir = await bozzaSalvata()
    await nelTenant(() => repo.delete(fir.id))
    expect((await riga(fir.id)).versione).toBe(2)
  })
})
