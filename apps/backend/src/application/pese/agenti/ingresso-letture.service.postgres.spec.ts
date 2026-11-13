/**
 * Ingresso delle letture contro un Postgres reale, COME `wasteflow_app` (RLS ENABLE+FORCE). Il
 * proprietario prepara le aziende e rilegge; la pulizia cancella SOLO le aziende create qui.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55444/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { randomUUID } from 'crypto'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import {
  coppiaChiavi,
  creaAgenteAttivoDiProva,
  creaAziendaPesaDiProva,
  creaStrumentoDiProva,
  firmaLetturaDiProva,
  payloadDiProva,
  type AgenteDiProva,
  type AziendaPesaDiProva,
} from '../../../test-support/agenti-pesa-di-test'
import { MS_MASSIMI_LOTTO, IngressoLettureService } from './ingresso-letture.service'
import { LottoOltreTempoError } from '../errori-pese'

describe('IngressoLettureService (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: IngressoLettureService
  const tenantCreati: string[] = []

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    servizio = new IngressoLettureService(app)
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    if (tenantCreati.length) await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await Promise.all([owner.$disconnect(), app.$disconnect()])
  })

  interface Scenario {
    a: AziendaPesaDiProva
    agente: AgenteDiProva
    strumento: string
  }
  async function scenario(simulazione = false, portata: number | null = 60000): Promise<Scenario> {
    const a = await creaAziendaPesaDiProva(owner, { simulazione })
    tenantCreati.push(a.tenantId)
    const agente = await creaAgenteAttivoDiProva(owner, a)
    const strumento = await creaStrumentoDiProva(owner, a, {
      agenteId: agente.id,
      portataMaxKg: portata,
    })
    return { a, agente, strumento }
  }
  const lettura = (s: Scenario, extra: Parameters<typeof payloadDiProva>[1] = {}) =>
    firmaLetturaDiProva(
      s.agente.chiavi.privata,
      payloadDiProva({ agenteId: s.agente.id, strumentoId: s.strumento }, extra)
    )
  const invia = (s: Scenario, el: { payload: string; firma: string }[], ricezione = new Date()) =>
    servizio.riceviLotto({ id: s.agente.id, tenantId: s.a.tenantId }, el, ricezione)
  const righe = (s: Scenario) => owner.letturaPesa.count({ where: { tenantId: s.a.tenantId } })

  it('lotto di 3 (valida, firma alterata, instabile): una sola riga, esiti per posizione', async () => {
    const s = await scenario()
    const buona = lettura(s, { sequenza: 1 })
    const alterata = lettura(s, { sequenza: 2 })
    alterata.payload = Buffer.from(
      Buffer.from(alterata.payload, 'base64').toString().replace('12340', '99999')
    ).toString('base64')
    const instabile = lettura(s, { sequenza: 3, stabile: false })

    const esiti = await invia(s, [buona, alterata, instabile])

    expect(esiti[0]).toMatchObject({ esito: 'ACCETTATA' })
    expect(esiti[1]).toMatchObject({ esito: 'RIFIUTATA', codice: 'FIRMA_NON_VALIDA' })
    expect(esiti[2]).toMatchObject({ esito: 'RIFIUTATA', codice: 'PESO_INSTABILE' })
    expect(await righe(s)).toBe(1)
  })

  it('stesso lotto due volte: GIA_RICEVUTA con lo stesso letturaId, nessun duplicato', async () => {
    const s = await scenario()
    const el = lettura(s, { sequenza: 1 })
    const [prima] = await invia(s, [el])
    const [seconda] = await invia(s, [el])
    expect(seconda).toMatchObject({ esito: 'GIA_RICEVUTA' })
    expect((seconda as { letturaId: string }).letturaId).toBe(
      (prima as { letturaId: string }).letturaId
    )
    expect(await righe(s)).toBe(1)
  })

  it('stessa lettura in due richieste parallele: una riga', async () => {
    const s = await scenario()
    const el = lettura(s, { sequenza: 1 })
    const esiti = await Promise.all([invia(s, [el]), invia(s, [el]), invia(s, [el])])
    const tutti = esiti.map(e => e[0].esito).sort()
    expect(tutti.filter(e => e === 'ACCETTATA')).toHaveLength(1)
    expect(tutti.filter(e => e === 'GIA_RICEVUTA')).toHaveLength(2)
    expect(await righe(s)).toBe(1)
  })

  it('stessa chiave con payload diverso: CHIAVE_RIUSATA', async () => {
    const s = await scenario()
    const chiave = randomUUID()
    await invia(s, [lettura(s, { sequenza: 1, chiaveIdempotenza: chiave })])
    const [r] = await invia(s, [
      lettura(s, { sequenza: 2, chiaveIdempotenza: chiave, pesoKg: '100.00' }),
    ])
    expect(r).toMatchObject({ esito: 'RIFIUTATA', codice: 'CHIAVE_RIUSATA' })
    expect(await righe(s)).toBe(1)
  })

  it('sequenza già usata da un’altra lettura: SEQUENZA_GIA_USATA con ultimaSequenza, nessuna riga nuova', async () => {
    const s = await scenario()
    await invia(s, [lettura(s, { sequenza: 5 })])
    await invia(s, [lettura(s, { sequenza: 9 })])
    // altra lettura (chiave diversa) che riusa la sequenza 5: l'agente ha perso il contatore
    const [r] = await invia(s, [lettura(s, { sequenza: 5, pesoKg: '77.00' })])
    expect(r).toMatchObject({
      esito: 'RIFIUTATA',
      codice: 'SEQUENZA_GIA_USATA',
      ultimaSequenza: 9,
    })
    expect(await righe(s)).toBe(2)
  })

  it('un vero replay della stessa lettura resta GIA_RICEVUTA (non SEQUENZA_GIA_USATA, non accettata di nuovo)', async () => {
    const s = await scenario()
    const el = lettura(s, { sequenza: 5 })
    await invia(s, [el])
    const [r] = await invia(s, [el])
    expect(r).toMatchObject({ esito: 'GIA_RICEVUTA' })
    expect(await righe(s)).toBe(1)
  })

  it('strumento di un’altra azienda nel payload firmato dall’agente A: STRUMENTO_NON_ASSEGNATO, nessuna riga in B', async () => {
    const a = await scenario()
    const b = await scenario()
    const el = firmaLetturaDiProva(
      a.agente.chiavi.privata,
      payloadDiProva({ agenteId: a.agente.id, strumentoId: b.strumento })
    )
    const [r] = await invia(a, [el])
    expect(r).toMatchObject({ esito: 'RIFIUTATA', codice: 'STRUMENTO_NON_ASSEGNATO' })
    expect(await righe(b)).toBe(0)
    expect(await righe(a)).toBe(0)
  })

  it('strumento della stessa azienda ma assegnato a un altro agente: STRUMENTO_NON_ASSEGNATO', async () => {
    const s = await scenario()
    const altro = await creaAgenteAttivoDiProva(owner, s.a)
    const strumentoAltro = await creaStrumentoDiProva(owner, s.a, { agenteId: altro.id })
    const el = firmaLetturaDiProva(
      s.agente.chiavi.privata,
      payloadDiProva({ agenteId: s.agente.id, strumentoId: strumentoAltro })
    )
    const [r] = await invia(s, [el])
    expect(r).toMatchObject({ esito: 'RIFIUTATA', codice: 'STRUMENTO_NON_ASSEGNATO' })
  })

  it('firma di un’altra chiave: FIRMA_NON_VALIDA; agenteId diverso nel payload: AGENTE_DIVERSO', async () => {
    const s = await scenario()
    const estranea = coppiaChiavi()
    const [r1] = await invia(s, [
      firmaLetturaDiProva(
        estranea.privata,
        payloadDiProva({ agenteId: s.agente.id, strumentoId: s.strumento })
      ),
    ])
    expect(r1).toMatchObject({ codice: 'FIRMA_NON_VALIDA' })
    const [r2] = await invia(s, [
      firmaLetturaDiProva(
        s.agente.chiavi.privata,
        payloadDiProva({ agenteId: randomUUID(), strumentoId: s.strumento })
      ),
    ])
    expect(r2).toMatchObject({ codice: 'AGENTE_DIVERSO' })
  })

  it('simulata: rifiutata senza permesso, accettata con il permesso', async () => {
    const senza = await scenario(false)
    const sim = { driver: 'SIMULATA', simulata: true, alibiId: 'SIM-000001' }
    const [r1] = await invia(senza, [lettura(senza, sim)])
    expect(r1).toMatchObject({ codice: 'SIMULAZIONE_NON_AMMESSA' })
    expect(await righe(senza)).toBe(0)

    const con = await scenario(true)
    const [r2] = await invia(con, [lettura(con, sim)])
    expect(r2).toMatchObject({ esito: 'ACCETTATA' })
    expect((r2 as { avvisi?: string[] }).avvisi).toContain('Lettura simulata: non è un peso reale.')
    const riga = await owner.letturaPesa.findFirstOrThrow({ where: { tenantId: con.a.tenantId } })
    expect(riga.simulata).toBe(true)
  })

  it('fuori portata e orologio avanti: rifiutate con il codice giusto', async () => {
    const s = await scenario(false, 1000)
    const [r1] = await invia(s, [lettura(s, { pesoKg: '1000.01' })])
    expect(r1).toMatchObject({ codice: 'FUORI_PORTATA' })
    const [r2] = await invia(s, [
      lettura(s, { pesoKg: '500.00', oraAgente: new Date(Date.now() + 10 * 60_000).toISOString() }),
    ])
    expect(r2).toMatchObject({ codice: 'OROLOGIO_AVANTI' })
  })

  it('alibi già usato: dalla stessa strumento (lettura) e da una pesata MANUALE', async () => {
    const s = await scenario()
    await invia(s, [lettura(s, { sequenza: 1, alibiId: 'A-1' })])
    const [r1] = await invia(s, [lettura(s, { sequenza: 2, alibiId: 'A-1' })])
    expect(r1).toMatchObject({ codice: 'ALIBI_GIA_USATO' })

    // Una pesata MANUALE con lo stesso alibi sullo stesso strumento: la lettura non entra.
    const acc = await owner.accessoPesa.create({
      data: {
        tenantId: s.a.tenantId,
        registroId: s.a.registroId,
        anno: 2026,
        numero: 1,
        verso: 'CARICO',
        modo: 'DOPPIA',
        apertoDa: s.a.utenteId,
      },
    })
    await owner.pesata.create({
      data: {
        tenantId: s.a.tenantId,
        accessoId: acc.id,
        ordine: 1,
        fonte: 'MANUALE',
        strumentoId: s.strumento,
        alibiId: 'MANUALE-9',
        pesoKg: '1000.00',
        stabile: true,
        oraRicezione: new Date(),
        operatoreId: s.a.utenteId,
        motivoManuale: 'prova',
        chiaveIdempotenza: randomUUID(),
        impronta: 'a'.repeat(64),
      },
    })
    const [r2] = await invia(s, [lettura(s, { sequenza: 3, alibiId: 'MANUALE-9' })])
    expect(r2).toMatchObject({ codice: 'ALIBI_GIA_USATO' })
  })

  it('firma non valida due volte in un minuto: un solo audit senza utente; ultima_sequenza non regredisce', async () => {
    const s = await scenario()
    const cattiva = { payload: Buffer.from('{}').toString('base64'), firma: `${'A'.repeat(86)}==` }
    await invia(s, [cattiva])
    await invia(s, [cattiva])
    const audit = await owner.activityLog.findMany({
      where: { tenantId: s.a.tenantId, action: 'PESA_AGENTE_FIRMA_NON_VALIDA' },
    })
    expect(audit).toHaveLength(1)
    expect(audit[0].userId).toBeNull()

    await invia(s, [lettura(s, { sequenza: 10 })])
    await invia(s, [lettura(s, { sequenza: 7 })])
    const agente = await owner.agentePesa.findUniqueOrThrow({ where: { id: s.agente.id } })
    expect(agente.ultimaSequenza).toBe(10n)
  })

  it('byte conservati: il payload salvato è identico a quello firmato (riverificabile)', async () => {
    const s = await scenario()
    const el = lettura(s, { sequenza: 1 })
    const [r] = await invia(s, [el])
    const riga = await owner.letturaPesa.findUniqueOrThrow({
      where: { id: (r as { letturaId: string }).letturaId },
    })
    expect(Buffer.from(riga.payload, 'utf8').toString('base64')).toBe(el.payload)
    expect(riga.firma).toBe(el.firma)
  })

  it('lotto oltre il tempo massimo: errore (503), mai RIFIUTATA; gli elementi già scritti restano', async () => {
    const s = await scenario()
    let t = 0
    servizio.orologio = () => (t += MS_MASSIMI_LOTTO / 2)
    try {
      await expect(
        invia(s, [
          lettura(s, { sequenza: 1 }),
          lettura(s, { sequenza: 2 }),
          lettura(s, { sequenza: 3 }),
        ])
      ).rejects.toBeInstanceOf(LottoOltreTempoError)
    } finally {
      servizio.orologio = () => Date.now()
    }
    expect(await righe(s)).toBeLessThan(3)
    const [r] = await invia(s, [lettura(s, { sequenza: 4 })])
    expect(r.esito).toBe('ACCETTATA')
  })
})
