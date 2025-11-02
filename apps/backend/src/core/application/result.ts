/**
 * Result Pattern - For Use Cases
 * Functional approach to error handling
 */

export class Result<T> {
  public readonly isSuccess: boolean
  public readonly isFailure: boolean
  private readonly _value?: T
  private readonly _error?: string

  private constructor(isSuccess: boolean, value?: T, error?: string) {
    this.isSuccess = isSuccess
    this.isFailure = !isSuccess
    this._value = value
    this._error = error

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

  static ok<U>(value?: U): Result<U> {
    return new Result<U>(true, value)
  }

  static fail<U>(error: string): Result<U> {
    return new Result<U>(false, undefined, error)
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
