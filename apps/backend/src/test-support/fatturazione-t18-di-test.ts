import { PrismaClient, type Prisma } from '@prisma/client'
import { partitaIvaUnica } from './anagrafiche-di-test'
import {
  completaCedenteDiTest,
  creaTabelleFatturazione,
  impostaFatturazioneDaDiTest,
  type TabelleFatturazioneDiTest,
} from './fatturazione-di-test'
import { creaLegameDiTest, creaMovimentoDiTest } from './legami-di-test'
import {
  creaAddebito,
  creaCodiciIvaEcodifiche,
  creaContrattoConElenco,
  creaRiga,
  type ListinoDiTest,
} from './listino-di-test'

/**
 * Fixture del Task 18 (elaborazione e anteprima), col client PROPRIETARIO. Aggiunte: nessuna
 * firma preesistente cambia. La pulizia e' `pulisciTenantDiTest`, per id esatti.
 */
export interface AziendaT18 {
  tenantId: string
  utenteId: string
  listino: ListinoDiTest
  tab: TabelleFatturazioneDiTest
}

export interface ContrattoT18 {
  contrattoId: string
  clienteId: string
  elencoId: string
  /** Riga `CER` a 1 euro/KG (22%) dell'elenco. */
  rigaCerId: string
}

/**
 * Azienda con utente, codici IVA, tabelle di fatturazione, «fatturazione da» al 2026-01-01 e (a
 * meno che `cedente: false`) cedente completo; `predefinito: false` lascia senza registro
 * predefinito.
 */
export async function creaAziendaT18(
  owner: PrismaClient,
  tenantCreati: string[],
  o: { cedente?: boolean; predefinito?: boolean } = {}
): Promise<AziendaT18> {
  const t = await owner.tenant.create({
    data: {
      partitaIva: partitaIvaUnica(),
      ragioneSociale: 'Cedente di prova SRL',
      country: 'IT',
    },
  })
  tenantCreati.push(t.id)
  const n = partitaIvaUnica()
  const utente = await owner.user.create({
    data: {
      tenantId: t.id,
      keycloakId: `kc-t18-${n}`,
      fiscalCode: `T18${n}`.slice(0, 16),
      firstName: 'Prova',
      lastName: 'Elaborazione',
      email: `t18-${n}@example.test`,
      role: 'ADMIN',
    },
  })
  const listino = await creaCodiciIvaEcodifiche(owner, t.id)
  const tab = await creaTabelleFatturazione(owner, t.id)
  if (o.cedente !== false) {
    await completaCedenteDiTest(owner, t.id, {
      registroIvaPredefinitoId: o.predefinito === false ? null : tab.registroId,
    })
  }
  await impostaFatturazioneDaDiTest(owner, t.id, '2026-01-01')
  return { tenantId: t.id, utenteId: utente.id, listino, tab }
}

export interface OpzContrattoT18 {
  clienteId?: string
  codiceElenco?: string
  /** `undefined`: registro `01` dell'azienda; `null`: nessuno. */
  registroIvaId?: string | null
  senzaCondizione?: boolean
  prezzoCer?: string
}

export async function creaContrattoT18(
  owner: PrismaClient,
  az: AziendaT18,
  o: OpzContrattoT18 = {}
): Promise<ContrattoT18> {
  const c = await creaContrattoConElenco(owner, az.tenantId, {
    clienteId: o.clienteId,
    codiceElenco: o.codiceElenco,
  })
  await owner.contrattoCliente.update({
    where: { id: c.contrattoId },
    data: {
      registroIvaId: o.registroIvaId === undefined ? az.tab.registroId : o.registroIvaId,
      condizionePagamentoId: o.senzaCondizione ? null : az.tab.condizioneId,
      contoCorrenteId: az.tab.contoId,
    },
  })
  const rigaCer = await creaRiga(owner, az.tenantId, c.elencoId, {
    tipo: 'CER',
    codiceIvaId: az.listino.iva22Id,
    prezzo: o.prezzoCer ?? '1',
  })
  return { ...c, rigaCerId: rigaCer.id }
}

/** Riga di listino di un tipo qualsiasi (le famiglie T e M hanno il loro addebito d'archivio). */
export async function creaRigaT18(
  owner: PrismaClient,
  az: AziendaT18,
  elencoId: string,
  tipo: string,
  prezzo: string | null,
  altro: Partial<Prisma.RigaAddebitoUncheckedCreateInput> = {}
): Promise<string> {
  const addebito =
    tipo === 'CER' || tipo === 'V' || tipo === 'F'
      ? undefined
      : await creaAddebito(owner, az.tenantId, { tipo })
  const r = await creaRiga(owner, az.tenantId, elencoId, {
    tipo,
    codiceIvaId: az.listino.iva22Id,
    prezzo,
    addebitoId: addebito?.id,
    altro,
  })
  return r.id
}

/** Un movimento e il suo legame `CONFERMATO` sulla riga `CER` del contratto (100 KG a 1 euro). */
export async function creaLegameConfermatoT18(
  owner: PrismaClient,
  az: AziendaT18,
  c: ContrattoT18,
  o: { data?: string; quantita?: string } = {}
): Promise<{ legameId: string; movimentoId: string }> {
  const m = await creaMovimentoDiTest(owner, az.tenantId, {
    movementDate: o.data ?? '2026-03-10',
    quantity: o.quantita ?? '100',
  })
  const l = await creaLegameDiTest(owner, az.tenantId, {
    movimentoOriginaleId: m.movimentoId,
    registroId: m.registroId,
    verso: m.type,
    stato: 'CONFERMATO',
    clienteId: c.clienteId,
    contrattoId: c.contrattoId,
    elencoId: c.elencoId,
    dataMovimento: o.data ?? '2026-03-10',
    righe: [
      {
        rigaAddebitoId: c.rigaCerId,
        codiceIvaId: az.listino.iva22Id,
        quantita: o.quantita ?? '100',
        prezzo: '1',
      },
    ],
  })
  return { legameId: l.legameId, movimentoId: m.movimentoId }
}

/** Inserisce (col proprietario) un'elaborazione in uno stato dato; restituisce l'id. */
export async function inserisciElaborazioneT18(
  owner: PrismaClient,
  tenantId: string,
  stato: string,
  o: { versione?: number; periodoDal?: string; periodoAl?: string; dataDocumento?: string } = {}
): Promise<string> {
  const [r] = await owner.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO elaborazioni_fatturazione
       (tenant_id, stato, periodo_dal, periodo_al, data_documento, raggruppamento, versione, updated_at)
     VALUES ($1::uuid, $2::stato_elaborazione_fatturazione, $3::date, $4::date, $5::date,
             'PER_CONTRATTO', $6::int, now())
     RETURNING id::text AS id`,
    tenantId,
    stato,
    o.periodoDal ?? '2026-03-01',
    o.periodoAl ?? '2026-03-31',
    o.dataDocumento ?? '2026-04-05',
    o.versione ?? 1
  )
  return r.id
}
