import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { SyncLogsQueryDto } from './sync-fir.dto'

/**
 * `GET /rentri/sync/logs?page=1&limit=20`: i parametri di query arrivano come stringhe. Senza
 * `@Type(() => Number)` `@IsInt` li rifiutava e la cronologia RENTRI del FIR rispondeva sempre 400
 * («Impossibile caricare i log di sincronizzazione»), trovato dall'e2e di dettaglio FIR.
 */
describe('SyncLogsQueryDto', () => {
  it('accetta page e limit come stringhe di query e le converte in numeri', async () => {
    const dto = plainToInstance(SyncLogsQueryDto, { page: '2', limit: '20' })
    expect(await validate(dto)).toHaveLength(0)
    expect(dto.page).toBe(2)
    expect(dto.limit).toBe(20)
  })

  it('rifiuta limit oltre 100 e page non numerica', async () => {
    const dto = plainToInstance(SyncLogsQueryDto, { page: 'x', limit: '101' })
    const campi = (await validate(dto)).map(e => e.property).sort()
    expect(campi).toEqual(['limit', 'page'])
  })
})
