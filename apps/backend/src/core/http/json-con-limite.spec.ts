import { Body, Controller, INestApplication, Module, Post } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import request from 'supertest'
import { jsonConLimite } from './json-con-limite'

@Controller('prova')
class ProvaController {
  @Post('altra')
  altra(@Body() corpo: unknown) {
    return { corpo }
  }

  @Post('con-limite')
  conLimite(@Body() corpo: { x?: string }) {
    return { lunghezza: corpo.x?.length ?? 0 }
  }
}

@Module({ controllers: [ProvaController] })
class ProvaModule {}

describe('jsonConLimite', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await NestFactory.create(ProvaModule, { logger: false })
    app.use('/prova/con-limite', jsonConLimite('600kb'))
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('non si chiama jsonParser: Nest non deve credere che il parser globale ci sia gia', () => {
    expect(jsonConLimite('1mb').name).not.toBe('jsonParser')
  })

  it('le altre rotte ricevono ancora il body JSON (parser globale registrato)', async () => {
    const r = await request(app.getHttpServer()).post('/prova/altra').send({ email: 'a@b.it' })
    expect(r.status).toBe(201)
    expect(r.body).toEqual({ corpo: { email: 'a@b.it' } })
  })

  it('la rotta con limite alto accetta un body oltre i 100 KB del default', async () => {
    const r = await request(app.getHttpServer())
      .post('/prova/con-limite')
      .send({ x: 'a'.repeat(300_000) })
    expect(r.status).toBe(201)
    expect(r.body).toEqual({ lunghezza: 300_000 })
  })
})
