import { Module } from "@nestjs/common";
import { OperadoraCartaoService } from "./operadora-cartao.service";

@Module({
  providers: [OperadoraCartaoService],
  exports: [OperadoraCartaoService],
})
export class PaymentsModule {}
