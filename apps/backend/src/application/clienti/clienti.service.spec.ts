import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { SedeNonValidaPerRuoloError } from '../../core/domain/errors'
import { ClientiService } from './clienti.service'
import { controllaRiferimenti } from './riferimenti-fatturazione'

jest.mock('./riferimenti-fatturazione', () => ({ controllaRiferimenti: jest.fn() }))
const controlla = controllaRiferimenti as jest.Mock

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'
const D = 'dddddddd-0000-4000-8000-000000000004'
const S = 'eeeeeeee-0000-4000-8000-000000000005'
const S2 = 'ffffffff-0000-4000-8000-000000000006'
const R1 = '11111111-0000-4000-8000-000000000001'
const R2 = '22222222-0000-4000-8000-000000000002'

const sede = (extra: Record<string, unknown> = {}) => ({
  id: S,
  tenantId: T,
  dittaId: D,
  denominazione: null,
  via: 'Via Roma',
  civico: '1',
  cap: '00100',
  comune: 'Roma',
  provincia: 'RM',
  referente: null,
  email: null,
  telefono: null,
  pec: null,
  principale: true,
  attiva: true,
  ...extra,
})

const riga = (extra: Record<string, unknown> = {}) => ({
  id: C,
  tenantId: T,
  dittaId: D,
  sedeId: S,
  codice: 'CL1',
  nome: null,
  cognome: null,
  codiceDestinatario: null,
  pecFatturazione: null,
  riferimentoAmministrazione: null,
  iban: null,
  contoCorrenteId: null,
  condizionePagamentoId: null,
  esigibilitaIva: 'IMMEDIATA',
  registroIvaId: null,
  speseIncassoId: null,
  bolloId: null,
  agenteId: null,
  ritenutaPercentuale: null,
  listino: null,
  provvigionePredefinita: null,
  tipoProvvigionePredefinita: null,
  note: null,
  attivo: true,
  versione: 1,
  ditta: {
    id: D,
    ragioneSociale: 'Cliente Rossi',
    partitaIva: '12345678903',
    codiceFiscale: null,
    privato: false,
  },
  sede: sede(),
  contoCorrente: null,
  condizionePagamento: null,
  registroIva: null,
  speseIncasso: null,
  bollo: null,
  agente: null,
  ...extra,
})

const dati = {
  ragioneSociale: 'Cliente Rossi',
  partitaIva: '12345678903',
  indirizzo: { via: 'Via Roma', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' },
  email: 'info@rossi.it',
  codice: 'CL1',
  note: 'Pagatore puntuale',
}

const errP = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test', meta })

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

const gruppo = (righe: Array<Record<string, unknown>> = []) => jest.fn().mockResolvedValue(righe)

describe('ClientiService (Prisma finto)', () => {
  let tx: any
  let prisma: any
  let ditte: { risolviPerRuolo: jest.Mock }
  let service: ClientiService

  beforeEach(() => {
    controlla.mockReset().mockResolvedValue([])
    tx = {
      cliente: {
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue({ id: C }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      sedeDitta: { findFirst: jest.fn().mockResolvedValue({ id: S2 }) },
      contrattoCliente: { groupBy: gruppo() },
      $queryRaw: jest.fn().mockResolvedValue([]),
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    ditte = {
      risolviPerRuolo: jest.fn().mockResolvedValue({
        dittaId: D,
        sedeId: S,
        ragioneSocialeDitta: 'Cliente Rossi',
        partitaIva: '12345678903',
        codiceFiscale: null,
        dittaEsistente: false,
        avvisi: [],
        contatti: { email: null, telefono: null, pec: null },
      }),
    }
    service = new ClientiService(prisma, ditte as any)
  })

  describe('crea', () => {
    beforeEach(() => {
      // la prima findFirst di `crea` e' il controllo del ruolo gia' presente, la seconda la rilettura
      tx.cliente.findFirst.mockReset()
      tx.cliente.findFirst.mockResolvedValueOnce(null).mockResolvedValue(riga())
    })

    it('risolve la ditta con ruolo CLIENTE senza i dati del cliente, scrive la riga', async () => {
      const r = await service.crea(T, U, dati)
      expect(ditte.risolviPerRuolo).toHaveBeenCalledWith(
        tx,
        'CLIENTE',
        expect.objectContaining({ ragioneSociale: 'Cliente Rossi', email: 'info@rossi.it' })
      )
      const passati = ditte.risolviPerRuolo.mock.calls[0][2]
      for (const k of ['codice', 'note', 'iban', 'agenteId', 'sedeId']) {
        expect(passati).not.toHaveProperty(k)
      }
      expect(tx.cliente.create.mock.calls[0][0].data).toMatchObject({
        tenantId: T,
        dittaId: D,
        sedeId: S,
        codice: 'CL1',
        note: 'Pagatore puntuale',
        esigibilitaIva: 'IMMEDIATA',
      })
      expect(r).toMatchObject({
        dittaEsistente: false,
        avvisi: [],
        cliente: { id: C, versione: 1, contratti: 0, eliminabile: true },
      })
    })

    it('dati fiscali non validi: 400 CLIENTE_NON_VALIDO prima di aprire la transazione', async () => {
      const e = await errore(service.crea(T, U, { ...dati, codiceDestinatario: 'AB', iban: 'XX' }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse()).toMatchObject({ error: 'CLIENTE_NON_VALIDO' })
      expect(e.getResponse().message).toHaveLength(2)
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(ditte.risolviPerRuolo).not.toHaveBeenCalled()
    })

    it('privato (solo codice fiscale) senza nome o cognome: 400, nessuna transazione', async () => {
      const e = await errore(
        service.crea(T, U, {
          ragioneSociale: 'Mario Rossi',
          codiceFiscale: 'RSSMRA80A01H501U',
          indirizzo: dati.indirizzo,
          nome: 'Mario',
        })
      )
      expect(e.getResponse().message).toEqual([
        'Per un cliente persona fisica indica nome e cognome.',
      ])
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('privato con nome e cognome: creato', async () => {
      ditte.risolviPerRuolo.mockResolvedValue({
        ...(await ditte.risolviPerRuolo()),
        partitaIva: null,
        codiceFiscale: 'RSSMRA80A01H501U',
      })
      await service.crea(T, U, {
        ragioneSociale: 'Mario Rossi',
        codiceFiscale: 'RSSMRA80A01H501U',
        indirizzo: dati.indirizzo,
        nome: 'Mario',
        cognome: 'Rossi',
      })
      expect(tx.cliente.create.mock.calls[0][0].data).toMatchObject({
        nome: 'Mario',
        cognome: 'Rossi',
      })
    })

    it('nome e cognome su una ditta con partita IVA: 400', async () => {
      const e = await errore(service.crea(T, U, { ...dati, nome: 'Mario', cognome: 'Rossi' }))
      expect(e.getResponse().message).toEqual([
        'Nome e cognome si indicano solo per un cliente persona fisica.',
      ])
    })

    it('ditta esistente che risulta un privato: ricontrollo dopo la risoluzione, transazione annullata', async () => {
      ditte.risolviPerRuolo.mockResolvedValue({
        ...(await ditte.risolviPerRuolo()),
        dittaEsistente: true,
        partitaIva: null,
        codiceFiscale: 'RSSMRA80A01H501U',
      })
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toEqual([
        'Per un cliente persona fisica indica nome e cognome.',
      ])
      expect(tx.cliente.create).not.toHaveBeenCalled()
    })

    it('riferimenti non validi: 400 con i messaggi di controllaRiferimenti, niente scrittura', async () => {
      controlla.mockResolvedValue(['Il conto corrente scelto non esiste o è disattivato.'])
      const e = await errore(service.crea(T, U, { ...dati, contoCorrenteId: R1 }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse()).toMatchObject({
        error: 'CLIENTE_NON_VALIDO',
        message: ['Il conto corrente scelto non esiste o è disattivato.'],
      })
      expect(tx.cliente.create).not.toHaveBeenCalled()
    })

    it('passa a controllaRiferimenti solo i riferimenti indicati, col tx e l’azienda', async () => {
      await service.crea(T, U, { ...dati, contoCorrenteId: R1, bolloId: R2, agenteId: '' })
      expect(controlla).toHaveBeenCalledTimes(1)
      const [txPassato, tenant, r] = controlla.mock.calls[0]
      expect(txPassato).toBe(tx)
      expect(tenant).toBe(T)
      expect(r).toEqual({ contoCorrenteId: R1, bolloId: R2 })
    })

    it('sedeId attiva della ditta risolta: è la sede di fatturazione', async () => {
      await service.crea(T, U, { ...dati, sedeId: S2 })
      expect(tx.sedeDitta.findFirst).toHaveBeenCalledWith({
        where: { id: S2, dittaId: D, tenantId: T, attiva: true },
        select: { id: true },
      })
      expect(tx.cliente.create.mock.calls[0][0].data.sedeId).toBe(S2)
    })

    it('sedeId non attiva o di un’altra ditta: SedeNonValidaPerRuoloError(cliente), niente scrittura', async () => {
      tx.sedeDitta.findFirst.mockResolvedValue(null)
      const e = await errore(service.crea(T, U, { ...dati, sedeId: S2 }))
      expect(e).toBeInstanceOf(SedeNonValidaPerRuoloError)
      expect(e.message).toContain('del cliente')
      expect(tx.cliente.create).not.toHaveBeenCalled()
    })

    it('ruolo già presente per la ditta: 400 "Esiste già un cliente per questa ditta"', async () => {
      tx.cliente.findFirst.mockReset().mockResolvedValue({ id: C })
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.message).toBe('Esiste già un cliente per questa ditta')
      expect(tx.cliente.create).not.toHaveBeenCalled()
    })

    it('audit CLIENTE_CREATO con clienteId, dittaId e dittaEsistente e nient’altro', async () => {
      await service.crea(T, U, dati)
      expect(tx.activityLog.create).toHaveBeenCalledTimes(1)
      const { data } = tx.activityLog.create.mock.calls[0][0]
      expect(data).toMatchObject({ tenantId: T, userId: U, action: 'CLIENTE_CREATO' })
      expect(data.metadata).toEqual({ clienteId: C, dittaId: D, dittaEsistente: false })
      expect(JSON.stringify(data)).not.toMatch(/12345678903|CL1|Pagatore/)
    })

    it('P2002 sul codice (target col nome): 409 CLIENTE_CODICE_DUPLICATO', async () => {
      tx.cliente.create.mockRejectedValue(errP('P2002', { target: 'clienti_tenant_id_codice_key' }))
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({ error: 'CLIENTE_CODICE_DUPLICATO' })
    })

    it('P2002 senza target (RLS) con codice già di un altro: riletto, 409 del codice', async () => {
      tx.cliente.create.mockRejectedValue(errP('P2002'))
      prisma.cliente.findFirst
        .mockReset()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ id: 'x' })
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({ error: 'CLIENTE_CODICE_DUPLICATO' })
    })

    it('P2002 senza target (RLS) e codice libero: vincolo della ditta, 400 del ruolo presente', async () => {
      tx.cliente.create.mockRejectedValue(errP('P2002'))
      prisma.cliente.findFirst.mockReset().mockResolvedValueOnce(null).mockResolvedValue(null)
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.message).toBe('Esiste già un cliente per questa ditta')
    })
  })

  describe('listino e provvigione predefinita (4.2a, D7, R13, R26)', () => {
    it('crea con listino 7: 400 col messaggio di D7, nessuna transazione', async () => {
      const e = await errore(service.crea(T, U, { ...dati, listino: 7 }))
      expect(e.getResponse()).toMatchObject({
        error: 'CLIENTE_NON_VALIDO',
        message: ['Il listino del cliente va da 1 a 6.'],
      })
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('crea con provvigione senza tipo: 400 sul tipo, mai il CHECK del database', async () => {
      const e = await errore(service.crea(T, U, { ...dati, provvigionePredefinita: '5' }))
      expect(e.getResponse().message).toEqual([
        'Indica su cosa si calcola la provvigione del cliente.',
      ])
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('crea scrive i tre campi normalizzati', async () => {
      tx.cliente.findFirst.mockResolvedValueOnce(null).mockResolvedValue(riga())
      await service.crea(T, U, {
        ...dati,
        listino: 2,
        provvigionePredefinita: '10 + 5,5',
        tipoProvvigionePredefinita: 'LORDO',
      })
      expect(tx.cliente.create.mock.calls[0][0].data).toMatchObject({
        listino: 2,
        provvigionePredefinita: '10+5.5',
        tipoProvvigionePredefinita: 'LORDO',
      })
    })

    const modifica = (m: Record<string, unknown>) =>
      service.modifica(T, U, C, { versione: 1, ...m } as any)

    it('modifica del solo listino: scrive solo quello, audit col nome del campo', async () => {
      await modifica({ listino: 4 })
      const arg = tx.cliente.updateMany.mock.calls[0][0]
      expect(arg.data).toEqual({ listino: 4, versione: { increment: 1 } })
      expect(tx.activityLog.create.mock.calls[0][0].data.metadata).toEqual({
        clienteId: C,
        campi: ['listino'],
      })
    })

    it('R26: provvigione null azzera anche il tipo', async () => {
      tx.cliente.findFirst.mockResolvedValue(
        riga({ provvigionePredefinita: '5', tipoProvvigionePredefinita: 'LORDO' })
      )
      await modifica({ provvigionePredefinita: null })
      expect(tx.cliente.updateMany.mock.calls[0][0].data).toEqual({
        provvigionePredefinita: null,
        tipoProvvigionePredefinita: null,
        versione: { increment: 1 },
      })
    })

    it('provvigione null con un tipo esplicito: 400 R13', async () => {
      tx.cliente.findFirst.mockResolvedValue(
        riga({ provvigionePredefinita: '5', tipoProvvigionePredefinita: 'LORDO' })
      )
      const e = await errore(
        modifica({ provvigionePredefinita: null, tipoProvvigionePredefinita: 'LORDO' })
      )
      expect(e.getResponse().message).toEqual([
        'Il tipo di provvigione si indica solo con la provvigione.',
      ])
      expect(tx.cliente.updateMany).not.toHaveBeenCalled()
    })

    it('solo il tipo su un cliente senza provvigione: 400 R13', async () => {
      const e = await errore(modifica({ tipoProvvigionePredefinita: 'SCONTATO' }))
      expect(e.getResponse().message).toEqual([
        'Il tipo di provvigione si indica solo con la provvigione.',
      ])
    })

    it('provvigione con formato errato: 400 sul formato', async () => {
      const e = await errore(
        modifica({ provvigionePredefinita: '1+2+3+4', tipoProvvigionePredefinita: 'LORDO' })
      )
      expect(e.getResponse().message).toHaveLength(1)
      expect(e.getResponse().message[0]).toMatch(/provvigione predefinita/)
    })

    it('listino 0 in modifica: 400', async () => {
      const e = await errore(modifica({ listino: 0 }))
      expect(e.getResponse().message).toEqual(['Il listino del cliente va da 1 a 6.'])
    })
  })

  describe('list / getById', () => {
    it('conta i contratti non eliminati e tutti con quattro groupBy per tutta la pagina', async () => {
      prisma.contrattoCliente.groupBy
        .mockReset()
        // vivi come cliente, vivi come cliente di fatturazione, tutti come cliente, tutti come fatturazione
        .mockResolvedValueOnce([{ clienteId: C, _count: { _all: 2 } }])
        .mockResolvedValueOnce([{ clienteFatturazioneId: C, _count: { _all: 1 } }])
        .mockResolvedValueOnce([{ clienteId: C, _count: { _all: 5 } }])
        .mockResolvedValueOnce([{ clienteFatturazioneId: C, _count: { _all: 1 } }])
      const r = await service.list(T, { pagina: 1, dimensione: 20 })
      expect(prisma.contrattoCliente.groupBy).toHaveBeenCalledTimes(4)
      expect(r.totale).toBe(1)
      expect(r.elementi[0]).toMatchObject({ contratti: 3, eliminabile: false })
    })

    it('un cliente citato solo da contratti eliminati: contratti 0 ma non eliminabile (R25)', async () => {
      prisma.contrattoCliente.groupBy
        .mockReset()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ clienteId: C, _count: { _all: 1 } }])
        .mockResolvedValueOnce([])
      const c = await service.getById(T, C)
      expect(c).toMatchObject({ contratti: 0, eliminabile: false })
    })

    it('nessun contratto: eliminabile; riferimenti nel formato { id, codice, descrizione }, sede in SedeDto', async () => {
      tx.cliente.findFirst.mockResolvedValue(
        riga({
          contoCorrente: { id: R1, codice: 'C1', descrizione: 'Conto principale' },
          agente: { id: R2, codice: null, ditta: { ragioneSociale: 'Agenzia Bianchi' } },
          ritenutaPercentuale: new Prisma.Decimal('4.5'),
          esigibilitaIva: 'SCISSIONE',
        })
      )
      const c = await service.getById(T, C)
      expect(c.eliminabile).toBe(true)
      expect(c.contoCorrente).toEqual({ id: R1, codice: 'C1', descrizione: 'Conto principale' })
      expect(c.agente).toEqual({ id: R2, codice: null, descrizione: 'Agenzia Bianchi' })
      expect(c.bollo).toBeNull()
      expect(c.ritenutaPercentuale).toBe('4.50')
      expect(c.esigibilitaIva).toBe('SCISSIONE')
      expect(c.ditta).toEqual({
        id: D,
        ragioneSociale: 'Cliente Rossi',
        partitaIva: '12345678903',
        codiceFiscale: null,
        privato: false,
      })
      expect(c.sedeFatturazione).toMatchObject({ id: S, citta: 'Roma', principale: true })
    })

    it('ricerca: testo di 2+ caratteri su ragione sociale, codice e partita IVA, mai sul codice fiscale', async () => {
      await service.list(T, { testo: 'Ros', soloAttivi: true, pagina: 2, dimensione: 10 })
      const arg = tx.cliente.findMany.mock.calls[0][0]
      expect(arg.where).toEqual({
        tenantId: T,
        attivo: true,
        OR: [
          { codice: { contains: 'Ros', mode: 'insensitive' } },
          { ditta: { ragioneSociale: { contains: 'Ros', mode: 'insensitive' } } },
          { ditta: { partitaIva: { contains: 'Ros' } } },
        ],
      })
      expect(JSON.stringify(arg.where)).not.toContain('codiceFiscale')
      expect(arg.skip).toBe(10)
      expect(arg.take).toBe(10)
      expect(arg.orderBy).toEqual([{ ditta: { ragioneSociale: 'asc' } }, { id: 'asc' }])
      expect(tx.cliente.count).toHaveBeenCalledWith({ where: arg.where })
    })

    it('testo di un solo carattere: ignorato', async () => {
      await service.list(T, { testo: ' R ', pagina: 1, dimensione: 10 })
      expect(tx.cliente.findMany.mock.calls[0][0].where).toEqual({ tenantId: T })
    })

    it('elenco e conteggio nella stessa transazione', async () => {
      await service.list(T, { pagina: 1, dimensione: 10 })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })

    it('getById: non trovato = 404 "Cliente non trovato"', async () => {
      tx.cliente.findFirst.mockResolvedValue(null)
      const e = await errore(service.getById(T, C))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(e.getResponse()).toMatchObject({
        message: 'Cliente non trovato.',
        error: 'CLIENTE_NON_TROVATO',
      })
    })
  })

  describe('modifica', () => {
    const modifica = (m: Record<string, unknown>) =>
      service.modifica(T, U, C, { versione: 1, ...m } as any)
    const campiAudit = () =>
      tx.activityLog.create.mock.calls.map((c: any) => [c[0].data.action, c[0].data.metadata])

    it('versione diversa: 409 CLIENTE_MODIFICATO_NEL_FRATTEMPO, nessuna scrittura', async () => {
      const e = await errore(modifica({ versione: 7, note: 'x' }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({ error: 'CLIENTE_MODIFICATO_NEL_FRATTEMPO' })
      expect(tx.cliente.updateMany).not.toHaveBeenCalled()
    })

    it('cliente di un’altra azienda o assente: 404', async () => {
      tx.cliente.findFirst.mockResolvedValue(null)
      const e = await errore(modifica({ note: 'x' }))
      expect(e).toBeInstanceOf(NotFoundException)
    })

    it('scrittura condizionata alla versione, increment, solo i campi cambiati', async () => {
      await modifica({ note: 'Nuove', codice: 'CL1' })
      const arg = tx.cliente.updateMany.mock.calls[0][0]
      expect(arg.where).toEqual({ id: C, tenantId: T, versione: 1 })
      expect(arg.data).toEqual({ note: 'Nuove', versione: { increment: 1 } })
    })

    it('updateMany a 0 righe: 409', async () => {
      tx.cliente.updateMany.mockResolvedValue({ count: 0 })
      const e = await errore(modifica({ note: 'x' }))
      expect(e.getResponse()).toMatchObject({ error: 'CLIENTE_MODIFICATO_NEL_FRATTEMPO' })
    })

    it('nessun cambiamento: nessuna scrittura né audit', async () => {
      await modifica({ codice: 'CL1', note: null })
      expect(tx.cliente.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('dati non validi: 400 CLIENTE_NON_VALIDO senza messaggi con i valori', async () => {
      const e = await errore(modifica({ iban: 'IT00', codiceDestinatario: 'AB' }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse()).toMatchObject({ error: 'CLIENTE_NON_VALIDO' })
      expect(JSON.stringify(e.getResponse())).not.toContain('IT00')
      expect(tx.cliente.updateMany).not.toHaveBeenCalled()
    })

    it('la validazione vede i dati attuali: PEC con un codice destinatario già presente', async () => {
      tx.cliente.findFirst.mockResolvedValue(riga({ codiceDestinatario: 'ABCDEFG' }))
      const e = await errore(modifica({ pecFatturazione: 'a@pec.it' }))
      expect(e.getResponse().message).toHaveLength(1)
    })

    it('riferimento amministrazione con 0000000 attuale: rifiutato', async () => {
      tx.cliente.findFirst.mockResolvedValue(riga({ codiceDestinatario: '0000000' }))
      const e = await errore(modifica({ riferimentoAmministrazione: 'RIF' }))
      expect(e).toBeInstanceOf(BadRequestException)
    })

    it('privato: nome e cognome non si possono togliere', async () => {
      tx.cliente.findFirst.mockResolvedValue(
        riga({
          nome: 'Mario',
          cognome: 'Rossi',
          ditta: {
            id: D,
            ragioneSociale: 'Mario Rossi',
            partitaIva: null,
            codiceFiscale: 'RSSMRA80A01H501U',
          },
        })
      )
      const e = await errore(modifica({ nome: null }))
      expect(e.getResponse().message).toEqual([
        'Per un cliente persona fisica indica nome e cognome.',
      ])
    })

    it('solo i riferimenti cambiati vengono controllati', async () => {
      tx.cliente.findFirst.mockResolvedValue(riga({ contoCorrenteId: R1 }))
      await modifica({ agenteId: R2, note: 'x' })
      expect(controlla).toHaveBeenCalledTimes(1)
      expect(controlla.mock.calls[0][1]).toBe(T)
      expect(controlla.mock.calls[0][2]).toEqual({ agenteId: R2 })
    })

    it('riferimenti svuotati o invariati: nessun controllo', async () => {
      tx.cliente.findFirst.mockResolvedValue(riga({ contoCorrenteId: R1 }))
      await modifica({ contoCorrenteId: null, note: 'x' })
      expect(controlla).not.toHaveBeenCalled()
    })

    it('riferimento cambiato non valido: 400 con i messaggi', async () => {
      controlla.mockResolvedValue(["L'agente scelto non esiste o è disattivato."])
      const e = await errore(modifica({ agenteId: R2 }))
      expect(e.getResponse()).toMatchObject({
        error: 'CLIENTE_NON_VALIDO',
        message: ["L'agente scelto non esiste o è disattivato."],
      })
      expect(tx.cliente.updateMany).not.toHaveBeenCalled()
    })

    it('cambio sede: ammessa solo una sede attiva della ditta, altrimenti 400', async () => {
      await modifica({ sedeId: S2 })
      expect(tx.sedeDitta.findFirst.mock.calls[0][0].where).toEqual({
        id: S2,
        dittaId: D,
        tenantId: T,
        attiva: true,
      })
      expect(tx.cliente.updateMany.mock.calls[0][0].data).toMatchObject({ sedeId: S2 })
      tx.sedeDitta.findFirst.mockResolvedValue(null)
      const e = await errore(modifica({ sedeId: S2 }))
      expect(e).toBeInstanceOf(SedeNonValidaPerRuoloError)
    })

    it('disattivazione: audit CLIENTE_DISATTIVATO, riattivazione: CLIENTE_RIATTIVATO', async () => {
      await modifica({ attivo: false })
      expect(campiAudit()).toEqual([['CLIENTE_DISATTIVATO', { clienteId: C }]])
      tx.activityLog.create.mockClear()
      tx.cliente.findFirst.mockResolvedValue(riga({ attivo: false }))
      await modifica({ attivo: true })
      expect(campiAudit()).toEqual([['CLIENTE_RIATTIVATO', { clienteId: C }]])
    })

    it('IBAN, PEC e conto: audit CLIENTE_MODIFICATO con i nomi dei campi e senza valori', async () => {
      await modifica({
        iban: 'IT60X0542811101000000123456',
        contoCorrenteId: R1,
        pecFatturazione: 'segreta@pec.it',
      })
      expect(campiAudit()).toEqual([
        [
          'CLIENTE_MODIFICATO',
          { clienteId: C, campi: ['iban', 'contoCorrenteId', 'pecFatturazione'] },
        ],
      ])
      const tutto = JSON.stringify(tx.activityLog.create.mock.calls)
      expect(tutto).not.toContain('IT60X')
      expect(tutto).not.toContain('segreta')
    })

    it('non tocca i contratti (D4)', async () => {
      tx.contrattoCliente.updateMany = jest.fn()
      tx.contrattoCliente.update = jest.fn()
      await modifica({ condizionePagamentoId: R1 })
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
      expect(tx.contrattoCliente.update).not.toHaveBeenCalled()
    })

    it('codice già di un altro cliente (P2002 senza target): 409 CLIENTE_CODICE_DUPLICATO', async () => {
      tx.cliente.updateMany.mockRejectedValue(errP('P2002'))
      // prisma e tx condividono `cliente`: la prima lettura e' la riga, la seconda la rilettura
      tx.cliente.findFirst.mockResolvedValueOnce(riga()).mockResolvedValue({ id: 'altro' })
      const e = await errore(modifica({ codice: 'NUOVO' }))
      expect(e.getResponse()).toMatchObject({ error: 'CLIENTE_CODICE_DUPLICATO' })
    })
  })

  describe('elimina', () => {
    it('deleteMany condizionato alla versione, audit senza dati', async () => {
      await service.elimina(T, U, C, 1)
      expect(tx.cliente.deleteMany).toHaveBeenCalledWith({
        where: { id: C, tenantId: T, versione: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data).toMatchObject({
        action: 'CLIENTE_ELIMINATO',
        metadata: { clienteId: C, dittaId: D },
      })
    })

    it('versione diversa o count 0: 409 CLIENTE_MODIFICATO_NEL_FRATTEMPO', async () => {
      const a = await errore(service.elimina(T, U, C, 9))
      expect(a.getResponse()).toMatchObject({ error: 'CLIENTE_MODIFICATO_NEL_FRATTEMPO' })
      tx.cliente.deleteMany.mockResolvedValue({ count: 0 })
      const b = await errore(service.elimina(T, U, C, 1))
      expect(b).toBeInstanceOf(ConflictException)
    })

    it('assente: 404', async () => {
      tx.cliente.findFirst.mockResolvedValue(null)
      expect(await errore(service.elimina(T, U, C, 1))).toBeInstanceOf(NotFoundException)
    })

    it('con contratti (P2003): 409 CLIENTE_CON_CONTRATTI col testo di D13', async () => {
      tx.cliente.deleteMany.mockRejectedValue(errP('P2003'))
      const e = await errore(service.elimina(T, U, C, 1))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toEqual({
        error: 'CLIENTE_CON_CONTRATTI',
        message:
          'Il cliente ha dei contratti: non si elimina. Disattivalo per non usarlo nei contratti nuovi.',
      })
    })
  })

  describe('attiviPerId', () => {
    it('lista vuota: nessuna query', async () => {
      const m = await TenantContext.run({ tenantId: T }, () => service.attiviPerId(tx, []))
      expect(m.size).toBe(0)
      expect(tx.cliente.findMany).not.toHaveBeenCalled()
    })

    it('mappa id -> campi ereditabili dell’azienda corrente', async () => {
      tx.cliente.findMany.mockResolvedValue([
        { id: C, dittaId: D, attivo: false, contoCorrenteId: R1, agenteId: R2 },
      ])
      const m = await TenantContext.run({ tenantId: T }, () => service.attiviPerId(tx, [C]))
      const arg = tx.cliente.findMany.mock.calls[0][0]
      expect(arg.where).toEqual({ tenantId: T, id: { in: [C] } })
      expect(arg.select).toMatchObject({
        id: true,
        dittaId: true,
        attivo: true,
        contoCorrenteId: true,
        condizionePagamentoId: true,
        agenteId: true,
        registroIvaId: true,
        speseIncassoId: true,
        bolloId: true,
        esigibilitaIva: true,
        ritenutaPercentuale: true,
        codiceDestinatario: true,
        riferimentoAmministrazione: true,
      })
      expect(m.get(C)).toMatchObject({ attivo: false, agenteId: R2 })
    })

    it('blocca le righe con SELECT ... FOR SHARE prima di leggerle (R24, R40)', async () => {
      const ordine: string[] = []
      tx.$queryRaw.mockImplementation(async (strings: readonly string[]) => {
        ordine.push('lock')
        const testo = strings.join('?')
        expect(testo).toContain('FOR SHARE')
        expect(testo).toContain('"clienti"')
        return []
      })
      tx.cliente.findMany.mockImplementation(async () => {
        ordine.push('lettura')
        return []
      })
      await TenantContext.run({ tenantId: T }, () => service.attiviPerId(tx, [C]))
      expect(ordine).toEqual(['lock', 'lettura'])
    })

    it('la ritenuta torna come stringa con due decimali (R40)', async () => {
      tx.cliente.findMany.mockResolvedValue([
        { id: C, dittaId: D, attivo: true, ritenutaPercentuale: new Prisma.Decimal('4.5') },
        { id: R1, dittaId: D, attivo: true, ritenutaPercentuale: null },
      ])
      const m = await TenantContext.run({ tenantId: T }, () => service.attiviPerId(tx, [C, R1]))
      expect(m.get(C)?.ritenutaPercentuale).toBe('4.50')
      expect(m.get(R1)?.ritenutaPercentuale).toBeNull()
    })
  })
})
