import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { RnfMetricsInterceptor } from "./common/interceptors/rnf-metrics.interceptor";
import { RnfMetricsModule } from "./common/metrics/rnf-metrics.module";
import { OrdersModule } from "./orders/orders.module";
import { PaymentsModule } from "./payments/payments.module";
import { ProductsModule } from "./products/products.module";
import { StoresModule } from "./stores/stores.module";
import { SupabaseModule } from "./supabase/supabase.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RnfMetricsModule,
    SupabaseModule,
    StoresModule,
    ProductsModule,
    PaymentsModule,
    OrdersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RnfMetricsInterceptor,
    },
  ],
})
export class AppModule {}
