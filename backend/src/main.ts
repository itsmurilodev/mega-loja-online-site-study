import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import fs from "node:fs";
import { AppModule } from "./app.module";
import {
  HOST,
  HTTPS_CERT_PATH,
  HTTPS_KEY_PATH,
  PORT,
} from "./common/constants";

export async function bootstrap(): Promise<void> {
  const hasLocalTls =
    Boolean(HTTPS_KEY_PATH && HTTPS_CERT_PATH) &&
    fs.existsSync(HTTPS_KEY_PATH) &&
    fs.existsSync(HTTPS_CERT_PATH);

  const httpsOptions = hasLocalTls
    ? {
        key: fs.readFileSync(HTTPS_KEY_PATH),
        cert: fs.readFileSync(HTTPS_CERT_PATH),
      }
    : undefined;

  const app = await NestFactory.create(
    AppModule,
    httpsOptions ? { httpsOptions } : undefined
  );

  app.enableCors({
    origin: "*",
    methods: "GET,POST,PATCH,OPTIONS",
    allowedHeaders: "Content-Type, Authorization",
    exposedHeaders:
      "X-Response-Time-Ms, X-RNF001-SLA-Limit-Ms, X-RNF001-Compliant, X-Transport-Security-Protocol",
  });

  await app.listen(PORT, HOST);
  const protocol = hasLocalTls ? "https" : "http";
  console.log(
    `MegaLoja API (NestJS + Supabase) rodando em ${protocol}://${HOST}:${PORT}`
  );
  console.log("Pressione Ctrl+C para encerrar.");
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error("Falha ao iniciar a aplicação NestJS:", err);
    process.exit(1);
  });
}
