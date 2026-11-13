import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches, MaxLength } from 'class-validator'

/** Corpo di `POST /agenti-pesa/abbinamento` (D8). */
export class AbbinamentoDto {
  @ApiProperty({ description: 'Codice di abbinamento, anche con trattini o minuscole' })
  @IsString()
  @MaxLength(32)
  codice!: string

  @ApiProperty({ description: 'Chiave pubblica Ed25519: 32 byte in base64 standard' })
  @IsString()
  @Matches(/^[A-Za-z0-9+/]{43}=$/, { message: 'La chiave pubblica non è valida.' })
  chiavePubblica!: string

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  nomeHost!: string

  @ApiProperty({ maxLength: 30 })
  @IsString()
  @MaxLength(30)
  versione!: string
}
