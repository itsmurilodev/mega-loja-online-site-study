import { Controller, Get, Res } from "@nestjs/common";
import { Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { AppService } from "./app.service";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  private serveFrontHtml(res: Response): void {
    const candidates = [
      path.resolve(process.cwd(), "frontend", "front.html"),
      path.resolve(__dirname, "..", "..", "frontend", "front.html"),
      path.resolve(process.cwd(), "front.html"),
      path.resolve(__dirname, "..", "..", "front.html"),
    ];

    for (const htmlPath of candidates) {
      if (fs.existsSync(htmlPath)) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(fs.readFileSync(htmlPath, "utf-8"));
        return;
      }
    }

    res.json(this.appService.getApiIndex());
  }

  @Get()
  getRoot(@Res() res: Response): void {
    this.serveFrontHtml(res);
  }

  @Get("front.html")
  getFrontHtml(@Res() res: Response): void {
    this.serveFrontHtml(res);
  }

  @Get("index.html")
  getIndexHtml(@Res() res: Response): void {
    this.serveFrontHtml(res);
  }

  @Get("cliente")
  getCliente(@Res() res: Response): void {
    this.serveFrontHtml(res);
  }

  @Get("operador")
  getOperador(@Res() res: Response): void {
    this.serveFrontHtml(res);
  }

  @Get("balcao")
  getBalcao(@Res() res: Response): void {
    this.serveFrontHtml(res);
  }

  @Get("admin")
  getAdmin(@Res() res: Response): void {
    this.serveFrontHtml(res);
  }

  @Get("api")
  getApiIndex() {
    return this.appService.getApiIndex();
  }

  @Get("api/health")
  getHealth() {
    return this.appService.getHealth();
  }

  @Get("api/metrics/rnf001")
  getRnf001Metrics() {
    return this.appService.getRnf001Metrics();
  }
}
