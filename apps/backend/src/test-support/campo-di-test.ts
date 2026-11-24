/**
 * Fixture dell'app campo per le spec Postgres (P4): un'azienda con un admin, due utenti AUTISTA
 * collegati a due autisti e un generatore di ritiri. Scrive col client PROPRIETARIO (le tabelle
 * hanno RLS FORCE: il proprietario non e' bypassato ma imposta `app.tenant_id` quando serve, qui si
 * usano solo INSERT con `tenant_id` esplicito, ammessi perche' il proprietario e' superuser).
 */
import type { PrismaClient } from '@prisma/client'
import { creaDittaConRuolo, partitaIvaUnica } from './anagrafiche-di-test'

export interface AziendaCampo {
  t: string
  admin: string
  utente1: string
  utente2: string
  autista1: string
  autista2: string
  produttore: string
  produttoreSede: string
  trasportatore: string
  destinatario: string
  destinatarioSede: string
}

export async function creaAziendaCampo(owner: PrismaClient): Promise<AziendaCampo> {
  const t = (
    await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Campo SRL', country: 'IT' },
    })
  ).id
  const utente = async (ruolo: 'ADMIN' | 'AUTISTA', etichetta: string) => {
    const sigla = partitaIvaUnica()
    return (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-ev-${etichetta}-${sigla}`,
          fiscalCode: `EVC${sigla}`.slice(0, 16),
          firstName: 'Prova',
          lastName: etichetta,
          email: `ev-${etichetta}-${sigla}@example.test`,
          role: ruolo,
        },
      })
    ).id
  }
  const p = await creaDittaConRuolo(owner, t, 'PRODUTTORE')
  const tr = await creaDittaConRuolo(owner, t, 'TRASPORTATORE')
  const d = await creaDittaConRuolo(owner, t, 'DESTINATARIO')
  const admin = await utente('ADMIN', 'admin')
  const utente1 = await utente('AUTISTA', 'aut1')
  const utente2 = await utente('AUTISTA', 'aut2')
  const autista = async (userId: string, nome: string) =>
    (
      await owner.autista.create({
        data: { tenantId: t, nome, cognome: 'Prova', userId, creatoDa: admin },
      })
    ).id
  return {
    t,
    admin,
    utente1,
    utente2,
    autista1: await autista(utente1, 'Uno'),
    autista2: await autista(utente2, 'Due'),
    produttore: p.ruoloId,
    produttoreSede: p.sedeId,
    trasportatore: tr.ruoloId,
    destinatario: d.ruoloId,
    destinatarioSede: d.sedeId,
  }
}

/** Ritiro PROGRAMMATO del giorno indicato (default 2026-12-01), assegnato all'autista dato. */
export async function creaRitiroCampo(
  owner: PrismaClient,
  a: AziendaCampo,
  autistaId: string | null,
  dataPrevista = '2026-12-01'
): Promise<string> {
  return (
    await owner.ritiro.create({
      data: {
        tenantId: a.t,
        creatoDa: a.admin,
        dataPrevista: new Date(`${dataPrevista}T00:00:00.000Z`),
        produttoreId: a.produttore,
        produttoreSedeId: a.produttoreSede,
        trasportatoreId: a.trasportatore,
        destinatarioId: a.destinatario,
        destinatarioSedeId: a.destinatarioSede,
        cerCode: '200301',
        descrizione: 'Rifiuti urbani non differenziati',
        quantitaPresunta: '100',
        tipoOperazione: 'RECOVERY',
        codiceOperazione: 'R13',
        provenienza: 'SPECIALE',
        tipoTratta: 'TERRESTRE',
        autistaId,
      },
      select: { id: true },
    })
  ).id
}
