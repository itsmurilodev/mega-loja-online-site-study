import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { ProductsModule } from "../products/products.module";
import { StoresModule } from "../stores/stores.module";
import { AuditController } from "./audit.controller";
import { OrderAccessService } from "./order-access.service";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { ThirdPartyCodeService } from "./third-party-code.service";

@Module({
  imports: [StoresModule, ProductsModule, PaymentsModule],
  controllers: [OrdersController, AuditController],
  providers: [OrdersService, ThirdPartyCodeService, OrderAccessService],
  exports: [OrdersService],
})
export class OrdersModule {}
