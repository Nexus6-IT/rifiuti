import { ProviderSdiFake, firmaWebhookFake } from './provider-sdi-fake'
import type { ContestoProvider } from '../../../application/fatturazione/sdi/provider-sdi.port'

const ctx: ContestoProvider = {
  ambiente: 'SANDBOX',
  credenziali: null,
  idConfigurazioneProvider: null,
}

/** XML minimo: al fake interessa solo l'identificativo del cessionario. */
const xmlPer = (piva: string) =>
  Buffer.from(
    `<p:FatturaElettronica><FatturaElettronicaHeader><CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdFiscaleIVA></DatiAnagrafici></CedentePrestatore>` +
      `<CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${piva}</IdCodice></IdFiscaleIVA></DatiAnagrafici></CessionarioCommittente></FatturaElettronicaHeader></p:FatturaElettronica>`
  )

const file = (piva: string, chiave = 'k-' + piva) => ({
  nomeFile: `IT01234567890_${chiave.slice(-5)}.xml`,
  xml: xmlPer(piva),
  firma: false,
  chiaveIdempotenza: chiave,
})

describe('ProviderSdiFake: esiti guidati dalla P.IVA del cessionario', () => {
  let p: ProviderSdiFake
  beforeEach(() => {
    p = new ProviderSdiFake(() => new Date('2026-11-19T10:00:00Z'))
  })

  it('di default accetta e la notifica e una RC', async () => {
    const r = await p.invia(ctx, file('12345678900'))
    expect(r.tipo).toBe('ACCETTATO')
    if (r.tipo !== 'ACCETTATO') return
    expect(r.idProvider).toBeTruthy()
    const n = await p.notifiche(ctx, r.idProvider)
    expect(n.map(x => x.tipo)).toEqual(['RC'])
    expect(n[0].dataRicezioneSdi).toEqual(new Date('2026-11-19T10:00:00Z'))
  })

  it('finale 1: NS con un codice di errore', async () => {
    const r = await p.invia(ctx, file('12345678901'))
    if (r.tipo !== 'ACCETTATO') throw new Error('atteso ACCETTATO')
    const n = await p.notifiche(ctx, r.idProvider)
    expect(n).toHaveLength(1)
    expect(n[0].tipo).toBe('NS')
    expect(n[0].codiciErrore).toEqual(['00305'])
  })

  it('finale 2: MC', async () => {
    const r = await p.invia(ctx, file('12345678902'))
    if (r.tipo !== 'ACCETTATO') throw new Error('atteso ACCETTATO')
    expect((await p.notifiche(ctx, r.idProvider)).map(x => x.tipo)).toEqual(['MC'])
  })

  it('finale 3: INCERTO ma l invio e arrivato (cerca lo trova)', async () => {
    const f = file('12345678903')
    expect(await p.invia(ctx, f)).toEqual({ tipo: 'INCERTO' })
    const trovato = await p.cerca(ctx, {
      chiaveIdempotenza: f.chiaveIdempotenza,
      nomeFile: f.nomeFile,
    })
    expect(trovato?.idProvider).toBeTruthy()
  })

  it('finale 6: INCERTO e l invio NON e arrivato (cerca non trova)', async () => {
    const f = file('12345678906')
    expect(await p.invia(ctx, f)).toEqual({ tipo: 'INCERTO' })
    expect(
      await p.cerca(ctx, { chiaveIdempotenza: f.chiaveIdempotenza, nomeFile: f.nomeFile })
    ).toBeNull()
  })

  it('finale 4: TRANSITORIO; finale 5: RIFIUTATO', async () => {
    expect((await p.invia(ctx, file('12345678904'))).tipo).toBe('TRANSITORIO')
    const r = await p.invia(ctx, file('12345678905'))
    expect(r.tipo).toBe('RIFIUTATO')
  })

  it('finale 7 e 8: RC poi esito del committente (EC01 / EC02)', async () => {
    for (const [piva, esito] of [
      ['12345678907', 'EC01'],
      ['12345678908', 'EC02'],
    ] as const) {
      const r = await p.invia(ctx, file(piva))
      if (r.tipo !== 'ACCETTATO') throw new Error('atteso ACCETTATO')
      const n = await p.notifiche(ctx, r.idProvider)
      expect(n.map(x => x.tipo)).toEqual(['RC', 'NE'])
      expect(n[1].esitoCommittente).toBe(esito)
    }
  })

  it('invio idempotente: la stessa chiave non genera un secondo invio ne un nuovo id', async () => {
    const f = file('12345678900', 'chiave-uguale')
    const a = await p.invia(ctx, f)
    const b = await p.invia(ctx, f)
    expect(a).toEqual(b)
    expect(p.invii).toBe(1)
  })

  it('senza identificativo del cessionario: RIFIUTATO', async () => {
    const r = await p.invia(ctx, { ...file('x'), xml: Buffer.from('<vuoto/>') })
    expect(r.tipo).toBe('RIFIUTATO')
  })

  it('verifica: P.IVA di 11 cifre ok; credenziali KO o P.IVA malformata no', async () => {
    expect(
      (await p.verifica(ctx, { partitaIva: '01234567890', codiceFiscale: '01234567890' })).ok
    ).toBe(true)
    expect((await p.verifica(ctx, { partitaIva: '123', codiceFiscale: 'x' })).ok).toBe(false)
    expect(
      (
        await p.verifica(
          { ...ctx, credenziali: { apiKey: 'KO' } },
          { partitaIva: '01234567890', codiceFiscale: 'x' }
        )
      ).ok
    ).toBe(false)
  })
})

describe('ProviderSdiFake.interpretaWebhook (firma HMAC e timestamp)', () => {
  const p = new ProviderSdiFake()
  const ora = new Date('2026-11-19T10:00:00Z')
  const segreto = 'wh_sec_prova'
  const corpo = Buffer.from(
    JSON.stringify({
      id: 'evt_1',
      idProvider: 'fake-1',
      notifica: {
        tipo: 'RC',
        esitoCommittente: null,
        codiciErrore: [],
        dataRicezioneSdi: '2026-11-19T09:59:00.000Z',
        idNotifica: 'n-1',
      },
    })
  )
  const intestazioni = (t: number, s = segreto, c = corpo) => ({
    'x-sdi-signature': firmaWebhookFake(c, s, t),
  })
  const t0 = Math.floor(ora.getTime() / 1000)

  it('firma valida: evento interpretato', () => {
    const r = p.interpretaWebhook(intestazioni(t0), corpo, segreto, ora)
    expect(r.tipo).toBe('VALIDO')
    if (r.tipo !== 'VALIDO') return
    expect(r.idEvento).toBe('evt_1')
    expect(r.idProvider).toBe('fake-1')
    expect(r.notifica.tipo).toBe('RC')
    expect(r.notifica.idNotifica).toBe('n-1')
  })

  it('firma errata (segreto diverso o corpo alterato): NON_AUTENTICO FIRMA', () => {
    expect(p.interpretaWebhook(intestazioni(t0, 'altro'), corpo, segreto, ora)).toEqual({
      tipo: 'NON_AUTENTICO',
      motivo: 'FIRMA',
    })
    expect(
      p.interpretaWebhook(intestazioni(t0), Buffer.from(corpo.toString() + ' '), segreto, ora)
    ).toEqual({
      tipo: 'NON_AUTENTICO',
      motivo: 'FIRMA',
    })
  })

  it('intestazione assente o malformata: NON_AUTENTICO FORMATO', () => {
    expect(p.interpretaWebhook({}, corpo, segreto, ora)).toEqual({
      tipo: 'NON_AUTENTICO',
      motivo: 'FORMATO',
    })
    expect(p.interpretaWebhook({ 'x-sdi-signature': 'rotta' }, corpo, segreto, ora)).toEqual({
      tipo: 'NON_AUTENTICO',
      motivo: 'FORMATO',
    })
  })

  it('timestamp troppo vecchio (o nel futuro): NON_AUTENTICO TIMESTAMP', () => {
    expect(p.interpretaWebhook(intestazioni(t0 - 600), corpo, segreto, ora)).toEqual({
      tipo: 'NON_AUTENTICO',
      motivo: 'TIMESTAMP',
    })
    expect(p.interpretaWebhook(intestazioni(t0 + 600), corpo, segreto, ora)).toEqual({
      tipo: 'NON_AUTENTICO',
      motivo: 'TIMESTAMP',
    })
  })

  it('corpo firmato ma non JSON o senza notifica: FORMATO / IGNORATO', () => {
    const rotto = Buffer.from('non json')
    expect(p.interpretaWebhook(intestazioni(t0, segreto, rotto), rotto, segreto, ora)).toEqual({
      tipo: 'NON_AUTENTICO',
      motivo: 'FORMATO',
    })
    const altro = Buffer.from(JSON.stringify({ id: 'e2', tipo: 'altro' }))
    expect(p.interpretaWebhook(intestazioni(t0, segreto, altro), altro, segreto, ora)).toEqual({
      tipo: 'IGNORATO',
    })
  })
})

describe('firmaWebhookFake: vettore condiviso con tools/sdi-fake', () => {
  it('produce la stessa firma del server finto HTTP (stesso vettore in tools/sdi-fake/test/firma.test.js)', () => {
    expect(firmaWebhookFake(Buffer.from('{"id":"evt-1"}'), 'segreto-di-prova', 1700000000)).toBe(
      't=1700000000,v1=afa1c743636aba3cff6ab0eac143d6533c1bb0fb29468c915d97b60eeff305e6'
    )
  })
})
