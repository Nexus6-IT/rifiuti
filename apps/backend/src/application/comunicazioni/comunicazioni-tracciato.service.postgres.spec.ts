/**
 * Servizio generico «comunicazione a tracciato» (4.9c-f, A5) contro un Postgres reale, collegato
 * COME `wasteflow_app` dentro il `TenantContext` dell'azienda. Si prova con un tracciato FINTO
 * registrato solo qui (registro locale): nessun tracciato vero e' toccato.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import {
  RegistroTracciati,
  type TracciatoComunicazione,
} from '../../domain/comunicazioni/tracciato-comunicazione'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  creaAziendaMud,
  creaMovimento,
  pulisciAziendeMud,
  type AziendaMud,
} from '../mud/aggregazione/mud-seed.postgres-spec'
import {
  ComunicazioneConBloccantiError,
  ComunicazioneNonTrovataError,
} from './comunicazioni-orso.port'
import {
  ConfermaVerificaRichiestaError,
  RichiestaComunicazioneNonValidaError,
  type PreparatoreTracciato,
  type RichiestaComunicazione,
} from './comunicazioni-tracciato.port'
import { ComunicazioniTracciatoService } from './comunicazioni-tracciato.service'
import { ConfigurazioneComunicazioniService } from './configurazione-comunicazioni.service'
import { DatiTracciatoService } from './dati-tracciato.service'
import { MarcaturaConsorziService } from './marcatura-consorzi.service'

interface RigaFinta {
  cer: string
  kg: number
  prodotto: string
}
interface DatiFinti {
  deposito: string
  righe: RigaFinta[]
}

const TracciatoFinto: TracciatoComunicazione<DatiFinti> = {
  consorzio: 'CONOU',
  versione: 'Finto-ww1',
  estensione: 'txt',
  contentType: 'text/plain; charset=windows-1252',
  codifica: 'windows-1252',
  affidabilita: 'RICAVATO_WINWASTE',
  notaAffidabilita: 'Tracciato finto di prova.',
  validaDati: d => (d.righe.some(r => r.prodotto === '?') ? ['prodotto mancante'] : []),
  // La prima riga porta un € e una à: devono diventare 0x80 e 0xE0 allo scaricamento.
  serializza: d =>
    `${d.deposito} € à\r\n` +
    d.righe.map(r => `${r.cer}|${r.kg}|${r.prodotto}`).join('\r\n') +
    '\r\n',
}

const PreparatoreFinto: PreparatoreTracciato<DatiFinti, { codiceDeposito?: string }> = {
  consorzio: 'CONOU',
  versione: 'Finto-ww1',
  nomeTracciato: () => 'Finto',
  selezione: { tipo: 'MARCATI', consorzio: 'CONOU' },
  configurazione: 'CONOU',
  datiTracciato: 'CONOU',
  differenzeDaWinWaste: ['differenza di prova'],
  inferenze: ['INFERENZA_DI_PROVA = 1'],
  validaRichiesta: r => (r.parametri?.rifiuta ? ['parametro rifiutato'] : []),
  async prepara(ctx) {
    const righe: RigaFinta[] = ctx.movimenti.map(m => {
      const dati = ctx.dettagli.datiTracciato.get(m.radiceId) as { prodotto?: string } | undefined
      return { cer: m.cer, kg: m.kg ?? 0, prodotto: dati?.prodotto ?? '?' }
    })
    return {
      dati: { deposito: ctx.configurazione.codiceDeposito ?? '', righe },
      avvisi: ctx.movimenti
        .filter(m => m.firId === null)
        .map(m => ({
          codice: 'SENZA_FIR',
          messaggio: 'Movimento senza FIR.',
          movimentoIds: [m.id],
          bloccante: false,
        })),
      movimentiInFile: ctx.movimenti,
    }
  },
  nomeFile: ({ periodo }) => `finto_${periodo.da}.txt`,
  contaRecord: d => d.righe.length,
}

describe('Comunicazione a tracciato (servizio generico) — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ComunicazioniTracciatoService
  let dati: DatiTracciatoService
  let configurazioni: ConfigurazioneComunicazioniService
  const tenantCreati: string[] = []

  const nel = <R>(az: AziendaMud, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, fn)

  async function nuovaAzienda(sigla: string) {
    const az = await creaAziendaMud(owner, sigla, { province: 'MI' })
    tenantCreati.push(az.tenantId)
    return az
  }

  const olio = (az: AziendaMud, giorno: string, quantita = 100, cer = '13 02 05*') =>
    creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: cer,
      quantita,
      unita: 'KG',
      giorno,
    })

  const richiesta = (
    az: AziendaMud,
    extra: Partial<RichiestaComunicazione> = {}
  ): RichiestaComunicazione => ({
    consorzio: 'CONOU',
    unitaLocaleId: az.unitaLocaleId,
    da: '2026-05-01',
    a: '2026-05-31',
    ...extra,
  })

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const registro = new RegistroTracciati().registra(TracciatoFinto)
    configurazioni = new ConfigurazioneComunicazioniService(app)
    dati = new DatiTracciatoService(app)
    servizio = new ComunicazioniTracciatoService(
      app,
      new MarcaturaConsorziService(app),
      configurazioni,
      [PreparatoreFinto as unknown as PreparatoreTracciato],
      registro
    )
  })

  afterAll(async () => {
    const where = { tenantId: { in: tenantCreati } }
    // Istantanee e dati puntano ai movimenti (NO ACTION): prima loro, poi il resto.
    await owner.comunicazioneConsorzio.deleteMany({ where })
    await owner.datiTracciatoMovimento.deleteMany({ where })
    await owner.configurazioneComunicazioneSede.deleteMany({ where })
    await pulisciAziendeMud(owner, tenantCreati)
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  it('anteprima: solo i movimenti marcati, con i dati del tracciato; una rettifica vale coi valori della vigente', async () => {
    const az = await nuovaAzienda('G1')
    const m1 = await olio(az, '2026-05-10', 100)
    await olio(az, '2026-05-11', 50, '20 03 01') // non e' del CONOU
    const m3 = await olio(az, '2026-05-12', 70)
    await creaMovimento(owner, az, {
      tipo: 'RETTIFICA',
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05*',
      quantita: 75,
      unita: 'KG',
      giorno: '2026-05-12',
      rettificatoId: m3.id,
      originaleId: m3.id,
    })
    await olio(az, '2026-06-02', 10) // fuori dal periodo
    await nel(az, () => dati.imposta(az.tenantId, az.utenteId, m1.id, 'CONOU', { prodotto: 'A' }))
    await nel(az, () => dati.imposta(az.tenantId, az.utenteId, m3.id, 'CONOU', { prodotto: 'B' }))

    const a = await nel(az, () => servizio.anteprima(az.tenantId, richiesta(az)))
    expect(a).toMatchObject({
      consorzio: 'CONOU',
      tracciato: 'Finto',
      versione: 'Finto-ww1',
      affidabilita: 'RICAVATO_WINWASTE',
      numeroRecord: 2,
      numeroMovimenti: 2,
      bloccanti: false,
    })
    // Un avviso per movimento senza FIR (i due marcati), nessuno per quello non marcato.
    expect(a.avvisi.map(x => x.codice)).toEqual(['SENZA_FIR', 'SENZA_FIR'])
    expect(a.avvisi.flatMap(x => x.movimentoIds)).toHaveLength(2)
    expect(a.ultima).toBeUndefined()
    const g = await nel(az, () => servizio.genera(az.tenantId, az.utenteId, richiesta(az)))
    const f = await nel(az, () => servizio.file(az.tenantId, g.id))
    // Rettifica: 75 kg, non i 70 originali; il dato del tracciato sta sulla radice.
    expect(f.contenuto.toString('latin1')).toContain('130205|75|B')
    expect(f.contenuto.toString('latin1')).not.toContain('|70|')
  })

  it('genera e idempotenza: stessi dati, stessa comunicazione; istantanea dei movimenti; file in Windows-1252', async () => {
    const az = await nuovaAzienda('G2')
    const m = await olio(az, '2026-05-10')
    await nel(az, () => dati.imposta(az.tenantId, az.utenteId, m.id, 'CONOU', { prodotto: 'A' }))
    await nel(az, () =>
      configurazioni.imposta(az.tenantId, az.unitaLocaleId, 'CONOU', { codiceDeposito: 'DEP001' })
    )

    const g1 = await nel(az, () => servizio.genera(az.tenantId, az.utenteId, richiesta(az)))
    expect(g1).toMatchObject({
      consorzio: 'CONOU',
      stato: 'GENERATA',
      tracciato: 'Finto',
      versione: 'Finto-ww1',
      periodoDa: '2026-05-01',
      periodoA: '2026-05-31',
      nomeFile: 'finto_2026-05-01.txt',
      generataDa: az.utenteId,
      affidabilita: 'RICAVATO_WINWASTE',
      modificataDopoInvio: false,
    })
    const g2 = await nel(az, () => servizio.genera(az.tenantId, az.utenteId, richiesta(az)))
    expect(g2.id).toBe(g1.id)
    expect(await owner.comunicazioneConsorzio.count({ where: { tenantId: az.tenantId } })).toBe(1)
    expect(
      await owner.comunicazioneConsorzioMovimento.count({ where: { comunicazioneId: g1.id } })
    ).toBe(1)

    const f = await nel(az, () => servizio.file(az.tenantId, g1.id))
    expect(f.contentType).toBe('text/plain; charset=windows-1252')
    expect(f.nomeFile).toBe('finto_2026-05-01.txt')
    // € = 0x80 e à = 0xE0 in Windows-1252 (con utf-8 sarebbero tre e due byte).
    expect([...f.contenuto.subarray(0, 9)]).toEqual(
      [...Buffer.from('DEP001 '), 0x80, 0x20, 0xe0].slice(0, 9)
    )
    expect(f.contenuto.includes(Buffer.from([0xe2, 0x82, 0xac]))).toBe(false)
    // Il contenuto salvato resta testo.
    const riga = await owner.comunicazioneConsorzio.findUniqueOrThrow({ where: { id: g1.id } })
    expect(riga.contenuto).toContain('€ à')
  })

  it('cambiare un dato del tracciato o la configurazione cambia l’hash e produce un’altra comunicazione', async () => {
    const az = await nuovaAzienda('G3')
    const m = await olio(az, '2026-05-10')
    await nel(az, () => dati.imposta(az.tenantId, az.utenteId, m.id, 'CONOU', { prodotto: 'A' }))
    const g1 = await nel(az, () => servizio.genera(az.tenantId, az.utenteId, richiesta(az)))
    await nel(az, () => dati.imposta(az.tenantId, az.utenteId, m.id, 'CONOU', { prodotto: 'C' }))
    const g2 = await nel(az, () => servizio.genera(az.tenantId, az.utenteId, richiesta(az)))
    expect(g2.id).not.toBe(g1.id)
    expect(g2.hashDati).not.toBe(g1.hashDati)
    await nel(az, () =>
      configurazioni.imposta(az.tenantId, az.unitaLocaleId, 'CONOU', { codiceDeposito: 'NUOVO1' })
    )
    const g3 = await nel(az, () => servizio.genera(az.tenantId, az.utenteId, richiesta(az)))
    expect(g3.hashDati).not.toBe(g2.hashDati)
    expect(await owner.comunicazioneConsorzio.count({ where: { tenantId: az.tenantId } })).toBe(3)
  })

  it('un errore del tracciato (prodotto mancante) e’ bloccante: l’anteprima lo dice e non si genera', async () => {
    const az = await nuovaAzienda('G4')
    await olio(az, '2026-05-10') // senza dati del tracciato: prodotto '?'
    const a = await nel(az, () => servizio.anteprima(az.tenantId, richiesta(az)))
    expect(a.bloccanti).toBe(true)
    expect(a.avvisi.find(x => x.bloccante)).toMatchObject({ codice: 'DATI_NON_VALIDI' })
    await expect(
      nel(az, () => servizio.genera(az.tenantId, az.utenteId, richiesta(az)))
    ).rejects.toBeInstanceOf(ComunicazioneConBloccantiError)
    expect(await owner.comunicazioneConsorzio.count({ where: { tenantId: az.tenantId } })).toBe(0)
  })

  it('segna inviata: serve la conferma per un tracciato ricavato; ripetuta non cambia nulla; modifica dopo l’invio', async () => {
    const az = await nuovaAzienda('G5')
    const m = await olio(az, '2026-05-10')
    await nel(az, () => dati.imposta(az.tenantId, az.utenteId, m.id, 'CONOU', { prodotto: 'A' }))
    const g = await nel(az, () => servizio.genera(az.tenantId, az.utenteId, richiesta(az)))
    await expect(
      nel(az, () => servizio.segnaInviata(az.tenantId, az.utenteId, g.id))
    ).rejects.toBeInstanceOf(ConfermaVerificaRichiestaError)
    await expect(
      nel(az, () => servizio.segnaInviata(az.tenantId, az.utenteId, g.id, false))
    ).rejects.toBeInstanceOf(ConfermaVerificaRichiestaError)

    const inviata = await nel(az, () => servizio.segnaInviata(az.tenantId, az.utenteId, g.id, true))
    expect(inviata).toMatchObject({
      stato: 'INVIATA',
      inviataDa: az.utenteId,
      modificataDopoInvio: false,
    })
    const ancora = await nel(az, () => servizio.segnaInviata(az.tenantId, randomUUID(), g.id))
    expect(ancora.inviataIl).toBe(inviata.inviataIl)
    expect(ancora.inviataDa).toBe(az.utenteId)

    await nel(az, () => dati.imposta(az.tenantId, az.utenteId, m.id, 'CONOU', { prodotto: 'E' }))
    const dopo = await nel(az, () => servizio.segnaInviata(az.tenantId, az.utenteId, g.id))
    expect(dopo.modificataDopoInvio).toBe(true)
    const elenco = await nel(az, () =>
      servizio.elenca(az.tenantId, {
        consorzio: 'CONOU',
        unitaLocaleId: az.unitaLocaleId,
        da: '2026-05-01',
        a: '2026-05-31',
      })
    )
    expect(elenco).toHaveLength(1)
    expect(elenco[0]).toMatchObject({
      id: g.id,
      modificataDopoInvio: true,
      affidabilita: 'RICAVATO_WINWASTE',
    })
    // Senza sede e periodo nel filtro l'hash non si ricalcola.
    const senzaFiltro = await nel(az, () => servizio.elenca(az.tenantId, { consorzio: 'CONOU' }))
    expect(senzaFiltro[0].modificataDopoInvio).toBe(false)
  })

  it('manifest: dichiara il tracciato ricavato, hash, record, avvisi, differenze, inferenze e lo stato', async () => {
    const az = await nuovaAzienda('G6')
    const m = await olio(az, '2026-05-10')
    await nel(az, () => dati.imposta(az.tenantId, az.utenteId, m.id, 'CONOU', { prodotto: 'A' }))
    const g = await nel(az, () => servizio.genera(az.tenantId, az.utenteId, richiesta(az)))
    const man = await nel(az, () => servizio.manifest(az.tenantId, g.id))
    expect(man.nomeFile).toBe('finto_2026-05-01.txt.manifest.txt')
    expect(man.testo).toContain('tracciato ricavato da WinWaste, da confermare con un file reale')
    expect(man.testo).toContain(`Hash dei dati:    ${g.hashDati}`)
    expect(man.testo).toContain('Record nel file:  1')
    expect(man.testo).toContain('SENZA_FIR')
    expect(man.testo).toContain('differenza di prova')
    expect(man.testo).toContain('INFERENZA_DI_PROVA = 1')
    expect(man.testo).toContain('Codifica:         windows-1252')
    expect(man.testo).toContain('Stato:            GENERATA')

    // Dati cambiati dopo la generazione: il manifest non descrive piu' il file e lo dice.
    await nel(az, () => dati.imposta(az.tenantId, az.utenteId, m.id, 'CONOU', { prodotto: 'B' }))
    const dopo = await nel(az, () => servizio.manifest(az.tenantId, g.id))
    expect(dopo.testo).toContain('DATI_CAMBIATI')
    expect(dopo.testo).toContain('Record nel file:  non disponibile')

    await nel(az, () => servizio.segnaInviata(az.tenantId, az.utenteId, g.id, true))
    const inviata = await nel(az, () => servizio.manifest(az.tenantId, g.id))
    expect(inviata.testo).toContain('Ho verificato che il consorzio accetta questo file')
    expect(inviata.testo).toContain('i dati sono cambiati dopo l’invio')
  })

  it('isolamento: sede o comunicazione di un’altra azienda → non trovata, nessuna riga scritta', async () => {
    const a = await nuovaAzienda('G7a')
    const b = await nuovaAzienda('G7b')
    const mb = await olio(b, '2026-05-10')
    await nel(b, () => dati.imposta(b.tenantId, b.utenteId, mb.id, 'CONOU', { prodotto: 'A' }))
    const gb = await nel(b, () => servizio.genera(b.tenantId, b.utenteId, richiesta(b)))

    await expect(
      nel(a, () => servizio.anteprima(a.tenantId, richiesta(a, { unitaLocaleId: b.unitaLocaleId })))
    ).rejects.toBeInstanceOf(ComunicazioneNonTrovataError)
    await expect(
      nel(a, () =>
        servizio.genera(a.tenantId, a.utenteId, richiesta(a, { unitaLocaleId: b.unitaLocaleId }))
      )
    ).rejects.toBeInstanceOf(ComunicazioneNonTrovataError)
    const operazioni: Array<() => Promise<unknown>> = [
      () => servizio.file(a.tenantId, gb.id),
      () => servizio.manifest(a.tenantId, gb.id),
      () => servizio.segnaInviata(a.tenantId, a.utenteId, gb.id, true),
    ]
    for (const op of operazioni) {
      await expect(nel(a, op)).rejects.toBeInstanceOf(ComunicazioneNonTrovataError)
    }
    expect(await owner.comunicazioneConsorzio.count({ where: { tenantId: a.tenantId } })).toBe(0)
    expect((await nel(a, () => servizio.elenca(a.tenantId, {}))).length).toBe(0)
    expect(
      (await owner.comunicazioneConsorzio.findUniqueOrThrow({ where: { id: gb.id } })).stato
    ).toBe('GENERATA')
  })

  it('richieste non valide: periodo, durata, parametri, consorzio non supportato', async () => {
    const az = await nuovaAzienda('G8')
    const prova = (r: RichiestaComunicazione) => nel(az, () => servizio.anteprima(az.tenantId, r))
    await expect(
      prova(richiesta(az, { da: '2026-05-31', a: '2026-05-01' }))
    ).rejects.toBeInstanceOf(RichiestaComunicazioneNonValidaError)
    await expect(prova(richiesta(az, { da: '2026-02-30' }))).rejects.toBeInstanceOf(
      RichiestaComunicazioneNonValidaError
    )
    await expect(
      prova(richiesta(az, { da: '2019-01-01', a: '2026-05-31' }))
    ).rejects.toBeInstanceOf(RichiestaComunicazioneNonValidaError)
    await expect(prova(richiesta(az, { parametri: { rifiuta: '1' } }))).rejects.toThrow(
      /parametro rifiutato/
    )
    await expect(prova(richiesta(az, { consorzio: 'COBAT' }))).rejects.toThrow(/non supportato/)
  })
})
