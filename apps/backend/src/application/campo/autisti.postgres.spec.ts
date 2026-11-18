/**
 * App campo P1 contro un Postgres reale, collegato COME `wasteflow_app` (RLS ENABLE+FORCE):
 * schema (RLS, chiavi esterne composte, unici, niente DELETE), anagrafica autisti, assegnazione
 * dell'autista al ritiro e giro dell'autista. Il proprietario prepara le aziende; la pulizia
 * cancella SOLO le aziende create qui, per id esatto (la cascata da `tenants` porta via il resto).
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
import { ICERRepository } from '../../domain/cer/repositories/cer-repository.interface'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { RitiriRepository } from '../../infrastructure/persistence/ritiri.repository'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { RitiroDatiNonValidiError } from '../ritiri/errori-ritiri'
import { RitiriService } from '../ritiri/ritiri.service'
import type { NuovoRitiro } from '../ritiri/ritiri.tipi'
import { AutistiService } from './autisti.service'
import {
  AutistaDatiNonValidiError,
  AutistaDuplicatoError,
  AutistaNonCollegatoError,
  AutistaNonTrovatoError,
} from './errori-campo'
import { GiroService } from './giro.service'

describe('App campo P1 — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let autisti: AutistiService
  let ritiri: RitiriService
  let giro: GiroService
  const tenantCreati: string[] = []
  const cerFinto = {
    exists: async () => true,
    isUtilizzabilePerNuovoFormulario: async () => true,
  } as unknown as ICERRepository

  interface Azienda {
    t: string
    admin: string
    /** Utenti con ruolo AUTISTA, pronti a essere collegati. */
    utenteAutista1: string
    utenteAutista2: string
    produttore: string
    produttoreSede: string
    trasportatore: string
    destinatario: string
    destinatarioSede: string
  }

  async function utente(t: string, ruolo: 'ADMIN' | 'AUTISTA', etichetta: string) {
    const sigla = partitaIvaUnica()
    return (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-campo-${etichetta}-${sigla}`,
          fiscalCode: `CMP${sigla}`.slice(0, 16),
          firstName: 'Prova',
          lastName: etichetta,
          email: `campo-${etichetta}-${sigla}@example.test`,
          role: ruolo,
        },
      })
    ).id
  }

  async function azienda(): Promise<Azienda> {
    const t = (
      await owner.tenant.create({
        data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Campo SRL', country: 'IT' },
      })
    ).id
    tenantCreati.push(t)
    const p = await creaDittaConRuolo(owner, t, 'PRODUTTORE')
    const tr = await creaDittaConRuolo(owner, t, 'TRASPORTATORE')
    const d = await creaDittaConRuolo(owner, t, 'DESTINATARIO')
    return {
      t,
      admin: await utente(t, 'ADMIN', 'admin'),
      utenteAutista1: await utente(t, 'AUTISTA', 'aut1'),
      utenteAutista2: await utente(t, 'AUTISTA', 'aut2'),
      produttore: p.ruoloId,
      produttoreSede: p.sedeId,
      trasportatore: tr.ruoloId,
      destinatario: d.ruoloId,
      destinatarioSede: d.sedeId,
    }
  }

  const nuovoRitiro = (a: Azienda, extra: Partial<NuovoRitiro> = {}): NuovoRitiro => ({
    dataPrevista: '2026-12-01',
    produttoreId: a.produttore,
    produttoreSedeId: a.produttoreSede,
    trasportatoreId: a.trasportatore,
    destinatarioId: a.destinatario,
    destinatarioSedeId: a.destinatarioSede,
    cerCode: '200301',
    descrizione: 'Rifiuti urbani non differenziati',
    quantitaPresunta: '100',
    codiceOperazione: 'R13',
    provenienza: 'SPECIALE',
    tipoTratta: 'TERRESTRE',
    chiaveIdempotenza: crypto.randomUUID(),
    ...extra,
  })

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const repo = new RitiriRepository()
    autisti = new AutistiService(app)
    ritiri = new RitiriService(app, repo, cerFinto)
    giro = new GiroService(app, repo)
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    for (const t of tenantCreati) {
      try {
        await owner.tenant.delete({ where: { id: t } })
      } catch (e) {
        console.error(`pulizia campo: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  describe('schema: RLS, chiavi composte, unici, privilegi', () => {
    it('RLS ENABLE+FORCE con isolamento_azienda e sola_lettura', async () => {
      const [t] = await owner.$queryRawUnsafe<{ rls: boolean; forzata: boolean }[]>(
        `SELECT relrowsecurity AS rls, relforcerowsecurity AS forzata FROM pg_class
         WHERE relname = 'autisti' AND relnamespace = 'public'::regnamespace`
      )
      expect(t).toEqual({ rls: true, forzata: true })
      const policy = await owner.$queryRawUnsafe<{ policyname: string }[]>(
        `SELECT policyname FROM pg_policies WHERE tablename = 'autisti' ORDER BY policyname`
      )
      expect(policy.map(p => p.policyname)).toEqual(['isolamento_azienda', 'sola_lettura'])
    })

    it('un altro tenant non vede ne modifica gli autisti dell azienda', async () => {
      const a = await azienda()
      const b = await azienda()
      const x = await nelTenant(a.t, () =>
        autisti.crea(a.t, a.admin, { nome: 'Luca', cognome: 'Rossi' })
      )
      expect(await nelTenant(b.t, () => autisti.elenca(b.t))).toEqual([])
      // Anche chiedendo l'id esatto dal tenant sbagliato: non esiste.
      await expect(
        nelTenant(b.t, () => autisti.aggiorna(b.t, x.id, { nome: 'Hack', cognome: 'Er' }))
      ).rejects.toBeInstanceOf(AutistaNonTrovatoError)
      // Nemmeno il client applicativo, con il contesto di B, legge la riga di A.
      const righe = await nelTenant(b.t, () =>
        app.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM autisti WHERE id = '${x.id}'`
        )
      )
      expect(righe[0].n).toBe(0)
    })

    it('chiavi composte: un autista di un altro tenant non entra nel ritiro, un utente altrui non e collegabile', async () => {
      const a = await azienda()
      const b = await azienda()
      const dib = await nelTenant(b.t, () =>
        autisti.crea(b.t, b.admin, { nome: 'B', cognome: 'B' })
      )
      await expect(
        owner.$executeRawUnsafe(
          `INSERT INTO autisti (tenant_id, nome, cognome, user_id, creato_da, updated_at)
           VALUES ('${a.t}', 'X', 'Y', '${b.utenteAutista1}', '${a.admin}', now())`
        )
      ).rejects.toThrow(/autisti_user_fkey/)
      const r = await nelTenant(a.t, () => ritiri.crea(a.t, a.admin, nuovoRitiro(a)))
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE ritiri SET autista_id = '${dib.id}' WHERE id = '${r.ritiri[0].id}'`
        )
      ).rejects.toThrow(/ritiri_autista_fkey/)
    })

    it('unici: un utente un solo autista, un codice fiscale per azienda; NULL ripetibili', async () => {
      const a = await azienda()
      const b = await azienda()
      await nelTenant(a.t, () =>
        autisti.crea(a.t, a.admin, {
          nome: 'A',
          cognome: 'A',
          codiceFiscale: 'RSSLCU80A01H501X',
          userId: a.utenteAutista1,
        })
      )
      await expect(
        nelTenant(a.t, () =>
          autisti.crea(a.t, a.admin, {
            nome: 'B',
            cognome: 'B',
            codiceFiscale: 'rsslcu80a01h501x',
          })
        )
      ).rejects.toBeInstanceOf(AutistaDuplicatoError)
      await expect(
        nelTenant(a.t, () =>
          autisti.crea(a.t, a.admin, { nome: 'C', cognome: 'C', userId: a.utenteAutista1 })
        )
      ).rejects.toBeInstanceOf(AutistaDuplicatoError)
      // Stesso codice fiscale in un'altra azienda: ammesso.
      await nelTenant(b.t, () =>
        autisti.crea(b.t, b.admin, { nome: 'A', cognome: 'A', codiceFiscale: 'RSSLCU80A01H501X' })
      )
      // Senza codice fiscale e senza utente: tutti quelli che servono.
      for (const n of ['D', 'E', 'F']) {
        await nelTenant(a.t, () => autisti.crea(a.t, a.admin, { nome: n, cognome: n }))
      }
    })

    it('al ruolo applicativo non e concesso DELETE ne TRUNCATE su autisti', async () => {
      const a = await azienda()
      const x = await nelTenant(a.t, () => autisti.crea(a.t, a.admin, { nome: 'A', cognome: 'A' }))
      await expect(
        nelTenant(a.t, () => app.$executeRawUnsafe(`DELETE FROM autisti WHERE id = '${x.id}'`))
      ).rejects.toThrow(/permission denied/i)
      await expect(app.$executeRawUnsafe(`TRUNCATE autisti`)).rejects.toThrow(/permission denied/i)
    })
  })

  describe('anagrafica autisti', () => {
    it('crea con tutti i campi, normalizza e restituisce le date come AAAA-MM-GG', async () => {
      const a = await azienda()
      const v = await nelTenant(a.t, () =>
        autisti.crea(a.t, a.admin, {
          nome: '  Luca ',
          cognome: 'Bianchi',
          codiceFiscale: 'bnclcu80a01h501z',
          trasportatoreId: a.trasportatore,
          patenteNumero: 'RM1234567',
          patenteCategoria: 'ce',
          patenteScadenza: '2030-05-31',
          cqcScadenza: '2029-01-15',
          adrScadenza: null,
          telefono: '+39 333 1234567',
          userId: a.utenteAutista1,
        })
      )
      expect(v).toMatchObject({
        nome: 'Luca',
        cognome: 'Bianchi',
        codiceFiscale: 'BNCLCU80A01H501Z',
        trasportatoreId: a.trasportatore,
        patenteCategoria: 'CE',
        patenteScadenza: '2030-05-31',
        cqcScadenza: '2029-01-15',
        adrScadenza: null,
        userId: a.utenteAutista1,
        attivo: true,
      })
    })

    it('rifiuta dati non validi con tutti i messaggi, senza scrivere', async () => {
      const a = await azienda()
      await expect(
        nelTenant(a.t, () =>
          autisti.crea(a.t, a.admin, {
            nome: ' ',
            cognome: '',
            codiceFiscale: 'CORTO',
            patenteScadenza: '2030-02-31',
          })
        )
      ).rejects.toMatchObject({
        messaggi: expect.arrayContaining([
          'Il nome è obbligatorio.',
          'Il cognome è obbligatorio.',
          'Il codice fiscale deve avere 16 caratteri.',
          'La scadenza della patente non è una data valida.',
        ]),
      })
      expect(await nelTenant(a.t, () => autisti.elenca(a.t))).toEqual([])
    })

    it('trasportatore altrui e utente non AUTISTA sono rifiutati', async () => {
      const a = await azienda()
      const b = await azienda()
      await expect(
        nelTenant(a.t, () =>
          autisti.crea(a.t, a.admin, { nome: 'A', cognome: 'A', trasportatoreId: b.trasportatore })
        )
      ).rejects.toBeInstanceOf(AutistaDatiNonValidiError)
      await expect(
        nelTenant(a.t, () =>
          autisti.crea(a.t, a.admin, { nome: 'A', cognome: 'A', userId: a.admin })
        )
      ).rejects.toMatchObject({ messaggi: ['L’utente collegato deve avere il ruolo autista.'] })
      await expect(
        nelTenant(a.t, () =>
          autisti.crea(a.t, a.admin, { nome: 'A', cognome: 'A', userId: b.utenteAutista1 })
        )
      ).rejects.toMatchObject({ messaggi: ['Utente non trovato.'] })
    })

    it('aggiorna, disattiva e filtra i soli attivi; un autista non si cancella', async () => {
      const a = await azienda()
      const x = await nelTenant(a.t, () =>
        autisti.crea(a.t, a.admin, { nome: 'Z', cognome: 'Zeta' })
      )
      await nelTenant(a.t, () => autisti.crea(a.t, a.admin, { nome: 'A', cognome: 'Alfa' }))
      const m = await nelTenant(a.t, () =>
        autisti.aggiorna(a.t, x.id, { nome: 'Z', cognome: 'Zeta', telefono: '123', attivo: false })
      )
      expect(m).toMatchObject({ telefono: '123', attivo: false })
      // Senza `attivo` nel corpo resta invariato.
      const m2 = await nelTenant(a.t, () =>
        autisti.aggiorna(a.t, x.id, { nome: 'Z', cognome: 'Zeta' })
      )
      expect(m2.attivo).toBe(false)
      const tutti = await nelTenant(a.t, () => autisti.elenca(a.t))
      expect(tutti.map(v => v.cognome)).toEqual(['Alfa', 'Zeta'])
      const attivi = await nelTenant(a.t, () => autisti.elenca(a.t, { soloAttivi: true }))
      expect(attivi.map(v => v.cognome)).toEqual(['Alfa'])
    })
  })

  describe('ritiro con autista', () => {
    it('assegna l autista e lo mostra nella vista; filtro per autista', async () => {
      const a = await azienda()
      const x = await nelTenant(a.t, () =>
        autisti.crea(a.t, a.admin, { nome: 'Luca', cognome: 'Bianchi' })
      )
      const con = await nelTenant(a.t, () =>
        ritiri.crea(a.t, a.admin, nuovoRitiro(a, { autistaId: x.id }))
      )
      await nelTenant(a.t, () => ritiri.crea(a.t, a.admin, nuovoRitiro(a)))
      expect(con.ritiri[0].autista).toEqual({ id: x.id, nome: 'Bianchi Luca' })
      const elenco = await nelTenant(a.t, () => ritiri.elenca(a.t, { autistaId: x.id }))
      expect(elenco.righe.map(r => r.id)).toEqual([con.ritiri[0].id])
      const tutti = await nelTenant(a.t, () => ritiri.elenca(a.t))
      expect(tutti.righe.filter(r => r.autista === null)).toHaveLength(1)
    })

    it('autista disattivo, inesistente o di un altro tenant: 400 senza scrivere', async () => {
      const a = await azienda()
      const b = await azienda()
      const disattivo = await nelTenant(a.t, () =>
        autisti.crea(a.t, a.admin, { nome: 'D', cognome: 'D' })
      )
      await nelTenant(a.t, () =>
        autisti.aggiorna(a.t, disattivo.id, { nome: 'D', cognome: 'D', attivo: false })
      )
      const altrui = await nelTenant(b.t, () =>
        autisti.crea(b.t, b.admin, { nome: 'B', cognome: 'B' })
      )
      for (const id of [disattivo.id, altrui.id, crypto.randomUUID()]) {
        await expect(
          nelTenant(a.t, () => ritiri.crea(a.t, a.admin, nuovoRitiro(a, { autistaId: id })))
        ).rejects.toMatchObject({ messaggi: ['Autista non trovato.'] })
      }
      await expect(
        nelTenant(a.t, () => ritiri.crea(a.t, a.admin, nuovoRitiro(a, { autistaId: 'non-uuid' })))
      ).rejects.toBeInstanceOf(RitiroDatiNonValidiError)
      expect((await nelTenant(a.t, () => ritiri.elenca(a.t))).totale).toBe(0)
    })

    it('la modifica puo cambiare e togliere l autista', async () => {
      const a = await azienda()
      const x = await nelTenant(a.t, () => autisti.crea(a.t, a.admin, { nome: 'X', cognome: 'X' }))
      const r = (await nelTenant(a.t, () => ritiri.crea(a.t, a.admin, nuovoRitiro(a)))).ritiri[0]
      const base = nuovoRitiro(a)
      const { chiaveIdempotenza: _k, ...dati } = base
      const m = await nelTenant(a.t, () =>
        ritiri.modifica(a.t, r.id, { ...dati, autistaId: x.id, versione: r.versione })
      )
      expect(m.autista?.id).toBe(x.id)
      const t = await nelTenant(a.t, () =>
        ritiri.modifica(a.t, r.id, { ...dati, autistaId: null, versione: m.versione })
      )
      expect(t.autista).toBeNull()
    })
  })

  describe('giro dell autista', () => {
    it('restituisce solo i PROGRAMMATI del giorno dell autista collegato, in ordine di giro', async () => {
      const a = await azienda()
      const a1 = await nelTenant(a.t, () =>
        autisti.crea(a.t, a.admin, { nome: 'Uno', cognome: 'Primo', userId: a.utenteAutista1 })
      )
      const a2 = await nelTenant(a.t, () =>
        autisti.crea(a.t, a.admin, { nome: 'Due', cognome: 'Secondo', userId: a.utenteAutista2 })
      )
      const crea = (extra: Partial<NuovoRitiro>) =>
        nelTenant(a.t, () => ritiri.crea(a.t, a.admin, nuovoRitiro(a, extra))).then(
          r => r.ritiri[0]
        )
      const senzaOrdine = await crea({ autistaId: a1.id })
      const terzo = await crea({ autistaId: a1.id, ordineGiro: 3 })
      const primo = await crea({ autistaId: a1.id, ordineGiro: 1 })
      await crea({ autistaId: a2.id, ordineGiro: 2 }) // altro autista
      await crea({ autistaId: a1.id, ordineGiro: 4, dataPrevista: '2026-12-02' }) // altro giorno
      await crea({ ordineGiro: 5 }) // senza autista
      const nonEseguito = await crea({ autistaId: a1.id, ordineGiro: 2 })
      await nelTenant(a.t, () =>
        ritiri.nonEseguito(a.t, nonEseguito.id, 'Cliente chiuso', nonEseguito.versione)
      )

      const g = await nelTenant(a.t, () => giro.giro(a.t, a.utenteAutista1, '2026-12-01'))
      expect(g.autista).toEqual({ id: a1.id, nome: 'Uno', cognome: 'Primo' })
      expect(g.ritiri.map(r => r.id)).toEqual([primo.id, terzo.id, senzaOrdine.id])
      // Il giro non espone le note interne.
      expect(JSON.stringify(g)).not.toContain('noteInterne')

      const g2 = await nelTenant(a.t, () => giro.giro(a.t, a.utenteAutista2, '2026-12-01'))
      expect(g2.ritiri).toHaveLength(1)
    })

    it('un utente non collegato, o collegato a un autista disattivato, riceve AutistaNonCollegatoError', async () => {
      const a = await azienda()
      await expect(
        nelTenant(a.t, () => giro.giro(a.t, a.utenteAutista1, '2026-12-01'))
      ).rejects.toBeInstanceOf(AutistaNonCollegatoError)
      const x = await nelTenant(a.t, () =>
        autisti.crea(a.t, a.admin, { nome: 'U', cognome: 'U', userId: a.utenteAutista1 })
      )
      await nelTenant(a.t, () =>
        autisti.aggiorna(a.t, x.id, {
          nome: 'U',
          cognome: 'U',
          userId: a.utenteAutista1,
          attivo: false,
        })
      )
      await expect(
        nelTenant(a.t, () => giro.giro(a.t, a.utenteAutista1, '2026-12-01'))
      ).rejects.toBeInstanceOf(AutistaNonCollegatoError)
    })

    it('il giro non attraversa le aziende: l utente di A nel contesto di B non ha giro', async () => {
      const a = await azienda()
      const b = await azienda()
      const x = await nelTenant(a.t, () =>
        autisti.crea(a.t, a.admin, { nome: 'U', cognome: 'U', userId: a.utenteAutista1 })
      )
      await nelTenant(a.t, () => ritiri.crea(a.t, a.admin, nuovoRitiro(a, { autistaId: x.id })))
      await expect(
        nelTenant(b.t, () => giro.giro(b.t, a.utenteAutista1, '2026-12-01'))
      ).rejects.toBeInstanceOf(AutistaNonCollegatoError)
    })

    it('data non valida: errore di dati, nessuna lettura', async () => {
      const a = await azienda()
      await expect(
        nelTenant(a.t, () => giro.giro(a.t, a.utenteAutista1, '2026-02-30'))
      ).rejects.toBeInstanceOf(RitiroDatiNonValidiError)
    })
  })
})
