import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBase64,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator'

/** Una lettura: i byte ESATTI firmati dall'agente e la firma, entrambi in base64 standard. */
export class ElementoLetturaDto {
  @ApiProperty({ maxLength: 2800, description: 'Payload firmato (UTF-8, ≤ 2048 byte) in base64' })
  @IsBase64()
  @MaxLength(2800)
  payload!: string

  @ApiProperty({ description: 'Firma Ed25519 di 64 byte in base64 (88 caratteri)' })
  @IsBase64()
  @Length(88, 88)
  firma!: string
}

/** Corpo di `POST /agenti-pesa/letture`: da 1 a 50 letture (D8). */
export class LottoLettureDto {
  @ApiProperty({ type: [ElementoLetturaDto], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ElementoLetturaDto)
  letture!: ElementoLetturaDto[]
}
