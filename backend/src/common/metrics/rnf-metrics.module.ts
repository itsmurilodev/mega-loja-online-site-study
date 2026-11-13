import { Global, Module } from "@nestjs/common";
import { RnfMetricsService } from "./rnf-metrics.service";

@Global()
@Module({
  providers: [RnfMetricsService],
  exports: [RnfMetricsService],
})
export class RnfMetricsModule {}
