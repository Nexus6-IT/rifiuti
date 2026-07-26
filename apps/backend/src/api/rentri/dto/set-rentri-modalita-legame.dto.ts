import { IsEnum } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { RentriModalitaLegame } from '@prisma/client'

/** DTO per impostare la modalità di legame RENTRI del tenant corrente. */
export class SetRentriModalitaLegameDto {
  @ApiProperty({
    enum: RentriModalitaLegame,
    description: 'Modalità con cui il tenant lega i FIR ai formulari RENTRI',
  })
  @IsEnum(RentriModalitaLegame)
  modalitaLegame: RentriModalitaLegame
}
