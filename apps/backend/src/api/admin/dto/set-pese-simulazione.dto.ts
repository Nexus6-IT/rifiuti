import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean } from 'class-validator'

/** Corpo di `PATCH /admin/tenants/:id/pese-simulazione` (solo SUPER_ADMIN, 4.8b Q2). */
export class SetPeseSimulazioneDto {
  @ApiProperty({ description: 'true: l’azienda e’ di prova e puo’ usare letture simulate' })
  @IsBoolean({ message: 'ammessa deve essere true o false.' })
  ammessa!: boolean
}
