import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "../common/constants";

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private supabaseInstance: SupabaseClient | null = null;

  get client(): SupabaseClient {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      this.logger.error(
        "SUPABASE_URL ou SUPABASE_KEY não configurados no arquivo .env."
      );
      throw new InternalServerErrorException(
        "Credenciais do Supabase ausentes. Configure SUPABASE_URL e SUPABASE_ANON_KEY (ou SUPABASE_SERVICE_ROLE_KEY) no arquivo .env."
      );
    }

    if (!this.supabaseInstance) {
      this.supabaseInstance = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    }

    return this.supabaseInstance;
  }
}
