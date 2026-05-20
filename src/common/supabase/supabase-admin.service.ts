import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type SupabaseAdminClient = SupabaseClient;

/**
 * Single Supabase service-role client for server-side auth admin APIs.
 * Avoids duplicating URL/key wiring across AuthService, UsersService, and
 * admin onboarding flows.
 */
@Injectable()
export class SupabaseAdminService {
  private readonly client: SupabaseAdminClient;

  constructor(config: ConfigService) {
    const url = config.get<string>('supabase.url');
    const serviceRoleKey = config.get<string>('supabase.serviceRoleKey');
    if (!url || !serviceRoleKey) {
      throw new Error(
        'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    this.client = createClient(url, serviceRoleKey);
  }

  getClient(): SupabaseAdminClient {
    return this.client;
  }
}
