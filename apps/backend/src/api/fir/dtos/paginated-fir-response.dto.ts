/**
 * Paginated FIR Response DTO - List API output
 */

import { ApiProperty } from '@nestjs/swagger'
import { FIRResponseDto } from './fir-response.dto'

export class PaginatedFIRResponseDto {
  @ApiProperty({ type: [FIRResponseDto], description: 'Lista FIR nella pagina corrente' })
  items: FIRResponseDto[]

  @ApiProperty({ example: 25, description: 'Numero totale di FIR' })
  total: number

  @ApiProperty({ example: 1, description: 'Numero pagina corrente' })
  page: number

  @ApiProperty({ example: 10, description: 'Elementi per pagina' })
  limit: number

  @ApiProperty({ example: 3, description: 'Numero totale di pagine' })
  totalPages: number
}
