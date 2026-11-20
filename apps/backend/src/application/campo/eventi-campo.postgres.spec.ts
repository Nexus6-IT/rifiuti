/**
 * App campo P4 contro un Postgres reale, collegato COME `wasteflow_app`: registrazione degli eventi
 * dal campo (idempotenza, lock su `versione`, conflitti «da riconciliare») ed elenco d'ufficio.
 * Lo schema (append-only, RLS, unici) e' in `eventi-campo.schema.postgres.spec.ts`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

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
import { RitiriRepository } from '../../infrastructure/persistence/ritiri.repository'
import { cancellaAziendeDiProva } from '../../test-support/cancella-azienda-di-prova'
import {
  creaAziendaCampo,
  creaRitiroCampo,
  type AziendaCampo,
} from '../../test-support/campo-di-test'
import { RitiroDatiNonValidiError, RitiroNonTrovatoError } from '../ritiri/errori-ritiri'
import { AutistaNonCollegatoError, EventoCampoDiAltroUtenteError } from './errori-campo'
import { EventiCampoService } from './eventi-campo.service'

describe('Eventi dal campo P4 — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: EventiCampoService
  const creati: string[] = []

  const azienda = async (): Promise<AziendaCampo> => {
    const a = await creaAziendaCampo(owner)
    creati.push(a.t)
    return a
  }
  const nelTenant = <R>(t: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: t }, async () => await fn())

  const evento = (ritiroId: string, extra: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(),
    ritiroId,
    tipo: 'RITIRO_ESEGUITO',
    versioneVista: 1,
    rilevatoIl: '2026-12-01T08:30:00.000Z',
    ...extra,
  })
  const nonEseguito = (ritiroId: string, extra: Record<string, unknown> = {}) =>
    evento(ritiroId, { tipo: 'RITIRO_NON_ESEGUITO', dati: { motivo: 'Cliente assente' }, ...extra })

  const registra = (a: AziendaCampo, utente: string, e: ReturnType<typeof evento>) =>
    nelTenant(a.t, () => servizio.registra(a.t, utente, e))
  const righe = (a: AziendaCampo) =>
    owner.eventoCampo.findMany({ where: { tenantId: a.t }, orderBy: { ricevutoIl: 'asc' } })
  const ritiroDb = (id: string) => owner.ritiro.findUniqueOrThrow({ where: { id } })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    servizio = new EventiCampoService(app, new RitiriRepository())
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    for (const t of creati) {
      try {
        await cancellaAziendeDiProva(owner, t)
      } catch (e) {
        console.error(`pulizia eventi campo: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  describe('registrazione e idempotenza', () => {
    it('un esito eseguito sul proprio ritiro e APPLICATO e lascia il ritiro com e', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      const e = evento(r, { dati: { nota: 'ritirati 3 colli' } })
      const esito = await registra(a, a.utente1, e)
      expect(esito).toMatchObject({ id: e.id, esito: 'APPLICATO', motivoConflitto: null })
      const [riga] = await righe(a)
      expect(riga).toMatchObject({
        eventoUuid: e.id,
        ritiroId: r,
        autistaId: a.autista1,
        utenteId: a.utente1,
        tipo: 'RITIRO_ESEGUITO',
        versioneVista: 1,
        esito: 'APPLICATO',
        dati: { nota: 'ritirati 3 colli' },
      })
      expect(riga.rilevatoIl.toISOString()).toBe('2026-12-01T08:30:00.000Z')
      expect(await ritiroDb(r)).toMatchObject({ stato: 'PROGRAMMATO', versione: 1 })
    })

    it('lo stesso uuid due volte: una riga sola, stessa risposta, nessun effetto in piu', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      const e = nonEseguito(r)
      const prima = await registra(a, a.utente1, e)
      const seconda = await registra(a, a.utente1, e)
      expect(seconda).toEqual(prima)
      expect(await righe(a)).toHaveLength(1)
      // Il ritiro e stato scritto UNA volta (versione 1 -> 2).
      expect(await ritiroDb(r)).toMatchObject({ stato: 'NON_ESEGUITO', versione: 2 })
    })

    it('reinvio con rete lenta: cinque richieste insieme con lo stesso uuid', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      const e = nonEseguito(r)
      const risposte = await Promise.all(Array.from({ length: 5 }, () => registra(a, a.utente1, e)))
      for (const x of risposte) expect(x).toEqual(risposte[0])
      expect(risposte[0].esito).toBe('APPLICATO')
      expect(await righe(a)).toHaveLength(1)
      expect(await ritiroDb(r)).toMatchObject({ stato: 'NON_ESEGUITO', versione: 2 })
    })

    it('uuid gia usato da un altro autista: rifiutato, la riga originale non cambia', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      const e = evento(r)
      await registra(a, a.utente1, e)
      await expect(registra(a, a.utente2, e)).rejects.toBeInstanceOf(EventoCampoDiAltroUtenteError)
      expect(await righe(a)).toHaveLength(1)
    })

    it('utente senza autista collegato: AutistaNonCollegato, niente scritto', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      await expect(registra(a, a.admin, evento(r))).rejects.toBeInstanceOf(AutistaNonCollegatoError)
      expect(await righe(a)).toHaveLength(0)
    })

    it('autista disattivato: AutistaNonCollegato', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      await owner.autista.update({ where: { id: a.autista1 }, data: { attivo: false } })
      await expect(registra(a, a.utente1, evento(r))).rejects.toBeInstanceOf(
        AutistaNonCollegatoError
      )
    })

    it('ritiro di un altra azienda o inesistente: 404, niente scritto', async () => {
      const a = await azienda()
      const b = await azienda()
      const rb = await creaRitiroCampo(owner, b, b.autista1)
      await expect(registra(a, a.utente1, evento(rb))).rejects.toBeInstanceOf(RitiroNonTrovatoError)
      await expect(registra(a, a.utente1, evento(crypto.randomUUID()))).rejects.toBeInstanceOf(
        RitiroNonTrovatoError
      )
      expect(await righe(a)).toHaveLength(0)
      expect(await righe(b)).toHaveLength(0)
    })

    it('dati non validi: 400 con i messaggi, niente scritto', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      await expect(registra(a, a.utente1, nonEseguito(r, { dati: {} }))).rejects.toBeInstanceOf(
        RitiroDatiNonValidiError
      )
      expect(await righe(a)).toHaveLength(0)
    })
  })

  describe('applicazione al ritiro e conflitti (mai perdere un fatto del campo)', () => {
    it('non eseguito: ritiro NON_ESEGUITO col motivo, versione +1, evento APPLICATO', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      const esito = await registra(a, a.utente1, nonEseguito(r))
      expect(esito.esito).toBe('APPLICATO')
      expect(await ritiroDb(r)).toMatchObject({
        stato: 'NON_ESEGUITO',
        motivo: 'Cliente assente',
        versione: 2,
      })
    })

    it('ritiro annullato in ufficio: evento registrato DA_RICONCILIARE, ritiro intatto', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      await owner.ritiro.update({
        where: { id: r },
        data: { stato: 'ANNULLATO', motivo: 'Annullato dal cliente', versione: 2 },
      })
      const e = evento(r)
      const esito = await registra(a, a.utente1, e)
      expect(esito).toMatchObject({
        id: e.id,
        esito: 'DA_RICONCILIARE',
        motivoConflitto: 'RITIRO_ANNULLATO',
      })
      const [riga] = await righe(a)
      expect(riga).toMatchObject({ esito: 'DA_RICONCILIARE', motivoConflitto: 'RITIRO_ANNULLATO' })
      expect(await ritiroDb(r)).toMatchObject({ stato: 'ANNULLATO', versione: 2 })
      // Anche il non eseguito su un ritiro annullato non va perso.
      const n = await registra(a, a.utente1, nonEseguito(r, { versioneVista: 2 }))
      expect(n.motivoConflitto).toBe('RITIRO_ANNULLATO')
      expect(await righe(a)).toHaveLength(2)
    })

    it('ritiro modificato in ufficio (versione diversa): sia il non eseguito sia l eseguito vanno da riconciliare', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      await owner.ritiro.update({ where: { id: r }, data: { versione: 4, ordineGiro: 3 } })
      const n = await registra(a, a.utente1, nonEseguito(r, { versioneVista: 1 }))
      expect(n).toMatchObject({ esito: 'DA_RICONCILIARE', motivoConflitto: 'RITIRO_MODIFICATO' })
      expect(await ritiroDb(r)).toMatchObject({ stato: 'PROGRAMMATO', versione: 4 })
      // Anche l'eseguito su un ritiro modificato (spostato) va da riconciliare.
      const e = await registra(a, a.utente1, evento(r, { versioneVista: 1 }))
      expect(e).toMatchObject({ esito: 'DA_RICONCILIARE', motivoConflitto: 'RITIRO_MODIFICATO' })
      // Con la versione corrente il non eseguito si applica.
      const ok = await registra(a, a.utente1, nonEseguito(r, { versioneVista: 4 }))
      expect(ok.esito).toBe('APPLICATO')
      expect(await ritiroDb(r)).toMatchObject({ stato: 'NON_ESEGUITO', versione: 5 })
    })

    it('ritiro gia chiuso in ufficio (non eseguito): nuovo esito da riconciliare', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      await owner.ritiro.update({
        where: { id: r },
        data: { stato: 'NON_ESEGUITO', motivo: 'Da ufficio', versione: 2 },
      })
      const x = await registra(a, a.utente1, evento(r, { versioneVista: 1 }))
      expect(x).toMatchObject({
        esito: 'DA_RICONCILIARE',
        motivoConflitto: 'RITIRO_STATO_CAMBIATO',
      })
      const y = await registra(a, a.utente1, nonEseguito(r, { versioneVista: 2 }))
      expect(y).toMatchObject({
        esito: 'DA_RICONCILIARE',
        motivoConflitto: 'RITIRO_STATO_CAMBIATO',
      })
      expect(await ritiroDb(r)).toMatchObject({ motivo: 'Da ufficio', versione: 2 })
    })

    it('ritiro riassegnato a un altro autista: evento registrato DA_RICONCILIARE, nessuna scrittura', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista2)
      const esito = await registra(a, a.utente1, nonEseguito(r))
      expect(esito).toMatchObject({
        esito: 'DA_RICONCILIARE',
        motivoConflitto: 'RITIRO_RIASSEGNATO',
      })
      expect(await ritiroDb(r)).toMatchObject({ stato: 'PROGRAMMATO', versione: 1 })
      // Il ritiro senza autista e lo stesso caso.
      const senza = await creaRitiroCampo(owner, a, null)
      expect((await registra(a, a.utente1, evento(senza))).motivoConflitto).toBe(
        'RITIRO_RIASSEGNATO'
      )
    })

    it('due telefoni insieme sullo stesso ritiro: uno applica, l altro finisce da riconciliare', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      const [x, y] = await Promise.all([
        registra(a, a.utente1, nonEseguito(r)),
        registra(a, a.utente1, nonEseguito(r, { dati: { motivo: 'Altro motivo' } })),
      ])
      expect([x.esito, y.esito].sort()).toEqual(['APPLICATO', 'DA_RICONCILIARE'])
      expect(await ritiroDb(r)).toMatchObject({ stato: 'NON_ESEGUITO', versione: 2 })
      expect(await righe(a)).toHaveLength(2)
    })
  })

  describe('un solo esito applicato per ritiro', () => {
    it('eseguito poi non eseguito (anche dopo logout/altro telefono): il secondo va da riconciliare, ritiro intatto', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      expect((await registra(a, a.utente1, evento(r))).esito).toBe('APPLICATO')
      const n = await registra(a, a.utente1, nonEseguito(r))
      expect(n).toMatchObject({ esito: 'DA_RICONCILIARE', motivoConflitto: 'ESITO_GIA_REGISTRATO' })
      expect(await ritiroDb(r)).toMatchObject({ stato: 'PROGRAMMATO', versione: 1 })
      expect(await righe(a)).toHaveLength(2)
    })

    it('eseguito due volte: il duplicato e registrato da riconciliare', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      await registra(a, a.utente1, evento(r))
      const d = await registra(a, a.utente1, evento(r))
      expect(d.motivoConflitto).toBe('ESITO_GIA_REGISTRATO')
    })

    it('un esito da riconciliare non blocca quello successivo corretto', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista2) // riassegnato: il primo e da riconciliare
      await registra(a, a.utente1, evento(r))
      await owner.ritiro.update({ where: { id: r }, data: { autistaId: a.autista1 } })
      expect((await registra(a, a.utente1, evento(r))).esito).toBe('APPLICATO')
    })

    it('stesso uuid con ritiro o tipo diversi: risponde con la riga originale, nessuna nuova riga', async () => {
      const a = await azienda()
      const r1 = await creaRitiroCampo(owner, a, a.autista1)
      const r2 = await creaRitiroCampo(owner, a, a.autista1)
      const e = evento(r1)
      const prima = await registra(a, a.utente1, e)
      const seconda = await registra(a, a.utente1, nonEseguito(r2, { id: e.id }))
      expect(seconda).toEqual(prima)
      expect(await righe(a)).toHaveLength(1)
      expect(await ritiroDb(r2)).toMatchObject({ stato: 'PROGRAMMATO' })
    })

    it('ritiro con FIR attivo: il non eseguito va da riconciliare e il ritiro non cambia', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      const finto = new EventiCampoService(app, {
        bloccaPerId: async () => ({ id: r, stato: 'PROGRAMMATO', versione: 1 }),
        autistaDelRitiro: async () => a.autista1,
        firAttivo: async () => ({ id: 'f', numero: null, status: 'DRAFT' }),
        impostaStato: jest.fn(),
      } as unknown as RitiriRepository)
      const esito = await nelTenant(a.t, () => finto.registra(a.t, a.utente1, nonEseguito(r)))
      expect(esito).toMatchObject({ esito: 'DA_RICONCILIARE', motivoConflitto: 'RITIRO_CON_FIR' })
      expect(await ritiroDb(r)).toMatchObject({ stato: 'PROGRAMMATO', versione: 1 })
    })
  })

  describe('elenco d ufficio «Esiti dal campo»', () => {
    it('filtra per esito, ordina dal piu recente e porta ritiro e autista', async () => {
      const a = await azienda()
      const r1 = await creaRitiroCampo(owner, a, a.autista1)
      const r2 = await creaRitiroCampo(owner, a, a.autista1)
      await owner.ritiro.update({
        where: { id: r2 },
        data: { stato: 'ANNULLATO', motivo: 'x', versione: 2 },
      })
      await registra(a, a.utente1, evento(r1))
      await registra(a, a.utente1, nonEseguito(r2, { versioneVista: 2 }))
      const tutti = await nelTenant(a.t, () => servizio.elenca(a.t, {}))
      expect(tutti.totale).toBe(2)
      expect(tutti.righe[0]).toMatchObject({
        esito: 'DA_RICONCILIARE',
        motivoConflitto: 'RITIRO_ANNULLATO',
        tipo: 'RITIRO_NON_ESEGUITO',
        dati: { motivo: 'Cliente assente' },
        autista: { id: a.autista1, nome: 'Prova Uno' },
        ritiro: { id: r2, stato: 'ANNULLATO', cerCode: '200301', dataPrevista: '2026-12-01' },
      })
      const da = await nelTenant(a.t, () => servizio.elenca(a.t, { esito: 'DA_RICONCILIARE' }))
      expect(da.righe.map(x => x.ritiro.id)).toEqual([r2])
      const ok = await nelTenant(a.t, () => servizio.elenca(a.t, { esito: 'APPLICATO' }))
      expect(ok.righe.map(x => x.ritiro.id)).toEqual([r1])
    })

    it('un altra azienda non vede nulla', async () => {
      const a = await azienda()
      const b = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista1)
      await registra(a, a.utente1, evento(r))
      expect(await nelTenant(b.t, () => servizio.elenca(b.t, {}))).toEqual({ righe: [], totale: 0 })
    })
  })
})
