import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { LoggerService } from '../../core/logger/logger.service';
import { firstValueFrom } from 'rxjs';

/**
 * Keycloak User Adapter
 *
 * Handles synchronization between WasteFlow and Keycloak user database.
 * Manages user attributes, roles, and group memberships in Keycloak.
 *
 * Use Cases:
 * - Create user in Keycloak when registered
 * - Update user attributes when changed
 * - Sync roles and permissions
 * - Manage tenant group memberships
 *
 * Keycloak Admin API:
 * - Uses Admin REST API with service account credentials
 * - Requires realm-management client role
 */
@Injectable()
export class KeycloakUserAdapter {
  private readonly keycloakUrl: string;
  private readonly realm: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private accessToken?: string;
  private tokenExpiry?: Date;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly logger: LoggerService,
  ) {
    this.keycloakUrl = this.configService.get<string>('KEYCLOAK_URL') || '';
    this.realm = this.configService.get<string>('KEYCLOAK_REALM') || '';
    this.clientId = this.configService.get<string>('KEYCLOAK_CLIENT_ID') || '';
    this.clientSecret = this.configService.get<string>('KEYCLOAK_CLIENT_SECRET') || '';

    this.logger.setContext('KeycloakUserAdapter');
  }

  /**
   * Get Keycloak admin access token
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.accessToken;
    }

    this.logger.debug('Getting Keycloak admin token');

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`,
          new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret,
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        )
      );

      const tokenData = response.data as { access_token: string; expires_in?: number };
      this.accessToken = tokenData.access_token;
      const expiresIn = tokenData.expires_in || 300; // Default 5 minutes
      this.tokenExpiry = new Date(Date.now() + (expiresIn - 30) * 1000); // Refresh 30s before expiry

      this.logger.debug('Keycloak admin token obtained');

      return this.accessToken;
    } catch (error: any) {
      this.logger.error('Failed to get Keycloak admin token', error);
      throw new Error('Keycloak authentication failed');
    }
  }

  /**
   * Create user in Keycloak.
   *
   * @param params.emailVerified   Se true (default) l'email è considerata già
   *   verificata (flusso admin-provisioning). Per il signup self-service passare
   *   `false` + `requiredActions: ['VERIFY_EMAIL']` affinché Keycloak invii
   *   la mail di verifica al primo login (o via sendVerifyEmail()).
   * @param params.requiredActions Azioni richieste al primo login (es.
   *   VERIFY_EMAIL, UPDATE_PASSWORD). Default: [].
   */
  async createUser(params: {
    fiscalCode: string;
    firstName: string;
    lastName: string;
    email: string;
    tenantId: string;
    emailVerified?: boolean;
    requiredActions?: string[];
  }): Promise<string> {
    this.logger.info('Creating user in Keycloak', {
      fiscalCode: params.fiscalCode,
      email: params.email,
    });

    try {
      const token = await this.getAccessToken();

      const keycloakUser = {
        username: params.fiscalCode,
        email: params.email,
        firstName: params.firstName,
        lastName: params.lastName,
        enabled: true,
        emailVerified: params.emailVerified ?? true,
        requiredActions: params.requiredActions ?? [],
        attributes: {
          fiscalCode: [params.fiscalCode],
          tenantId: [params.tenantId],
        },
      };

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.keycloakUrl}/admin/realms/${this.realm}/users`,
          keycloakUser,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        )
      );

      // Keycloak returns user ID in Location header
      const headers = response.headers as { location?: string };
      const location = headers.location;
      const userId = location?.split('/').pop();

      this.logger.info('User created in Keycloak', {
        fiscalCode: params.fiscalCode,
        keycloakUserId: userId,
      });

      return userId || '';
    } catch (error: any) {
      this.logger.error('Failed to create user in Keycloak', error, {
        fiscalCode: params.fiscalCode,
      });

      throw error;
    }
  }

  /**
   * Update user in Keycloak
   */
  async updateUser(
    keycloakUserId: string,
    params: {
      firstName?: string;
      lastName?: string;
      email?: string;
    }
  ): Promise<void> {
    this.logger.info('Updating user in Keycloak', { keycloakUserId });

    try {
      const token = await this.getAccessToken();

      const updateData: any = {};
      if (params.firstName) updateData.firstName = params.firstName;
      if (params.lastName) updateData.lastName = params.lastName;
      if (params.email) updateData.email = params.email;

      await firstValueFrom(
        this.httpService.put(
          `${this.keycloakUrl}/admin/realms/${this.realm}/users/${keycloakUserId}`,
          updateData,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        )
      );

      this.logger.info('User updated in Keycloak', { keycloakUserId });
    } catch (error: any) {
      this.logger.error('Failed to update user in Keycloak', error, {
        keycloakUserId,
      });

      throw error;
    }
  }

  /**
   * Assign role to user in Keycloak
   */
  async assignRole(keycloakUserId: string, role: string): Promise<void> {
    this.logger.info('Assigning role in Keycloak', {
      keycloakUserId,
      role,
    });

    try {
      const token = await this.getAccessToken();

      // First, get role representation
      const roleResponse = await firstValueFrom(
        this.httpService.get(
          `${this.keycloakUrl}/admin/realms/${this.realm}/roles/${role}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        )
      );

      const roleRepresentation = roleResponse.data as { id: string; name: string };

      // Assign role to user
      await firstValueFrom(
        this.httpService.post(
          `${this.keycloakUrl}/admin/realms/${this.realm}/users/${keycloakUserId}/role-mappings/realm`,
          [roleRepresentation],
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        )
      );

      this.logger.info('Role assigned in Keycloak', {
        keycloakUserId,
        role,
      });
    } catch (error: any) {
      this.logger.error('Failed to assign role in Keycloak', error, {
        keycloakUserId,
        role,
      });

      throw error;
    }
  }

  /**
   * Add user to tenant group in Keycloak
   */
  async addUserToTenantGroup(
    keycloakUserId: string,
    tenantId: string
  ): Promise<void> {
    this.logger.info('Adding user to tenant group in Keycloak', {
      keycloakUserId,
      tenantId,
    });

    try {
      const token = await this.getAccessToken();

      // Find or create tenant group
      const groupId = await this.getOrCreateTenantGroup(tenantId);

      // Add user to group
      await firstValueFrom(
        this.httpService.put(
          `${this.keycloakUrl}/admin/realms/${this.realm}/users/${keycloakUserId}/groups/${groupId}`,
          {},
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        )
      );

      this.logger.info('User added to tenant group in Keycloak', {
        keycloakUserId,
        tenantId,
        groupId,
      });
    } catch (error: any) {
      this.logger.error('Failed to add user to tenant group', error, {
        keycloakUserId,
        tenantId,
      });

      throw error;
    }
  }

  /**
   * Get or create tenant group in Keycloak
   */
  private async getOrCreateTenantGroup(tenantId: string): Promise<string> {
    const token = await this.getAccessToken();

    // Search for existing group
    const searchResponse = await firstValueFrom(
      this.httpService.get(
        `${this.keycloakUrl}/admin/realms/${this.realm}/groups`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            search: `tenant-${tenantId}`,
          },
        }
      )
    );

    const groups = searchResponse.data as Array<{ id: string; name: string }>;
    const existingGroup = groups.find(
      (g) => g.name === `tenant-${tenantId}`
    );

    if (existingGroup) {
      return existingGroup.id;
    }

    // Create new group
    const createResponse = await firstValueFrom(
      this.httpService.post(
        `${this.keycloakUrl}/admin/realms/${this.realm}/groups`,
        {
          name: `tenant-${tenantId}`,
          attributes: {
            tenantId: [tenantId],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      )
    );

    const createHeaders = createResponse.headers as { location?: string };
    const location = createHeaders.location;
    const groupId = location?.split('/').pop();

    return groupId || '';
  }

  /**
   * Set (reset) a user's password in Keycloak.
   *
   * Calls `PUT /admin/realms/{realm}/users/{id}/reset-password`. When
   * `temporary` is true (default) Keycloak forces the user to change the
   * password on first login (UPDATE_PASSWORD required action).
   */
  async setPassword(
    keycloakUserId: string,
    password: string,
    temporary = true,
  ): Promise<void> {
    this.logger.info('Setting user password in Keycloak', {
      keycloakUserId,
      temporary,
    });

    try {
      const token = await this.getAccessToken();

      await firstValueFrom(
        this.httpService.put(
          `${this.keycloakUrl}/admin/realms/${this.realm}/users/${keycloakUserId}/reset-password`,
          {
            type: 'password',
            value: password,
            temporary,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        )
      );

      this.logger.info('User password set in Keycloak', { keycloakUserId });
    } catch (error: any) {
      this.logger.error('Failed to set user password in Keycloak', error, {
        keycloakUserId,
      });

      throw error;
    }
  }

  /**
   * Invia (o ri-invia) la mail di verifica email a un utente Keycloak.
   *
   * Chiama `PUT /admin/realms/{realm}/users/{id}/send-verify-email`.
   * Se Keycloak non è configurato con un provider SMTP il server risponde
   * con errore 500; in questo caso il chiamante deve gestire l'eccezione
   * come best-effort (non bloccare la risposta al client).
   *
   * ATTIVARE: configurare il provider SMTP nel realm Keycloak (`ignicraft`).
   */
  async sendVerifyEmail(keycloakUserId: string): Promise<void> {
    this.logger.info('Sending verify-email to user in Keycloak', { keycloakUserId });
    try {
      const token = await this.getAccessToken();
      await firstValueFrom(
        this.httpService.put(
          `${this.keycloakUrl}/admin/realms/${this.realm}/users/${keycloakUserId}/send-verify-email`,
          {},
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );
      this.logger.info('Verify-email sent via Keycloak', { keycloakUserId });
    } catch (error: any) {
      this.logger.error('Failed to send verify-email from Keycloak (best-effort)', error, {
        keycloakUserId,
      });
      throw error;
    }
  }

  /**
   * Delete user in Keycloak (rollback su provisioning fallito).
   */
  async deleteUser(keycloakUserId: string): Promise<void> {
    this.logger.info('Deleting user in Keycloak', { keycloakUserId });
    try {
      const token = await this.getAccessToken();
      await firstValueFrom(
        this.httpService.delete(
          `${this.keycloakUrl}/admin/realms/${this.realm}/users/${keycloakUserId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );
      this.logger.info('User deleted in Keycloak', { keycloakUserId });
    } catch (error: any) {
      this.logger.error('Failed to delete user in Keycloak', error, {
        keycloakUserId,
      });
      throw error;
    }
  }

  /**
   * Disable user in Keycloak
   */
  async disableUser(keycloakUserId: string): Promise<void> {
    this.logger.info('Disabling user in Keycloak', { keycloakUserId });

    try {
      const token = await this.getAccessToken();

      await firstValueFrom(
        this.httpService.put(
          `${this.keycloakUrl}/admin/realms/${this.realm}/users/${keycloakUserId}`,
          { enabled: false },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        )
      );

      this.logger.info('User disabled in Keycloak', { keycloakUserId });
    } catch (error: any) {
      this.logger.error('Failed to disable user in Keycloak', error, {
        keycloakUserId,
      });

      throw error;
    }
  }
}
