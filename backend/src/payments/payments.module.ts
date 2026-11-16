import { Module } from "@nestjs/common";
import { OperadoraCartaoService } from "./operadora-cartao.service";
import { PaymentsController } from "./payments.controller";
import { PixService } from "./pix.service";

@Module({
  controllers: [PaymentsController],
  providers: [OperadoraCartaoService, PixService],
  exports: [OperadoraCartaoService, PixService],
})
export class PaymentsModule {}
