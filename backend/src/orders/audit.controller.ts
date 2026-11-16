import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { AuditEntry, AuditService } from "../supabase/audit.service";

@Controller("api/audit")
@UseGuards(RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // S3-17: consulta geral do log (gerente e empresa); por pedido: GET /api/orders/:id/audit.
  @Get()
  @Roles("gerente", "empresa")
  async list(
    @Query("order_id") orderId?: string,
    @Query("limit") limit?: string
  ): Promise<{ audit: AuditEntry[] }> {
    if (orderId !== undefined && !/^\d+$/.test(orderId)) {
      throw new BadRequestException("order_id invalido.");
    }
    return {
      audit: await this.auditService.list({
        orderId: orderId ? Number(orderId) : null,
        limit: limit ? Number(limit) : undefined,
      }),
    };
  }
}
