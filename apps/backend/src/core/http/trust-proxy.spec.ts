import express from 'express'
import request from 'supertest'
import { valoreTrustProxy } from './trust-proxy'

describe('valoreTrustProxy', () => {
  it('predefinito: loopback, link-local e reti private (nginx host + nginx del container frontend)', () => {
    expect(valoreTrustProxy(undefined)).toBe('loopback, linklocal, uniquelocal')
    expect(valoreTrustProxy('')).toBe('loopback, linklocal, uniquelocal')
  })
  it('accetta false, un numero o subnet; rifiuta true', () => {
    expect(valoreTrustProxy('false')).toBe(false)
    expect(valoreTrustProxy('1')).toBe(1)
    expect(valoreTrustProxy('172.16.0.0/12')).toBe('172.16.0.0/12')
    expect(() => valoreTrustProxy('true')).toThrow()
  })

  const ipVisto = async (trust: ReturnType<typeof valoreTrustProxy>, xff: string) => {
    const app = express()
    app.set('trust proxy', trust)
    app.get('/', (req, res) => res.send(req.ip))
    const r = await request(app).get('/').set('X-Forwarded-For', xff)
    return r.text
  }

  it('dietro nginx su loopback req.ip e` l’ultimo valore aggiunto da nginx, non quello inventato dal client', async () => {
    // il client invia "6.6.6.6", nginx aggiunge l'IP reale 203.0.113.9
    expect(await ipVisto(valoreTrustProxy(undefined), '6.6.6.6, 203.0.113.9')).toBe('203.0.113.9')
  })
  it('catena di produzione: remote del container frontend (172.18.0.5), XFF "1.2.3.4, 172.18.0.1" -> req.ip 1.2.3.4', () => {
    const app = express()
    app.set('trust proxy', valoreTrustProxy(undefined))
    const req = Object.assign(Object.create(app.request), {
      app,
      headers: { 'x-forwarded-for': '1.2.3.4, 172.18.0.1' },
      socket: { remoteAddress: '172.18.0.5' },
      connection: { remoteAddress: '172.18.0.5' },
    })
    expect(req.ip).toBe('1.2.3.4')
  })
  it('XFF inventato dal client a sinistra non conta: vince l’ultimo valore non fidato', () => {
    const app = express()
    app.set('trust proxy', valoreTrustProxy(undefined))
    const req = Object.assign(Object.create(app.request), {
      app,
      headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 172.18.0.1' },
      socket: { remoteAddress: '172.18.0.5' },
      connection: { remoteAddress: '172.18.0.5' },
    })
    expect(req.ip).toBe('1.2.3.4')
  })
  it('senza trust proxy si vedrebbe l’indirizzo del proxy', async () => {
    expect(await ipVisto(false, '203.0.113.9')).not.toBe('203.0.113.9')
  })
})
