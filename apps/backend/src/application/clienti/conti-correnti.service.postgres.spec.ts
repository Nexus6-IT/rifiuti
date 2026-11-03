/**
 * Conti correnti (4.1a) contro un Postgres reale, collegato COME `wasteflow_app`, dentro
 * il `TenantContext`. Il proprietario prepara le aziende e legge lo stato finale. Pulizia solo per
 * id esatti creati (FK a cascata su `tenants`).
 */
import { Prisma, PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
// Le sessioni di questo processo si riconoscono in `pg_stat_activity` (barriera sul lock).
const NOME_APPLICAZIONE = `conti-correnti-${process.pid}`
{
  const u = new URL(process.env.DATABASE_URL)
  u.searchParams.set('application_name', NOME_APPLICAZIONE)
  process.env.DATABASE_URL = u.toString()
}

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaTabelleFatturazione } from '../../test-support/fatturazione-di-test'
import { ContiCorrentiService } from './conti-correnti.service'

describe('ContiCorrentiService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: ContiCorrentiService
  const tenantCreati: string[] = []
  let n = 0
  let contratti = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new ContiCorrentiService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = { in: tenantCreati }
      await owner.allegatoContrattoCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.periodoFatturazioneCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.contrattoCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.cliente.deleteMany({ where: { tenantId: in_ } })
      await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.user.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Conti correnti SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-conti-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `conti-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    return { tenantId: t.id, utenteId: utente.id }
  }

  /** Cliente (ditta con ruolo CLIENTE, col proprietario) che cita le righe indicate. */
  async function clienteConRiferimento(
    tenantId: string,
    campo: Partial<Prisma.ClienteUncheckedCreateInput>
  ) {
    const c = await creaDittaConRuolo(owner, tenantId, 'CLIENTE')
    // `creaDittaConRuolo(…, 'CLIENTE')` crea gia' la riga del cliente: la si aggiorna.
    return owner.cliente.update({ where: { id: c.ruoloId }, data: campo })
  }

  /** Contratto (su un cliente nuovo) che cita le righe indicate. */
  async function contrattoConRiferimento(
    tenantId: string,
    campo: Partial<Prisma.ContrattoClienteUncheckedCreateInput>
  ) {
    const cliente = await clienteConRiferimento(tenantId, {})
    return owner.contrattoCliente.create({
      data: {
        tenantId,
        clienteId: cliente.id,
        numero: `CC-2026-${++contratti}`,
        descrizione: 'Contratto di prova',
        dataInizio: new Date('2026-01-01'),
        ...campo,
      },
    })
  }

  const IBAN = 'IT60X0542811101000000123456'
  const IBAN2 = 'DE89370400440532013000'
  const dati = {
    codice: 'C1',
    descrizione: 'Conto principale',
    banca: 'Banca di prova',
    iban: 'IT60 X054 2811 1010 0000 0123 456',
    bic: 'BPMOIT22',
  }

  it('conto: crea, modifica, disattiva, elimina', async () => {
    const { tenantId, utenteId } = await azienda()
    const creato = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    expect(creato).toMatchObject({
      codice: 'C1',
      iban: IBAN,
      ibanMascherato: 'IT60 **** **** 3456',
      attivo: true,
      versione: 1,
      eliminabile: true,
    })

    const modificato = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creato.id, { banca: 'Altra banca', versione: 1 })
    )
    expect(modificato).toMatchObject({ banca: 'Altra banca', versione: 2 })

    const disattivato = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creato.id, { attivo: false, versione: 2 })
    )
    expect(disattivato).toMatchObject({ attivo: false, versione: 3 })
    expect(await nel(tenantId, () => service.list(tenantId, false))).toHaveLength(0)
    expect(await nel(tenantId, () => service.list(tenantId, true))).toHaveLength(1)

    await nel(tenantId, () => service.elimina(tenantId, utenteId, creato.id, 3))
    expect(await owner.contoCorrente.count({ where: { id: creato.id } })).toBe(0)
  })

  it('l’elenco ha l’IBAN mascherato, il dettaglio quello intero', async () => {
    const { tenantId, utenteId } = await azienda()
    const creato = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    const [riga] = await nel(tenantId, () => service.list(tenantId, true))
    expect(riga.ibanMascherato).toBe('IT60 **** **** 3456')
    expect(JSON.stringify(riga)).not.toContain(IBAN)
    expect((await nel(tenantId, () => service.getById(tenantId, creato.id))).iban).toBe(IBAN)
  })

  it('IBAN duplicato: 409 CONTO_CORRENTE_IBAN_DUPLICATO (anche con spazi e minuscole); in un’altra azienda va bene', async () => {
    const a = await azienda()
    const b = await azienda()
    await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
    await expect(
      nel(a.tenantId, () =>
        service.crea(a.tenantId, a.utenteId, {
          ...dati,
          codice: 'C2',
          iban: 'it60x0542811101000000123456',
        })
      )
    ).rejects.toMatchObject({ status: 409, response: { error: 'CONTO_CORRENTE_IBAN_DUPLICATO' } })
    await expect(
      nel(b.tenantId, () => service.crea(b.tenantId, b.utenteId, dati))
    ).resolves.toMatchObject({ iban: IBAN })
  })

  it('codice duplicato: 409 col proprio codice, distinto da quello dell’IBAN', async () => {
    const { tenantId, utenteId } = await azienda()
    await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    await expect(
      nel(tenantId, () => service.crea(tenantId, utenteId, { ...dati, iban: IBAN2 }))
    ).rejects.toMatchObject({ status: 409, response: { error: 'CONTO_CORRENTE_CODICE_DUPLICATO' } })
  })

  it('modifica con l’IBAN di un altro conto o il codice di un altro conto: 409 distinti; con i propri valori no', async () => {
    const { tenantId, utenteId } = await azienda()
    await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    const secondo = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, { ...dati, codice: 'C2', iban: IBAN2, bic: null })
    )
    await expect(
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, secondo.id, { iban: IBAN, versione: 1 })
      )
    ).rejects.toMatchObject({ status: 409, response: { error: 'CONTO_CORRENTE_IBAN_DUPLICATO' } })
    await expect(
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, secondo.id, { codice: 'C1', versione: 1 })
      )
    ).rejects.toMatchObject({ status: 409, response: { error: 'CONTO_CORRENTE_CODICE_DUPLICATO' } })
    await expect(
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, secondo.id, {
          iban: IBAN2,
          banca: 'Nuova',
          versione: 1,
        })
      )
    ).resolves.toMatchObject({ banca: 'Nuova', versione: 2 })
  })

  /**
   * Barriera deterministica (niente corsa a tempo): una transazione del proprietario esegue `tieni`
   * (un INSERT o un UPDATE) senza committare; la `perdente` del servizio si ferma sul lock
   * (visibile in `pg_stat_activity` come `wait_event_type = 'Lock'`); solo allora il proprietario
   * committa e la perdente vede l'esito. Cosi' il timeout della transazione del servizio
   * (P2028 / 55P03, tradotto in OPERAZIONE_CONCORRENTE) non puo' scattare prima del rilascio.
   * Restituisce il codice d'errore della perdente (`ok` se riesce).
   */
  const conTenitore = async (
    tieni: (tx: Prisma.TransactionClient) => Promise<unknown>,
    perdente: () => Promise<unknown>
  ): Promise<string> => {
    let rilascia!: () => void
    const barriera = new Promise<void>(r => (rilascia = r))
    let tenuta!: () => void
    const eTenuta = new Promise<void>(r => (tenuta = r))
    const tenitore = owner.$transaction(
      async tx => {
        await tieni(tx)
        tenuta()
        await barriera
      },
      { timeout: 60_000 }
    )
    try {
      // Se `tieni` fallisce il tenitore si rifiuta: l'errore vero emerge subito, senza attese appese.
      await Promise.race([eTenuta, tenitore])
      let finita = false
      const esito = perdente()
        .then(
          () => 'ok',
          (e: { response?: { error?: string } }) => e.response?.error ?? 'errore'
        )
        .finally(() => (finita = true))
      const scadenza = Date.now() + 30_000
      while (!finita) {
        const r = await owner.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
            AND wait_event_type = 'Lock'`
        if (r[0].n >= 1) break
        if (Date.now() > scadenza) throw new Error('la perdente non e` in attesa del lock')
        await new Promise(r => setTimeout(r, 25))
      }
      // Se la perdente e' gia' finita senza attendere, l'`expect` mostra il suo esito reale.
      rilascia()
      await tenitore
      return await esito
    } finally {
      rilascia()
      await tenitore.catch(() => undefined)
    }
  }

  it('in concorrenza ogni vincolo dà il proprio codice (IBAN uguale / codice uguale)', async () => {
    const { tenantId, utenteId } = await azienda()

    // Stesso IBAN, codice diverso.
    expect(
      await conTenitore(
        tx =>
          tx.contoCorrente.create({
            data: { tenantId, codice: 'X1', descrizione: 'V', banca: 'B', iban: IBAN },
          }),
        () => nel(tenantId, () => service.crea(tenantId, utenteId, { ...dati, codice: 'X2' }))
      )
    ).toBe('CONTO_CORRENTE_IBAN_DUPLICATO')

    // Stesso codice, IBAN diverso.
    expect(
      await conTenitore(
        tx =>
          tx.contoCorrente.create({
            data: { tenantId, codice: 'Y', descrizione: 'V', banca: 'B', iban: IBAN2 },
          }),
        () =>
          nel(tenantId, () =>
            service.crea(tenantId, utenteId, {
              ...dati,
              codice: 'Y',
              iban: 'FR1420041010050500013M02606',
            })
          )
      )
    ).toBe('CONTO_CORRENTE_CODICE_DUPLICATO')
  })

  it('due modifiche concorrenti sulla stessa versione: una passa, l’altra 409', async () => {
    const { tenantId, utenteId } = await azienda()
    const c = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    // Il proprietario e' la "vincente": aggiorna la riga (versione 2) e non committa.
    const esito = await conTenitore(
      tx =>
        tx.contoCorrente.update({
          where: { id: c.id },
          data: { banca: 'A', versione: { increment: 1 } },
        }),
      () =>
        nel(tenantId, () => service.modifica(tenantId, utenteId, c.id, { banca: 'B', versione: 1 }))
    )
    expect(esito).toBe('CONTO_CORRENTE_MODIFICATO_NEL_FRATTEMPO')
    const riga = await owner.contoCorrente.findUnique({ where: { id: c.id } })
    expect(riga?.versione).toBe(2)
    expect(riga?.banca).toBe('A')
  })

  it('audit di un conto: il JSON non contiene IBAN né BIC', async () => {
    const { tenantId, utenteId } = await azienda()
    const c = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, c.id, { iban: IBAN2, bic: 'DEUTDEFF', versione: 1 })
    )
    await nel(tenantId, () => service.elimina(tenantId, utenteId, c.id, 2))
    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: { startsWith: 'CONTO_CORRENTE_' } },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit.map(a => a.action).sort()).toEqual([
      'CONTO_CORRENTE_CREATO',
      'CONTO_CORRENTE_ELIMINATO',
      'CONTO_CORRENTE_MODIFICATO',
    ])
    const json = JSON.stringify(audit)
    for (const vietato of [IBAN, IBAN2, '0542811101000000123456', 'BPMOIT22', 'DEUTDEFF']) {
      expect(json).not.toContain(vietato)
    }
    const modifica = audit.find(a => a.action === 'CONTO_CORRENTE_MODIFICATO')
    expect((modifica?.metadata as any).campi).toEqual(['iban', 'bic'])
  })

  it('eliminazione con versione vecchia: 409 e la riga resta', async () => {
    const { tenantId, utenteId } = await azienda()
    const c = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, c.id, 7))
    ).rejects.toMatchObject({ status: 409 })
    expect(await owner.contoCorrente.count({ where: { id: c.id } })).toBe(1)
  })

  it('nel contesto di B il conto di A è 404 (lettura, modifica, eliminazione)', async () => {
    const a = await azienda()
    const b = await azienda()
    const c = await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
    await expect(nel(b.tenantId, () => service.getById(b.tenantId, c.id))).rejects.toMatchObject({
      status: 404,
    })
    await expect(
      nel(b.tenantId, () =>
        service.modifica(b.tenantId, b.utenteId, c.id, { attivo: false, versione: 1 })
      )
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      nel(b.tenantId, () => service.elimina(b.tenantId, b.utenteId, c.id, 1))
    ).rejects.toMatchObject({ status: 404 })
    expect(await nel(b.tenantId, () => service.list(b.tenantId, true))).toHaveLength(0)
    expect((await owner.contoCorrente.findUnique({ where: { id: c.id } }))?.versione).toBe(1)
  })

  it('in uso da un cliente: elimina 409, la riga resta, eliminabile false', async () => {
    const { tenantId, utenteId } = await azienda()
    const ids = await creaTabelleFatturazione(owner, tenantId)
    await clienteConRiferimento(tenantId, { contoCorrenteId: ids.contoId })
    const v = await nel(tenantId, () => service.getById(tenantId, ids.contoId))
    expect(v.eliminabile).toBe(false)
    const elenco = await nel(tenantId, () => service.list(tenantId, true))
    expect(elenco.find(x => x.id === ids.contoId)?.eliminabile).toBe(false)
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, ids.contoId, 1))
    ).rejects.toMatchObject({
      status: 409,
      response: {
        error: 'CONTO_CORRENTE_IN_USO',
        message:
          'Il conto corrente è usato da clienti o contratti: disattivalo invece di eliminarlo.',
      },
    })
    expect(await owner.contoCorrente.count({ where: { id: ids.contoId } })).toBe(1)
  })

  it('citata solo da un contratto eliminato: eliminabile false, la FK lo vede (R23)', async () => {
    const { tenantId } = await azienda()
    const ids = await creaTabelleFatturazione(owner, tenantId)
    await contrattoConRiferimento(tenantId, {
      contoCorrenteId: ids.contoId,
      eliminatoIl: new Date(),
    })
    const v = await nel(tenantId, () => service.getById(tenantId, ids.contoId))
    expect(v.eliminabile).toBe(false)
  })
})
