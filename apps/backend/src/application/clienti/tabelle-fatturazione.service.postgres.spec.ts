/**
 * Registri IVA, testi di fatturazione e codifiche del contratto (4.1a) contro un Postgres reale,
 * collegato COME `wasteflow_app`, dentro il `TenantContext`. Il proprietario prepara le aziende e
 * legge lo stato finale. Pulizia solo per id esatti creati (FK a cascata su `tenants`).
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

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaTabelleFatturazione } from '../../test-support/fatturazione-di-test'
import { CodificheContrattoService } from './codifiche-contratto.service'
import { RegistriIvaService } from './registri-iva.service'
import { TestiFatturazioneService } from './testi-fatturazione.service'

describe('Registri IVA, testi, codifiche — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registri: RegistriIvaService
  let testi: TestiFatturazioneService
  let codifiche: CodificheContrattoService
  const tenantCreati: string[] = []
  let n = 0
  let contratti = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    registri = new RegistriIvaService(app)
    testi = new TestiFatturazioneService(app)
    codifiche = new CodificheContrattoService(app)
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
        ragioneSociale: 'Tabelle fatturazione SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-tabelle-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `tabelle-${suffisso}@example.com`,
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

  describe('registri IVA', () => {
    const dati = { codice: '7', descrizione: 'Vendite estero', ricevuteSplit: false }

    it('crea, modifica, elimina: codice completato, versioni, audit', async () => {
      const { tenantId, utenteId } = await azienda()
      const creato = await nel(tenantId, () => registri.crea(tenantId, utenteId, dati))
      expect(creato).toMatchObject({
        codice: '07',
        versione: 1,
        attivo: true,
        ricevuteSplit: false,
        eliminabile: true,
      })

      const modificato = await nel(tenantId, () =>
        registri.modifica(tenantId, utenteId, creato.id, { ricevuteSplit: true, versione: 1 })
      )
      expect(modificato).toMatchObject({ versione: 2, ricevuteSplit: true })

      await nel(tenantId, () => registri.elimina(tenantId, utenteId, creato.id, 2))
      expect(await owner.registroIva.count({ where: { id: creato.id } })).toBe(0)

      const audit = await owner.activityLog.findMany({
        where: { tenantId, action: { startsWith: 'REGISTRO_IVA_' } },
        orderBy: { createdAt: 'asc' },
      })
      expect(audit.map(a => a.action)).toEqual([
        'REGISTRO_IVA_CREATO',
        'REGISTRO_IVA_MODIFICATO',
        'REGISTRO_IVA_ELIMINATO',
      ])
      expect((audit[1].metadata as any).campi).toEqual(['ricevuteSplit'])
    })

    it('codice duplicato: 409; in un’altra azienda va bene', async () => {
      const a = await azienda()
      const b = await azienda()
      await nel(a.tenantId, () => registri.crea(a.tenantId, a.utenteId, dati))
      await expect(
        nel(a.tenantId, () => registri.crea(a.tenantId, a.utenteId, { ...dati, codice: '07' }))
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'REGISTRO_IVA_CODICE_DUPLICATO' },
      })
      await expect(
        nel(b.tenantId, () => registri.crea(b.tenantId, b.utenteId, dati))
      ).resolves.toMatchObject({ codice: '07' })
    })

    it('versione vecchia: 409 e la riga resta', async () => {
      const { tenantId, utenteId } = await azienda()
      const creato = await nel(tenantId, () => registri.crea(tenantId, utenteId, dati))
      await expect(
        nel(tenantId, () => registri.elimina(tenantId, utenteId, creato.id, 7))
      ).rejects.toMatchObject({ status: 409 })
      expect(await owner.registroIva.count({ where: { id: creato.id } })).toBe(1)
    })

    it('nel contesto di B il registro di A è 404 (lettura, modifica, eliminazione)', async () => {
      const a = await azienda()
      const b = await azienda()
      const creato = await nel(a.tenantId, () => registri.crea(a.tenantId, a.utenteId, dati))
      await expect(
        nel(b.tenantId, () => registri.getById(b.tenantId, creato.id))
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        nel(b.tenantId, () =>
          registri.modifica(b.tenantId, b.utenteId, creato.id, { attivo: false, versione: 1 })
        )
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        nel(b.tenantId, () => registri.elimina(b.tenantId, b.utenteId, creato.id, 1))
      ).rejects.toMatchObject({ status: 404 })
      expect(await nel(b.tenantId, () => registri.list(b.tenantId, true))).toHaveLength(0)
    })
  })

  describe('testi di fatturazione', () => {
    const dati = { codice: 'T1', titolo: 'Pagamento', righe: ['Prima', 'Seconda', ''] }

    it('crea, modifica, elimina: righe vuote in coda tolte, versioni, audit', async () => {
      const { tenantId, utenteId } = await azienda()
      const creato = await nel(tenantId, () => testi.crea(tenantId, utenteId, dati))
      expect(creato).toMatchObject({
        codice: 'T1',
        righe: ['Prima', 'Seconda'],
        versione: 1,
        eliminabile: true,
      })

      const modificato = await nel(tenantId, () =>
        testi.modifica(tenantId, utenteId, creato.id, { righe: ['Sola riga'], versione: 1 })
      )
      expect(modificato).toMatchObject({ versione: 2, righe: ['Sola riga'] })

      await nel(tenantId, () => testi.elimina(tenantId, utenteId, creato.id, 2))
      expect(await owner.testoFatturazione.count({ where: { id: creato.id } })).toBe(0)

      const audit = await owner.activityLog.findMany({
        where: { tenantId, action: { startsWith: 'TESTO_FATTURAZIONE_' } },
        orderBy: { createdAt: 'asc' },
      })
      expect(audit.map(a => a.action)).toEqual([
        'TESTO_FATTURAZIONE_CREATO',
        'TESTO_FATTURAZIONE_MODIFICATO',
        'TESTO_FATTURAZIONE_ELIMINATO',
      ])
      expect(JSON.stringify(audit.map(a => a.metadata))).not.toContain('Sola riga')
    })

    it('codice duplicato: 409 col codice del vincolo', async () => {
      const { tenantId, utenteId } = await azienda()
      await nel(tenantId, () => testi.crea(tenantId, utenteId, dati))
      await expect(nel(tenantId, () => testi.crea(tenantId, utenteId, dati))).rejects.toMatchObject(
        {
          status: 409,
          response: { error: 'TESTO_FATTURAZIONE_CODICE_DUPLICATO' },
        }
      )
    })

    it('nel contesto di B il testo di A è 404', async () => {
      const a = await azienda()
      const b = await azienda()
      const creato = await nel(a.tenantId, () => testi.crea(a.tenantId, a.utenteId, dati))
      await expect(
        nel(b.tenantId, () => testi.getById(b.tenantId, creato.id))
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        nel(b.tenantId, () =>
          testi.modifica(b.tenantId, b.utenteId, creato.id, { attivo: false, versione: 1 })
        )
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        nel(b.tenantId, () => testi.elimina(b.tenantId, b.utenteId, creato.id, 1))
      ).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('codifiche del contratto', () => {
    it('crea, modifica, elimina: genere fisso, versioni, audit', async () => {
      const { tenantId, utenteId } = await azienda()
      const creata = await nel(tenantId, () =>
        codifiche.crea(tenantId, utenteId, { genere: 'TIPO', descrizione: 'Annuale' })
      )
      expect(creata).toMatchObject({
        genere: 'TIPO',
        codice: '001',
        versione: 1,
        attiva: true,
        eliminabile: true,
      })

      const modificata = await nel(tenantId, () =>
        codifiche.modifica(tenantId, utenteId, creata.id, {
          descrizione: 'Pluriennale',
          versione: 1,
        })
      )
      expect(modificata).toMatchObject({ versione: 2, genere: 'TIPO', descrizione: 'Pluriennale' })

      await nel(tenantId, () => codifiche.elimina(tenantId, utenteId, creata.id, 2))
      expect(await owner.codificaContratto.count({ where: { id: creata.id } })).toBe(0)

      const audit = await owner.activityLog.findMany({
        where: { tenantId, action: { startsWith: 'CODIFICA_CONTRATTO_' } },
        orderBy: { createdAt: 'asc' },
      })
      expect(audit.map(a => a.action)).toEqual([
        'CODIFICA_CONTRATTO_CREATA',
        'CODIFICA_CONTRATTO_MODIFICATA',
        'CODIFICA_CONTRATTO_ELIMINATA',
      ])
    })

    it('primo codice libero: 001, 002, un buco si riempie; i generi sono indipendenti', async () => {
      const { tenantId, utenteId } = await azienda()
      const crea = (genere: 'CATEGORIA' | 'TIPO', descrizione: string, codice?: string) =>
        nel(tenantId, () => codifiche.crea(tenantId, utenteId, { genere, descrizione, codice }))
      expect((await crea('CATEGORIA', 'Uno')).codice).toBe('001')
      expect((await crea('CATEGORIA', 'Due')).codice).toBe('002')
      expect((await crea('TIPO', 'Altro genere')).codice).toBe('001')
      await crea('CATEGORIA', 'Con codice scelto', '004')
      expect((await crea('CATEGORIA', 'Tre')).codice).toBe('003')
      expect(await nel(tenantId, () => codifiche.prossimoCodice(tenantId, 'CATEGORIA'))).toBe('005')
      expect(await nel(tenantId, () => codifiche.prossimoCodice(tenantId, 'MOTIVO_ANNULLO'))).toBe(
        '001'
      )
    })

    it('primo codice libero concorrente: due POST in parallelo ottengono 001 e 002', async () => {
      // Il lock consultivo per (azienda, genere) serializza le creazioni senza codice; il nuovo
      // tentativo su P2002 e' solo la rete di sicurezza per quelle a codice esplicito. Che sia
      // davvero il lock a fare il lavoro lo provano i due test che seguono. Cinque aziende di
      // fila: sul primo giro le connessioni del pool si aprono in serie.
      for (let giro = 0; giro < 5; giro++) {
        const { tenantId, utenteId } = await azienda()
        const [x, y] = await Promise.all([
          nel(tenantId, () =>
            codifiche.crea(tenantId, utenteId, { genere: 'MOTIVO_ANNULLO', descrizione: 'Primo' })
          ),
          nel(tenantId, () =>
            codifiche.crea(tenantId, utenteId, { genere: 'MOTIVO_ANNULLO', descrizione: 'Secondo' })
          ),
        ])
        expect([x.codice, y.codice].sort()).toEqual(['001', '002'])
        expect(
          await owner.codificaContratto.count({ where: { tenantId, genere: 'MOTIVO_ANNULLO' } })
        ).toBe(2)
      }
    })

    it('tre creazioni senza codice in parallelo: 001, 002, 003 (due tentativi non bastano senza il lock)', async () => {
      const { tenantId, utenteId } = await azienda()
      const crea = (descrizione: string) =>
        nel(tenantId, () =>
          codifiche.crea(tenantId, utenteId, { genere: 'MOTIVO_ANNULLO', descrizione })
        )
      const esiti = await Promise.all([crea('A'), crea('B'), crea('C')])
      expect(esiti.map(e => e.codice).sort()).toEqual(['001', '002', '003'])
    })

    it('la creazione senza codice aspetta il lock consultivo di azienda e genere tenuto da un altro', async () => {
      const { tenantId, utenteId } = await azienda()
      let rilascia!: () => void
      let presa!: () => void
      const cancello = new Promise<void>(r => (rilascia = r))
      const lockPreso = new Promise<void>(r => (presa = r))
      const tenuta = owner.$transaction(
        async tx => {
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(
              hashtext('codifiche-contratto-codice:MOTIVO_ANNULLO'), hashtext(${tenantId}))`
          presa()
          await cancello
        },
        { timeout: 30000 }
      )
      await lockPreso
      let finita = false
      const creazione = nel(tenantId, () =>
        codifiche.crea(tenantId, utenteId, { genere: 'MOTIVO_ANNULLO', descrizione: 'Attesa' })
      ).then(v => {
        finita = true
        return v
      })
      try {
        await new Promise(r => setTimeout(r, 800))
        // Senza il lock la creazione sarebbe gia' finita.
        expect(finita).toBe(false)
      } finally {
        rilascia()
        await tenuta
      }
      expect((await creazione).codice).toBe('001')
    }, 20000)

    it('creazione senza codice con una riga del genere bloccata da un’altra transazione: non aspetta e non è un 500', async () => {
      const { tenantId, utenteId } = await azienda()
      const prima = await nel(tenantId, () =>
        codifiche.crea(tenantId, utenteId, { genere: 'TIPO', descrizione: 'Uno' })
      )
      let rilascia!: () => void
      let presa!: () => void
      const cancello = new Promise<void>(r => (rilascia = r))
      const lockPreso = new Promise<void>(r => (presa = r))
      const tenuta = owner.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT id FROM codifiche_contratto WHERE id = ${prima.id}::uuid FOR NO KEY UPDATE`
          presa()
          await cancello
        },
        { timeout: 30000 }
      )
      await lockPreso
      try {
        const nuova = await nel(tenantId, () =>
          codifiche.crea(tenantId, utenteId, { genere: 'TIPO', descrizione: 'Due' })
        )
        expect(nuova.codice).toBe('002')
      } finally {
        rilascia()
        await tenuta
      }
    }, 20000)

    it('codice esplicito duplicato nello stesso genere: 409; in un altro genere va bene', async () => {
      const { tenantId, utenteId } = await azienda()
      await nel(tenantId, () =>
        codifiche.crea(tenantId, utenteId, { genere: 'TIPO', codice: 'AB', descrizione: 'x' })
      )
      await expect(
        nel(tenantId, () =>
          codifiche.crea(tenantId, utenteId, { genere: 'TIPO', codice: 'AB', descrizione: 'y' })
        )
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'CODIFICA_CONTRATTO_CODICE_DUPLICATO' },
      })
      await expect(
        nel(tenantId, () =>
          codifiche.crea(tenantId, utenteId, {
            genere: 'CATEGORIA',
            codice: 'AB',
            descrizione: 'z',
          })
        )
      ).resolves.toMatchObject({ codice: 'AB' })
    })

    it('list filtra per genere e per attiva', async () => {
      const { tenantId, utenteId } = await azienda()
      const c = await nel(tenantId, () =>
        codifiche.crea(tenantId, utenteId, { genere: 'CATEGORIA', descrizione: 'Una' })
      )
      await nel(tenantId, () =>
        codifiche.crea(tenantId, utenteId, { genere: 'TIPO', descrizione: 'Altra' })
      )
      await nel(tenantId, () =>
        codifiche.modifica(tenantId, utenteId, c.id, { attiva: false, versione: 1 })
      )
      const lista = (genere: 'CATEGORIA' | 'TIPO', incluse: boolean) =>
        nel(tenantId, () => codifiche.list(tenantId, { genere, incluseDisattivate: incluse }))
      expect(await lista('CATEGORIA', false)).toHaveLength(0)
      expect(await lista('CATEGORIA', true)).toHaveLength(1)
      expect(await lista('TIPO', false)).toHaveLength(1)
    })

    it('nel contesto di B la codifica di A è 404 e i codici di A non si vedono', async () => {
      const a = await azienda()
      const b = await azienda()
      const creata = await nel(a.tenantId, () =>
        codifiche.crea(a.tenantId, a.utenteId, { genere: 'TIPO', descrizione: 'Di A' })
      )
      await expect(
        nel(b.tenantId, () => codifiche.getById(b.tenantId, creata.id))
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        nel(b.tenantId, () =>
          codifiche.modifica(b.tenantId, b.utenteId, creata.id, { attiva: false, versione: 1 })
        )
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        nel(b.tenantId, () => codifiche.elimina(b.tenantId, b.utenteId, creata.id, 1))
      ).rejects.toMatchObject({ status: 404 })
      // B parte da 001 anche se A ha gia' usato 001
      expect(await nel(b.tenantId, () => codifiche.prossimoCodice(b.tenantId, 'TIPO'))).toBe('001')
    })
  })

  describe('uso reale da clienti e contratti (12b)', () => {
    it('in uso da un cliente: elimina 409, la riga resta, eliminabile false', async () => {
      const { tenantId, utenteId } = await azienda()
      const ids = await creaTabelleFatturazione(owner, tenantId)
      await clienteConRiferimento(tenantId, { registroIvaId: ids.registroId })
      const v = await nel(tenantId, () => registri.getById(tenantId, ids.registroId))
      expect(v.eliminabile).toBe(false)
      const elenco = await nel(tenantId, () => registri.list(tenantId, true))
      expect(elenco.find(x => x.id === ids.registroId)?.eliminabile).toBe(false)
      await expect(
        nel(tenantId, () => registri.elimina(tenantId, utenteId, ids.registroId, 1))
      ).rejects.toMatchObject({
        status: 409,
        response: {
          error: 'REGISTRO_IVA_IN_USO',
          message:
            'Il registro IVA è usato da clienti o contratti: disattivalo invece di eliminarlo.',
        },
      })
      expect(await owner.registroIva.count({ where: { id: ids.registroId } })).toBe(1)
    })

    it("registro usato che diventa ricevute split: 409 REGISTRO_IVA_IN_USO; se non usato si puo'", async () => {
      const { tenantId, utenteId } = await azienda()
      const ids = await creaTabelleFatturazione(owner, tenantId)
      await contrattoConRiferimento(tenantId, { registroIvaId: ids.registroId })
      await expect(
        nel(tenantId, () =>
          registri.modifica(tenantId, utenteId, ids.registroId, {
            ricevuteSplit: true,
            versione: 1,
          })
        )
      ).rejects.toMatchObject({
        status: 409,
        response: {
          error: 'REGISTRO_IVA_IN_USO',
          message:
            'Il registro IVA è usato da clienti o contratti: non può diventare il registro delle ricevute split payment.',
        },
      })
      expect(
        (await owner.registroIva.findUnique({ where: { id: ids.registroId } }))?.ricevuteSplit
      ).toBe(false)
      const libero = await nel(tenantId, () =>
        registri.crea(tenantId, utenteId, {
          codice: '77',
          descrizione: 'Libero',
          ricevuteSplit: false,
        })
      )
      const v = await nel(tenantId, () =>
        registri.modifica(tenantId, utenteId, libero.id, { ricevuteSplit: true, versione: 1 })
      )
      expect(v.ricevuteSplit).toBe(true)
    })

    it('in uso da un contratto: elimina 409, la riga resta, eliminabile false', async () => {
      const { tenantId, utenteId } = await azienda()
      const ids = await creaTabelleFatturazione(owner, tenantId)
      await contrattoConRiferimento(tenantId, { testoFatturazioneId: ids.testoId })
      const v = await nel(tenantId, () => testi.getById(tenantId, ids.testoId))
      expect(v.eliminabile).toBe(false)
      const elenco = await nel(tenantId, () => testi.list(tenantId, true))
      expect(elenco.find(x => x.id === ids.testoId)?.eliminabile).toBe(false)
      await expect(
        nel(tenantId, () => testi.elimina(tenantId, utenteId, ids.testoId, 1))
      ).rejects.toMatchObject({
        status: 409,
        response: {
          error: 'TESTO_FATTURAZIONE_IN_USO',
          message:
            'Il testo di fatturazione è usato da clienti o contratti: disattivalo invece di eliminarlo.',
        },
      })
      expect(await owner.testoFatturazione.count({ where: { id: ids.testoId } })).toBe(1)
    })

    it('in uso da un contratto: elimina 409, la riga resta, eliminabile false', async () => {
      const { tenantId, utenteId } = await azienda()
      const ids = await creaTabelleFatturazione(owner, tenantId)
      await contrattoConRiferimento(tenantId, { tipoId: ids.tipoId })
      const v = await nel(tenantId, () => codifiche.getById(tenantId, ids.tipoId))
      expect(v.eliminabile).toBe(false)
      const elenco = await nel(tenantId, () =>
        codifiche.list(tenantId, { genere: 'TIPO', incluseDisattivate: true })
      )
      expect(elenco.find(x => x.id === ids.tipoId)?.eliminabile).toBe(false)
      await expect(
        nel(tenantId, () => codifiche.elimina(tenantId, utenteId, ids.tipoId, 1))
      ).rejects.toMatchObject({
        status: 409,
        response: {
          error: 'CODIFICA_CONTRATTO_IN_USO',
          message:
            'La codifica del contratto è usata da clienti o contratti: disattivala invece di eliminarla.',
        },
      })
      expect(await owner.codificaContratto.count({ where: { id: ids.tipoId } })).toBe(1)
    })

    it('codifiche: categoria e motivo di annullo citati da un contratto contano come usi', async () => {
      const { tenantId } = await azienda()
      const ids = await creaTabelleFatturazione(owner, tenantId)
      await contrattoConRiferimento(tenantId, {
        categoriaId: ids.categoriaId,
        motivoAnnulloId: ids.motivoId,
      })
      const cat = await nel(tenantId, () => codifiche.getById(tenantId, ids.categoriaId))
      const mot = await nel(tenantId, () => codifiche.getById(tenantId, ids.motivoId))
      expect([cat.eliminabile, mot.eliminabile]).toEqual([false, false])
    })
  })
})
