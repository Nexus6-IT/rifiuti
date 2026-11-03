/**
 * Elenchi degli addebiti (4.2b, Task 20) contro un Postgres reale, collegato COME `wasteflow_app`,
 * dentro il `TenantContext`. Il proprietario prepara aziende, contratti e righe e legge lo stato
 * finale. Pulizia solo per id esatti creati.
 */
import { PrismaClient } from '@prisma/client'
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
// Le barriere su pg_stat_activity guardano solo le connessioni del servizio di questo processo.
const NOME_APPLICAZIONE = `elenchi-addebiti-t20-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  creaLegameDiTest,
  creaMovimentoDiTest,
  pulisciLegamiDiTest,
} from '../../test-support/legami-di-test'
import {
  creaAddebito,
  creaCodiciIvaEcodifiche,
  creaContrattoConElenco,
  creaRiga,
} from '../../test-support/listino-di-test'
import { AzioniListinoService } from './azioni-listino.service'
import { ElenchiAddebitiService } from './elenchi-addebiti.service'

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

describe('ElenchiAddebitiService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: ElenchiAddebitiService
  let azioni: AzioniListinoService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new ElenchiAddebitiService(app)
    azioni = new AzioniListinoService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = { in: tenantCreati }
      await pulisciLegamiDiTest(owner, tenantCreati)
      // Righe e elenchi vanno a cascata col contratto; le FK NoAction verso addebiti e codici IVA
      // chiedono di cancellare prima i contratti.
      await owner.contrattoCliente.updateMany({
        where: { tenantId: in_ },
        data: { contrattoPrincipaleId: null },
      })
      await owner.contrattoCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.addebito.deleteMany({ where: { tenantId: in_ } })
      await owner.codificaAddebito.deleteMany({ where: { tenantId: in_ } })
      await owner.codiceIva.deleteMany({ where: { tenantId: in_ } })
      await owner.activityLog.deleteMany({ where: { tenantId: in_ } })
      await owner.user.deleteMany({ where: { tenantId: in_ } })
      await owner.tenant.deleteMany({ where: { id: in_ } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Elenchi SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-elenchi-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `elenchi-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    return { tenantId: t.id, utenteId: utente.id }
  }

  /** Azienda con un contratto `ATTIVO` e il suo primo elenco `001`. */
  async function conContratto(opzioni: Parameters<typeof creaContrattoConElenco>[2] = {}) {
    const a = await azienda()
    const c = await creaContrattoConElenco(owner, a.tenantId, opzioni)
    return { ...a, ...c }
  }

  it('crea senza codice: propone 001, poi 002; lista ordinata, prossimo codice e contesto', async () => {
    const { tenantId, utenteId, contrattoId, elencoId, clienteId } = await conContratto()
    const cliente = await owner.cliente.findFirstOrThrow({
      where: { id: clienteId, tenantId },
      include: { ditta: true },
    })
    // La fixture ha gia' il 001: il primo libero e' 002.
    expect(await nel(tenantId, () => service.prossimoCodice(tenantId, contrattoId))).toBe('002')
    const creato = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, contrattoId, { descrizione: 'Listino 2026' })
    )
    expect(creato).toMatchObject({
      codice: '002',
      descrizione: 'Listino 2026',
      predefinito: false,
      righe: 0,
      versione: 1,
      modificabile: true,
      eliminabile: true,
      allegati: [],
      contrattoId,
    })
    const { contesto, elenchi } = await nel(tenantId, () => service.list(tenantId, contrattoId))
    expect(elenchi.map(e => e.codice)).toEqual(['001', '002'])
    expect(elenchi[0].id).toBe(elencoId)
    expect(contesto.contratto).toMatchObject({
      id: contrattoId,
      stato: 'ATTIVO',
      clienteRagioneSociale: cliente.ditta.ragioneSociale,
      contrattoPrincipale: null,
      dataInizio: '2026-01-01',
      dataFine: null,
    })
    expect(await nel(tenantId, () => service.prossimoCodice(tenantId, contrattoId))).toBe('003')
  })

  it('il contratto vuoto di elenchi propone 001', async () => {
    const a = await azienda()
    const { contrattoId, elencoId } = await creaContrattoConElenco(owner, a.tenantId)
    await owner.elencoAddebiti.delete({ where: { id: elencoId } })
    expect(await nel(a.tenantId, () => service.prossimoCodice(a.tenantId, contrattoId))).toBe('001')
    const c = await nel(a.tenantId, () =>
      service.crea(a.tenantId, a.utenteId, contrattoId, { descrizione: 'Primo' })
    )
    expect(c.codice).toBe('001')
  })

  it('salva il codice normalizzato: maiuscolo e numerico a tre cifre', async () => {
    const { tenantId, utenteId, contrattoId } = await conContratto()
    const a = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, contrattoId, { codice: 'ab', descrizione: 'Uno' })
    )
    const b = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, contrattoId, { codice: '7', descrizione: 'Due' })
    )
    expect([a.codice, b.codice]).toEqual(['AB', '007'])
    const salvati = await owner.elencoAddebiti.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { codice: true },
    })
    expect(salvati.map(s => s.codice).sort()).toEqual(['007', 'AB'])
  })

  it('codice duplicato nello stesso contratto: 409; in un altro contratto va bene', async () => {
    const { tenantId, utenteId, contrattoId } = await conContratto()
    const e = await errore(
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, contrattoId, { codice: '1', descrizione: 'Doppio' })
      )
    )
    expect(e.getStatus()).toBe(409)
    expect(e.getResponse()).toMatchObject({ error: 'ELENCO_ADDEBITI_CODICE_DUPLICATO' })
    const altro = await creaContrattoConElenco(owner, tenantId)
    const ok = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, altro.contrattoId, { codice: '002', descrizione: 'Altro' })
    )
    expect(ok.codice).toBe('002')
  })

  it('dati non validi: 400 con i messaggi del dominio, nulla scritto', async () => {
    const { tenantId, utenteId, contrattoId } = await conContratto()
    const e = await errore(
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, contrattoId, {
          codice: 'ABCD',
          descrizione: '',
          validoDal: '2026-01-01',
        })
      )
    )
    expect(e.getStatus()).toBe(400)
    expect(e.getResponse()).toMatchObject({ error: 'ELENCO_ADDEBITI_NON_VALIDO' })
    expect(e.getResponse().message).toEqual(
      expect.arrayContaining([
        'Il codice ha da 1 a 3 caratteri alfanumerici.',
        'Inserisci una descrizione per questo elenco.',
      ])
    )
    expect(await owner.elencoAddebiti.count({ where: { contrattoId } })).toBe(1)
  })

  it('lista con validiAl: tiene fine vuota o non prima della data', async () => {
    const { tenantId, utenteId, contrattoId } = await conContratto()
    await nel(tenantId, async () => {
      await service.crea(tenantId, utenteId, contrattoId, {
        codice: 'S',
        descrizione: 'Scaduto',
        validoDal: '2025-01-01',
        validoAl: '2025-12-31',
      })
      await service.crea(tenantId, utenteId, contrattoId, {
        codice: 'V',
        descrizione: 'Valido',
        validoDal: '2026-01-01',
        validoAl: '2026-12-31',
      })
    })
    const { elenchi } = await nel(tenantId, () => service.list(tenantId, contrattoId, '2026-06-01'))
    expect(elenchi.map(e => e.codice)).toEqual(['001', 'V'])
    const e = await errore(nel(tenantId, () => service.list(tenantId, contrattoId, 'ieri')))
    expect(e.getStatus()).toBe(400)
  })

  it('predefinito: impostarlo toglie il flag all’altro nella stessa transazione', async () => {
    const { tenantId, utenteId, contrattoId, elencoId } = await conContratto({ predefinito: true })
    const nuovo = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, contrattoId, { descrizione: 'Nuovo', predefinito: true })
    )
    expect(nuovo.predefinito).toBe(true)
    const vecchio = await owner.elencoAddebiti.findUniqueOrThrow({ where: { id: elencoId } })
    expect(vecchio).toMatchObject({ predefinito: false, versione: 2 })

    // E in modifica: riportarlo sul primo lo toglie al secondo.
    const dopo = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, elencoId, { predefinito: true, versione: 2 })
    )
    expect(dopo).toMatchObject({ predefinito: true, versione: 3 })
    const lista = await owner.elencoAddebiti.findMany({ where: { contrattoId, predefinito: true } })
    expect(lista.map(l => l.id)).toEqual([elencoId])
  })

  it('due predefiniti concorrenti: entrambe 200, alla fine uno solo', async () => {
    const { tenantId, utenteId, contrattoId, elencoId } = await conContratto()
    const b = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, contrattoId, { descrizione: 'B' })
    )
    const c = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, contrattoId, { descrizione: 'C' })
    )
    const esiti = await Promise.allSettled([
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, b.id, { predefinito: true, versione: 1 })
      ),
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, c.id, { predefinito: true, versione: 1 })
      ),
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, elencoId, { predefinito: true, versione: 1 })
      ),
    ])
    expect(esiti.map(e => e.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
    const predefiniti = await owner.elencoAddebiti.count({
      where: { contrattoId, predefinito: true },
    })
    expect(predefiniti).toBe(1)
  })

  it('creazioni concorrenti senza codice: tutte 201 con codici distinti', async () => {
    const { tenantId, utenteId, contrattoId } = await conContratto()
    const esiti = await Promise.all(
      [1, 2, 3, 4].map(i =>
        nel(tenantId, () =>
          service.crea(tenantId, utenteId, contrattoId, { descrizione: `Parallelo ${i}` })
        )
      )
    )
    const codici = esiti.map(e => e.codice)
    expect(new Set(codici).size).toBe(4)
    expect(await owner.elencoAddebiti.count({ where: { contrattoId } })).toBe(5)
  })

  it('modifica: versione, svuota con null, codice normalizzato, audit senza testo libero', async () => {
    const { tenantId, utenteId, contrattoId, elencoId } = await conContratto()
    const contrattoPrima = await owner.contrattoCliente.findUniqueOrThrow({
      where: { id: contrattoId },
    })
    const m1 = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, elencoId, {
        codice: 'x1',
        nota1: 'Una nota riservata',
        validoDal: '2026-01-01',
        validoAl: '2026-12-31',
        versione: 1,
      })
    )
    expect(m1).toMatchObject({
      codice: 'X1',
      nota1: 'Una nota riservata',
      validoDal: '2026-01-01',
      validoAl: '2026-12-31',
      versione: 2,
    })
    const m2 = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, elencoId, {
        nota1: null,
        validoDal: null,
        validoAl: null,
        versione: 2,
      })
    )
    expect(m2).toMatchObject({ nota1: null, validoDal: null, validoAl: null, versione: 3 })

    const vecchia = await errore(
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, elencoId, { descrizione: 'Tardi', versione: 1 })
      )
    )
    expect(vecchia.getStatus()).toBe(409)
    expect(vecchia.getResponse()).toMatchObject({
      error: 'ELENCO_ADDEBITI_MODIFICATO_NEL_FRATTEMPO',
    })

    // Corpo senza differenze: nessuna scrittura, versione invariata.
    const uguale = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, elencoId, { versione: 3 })
    )
    expect(uguale.versione).toBe(3)

    const contrattoDopo = await owner.contrattoCliente.findUniqueOrThrow({
      where: { id: contrattoId },
    })
    expect(contrattoDopo.versione).toBe(contrattoPrima.versione)

    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: { startsWith: 'ELENCO_ADDEBITI_' } },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit.map(a => a.action)).toEqual([
      'ELENCO_ADDEBITI_MODIFICATO',
      'ELENCO_ADDEBITI_MODIFICATO',
    ])
    expect((audit[0].metadata as any).campi).toEqual(['codice', 'nota1', 'validoDal', 'validoAl'])
    expect(JSON.stringify(audit.map(a => a.metadata))).not.toContain('riservata')
    expect(audit.every(a => a.userId === utenteId)).toBe(true)
  })

  it('codice duplicato in modifica: 409', async () => {
    const { tenantId, utenteId, contrattoId, elencoId } = await conContratto()
    const b = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, contrattoId, { descrizione: 'B' })
    )
    const e = await errore(
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, b.id, { codice: '001', versione: 1 })
      )
    )
    expect(e.getStatus()).toBe(409)
    expect(e.getResponse()).toMatchObject({ error: 'ELENCO_ADDEBITI_CODICE_DUPLICATO' })
    expect(elencoId).not.toBe(b.id)
  })

  it('elimina fisica: righe, fasce e allegati vanno a cascata; audit con il numero delle righe', async () => {
    const { tenantId, utenteId, elencoId } = await conContratto()
    const iva = (await creaCodiciIvaEcodifiche(owner, tenantId)).iva22Id
    const addebito = await creaAddebito(owner, tenantId)
    const riga = await owner.rigaAddebito.create({
      data: {
        tenantId,
        elencoId,
        tipo: 'V',
        addebitoId: addebito.id,
        tipoQuantita: 'PESO_NETTO',
        unitaMisura: 'KG',
        prezzo: '1.5',
        codiceIvaId: iva,
      },
    })
    await owner.scaglioneRigaAddebito.create({
      data: { tenantId, rigaId: riga.id, ordine: 1, finoA: '100', prezzo: '0.1', tipoCalcolo: 'A' },
    })
    await owner.allegatoElencoAddebiti.create({
      data: {
        tenantId,
        elencoId,
        posizione: 1,
        nomeFile: 'a.pdf',
        mimeType: 'application/pdf',
        dimensioneByte: 4,
        sha256: 'a'.repeat(64),
        contenuto: Buffer.from('%PDF'),
        caricatoDa: utenteId,
      },
    })
    const vista = await nel(tenantId, () => service.getById(tenantId, elencoId))
    expect(vista.righe).toBe(1)
    expect(vista.allegati).toEqual([
      expect.objectContaining({ posizione: 1, nomeFile: 'a.pdf', dimensioneByte: 4 }),
    ])

    await nel(tenantId, () => service.elimina(tenantId, utenteId, elencoId, vista.versione))
    expect(await owner.elencoAddebiti.count({ where: { id: elencoId } })).toBe(0)
    expect(await owner.rigaAddebito.count({ where: { elencoId } })).toBe(0)
    expect(await owner.scaglioneRigaAddebito.count({ where: { rigaId: riga.id } })).toBe(0)
    expect(await owner.allegatoElencoAddebiti.count({ where: { elencoId } })).toBe(0)
    const audit = await owner.activityLog.findFirstOrThrow({
      where: { tenantId, action: 'ELENCO_ADDEBITI_ELIMINATO' },
    })
    expect((audit.metadata as any).righe).toBe(1)

    const e = await errore(nel(tenantId, () => service.getById(tenantId, elencoId)))
    expect(e.getStatus()).toBe(404)
  })

  it('elimina con versione vecchia: 409 e l’elenco resta', async () => {
    const { tenantId, utenteId, elencoId } = await conContratto()
    const e = await errore(nel(tenantId, () => service.elimina(tenantId, utenteId, elencoId, 7)))
    expect(e.getStatus()).toBe(409)
    expect(await owner.elencoAddebiti.count({ where: { id: elencoId } })).toBe(1)
  })

  it('contratto annullato: lettura ok con modificabile=false, ogni scrittura 409 LISTINO_NON_MODIFICABILE', async () => {
    const { tenantId, utenteId, contrattoId, elencoId } = await conContratto({ stato: 'ANNULLATO' })
    const { elenchi } = await nel(tenantId, () => service.list(tenantId, contrattoId))
    expect(elenchi[0]).toMatchObject({ modificabile: false, eliminabile: false })
    expect(await nel(tenantId, () => service.getById(tenantId, elencoId))).toMatchObject({
      modificabile: false,
    })

    const scritture: Array<() => Promise<unknown>> = [
      () => service.crea(tenantId, utenteId, contrattoId, { descrizione: 'No' }),
      () => service.modifica(tenantId, utenteId, elencoId, { descrizione: 'No', versione: 1 }),
      () => service.elimina(tenantId, utenteId, elencoId, 1),
    ]
    for (const scrittura of scritture) {
      const e = await errore(nel(tenantId, scrittura))
      expect(e.getStatus()).toBe(409)
      expect(e.getResponse()).toMatchObject({
        error: 'LISTINO_NON_MODIFICABILE',
        message: 'Il listino di un contratto annullato non si modifica.',
      })
    }
    expect(await owner.elencoAddebiti.count({ where: { contrattoId } })).toBe(1)
  })

  it('contratto eliminato o di un altro tenant: 404 da entrambi i prefissi', async () => {
    const a = await conContratto()
    const b = await conContratto()
    await owner.contrattoCliente.update({
      where: { id: a.contrattoId },
      data: { eliminatoIl: new Date() },
    })
    const prove: Array<() => Promise<unknown>> = [
      () => service.list(a.tenantId, a.contrattoId),
      () => service.prossimoCodice(a.tenantId, a.contrattoId),
      () => service.crea(a.tenantId, a.utenteId, a.contrattoId, { descrizione: 'X' }),
      () => service.getById(a.tenantId, a.elencoId),
      () => service.modifica(a.tenantId, a.utenteId, a.elencoId, { descrizione: 'X', versione: 1 }),
      () => service.elimina(a.tenantId, a.utenteId, a.elencoId, 1),
      // altro tenant
      () => service.list(a.tenantId, b.contrattoId),
      () => service.crea(a.tenantId, a.utenteId, b.contrattoId, { descrizione: 'X' }),
      () => service.getById(a.tenantId, b.elencoId),
      () => service.modifica(a.tenantId, a.utenteId, b.elencoId, { descrizione: 'X', versione: 1 }),
      () => service.elimina(a.tenantId, a.utenteId, b.elencoId, 1),
    ]
    for (const prova of prove) {
      const e = await errore(nel(a.tenantId, prova))
      expect(e.getStatus()).toBe(404)
    }
    expect(await owner.elencoAddebiti.count({ where: { id: b.elencoId } })).toBe(1)
  })

  it('contratto allegato: il contesto riporta il principale', async () => {
    const a = await conContratto()
    const allegato = await creaContrattoConElenco(owner, a.tenantId, {
      clienteId: a.clienteId,
      contrattoPrincipaleId: a.contrattoId,
    })
    const { contesto } = await nel(a.tenantId, () => service.list(a.tenantId, allegato.contrattoId))
    expect(contesto.contratto.contrattoPrincipale).toMatchObject({ id: a.contrattoId })
  })
  // ---------------------------------------------------------------------------------------
  // Giro finale: audit del predefinito perso, stati ammessi, creazioni concorrenti, lock in ordine
  // ---------------------------------------------------------------------------------------

  it('chi perde il predefinito è nell’audit con l’elenco che l’ha preso (creazione e modifica)', async () => {
    const { tenantId, utenteId, contrattoId, elencoId } = await conContratto({ predefinito: true })
    const nuovo = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, contrattoId, { descrizione: 'Nuovo', predefinito: true })
    )
    await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, elencoId, { predefinito: true, versione: 2 })
    )
    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: 'ELENCO_ADDEBITI_MODIFICATO' },
      orderBy: { createdAt: 'asc' },
    })
    const perdite = audit
      .map(a => a.metadata as any)
      .filter(m => m.perdutoPer !== undefined)
      .map(m => [m.elencoId, m.perdutoPer, m.campi])
    expect(perdite).toEqual([
      [elencoId, nuovo.id, ['predefinito']],
      [nuovo.id, elencoId, ['predefinito']],
    ])
    // Nessun testo libero nell'audit (D16).
    expect(JSON.stringify(audit.map(a => a.metadata))).not.toContain('Nuovo')
  })

  it.each(['BOZZA', 'SOSPESO', 'SOSPESO_MOVIMENTI'] as const)(
    'contratto %s: le scritture sono ammesse (D16)',
    async stato => {
      const { tenantId, utenteId, contrattoId, elencoId } = await conContratto({ stato })
      const creato = await nel(tenantId, () =>
        service.crea(tenantId, utenteId, contrattoId, { descrizione: 'Ammesso' })
      )
      expect(creato).toMatchObject({ modificabile: true, eliminabile: true })
      const mod = await nel(tenantId, () =>
        service.modifica(tenantId, utenteId, elencoId, { descrizione: 'Cambiato', versione: 1 })
      )
      expect(mod).toMatchObject({ descrizione: 'Cambiato', versione: 2 })
      await nel(tenantId, () => service.elimina(tenantId, utenteId, creato.id, 1))
      expect(await owner.elencoAddebiti.count({ where: { contrattoId } })).toBe(1)
    }
  )

  it('due creazioni concorrenti con predefinito: entrambe 201, alla fine uno solo', async () => {
    const { tenantId, utenteId, contrattoId } = await conContratto({ predefinito: true })
    const esiti = await Promise.allSettled([
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, contrattoId, { descrizione: 'B', predefinito: true })
      ),
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, contrattoId, { descrizione: 'C', predefinito: true })
      ),
    ])
    expect(esiti.map(e => e.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await owner.elencoAddebiti.count({ where: { contrattoId, predefinito: true } })).toBe(1)
  })

  it('creazione con codice esplicito contro una senza codice: nessun 500, codici distinti', async () => {
    const { tenantId, utenteId, contrattoId } = await conContratto()
    const esiti = await Promise.allSettled([
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, contrattoId, { descrizione: 'Esplicito', codice: '002' })
      ),
      nel(tenantId, () => service.crea(tenantId, utenteId, contrattoId, { descrizione: 'Auto' })),
    ])
    expect(esiti.map(e => e.status)).toEqual(['fulfilled', 'fulfilled'])
    const codici = (await owner.elencoAddebiti.findMany({ where: { contrattoId } })).map(
      e => e.codice
    )
    expect(new Set(codici).size).toBe(codici.length)
    expect(codici).toHaveLength(3)
  })

  it('creazione: audit ELENCO_ADDEBITI_CREATO con id, numero del contratto e codice, senza testo libero', async () => {
    const { tenantId, utenteId, contrattoId } = await conContratto()
    const creato = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, contrattoId, { descrizione: 'Descrizione riservata' })
    )
    const contratto = await owner.contrattoCliente.findUniqueOrThrow({ where: { id: contrattoId } })
    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: 'ELENCO_ADDEBITI_CREATO' },
    })
    expect(audit).toHaveLength(1)
    expect(audit[0].userId).toBe(utenteId)
    expect(audit[0].metadata).toEqual({
      elencoId: creato.id,
      contrattoId,
      numeroContratto: contratto.numero,
      codice: '002',
    })
  })

  it('copia da due elenchi dello stesso contratto contro il cambio del predefinito: nessun deadlock (I2)', async () => {
    const a = await azienda()
    const listino = await creaCodiciIvaEcodifiche(owner, a.tenantId)
    const arrivo = await creaContrattoConElenco(owner, a.tenantId)
    const b = await creaContrattoConElenco(owner, a.tenantId)
    const secondo = await owner.elencoAddebiti.create({
      data: { tenantId: a.tenantId, contrattoId: b.contrattoId, codice: '002', descrizione: 'B2' },
    })
    // `basso` ha l'id piu' piccolo ed e' il predefinito; il PATCH parte dall'altro (id piu' alto).
    const [basso, alto] = [b.elencoId, secondo.id].sort()
    await owner.elencoAddebiti.update({ where: { id: basso }, data: { predefinito: true } })
    const r1 = await creaRiga(owner, a.tenantId, basso, { codiceIvaId: listino.iva22Id })
    const r2 = await creaRiga(owner, a.tenantId, alto, { codiceIvaId: listino.iva22Id })

    // Barriera: una transazione del proprietario tiene `basso`. Prima si mette in coda la copia
    // (che chiede basso e poi alto), poi il cambio del predefinito di `alto`: rilasciata la
    // barriera, se il cambio tenesse `alto` mentre aspetta `basso` le due sessioni si
    // incrocerebbero (40P01). Con i lock in ordine di id passano entrambe.
    let rilascia!: () => void
    const barriera = new Promise<void>(r => (rilascia = r))
    let tenuto!: () => void
    const eTenuto = new Promise<void>(r => (tenuto = r))
    const tenitore = owner.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM "elenchi_addebiti" WHERE id = ${basso}::uuid FOR UPDATE`
        tenuto()
        await barriera
      },
      { timeout: 60_000 }
    )
    await eTenuto
    const inAttesa = async () => {
      const r = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
          AND wait_event_type = 'Lock'`
      return r[0].n
    }
    const finche = async (attesi: number) => {
      const scadenza = Date.now() + 30_000
      while ((await inAttesa()) < attesi) {
        if (Date.now() > scadenza) throw new Error(`sessioni in attesa di lock: attese ${attesi}`)
        await new Promise(r => setTimeout(r, 25))
      }
    }
    try {
      const copia = nel(a.tenantId, () =>
        azioni.aggiungiRighe(a.tenantId, a.utenteId, arrivo.elencoId, {
          righeIds: [r1.id, r2.id],
          versione: 1,
        })
      )
      await finche(1)
      const cambio = nel(a.tenantId, () =>
        service.modifica(a.tenantId, a.utenteId, alto, { predefinito: true, versione: 1 })
      )
      await finche(2)
      rilascia()
      await tenitore
      const esiti = await Promise.allSettled([copia, cambio])
      expect(esiti.map(e => e.status)).toEqual(['fulfilled', 'fulfilled'])
    } finally {
      rilascia()
      await tenitore.catch(() => undefined)
    }
    const predefiniti = await owner.elencoAddebiti.findMany({
      where: { contrattoId: b.contrattoId, predefinito: true },
    })
    expect(predefiniti.map(e => e.id)).toEqual([alto])
  })

  describe('elenchi citati dai legami dei movimenti (4.3, decisione 8)', () => {
    /** Azienda con listino, contratto, elenco, riga e un legame che cita la riga e l'elenco. */
    async function conLegame(corpoAzienda: () => Promise<{ tenantId: string; utenteId: string }>) {
      const a = await corpoAzienda()
      const listino = await creaCodiciIvaEcodifiche(owner, a.tenantId)
      const c = await creaContrattoConElenco(owner, a.tenantId)
      const riga = await creaRiga(owner, a.tenantId, c.elencoId, { codiceIvaId: listino.iva22Id })
      const m = await creaMovimentoDiTest(owner, a.tenantId)
      const l = await creaLegameDiTest(owner, a.tenantId, {
        movimentoOriginaleId: m.movimentoId,
        registroId: m.registroId,
        verso: m.type,
        stato: 'CONFERMATO',
        clienteId: c.clienteId,
        contrattoId: c.contrattoId,
        elencoId: c.elencoId,
        righe: [{ rigaAddebitoId: riga.id, codiceIvaId: listino.iva22Id, quantita: '100' }],
      })
      return { ...a, ...c, listino, rigaId: riga.id, legameId: l.legameId }
    }

    it('elimina elenco con una riga citata: 409 ELENCO_ADDEBITI_IN_USO, nessuna riga cancellata a cascata', async () => {
      const s = await conLegame(azienda)
      const e = await errore(
        nel(s.tenantId, () => service.elimina(s.tenantId, s.utenteId, s.elencoId, 1))
      )
      expect(e.getStatus()).toBe(409)
      expect(e.getResponse()).toEqual({
        error: 'ELENCO_ADDEBITI_IN_USO',
        message: "L'elenco ha righe usate da movimenti: non si può eliminare.",
      })
      expect(await owner.elencoAddebiti.count({ where: { id: s.elencoId } })).toBe(1)
      expect(await owner.rigaAddebito.count({ where: { id: s.rigaId } })).toBe(1)
      expect(await owner.rigaLegameMovimento.count({ where: { legameId: s.legameId } })).toBe(1)
    })

    it('elimina elenco senza righe citate: 200 come prima', async () => {
      const s = await conLegame(azienda)
      const altro = await owner.elencoAddebiti.create({
        data: {
          tenantId: s.tenantId,
          contrattoId: s.contrattoId,
          codice: '002',
          descrizione: 'Libero',
        },
      })
      await creaRiga(owner, s.tenantId, altro.id, { codiceIvaId: s.listino.iva22Id })
      await nel(s.tenantId, () => service.elimina(s.tenantId, s.utenteId, altro.id, 1))
      expect(await owner.elencoAddebiti.count({ where: { id: altro.id } })).toBe(0)
      expect(await owner.elencoAddebiti.count({ where: { id: s.elencoId } })).toBe(1)
    })

    it('vista dell’elenco: eliminabile false se una sua riga è citata, true altrimenti', async () => {
      const s = await conLegame(azienda)
      const libero = await owner.elencoAddebiti.create({
        data: {
          tenantId: s.tenantId,
          contrattoId: s.contrattoId,
          codice: '002',
          descrizione: 'Libero',
        },
      })
      const { elenchi: elenco } = await nel(s.tenantId, () =>
        service.list(s.tenantId, s.contrattoId)
      )
      expect(elenco.find(x => x.id === s.elencoId)?.eliminabile).toBe(false)
      expect(elenco.find(x => x.id === libero.id)?.eliminabile).toBe(true)
      expect(
        (await nel(s.tenantId, () => service.getById(s.tenantId, s.elencoId))).eliminabile
      ).toBe(false)
    })

    it('chiudere il validoAl dell’elenco usato: 200 (decisione 8, si chiude la validità)', async () => {
      const s = await conLegame(azienda)
      const aperto = await nel(s.tenantId, () =>
        service.modifica(s.tenantId, s.utenteId, s.elencoId, {
          validoDal: '2026-01-01',
          validoAl: '2026-12-31',
          versione: 1,
        })
      )
      const chiuso = await nel(s.tenantId, () =>
        service.modifica(s.tenantId, s.utenteId, s.elencoId, {
          validoAl: '2026-06-30',
          versione: aperto.versione,
        })
      )
      expect(chiuso.validoAl).toBe('2026-06-30')
    })
  })
})
