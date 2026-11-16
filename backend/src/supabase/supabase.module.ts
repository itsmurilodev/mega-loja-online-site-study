import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { SchemaService } from "./schema.service";
import { SupabaseService } from "./supabase.service";

@Global()
@Module({
  providers: [SupabaseService, SchemaService, AuditService],
  exports: [SupabaseService, SchemaService, AuditService],
})
export class SupabaseModule {}
