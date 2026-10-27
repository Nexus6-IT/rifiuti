import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { ModificaFIRDto } from './modifica-fir.dto'

/** Validazione con la pipe vera, come in main.ts. */
describe('ModificaFIRDto — validazione', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  const valida = (body: unknown) => pipe.transform(body, { type: 'body', metatype: ModificaFIRDto })
  const base = {
    produttoreId: 'p1',
    rifiuto: { cerCode: '20 03 01', quantita: 100, unitaMisura: 'kg' },
    trasportatoreId: 't1',
    destinatarioId: 'd1',
    provenienza: 'SPECIALE',
    tipoTrattaPrincipale: 'TERRESTRE',
    versione: 2,
  }

  it('accetta un corpo completo e trasforma il rifiuto', async () => {
    await expect(valida(base)).resolves.toMatchObject({
      versione: 2,
      rifiuto: { cerCode: '20 03 01' },
    })
  })

  it('accetta i facoltativi della creazione (tratte, annotazioni, stato fisico)', async () => {
    const corpo = {
      ...base,
      annotazioni: 'x',
      trasportatoriAggiuntivi: [{ trasportatoreId: 't2', tipoTratta: 'FERROVIARIA', ordine: 2 }],
      rifiuto: { ...base.rifiuto, statoFisico: 'Solido', numeroColli: 2 },
    }
    await expect(valida(corpo)).resolves.toBeDefined()
  })

  it.each([
    ['versione mancante', { ...base, versione: undefined }],
    ['versione 0', { ...base, versione: 0 }],
    ['versione stringa', { ...base, versione: '2' }],
    ['unitaMisura mancante', { ...base, rifiuto: { ...base.rifiuto, unitaMisura: undefined } }],
    ['cerCode mancante', { ...base, rifiuto: { ...base.rifiuto, cerCode: undefined } }],
    ['rifiuto.descrizione', { ...base, rifiuto: { ...base.rifiuto, descrizione: 'x' } }],
    ['rifiuto.categoria', { ...base, rifiuto: { ...base.rifiuto, categoria: 'x' } }],
    ['rifiuto.tipoOperazione', { ...base, rifiuto: { ...base.rifiuto, tipoOperazione: 'x' } }],
    ['stato', { ...base, stato: 'EMESSO' }],
    ['numeroProgressivo', { ...base, numeroProgressivo: 'FIR-1' }],
  ])('rifiuta: %s', async (_nome, corpo) => {
    await expect(valida(corpo)).rejects.toBeInstanceOf(BadRequestException)
  })
})
