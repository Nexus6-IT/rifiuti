import { randomUUID } from 'crypto'
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'
import { corpoNuovoFormularioValido } from './aiuti/formulario'

/**
 * Validazione del MODELLO DATI DI SCRITTURA contro il contratto ufficiale.
 *
 * Perche' questi test esistono: fino a oggi `POST /formulari/v1.0/` accettava
 * qualunque corpo e rispondeva 202. Il backend ne ha approfittato per mesi
 * spedendo un segnaposto di due campi (`{ firId, firNumber }`) senza che
 * nessun test diventasse rosso — l'oracolo guardava l'involucro e mai il
 * contenuto. Finche' il finto non sa RIFIUTARE, qualunque mappatura
 * scriveremo risultera' verde senza significare nulla.
 *
 * Il metro e' `NuovoFormularioModel` in `docs/contracts/rentri/formulari.yaml`
 * (scaricato da demoapi.rentri.gov.it, digest in MANIFEST.md), non la nostra
 * idea del modello.
 */

async function tokenValido(): Promise<string> {
  const { chiavePrivataPem, certificatoBase64Der } = creaCertificatoDiTest()
  const chiave = await importPKCS8(chiavePrivataPem, 'RS256')

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', x5c: [certificatoBase64Der] } as never)
    .setIssuer('operatore-test')
    .setSubject('operatore-test')
    .setAudience('rentrigov.demo.api')
    .setIssuedAt()
    .setExpirationTime('300s')
    .setJti(randomUUID())
    .sign(chiave)
}

describe('POST /formulari/v1.0/ — modello dati di scrittura', () => {
  it('rifiuta con 400 un corpo privo di dati_partenza', async () => {
    const app = creaApp()

    const risposta = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/',
      headers: { authorization: `Bearer ${await tokenValido()}` },
      payload: { num_iscr_sito: 'OP1234ABC000001-AB0001' },
    })

    expect(risposta.statusCode).toBe(400)
    expect(risposta.json().detail).toContain('dati_partenza')
  })

  it('rifiuta con 400 un corpo che porta campi non previsti dal modello', async () => {
    const app = creaApp()

    const risposta = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/',
      headers: { authorization: `Bearer ${await tokenValido()}` },
      payload: { ...corpoNuovoFormularioValido(), firId: 'abc', firNumber: 7 },
    })

    expect(risposta.statusCode).toBe(400)
    expect(risposta.json().detail).toContain('firId')
  })

  it('rifiuta con 400 un num_iscr_sito che non rispetta il formato del contratto', async () => {
    const app = creaApp()

    const risposta = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/',
      headers: { authorization: `Bearer ${await tokenValido()}` },
      payload: { ...corpoNuovoFormularioValido(), num_iscr_sito: 'non-un-numero-iscrizione' },
    })

    expect(risposta.statusCode).toBe(400)
    expect(risposta.json().detail).toContain('num_iscr_sito')
  })
})
