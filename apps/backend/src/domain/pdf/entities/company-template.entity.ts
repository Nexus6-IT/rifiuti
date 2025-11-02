import { AggregateRoot } from '../../../core/domain/aggregate-root';

/**
 * CompanyTemplate Entity
 *
 * Stores custom PDF letterhead templates for each tenant:
 * - Company logo (base64 or S3 URL)
 * - Header/footer text
 * - Brand colors
 * - Custom styling preferences
 *
 * Enables professional, branded PDF exports per User Story 6.
 */
export class CompanyTemplate extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private _tenantId: string,
    private _name: string,
    private _logoUrl: string | null,
    private _logoBase64: string | null,
    private _headerText: string | null,
    private _footerText: string | null,
    private _primaryColor: string,
    private _secondaryColor: string,
    private _fontFamily: string,
    private _isDefault: boolean,
    private _createdAt: Date,
    private _updatedAt: Date,
  ) {
    super();
  }

  /**
   * Create new company template
   */
  static create(params: {
    id: string;
    tenantId: string;
    name: string;
    logoUrl?: string | null;
    logoBase64?: string | null;
    headerText?: string | null;
    footerText?: string | null;
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
    isDefault?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
  }): CompanyTemplate {
    // Validation
    if (!params.id) {
      throw new Error('Template ID is required');
    }
    if (!params.tenantId) {
      throw new Error('Tenant ID is required');
    }
    if (!params.name || params.name.trim().length === 0) {
      throw new Error('Template name is required');
    }
    if (params.name.length > 100) {
      throw new Error('Template name must not exceed 100 characters');
    }

    // Color validation (hex format)
    const hexColorRegex = /^#[0-9A-F]{6}$/i;
    const primaryColor = params.primaryColor || '#3b82f6';
    const secondaryColor = params.secondaryColor || '#1e40af';

    if (!hexColorRegex.test(primaryColor)) {
      throw new Error('Primary color must be a valid hex color (e.g., #3b82f6)');
    }
    if (!hexColorRegex.test(secondaryColor)) {
      throw new Error('Secondary color must be a valid hex color (e.g., #1e40af)');
    }

    // Logo validation - must have at least one
    if (!params.logoUrl && !params.logoBase64) {
      // Logo is optional - can use default branding
    } else {
      // If base64 provided, validate format
      if (params.logoBase64 && !params.logoBase64.startsWith('data:image/')) {
        throw new Error('Logo base64 must start with "data:image/"');
      }
    }

    const now = new Date();

    return new CompanyTemplate(
      params.id,
      params.tenantId,
      params.name.trim(),
      params.logoUrl || null,
      params.logoBase64 || null,
      params.headerText || null,
      params.footerText || null,
      primaryColor,
      secondaryColor,
      params.fontFamily || 'Roboto',
      params.isDefault ?? false,
      params.createdAt || now,
      params.updatedAt || now,
    );
  }

  /**
   * Update template properties
   */
  update(params: {
    name?: string;
    logoUrl?: string | null;
    logoBase64?: string | null;
    headerText?: string | null;
    footerText?: string | null;
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
  }): void {
    if (params.name !== undefined) {
      if (!params.name || params.name.trim().length === 0) {
        throw new Error('Template name cannot be empty');
      }
      if (params.name.length > 100) {
        throw new Error('Template name must not exceed 100 characters');
      }
      this._name = params.name.trim();
    }

    if (params.logoUrl !== undefined) {
      this._logoUrl = params.logoUrl;
    }

    if (params.logoBase64 !== undefined) {
      if (params.logoBase64 && !params.logoBase64.startsWith('data:image/')) {
        throw new Error('Logo base64 must start with "data:image/"');
      }
      this._logoBase64 = params.logoBase64;
    }

    if (params.headerText !== undefined) {
      this._headerText = params.headerText;
    }

    if (params.footerText !== undefined) {
      this._footerText = params.footerText;
    }

    if (params.primaryColor !== undefined) {
      const hexColorRegex = /^#[0-9A-F]{6}$/i;
      if (!hexColorRegex.test(params.primaryColor)) {
        throw new Error('Primary color must be a valid hex color (e.g., #3b82f6)');
      }
      this._primaryColor = params.primaryColor;
    }

    if (params.secondaryColor !== undefined) {
      const hexColorRegex = /^#[0-9A-F]{6}$/i;
      if (!hexColorRegex.test(params.secondaryColor)) {
        throw new Error('Secondary color must be a valid hex color (e.g., #1e40af)');
      }
      this._secondaryColor = params.secondaryColor;
    }

    if (params.fontFamily !== undefined) {
      this._fontFamily = params.fontFamily || 'Roboto';
    }

    this._updatedAt = new Date();
  }

  /**
   * Set as default template for tenant
   */
  setAsDefault(): void {
    this._isDefault = true;
    this._updatedAt = new Date();
  }

  /**
   * Unset as default template
   */
  unsetAsDefault(): void {
    this._isDefault = false;
    this._updatedAt = new Date();
  }

  // Getters
  get id(): string {
    return this._id;
  }

  getTenantId(): string {
    return this._tenantId;
  }

  getName(): string {
    return this._name;
  }

  getLogoUrl(): string | null {
    return this._logoUrl;
  }

  getLogoBase64(): string | null {
    return this._logoBase64;
  }

  getHeaderText(): string | null {
    return this._headerText;
  }

  getFooterText(): string | null {
    return this._footerText;
  }

  getPrimaryColor(): string {
    return this._primaryColor;
  }

  getSecondaryColor(): string {
    return this._secondaryColor;
  }

  getFontFamily(): string {
    return this._fontFamily;
  }

  isDefaultTemplate(): boolean {
    return this._isDefault;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * Convert to plain object for persistence
   */
  toPlainObject(): any {
    return {
      id: this._id,
      tenantId: this._tenantId,
      name: this._name,
      logoUrl: this._logoUrl,
      logoBase64: this._logoBase64,
      headerText: this._headerText,
      footerText: this._footerText,
      primaryColor: this._primaryColor,
      secondaryColor: this._secondaryColor,
      fontFamily: this._fontFamily,
      isDefault: this._isDefault,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    };
  }
}
