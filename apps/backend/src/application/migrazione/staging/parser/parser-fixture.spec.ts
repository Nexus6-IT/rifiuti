import { join } from 'path'
import { apriStaging, StagingAperto } from '../lettore-staging'
import { parsaCausaliRifiuti } from './causali-rifiuti'
import { parsaFormulari } from './formulari'
import { parsaGiacenzeRifiuti } from './giacenze-rifiuti'
import { parsaMovimenti } from './movimenti'
import { parsaRenRegistrazioni } from './ren-registrazioni'
import { parsaRegistriRifiuti } from './registri-rifiuti'
import { ContestoParser, sorgenteDa } from './scarti'
import { parsaVersis } from './versis'

const FIXTURE = join(__dirname, '../../../../../test/fixtures/winwaste/WW00012026')
const CONTESTO: ContestoParser = { ditta: '0001', anno: 2026 }

let staging: StagingAperto
beforeAll(async () => {
  staging = await apriStaging(FIXTURE)
})

const sintesi = (s: { riga: number; cod: string; codice: string }[]) =>
  s.map(x => `${x.riga}:${x.cod}:${x.codice}`)

describe('parsaMovimenti sulla fixture WW00012026', () => {
  it('produce i conteggi attesi e gli scarti tipati', async () => {
    const r = await parsaMovimenti(sorgenteDa(staging, 'MOVIMENTI'), CONTESTO)
    expect(r.righeLette).toBe(18)
    expect(r.record).toHaveLength(13)
    expect(sintesi(r.scarti)).toEqual([
      '7:7:RELAZIONE_MANCANTE',
      '8:8:DTUK_NON_VALIDA',
      '11:11:OPER_SCONOSCIUTO',
      '16:16:RELAZ_LUNGHEZZA',
      '17:17:CER_FORMATO',
    ])
    expect(sintesi(r.avvisi)).toEqual(['10:10:KGNUM_INCOERENTE', '12:12:DATR_DTUK_DIVERSE'])
  })

  it('un movimento annullato ($$) e letto e marcato, non scartato', async () => {
    const r = await parsaMovimenti(sorgenteDa(staging, 'MOVIMENTI'), CONTESTO)
    const annullati = r.record.filter(m => m.annullato)
    expect(annullati.map(m => m.cod)).toEqual([5])
    expect(annullati[0]).toMatchObject({
      causaAnnullo: 'PREFISSO_ANNULLO',
      data: '2026-01-25', // DTUK '$$260125'
      legacyKey: '0001|2026|MOVIMENTI|5',
    })
  })

  it('decodifica carico, scarico con relazione, litri e registri', async () => {
    const r = await parsaMovimenti(sorgenteDa(staging, 'MOVIMENTI'), CONTESTO)
    const per = (cod: number) => r.record.find(m => m.cod === cod)!
    expect(per(1)).toMatchObject({
      tabella: 'MOVIMENTI',
      legacyKey: '0001|2026|MOVIMENTI|1',
      oper: { codice: '20', tipo: 'CARICO' },
      data: '2026-01-05',
      dataRegistrazione: '2026-01-05',
      cer: { codice: '15 01 10*', pericoloso: true },
      nettoKg: 1000,
      lordoKg: 1100,
      taraKg: 100,
      kgnum: 1000,
      giascar: 800,
      stato: 'R001',
      produttore: { codice: '000020', unita: '0001' },
      destinatario: { codice: 'X90000', unita: '0002' },
      registri: [{ registro: '0002', protocollo: 1 }],
      c4: { idEsterno: 'EXT-0001', quantitaOrigine: 1000, unitaOrigine: 'K' },
    })
    expect(per(3).relaz).toEqual([{ tipo: 'C', cod: 1, classe: 'R', kg: 600, m3: 0 }])
    expect(per(9)).toMatchObject({ nettoKg: 1800, volumeM3: 2, mcnum: 2 })
    expect(per(13).relaz).toEqual([{ tipo: 'G', riga: 1, classe: 'R', kg: 100, m3: 0 }])
    expect(per(15).relaz).toHaveLength(2)
    expect(per(6)).toMatchObject({ oper: { tipo: 'SOLO_FATTURAZIONE' }, cer: null, nettoKg: null })
    expect(per(18).registri).toEqual([{ registro: '0001', protocollo: null }])
  })

  it('i caratteri speciali dei campi di testo restano nel grezzo, il resto delle colonne e mappato', async () => {
    const r = await parsaMovimenti(sorgenteDa(staging, 'MOVIMENTI'), CONTESTO)
    const m13 = r.record.find(m => m.cod === 13)!
    expect(m13.grezzo.NOT3).toBe('riga 1\nriga 2\tcon tab')
    const m2 = r.record.find(m => m.cod === 2)!
    expect(m2.grezzo.DES).toBe('Imballaggi in plastica: nota con à, è e § dentro')
    // le colonne mappate non sono duplicate nel grezzo
    expect(m2.grezzo.CER).toBeUndefined()
    expect(m2.grezzo.COD).toBeUndefined()
    // valori vuoti e zero non entrano nel grezzo
    expect(Object.values(m2.grezzo).some(x => x === '' || /^0(\.0+)?$/.test(x))).toBe(false)
  })

  it('ogni record e ogni scarto portano il numero di riga dello staging', async () => {
    const r = await parsaMovimenti(sorgenteDa(staging, 'MOVIMENTI'), CONTESTO)
    expect(r.record.map(m => m.riga)).toEqual(r.record.map(m => m.cod))
  })
})

describe('parsaFormulari sulla fixture WW00012026', () => {
  it('classifica C7 e marca gli annullati', async () => {
    const r = await parsaFormulari(sorgenteDa(staging, 'FORMULARI'), CONTESTO)
    expect(r.righeLette).toBe(6)
    expect(sintesi(r.scarti)).toEqual(['6:6:C7_SCONOSCIUTO'])
    // RELAZ di un FIR del portale e testo libero: avviso, il FIR non e scartato e il testo resta nel grezzo
    expect(sintesi(r.avvisi)).toEqual(['4:4:RELAZ_NON_DECODIFICABILE'])
    const f4 = r.record.find(f => f.cod === 4)!
    expect(f4.relaz).toEqual([])
    expect(f4.grezzo.RELAZ).toBe(`NOTE DI PROVA PER IL TRASPORTO${'\u00ff'.repeat(9)}`)
    expect(r.record.map(f => [f.cod, f.statoFir, f.annullato])).toEqual([
      [1, 'EMESSO', false],
      [2, 'RICOPIATO', false],
      [3, 'ANNULLATO', true],
      [4, 'PORTALE', false],
      [5, 'RICOPIATO', false],
    ])
    const f3 = r.record.find(f => f.cod === 3)!
    expect(f3).toMatchObject({ causaAnnullo: 'C7_ANNULLATO', legacyKey: '0001|2026|FORMULARI|3' })
  })

  it('legge numero fiscale, data documento e stato digitale', async () => {
    const r = await parsaFormulari(sorgenteDa(staging, 'FORMULARI'), CONTESTO)
    const f1 = r.record.find(f => f.cod === 1)!
    expect(f1).toMatchObject({
      formu: 'XRIF000001/26',
      serieNumero: { serie: 'XRIF', numero: 1, anno2: '26' },
      dataDocumento: '2026-01-20',
      digitale: true,
      kgnum: 600,
      nettoKg: 600,
    })
    const f4 = r.record.find(f => f.cod === 4)!
    expect(f4).toMatchObject({ formu: '', serieNumero: null, digitale: false })
  })
})

describe('parsaGiacenzeRifiuti sulla fixture WW00012026', () => {
  it('distingue le righe normali da quelle di compensazione', async () => {
    const r = await parsaGiacenzeRifiuti(sorgenteDa(staging, 'GIACENZE RIFIUTI'))
    expect(r.scarti).toEqual([])
    expect(r.record.map(g => g.compensazione)).toEqual([false, false, true])
    expect(r.record[0]).toMatchObject({
      chiaveNaturale: 'X900000002|001|001|150110|2|',
      giacenze: { RR: { kg: 1500, m3: 3 }, RL: { kg: 0, m3: 0 } },
    })
    expect(r.record[1].giacenze.DR.kg).toBe(250)
    expect(r.record[1].giacenze.DT.kg).toBe(75)
    expect(r.record[2].giacenze.RR.kg).toBe(-200)
    // le colonne a zero non entrano nel grezzo
    expect(r.record[0].grezzo).toEqual({ VER: '1', ID: 'Administrator' })
  })
})

describe('parser delle codifiche e di VERSIS sulla fixture', () => {
  it('causali: 14 record con OPER = TIP + OPE', async () => {
    const r = await parsaCausaliRifiuti(sorgenteDa(staging, 'CAUSALI RIFIUTI'))
    expect(r.scarti).toEqual([])
    expect(r.record).toHaveLength(14)
    expect(r.record.map(c => [c.cod, c.oper.codice]).slice(0, 4)).toEqual([
      ['01', '20'],
      ['02', '20'],
      ['05', '21'],
      ['08', '22'],
    ])
    expect(r.record.find(c => c.cod === '15')!.oper.tipo).toBe('SOLO_FATTURAZIONE')
  })

  it('registri: protocollo e data dell ultima stampa', async () => {
    const r = await parsaRegistriRifiuti(sorgenteDa(staging, 'REGISTRI RIFIUTI'))
    expect(r.scarti).toEqual([])
    expect(r.record.map(x => [x.cod, x.ultimoProtocollo])).toEqual([
      ['0001', null],
      ['0002', 7],
      ['0003', null],
      ['0004', null],
    ])
    expect(r.record[1].ultimaStampa).toBe('04-02')
  })

  it('VERSIS non legge mai C1..C5: nessun segreto nei record', async () => {
    const r = await parsaVersis(sorgenteDa(staging, 'VERSIS'))
    expect(r.record.map(x => [x.prefisso, x.sensibile])).toEqual([
      ['XRENTRI', false],
      ['XRENTRI', false],
      ['HUBRW', true],
    ])
    const testo = JSON.stringify(r)
    for (const segreto of [
      'PASSWORD-CIFRATA-FINTA',
      'LICENZA-FINTA',
      'utente-finto',
      'hub.esempio.invalid',
    ]) {
      expect(testo).not.toContain(segreto)
    }
  })

  it('RENregistrazioni: conta le registrazioni inviate (XSEINVIATO = X)', async () => {
    const r = await parsaRenRegistrazioni(sorgenteDa(staging, 'RENregistrazioni'))
    expect(r.scarti).toEqual([])
    expect(r.record.map(x => [x.codMovimento, x.inviata, x.idRentri])).toEqual([
      [3, true, 'ID-FINTO-0001'],
      [4, false, ''],
    ])
  })
})
