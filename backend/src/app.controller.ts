import { Controller, Get } from "@nestjs/common";
import { AppService } from "./app.service";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getRootIndex() {
    return this.appService.getApiIndex();
  }

  @Get("api")
  getApiIndex() {
    return this.appService.getApiIndex();
  }

  @Get("api/health")
  getHealth() {
    return this.appService.getHealth();
  }
}
