/**
 * Corpi di `POST /elaborazioni-fatturazione/:id/{ricalcola,scarta,definitiva}` (4.4b1, §11).
 * `versione` e `impronta` sono quelle dell'anteprima che l'utente ha visto.
 */
import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsString, Matches, Max, Min } from 'class-validator'

export class VersioneElaborazioneDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  versione: number
}

export class DefinitivaDto extends VersioneElaborazioneDto {
  @ApiProperty({ description: 'Impronta SHA-256 (64 caratteri esadecimali) dell`anteprima vista' })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/i, { message: "L'impronta non è valida." })
  impronta: string
}
