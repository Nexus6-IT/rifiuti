/**
 * Fase 3 (3.1), Task 5: blocco all'invio a RENTRI dei FIR importati, nel database. Il proprietario
 * (`wasteflow`) prepara e prova (i trigger e i CHECK fermano anche lui); la lettura come
 * `wasteflow_app` conferma che il blocco e' visibile a chi legge. La pulizia cancella SOLO le aziende
 * create qui, per id esatto.
 */
import { PrismaClient } from '@prisma/client'
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'

import { cancellaAziendeDiProva } from '../../test-support/cancella-azienda-di-prova'
describe("Fase 3 (3.1): blocco all'invio dei FIR importati (Postgres reale)", () => {
  const owner = new PrismaClient()
  const tenantCreati: string[] = []
  let n = 0
  const seme = 9_000_000 + (Date.now() % 900_000)

  async function contesto() {
    n++
    const t = (
      await owner.tenant.create({
        data: {
          partitaIva: partitaIvaValida(seme + n * 29),
          ragioneSociale: 'FIR importati SRL',
          country: 'IT',
        },
      })
    ).id
    tenantCreati.push(t)
    const user = (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-firimp-${seme}-${n}`,
          fiscalCode: `FIRI${seme}${n}`.slice(0, 16),
          firstName: 'Prova',
          lastName: 'Importati',
          email: `firimp-${seme}-${n}@example.test`,
        },
      })
    ).id
    const lotto = (
      await owner.lottoImport.create({
        data: {
          tenantId: t,
          importSource: 'WINWASTE',
          archivio: 'WW00012026',
          ambito: 'FIR',
          formatoStaging: 'winwaste-staging/1',
          hashStaging: 'c'.repeat(64),
        },
      })
    ).id
    return { t, user, lotto }
  }

  type Ctx = Awaited<ReturnType<typeof contesto>>

  const dati = (c: Ctx, extra: Record<string, unknown> = {}) => {
    n++
    return {
      tenantId: c.t,
      producerUserId: c.user,
      producerPartitaIva: '00000000000',
      producerName: 'Produttore',
      producerAddress: 'Via Roma 1',
      carrierPartitaIva: '00000000001',
      carrierName: 'Trasportatore',
      carrierVehiclePlate: 'AB123CD',
      receiverPartitaIva: '00000000002',
      receiverName: 'Destinatario',
      receiverAddress: 'Via Roma 2',
      cerCode: '15 01 01',
      wasteDescription: 'Imballaggi',
      wasteCategory: 'Non pericoloso',
      quantity: 5,
      transportDate: new Date('2026-03-05T08:00:00Z'),
      provenienza: 'SPECIALE' as const,
      firNumber: `FIR/IMP/${seme}/${n}`,
      ...extra,
    }
  }

  const prov = (c: Ctx) => ({
    importSource: 'WINWASTE',
    legacyKey: `0001|2026|FORMULARI|${++n}`,
    lottoImportId: c.lotto,
  })

  const MOTIVO = 'Importato: invio a RENTRI bloccato fino alla riconciliazione'

  async function errore(p: Promise<unknown>): Promise<string> {
    try {
      await p
    } catch (e) {
      return String((e as Error).message)
    }
    throw new Error('attesa una violazione, non e arrivata')
  }

  afterAll(async () => {
    for (const t of tenantCreati) await cancellaAziendeDiProva(owner, t)
    await owner.$disconnect()
  })

  it("i FIR gia' presenti hanno bloccato_invio = false e nessun motivo", async () => {
    const [r] = await owner.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT count(*) AS c FROM firs WHERE bloccato_invio OR motivo_blocco_invio IS NOT NULL`
    )
    expect(Number(r.c)).toBe(0)
  })

  it("FIR importato con bloccato_invio = false: rifiutato all'inserimento", async () => {
    const c = await contesto()
    expect(
      await errore(owner.fIR.create({ data: dati(c, { ...prov(c), bloccatoInvio: false }) }))
    ).toContain('nasce con bloccato_invio = true')
    // il default (false) non basta: l'importato deve dichiararlo
    expect(await errore(owner.fIR.create({ data: dati(c, prov(c)) }))).toContain(
      'nasce con bloccato_invio = true'
    )
  })

  it('FIR importato bloccato ma senza motivo: CHECK', async () => {
    const c = await contesto()
    expect(
      await errore(owner.fIR.create({ data: dati(c, { ...prov(c), bloccatoInvio: true }) }))
    ).toContain('firs_bloccato_invio_motivo_check')
  })

  it('FIR importato bloccato con motivo: si inserisce', async () => {
    const c = await contesto()
    const f = await owner.fIR.create({
      data: dati(c, { ...prov(c), bloccatoInvio: true, motivoBloccoInvio: MOTIVO }),
    })
    expect(f.bloccatoInvio).toBe(true)
    expect(f.motivoBloccoInvio).toBe(MOTIVO)
    expect(f.importSource).toBe('WINWASTE')
  })

  it('UPDATE da bloccato a sbloccato di un FIR importato: rifiutato, anche dal proprietario', async () => {
    const c = await contesto()
    const f = await owner.fIR.create({
      data: dati(c, { ...prov(c), bloccatoInvio: true, motivoBloccoInvio: MOTIVO }),
    })
    expect(
      await errore(owner.fIR.update({ where: { id: f.id }, data: { bloccatoInvio: false } }))
    ).toContain('non si sblocca prima della riconciliazione')
    expect(
      await errore(
        owner.fIR.update({
          where: { id: f.id },
          data: { bloccatoInvio: false, motivoBloccoInvio: null },
        })
      )
    ).toContain('non si sblocca prima della riconciliazione')
    // un'altra colonna, e il motivo, si aggiornano
    const ok = await owner.fIR.update({
      where: { id: f.id },
      data: { wasteDescription: 'altro', motivoBloccoInvio: `${MOTIVO} (nota)` },
    })
    expect(ok.bloccatoInvio).toBe(true)
  })

  it("un FIR non importato resta sbloccato di default; bloccato a mano e' ammesso (blocco piu' largo dell'import)", async () => {
    const c = await contesto()
    const normale = await owner.fIR.create({ data: dati(c) })
    expect(normale.bloccatoInvio).toBe(false)
    expect(normale.motivoBloccoInvio).toBeNull()
    const aMano = await owner.fIR.create({
      data: dati(c, { bloccatoInvio: true, motivoBloccoInvio: 'bloccato a mano' }),
    })
    expect(aMano.bloccatoInvio).toBe(true)
    expect(aMano.importSource).toBeNull()
    // il blocco a mano si puo' togliere: la regola d'immutabilita' vale per gli importati
    const sbloccato = await owner.fIR.update({
      where: { id: aMano.id },
      data: { bloccatoInvio: false },
    })
    expect(sbloccato.bloccatoInvio).toBe(false)
  })

  it("un FIR non importato non puo' avere solo parte della provenienza (rete della migration precedente)", async () => {
    const c = await contesto()
    expect(
      await errore(
        owner.fIR.create({
          data: dati(c, {
            importSource: 'WINWASTE',
            bloccatoInvio: true,
            motivoBloccoInvio: MOTIVO,
          }),
        })
      )
    ).toContain('firs_provenienza_check')
  })
})
