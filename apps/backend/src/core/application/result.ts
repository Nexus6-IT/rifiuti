/**
 * Result Pattern - For Use Cases
 * Functional approach to error handling
 */

export class Result<T> {
  public readonly isSuccess: boolean
  public readonly isFailure: boolean
  private readonly _value?: T
  private readonly _error?: string
  private readonly _code?: string

  private constructor(isSuccess: boolean, value?: T, error?: string, code?: string) {
    this.isSuccess = isSuccess
    this.isFailure = !isSuccess
    this._value = value
    this._error = error
    this._code = code

    Object.freeze(this)
  }

  get value(): T {
    if (!this.isSuccess) {
      throw new Error('Cannot get value from failed result')
    }
    return this._value as T
  }

  get error(): string {
    if (this.isSuccess) {
      throw new Error('Cannot get error from successful result')
    }
    return this._error as string
  }

  /** Codice macchina dell'errore, se chi ha fallito ne ha indicato uno (mai da dedurre dal testo). */
  get code(): string | undefined {
    return this._code
  }

  static ok<U>(value?: U): Result<U> {
    return new Result<U>(true, value)
  }

  static fail<U>(error: string, code?: string): Result<U> {
    return new Result<U>(false, undefined, error, code)
  }

  static combine(results: Result<any>[]): Result<any> {
    for (const result of results) {
      if (result.isFailure) {
        return result
      }
    }
    return Result.ok()
  }
}
