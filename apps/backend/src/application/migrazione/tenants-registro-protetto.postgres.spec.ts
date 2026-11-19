/**
 * I3: il trigger `tenants_registro_protetto` impedisce di cancellare un'azienda che ha registro, FIR
 * o lotti di import, anche al proprietario; il flag di transazione e' riconosciuto solo se la
 * sessione e' superuser. Pulizia SOLO con `cancellaAziendeDiProva` (id esatti).
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import {
  cancellaAziendaDiProva,
  cancellaAziendeDiProva,
  GUC_CONSENTI_CANCELLAZIONE_AZIENDA,
} from '../../test-support/cancella-azienda-di-prova'
import { creaFirDiTest, creaMovimentoDiTest } from '../../test-support/legami-di-test'

describe('I3: tenants_registro_protetto (Postgres reale)', () => {
  const owner = new PrismaClient()
  const app = clientComeRuolo('wasteflow_app', process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev')
  const sistema = clientComeRuolo(
    'wasteflow_sistema',
    process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev'
  )
  const tenantCreati: string[] = []
  let n = 0
  const seme = 9_000_000 + (Date.now() % 1_000_000)

  async function azienda(): Promise<string> {
    n++
    const t = (
      await owner.tenant.create({
        data: {
          partitaIva: partitaIvaValida(seme + n * 23),
          ragioneSociale: 'Cascata SRL',
          country: 'IT',
        },
      })
    ).id
    tenantCreati.push(t)
    return t
  }

  const esiste = async (id: string): Promise<boolean> =>
    (await owner.tenant.count({ where: { id } })) === 1

  async function conMovimento(): Promise<string> {
    const t = await azienda()
    await creaMovimentoDiTest(owner, t)
    return t
  }
  async function conFir(): Promise<string> {
    const t = await azienda()
    const u = await owner.user.create({
      data: {
        tenantId: t,
        keycloakId: `i3-${t}`,
        fiscalCode: 'RSSMRA80A01H501U',
        email: `i3-${t}@example.test`,
        firstName: 'A',
        lastName: 'B',
        role: 'ADMIN',
      },
    })
    await creaFirDiTest(owner, t, u.id)
    return t
  }
  async function conLotto(): Promise<string> {
    const t = await azienda()
    await owner.$executeRawUnsafe(
      `INSERT INTO lotti_import (tenant_id, import_source, archivio, ambito, formato_staging, hash_staging, updated_at)
       VALUES ('${t}'::uuid, 'WINWASTE', 'WW00012026', 'ANAGRAFICHE', 'winwaste-staging/1', '${'a'.repeat(64)}', now())`
    )
    return t
  }

  const come = (cl: PrismaClient, id: string, flag = false) =>
    cl.$transaction(async tx => {
      if (flag) await tx.$executeRawUnsafe(`SET LOCAL ${GUC_CONSENTI_CANCELLAZIONE_AZIENDA} = 'on'`)
      await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${id}'::uuid`)
    })

  afterAll(async () => {
    await cancellaAziendeDiProva(owner, tenantCreati)
    await owner.$disconnect()
    await app.$disconnect()
    await sistema.$disconnect()
  })

  const casi: [string, () => Promise<string>][] = [
    ['movimenti', conMovimento],
    ['FIR', conFir],
    ['lotti di import', conLotto],
  ]

  describe.each(casi)('azienda con %s', (_nome, prepara) => {
    it('il proprietario non la cancella: 23514, messaggio senza dati', async () => {
      const t = await prepara()
      const errore = await come(owner, t).catch((e: Error) => e)
      expect(errore).toBeInstanceOf(Error)
      const testo = String((errore as Error).message)
      expect(testo).toMatch(/23514|cancellazione azienda rifiutata/)
      expect(testo).not.toContain(t)
      expect(testo).not.toContain('Cascata SRL')
      expect(await esiste(t)).toBe(true)
    })

    it('il ruolo applicativo non la cancella (nemmeno col flag impostato)', async () => {
      const t = await prepara()
      for (const flag of [false, true]) {
        await expect(come(app, t, flag)).rejects.toThrow(/cancellazione azienda rifiutata|23514/)
        expect(await esiste(t)).toBe(true)
      }
    })

    it('il ruolo di sistema non la cancella (nemmeno col flag impostato)', async () => {
      const t = await prepara()
      for (const flag of [false, true]) {
        await expect(come(sistema, t, flag)).rejects.toThrow(
          /cancellazione azienda rifiutata|23514/
        )
        expect(await esiste(t)).toBe(true)
      }
    })

    it('il proprietario col flag di transazione la cancella (cascata compresa)', async () => {
      const t = await prepara()
      await owner.$transaction(tx => cancellaAziendaDiProva(tx, t))
      expect(await esiste(t)).toBe(false)
    })
  })

  it("un'azienda senza movimenti, FIR o lotti si cancella senza flag", async () => {
    const t = await azienda()
    await come(owner, t)
    expect(await esiste(t)).toBe(false)
  })

  it('il flag vale solo per la transazione: fuori, la protezione torna', async () => {
    const t = await conMovimento()
    await owner.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ${GUC_CONSENTI_CANCELLAZIONE_AZIENDA} = 'on'`)
    })
    await expect(come(owner, t)).rejects.toThrow(/cancellazione azienda rifiutata|23514/)
    expect(await esiste(t)).toBe(true)
  })
})
