import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

/**
 * DTO per `POST /rentri/scorta/vidima` (R6). `quantita` è limitata (100,
 * l'ambiente DEMO RENTRI consente al massimo 100 blocchi per operatore ma
 * non impone un limite documentato sulla singola richiesta di vidimazione —
 * il tetto qui è nostro, per evitare che una richiesta malformata avvii
 * centinaia di chiamate sequenziali all'ente in un colpo solo).
 */
export class VidimaScortaRentriDto {
  @ApiProperty({
    example: 'BLK-A',
    description: 'Codice del blocco virtuale RENTRI su cui vidimare',
  })
  @IsString()
  @IsNotEmpty()
  codiceBlocco: string

  @ApiProperty({ example: 10, description: 'Quanti numeri vidimare in questo lotto' })
  @IsInt()
  @Min(1)
  @Max(100)
  quantita: number
}
