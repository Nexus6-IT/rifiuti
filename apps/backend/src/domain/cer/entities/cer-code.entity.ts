/**
 * CERCode Entity - Codice Europeo Rifiuti
 * Catalogo completo 842 codici CER/EER aggiornato 2025
 */

export class CERCode {
  constructor(
    private readonly _id: string,
    private readonly _code: string,
    private readonly _description: string,
    private readonly _isPericoloso: boolean,
    private readonly _category: string,
    private readonly _subcategory: string | null,
    private readonly _createdAt: Date,
    private readonly _updatedAt: Date
  ) {}

  static create(props: {
    code: string
    description: string
    isPericoloso: boolean
    category: string
    subcategory?: string
  }): CERCode {
    // Validate code format: "XX XX XX" or "XX XX XX*"
    if (!this.isValidCodeFormat(props.code)) {
      throw new Error(`Invalid CER code format: ${props.code}`)
    }

    const now = new Date()
    return new CERCode(
      this.generateId(),
      props.code,
      props.description,
      props.isPericoloso,
      props.category,
      props.subcategory || null,
      now,
      now
    )
  }

  static reconstitute(props: {
    id: string
    code: string
    description: string
    isPericoloso: boolean
    category: string
    subcategory?: string
    createdAt: Date
    updatedAt: Date
  }): CERCode {
    return new CERCode(
      props.id,
      props.code,
      props.description,
      props.isPericoloso,
      props.category,
      props.subcategory || null,
      props.createdAt,
      props.updatedAt
    )
  }

  private static isValidCodeFormat(code: string): boolean {
    // Format: "XX XX XX" or "XX XX XX*" (with asterisk for dangerous waste)
    return /^\d{2}\s\d{2}\s\d{2}\*?$/.test(code)
  }

  // Getters
  get id(): string {
    return this._id
  }

  get code(): string {
    return this._code
  }

  get description(): string {
    return this._description
  }

  get isPericoloso(): boolean {
    return this._isPericoloso
  }

  get category(): string {
    return this._category
  }

  get subcategory(): string | null {
    return this._subcategory
  }

  get createdAt(): Date {
    return this._createdAt
  }

  get updatedAt(): Date {
    return this._updatedAt
  }

  // Helper methods
  get categoryNumber(): number {
    return parseInt(this.code.substring(0, 2))
  }

  equals(other: CERCode): boolean {
    return this._code === other._code
  }

  private static generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
}
