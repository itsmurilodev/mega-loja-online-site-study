import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Response } from "express";

/**
 * Filtro global de exceções do NestJS para padronizar o contrato JSON `{ "error": "..." }`
 * esperado pelo frontend (`front.html`).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Erro interno no servidor.";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resBody = exception.getResponse();

      if (typeof resBody === "string") {
        message = resBody;
      } else if (resBody && typeof resBody === "object") {
        const record = resBody as Record<string, unknown>;
        if (Array.isArray(record.message)) {
          message = record.message.join("; ");
        } else if (typeof record.message === "string") {
          message = record.message;
        } else if (typeof record.error === "string") {
          message = record.error;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json({
      error: message,
    });
  }
}
