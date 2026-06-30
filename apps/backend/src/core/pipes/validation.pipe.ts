import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common'
import { validate, ValidationError } from 'class-validator'
import { plainToInstance } from 'class-transformer'

/**
 * Global Validation Pipe
 *
 * Validates incoming request DTOs using class-validator decorators.
 * Automatically transforms plain objects to class instances.
 *
 * Usage in DTOs:
 * ```typescript
 * export class CreateFIRDto {
 *   @IsString()
 *   @IsNotEmpty()
 *   producerName: string;
 *
 *   @IsString()
 *   @Length(6, 6)
 *   cerCode: string;
 *
 *   @IsNumber()
 *   @Min(0)
 *   quantity: number;
 * }
 * ```
 *
 * If validation fails, returns structured error:
 * ```json
 * {
 *   "statusCode": 400,
 *   "error": "VALIDATION_ERROR",
 *   "message": "Validation failed",
 *   "details": {
 *     "cerCode": ["cerCode must be exactly 6 characters"],
 *     "quantity": ["quantity must be a positive number"]
 *   }
 * }
 * ```
 */
@Injectable()
export class ValidationPipe implements PipeTransform<any> {
  async transform(value: any, { metatype }: ArgumentMetadata) {
    // Skip validation if no metatype or primitive type
    if (!metatype || !this.toValidate(metatype)) {
      return value
    }

    // Transform plain object to class instance
    const object = plainToInstance(metatype, value)

    // Validate using class-validator
    const errors = await validate(object, {
      whitelist: true, // Strip properties not in DTO
      forbidNonWhitelisted: true, // Throw error if unknown properties
      transform: true, // Transform types automatically
    })

    if (errors.length > 0) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: this.formatErrors(errors),
      })
    }

    return object
  }

  /**
   * Check if type should be validated
   */
  private toValidate(metatype: new (...args: unknown[]) => unknown): boolean {
    const types: (new (...args: unknown[]) => unknown)[] = [String, Boolean, Number, Array, Object]
    return !types.includes(metatype)
  }

  /**
   * Format validation errors into structured object
   */
  private formatErrors(errors: ValidationError[]): Record<string, string[]> {
    const formatted: Record<string, string[]> = {}

    for (const error of errors) {
      if (error.constraints) {
        formatted[error.property] = Object.values(error.constraints)
      }

      // Handle nested validation errors
      if (error.children && error.children.length > 0) {
        const childErrors = this.formatErrors(error.children)
        for (const [key, value] of Object.entries(childErrors)) {
          formatted[`${error.property}.${key}`] = value
        }
      }
    }

    return formatted
  }
}
