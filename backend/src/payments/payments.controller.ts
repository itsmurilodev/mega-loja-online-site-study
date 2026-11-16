import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { PixCharge, PixService } from "./pix.service";

@Controller("api/payments")
export class PaymentsController {
  constructor(private readonly pixService: PixService) {}

  // S3-23: gera uma cobrança Pix simulada (QR e copia e cola com validade curta).
  @Post("pix")
  @HttpCode(HttpStatus.CREATED)
  createPix(
    @Body() payload: { amount?: number; ttl_seconds?: number }
  ): { pix: PixCharge } {
    return { pix: this.pixService.create(payload?.amount, payload?.ttl_seconds) };
  }
}
