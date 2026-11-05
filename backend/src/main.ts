import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { HOST, PORT } from "./common/constants";

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: "*",
    methods: "GET,POST,PATCH,OPTIONS",
    allowedHeaders: "Content-Type, Authorization",
  });

  await app.listen(PORT, HOST);
  console.log(
    `MegaLoja API (NestJS + Supabase) rodando em http://${HOST}:${PORT}`
  );
  console.log("Pressione Ctrl+C para encerrar.");
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error("Falha ao iniciar a aplicação NestJS:", err);
    process.exit(1);
  });
}
