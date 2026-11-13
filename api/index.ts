import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { AppModule } from "../backend/src/app.module";

let cachedApp: INestApplication | null = null;

async function getNestApp(): Promise<INestApplication> {
  if (!cachedApp) {
    const app = await NestFactory.create(AppModule);
    app.enableCors({
      origin: "*",
      methods: "GET,POST,PATCH,OPTIONS",
      allowedHeaders: "Content-Type, Authorization",
    });
    await app.init();
    cachedApp = app;
  }
  return cachedApp;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const parsed = new URL(req.url || "/", "http://127.0.0.1");
  const rewrittenPath = parsed.searchParams.get("path");

  if (rewrittenPath !== null) {
    parsed.searchParams.delete("path");
    const cleanPath = `/api/${rewrittenPath}`.replace(/\/+$/, "") || "/api";
    const remainingQuery = parsed.searchParams.toString();
    req.url = remainingQuery ? `${cleanPath}?${remainingQuery}` : cleanPath;
  } else if (parsed.pathname === "/api/index") {
    const remainingQuery = parsed.searchParams.toString();
    req.url = remainingQuery ? `/api?${remainingQuery}` : "/api";
  }

  const app = await getNestApp();
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance(req, res);
}
