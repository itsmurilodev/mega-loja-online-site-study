import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import crypto from "node:crypto";
import { SECRET_TOKEN_KEY } from "../common/constants";

export const PIX_TTL_PADRAO_S = 300; // 5 minutos
export const PIX_TTL_MAX_S = 900;

export interface PixCharge {
  txid: string;
  amount: number;
  expires_at: string;
  expires_in_seconds: number;
  /** Texto do "Pix copia e cola" (simulado). */
  copia_e_cola: string;
  /** Token assinado: é ele que o checkout recebe para provar o pagamento. */
  token: string;
  simulated: true;
}

/**
 * S3-23 - Pix simulado.
 * Não há PSP real: a cobrança é um token assinado (HMAC com SECRET_TOKEN_KEY)
 * contendo txid, valor e validade. Apresentar o token ainda válido no checkout
 * equivale ao "cliente pagou"; token expirado é recusado (402).
 * O token não guarda estado no servidor, então a validade é conferida pela
 * própria assinatura.
 */
@Injectable()
export class PixService {
  private sign(body: string): string {
    if (!SECRET_TOKEN_KEY) {
      throw new InternalServerErrorException(
        "SECRET_TOKEN_KEY ausente nas variáveis de ambiente (RNF002/RNF003: segredos fora do código)."
      );
    }
    return crypto
      .createHmac("sha256", Buffer.from(SECRET_TOKEN_KEY, "utf-8"))
      .update(body)
      .digest("base64url");
  }

  create(amount: unknown, ttlSeconds?: unknown): PixCharge {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException("Informe um valor maior que zero para o Pix.");
    }
    const cents = Math.round(value * 100);

    let ttl = PIX_TTL_PADRAO_S;
    if (ttlSeconds !== undefined && ttlSeconds !== null && ttlSeconds !== "") {
      ttl = Number(ttlSeconds);
      if (!Number.isInteger(ttl) || ttl < 1 || ttl > PIX_TTL_MAX_S) {
        throw new BadRequestException(
          `ttl_seconds deve ser um inteiro entre 1 e ${PIX_TTL_MAX_S}.`
        );
      }
    }

    const txid = `PIX${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const expiresAtMs = Date.now() + ttl * 1000;
    const body = Buffer.from(
      JSON.stringify({ t: txid, a: cents, e: Math.floor(expiresAtMs / 1000) })
    ).toString("base64url");
    const token = `${body}.${this.sign(body)}`;

    return {
      txid,
      amount: cents / 100,
      expires_at: new Date(expiresAtMs).toISOString(),
      expires_in_seconds: ttl,
      copia_e_cola:
        `00020126SIMULADO-MEGALOJA${txid}5204000053039865406${(cents / 100).toFixed(2)}` +
        `5802BR5909MEGALOJA6007CANOAS`,
      token,
      simulated: true,
    };
  }

  /** Confere assinatura, validade e valor. Devolve o txid se estiver tudo certo. */
  verify(token: unknown, expectedAmount: number): { txid: string } {
    const raw = String(token ?? "");
    const [body, signature] = raw.split(".");
    if (!body || !signature) {
      throw new BadRequestException("Pix inválido: cobrança não reconhecida.");
    }

    const esperado = this.sign(body);
    const a = Buffer.from(signature);
    const b = Buffer.from(esperado);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new BadRequestException("Pix inválido: assinatura não confere.");
    }

    let data: { t: string; a: number; e: number };
    try {
      data = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
    } catch {
      throw new BadRequestException("Pix inválido: cobrança ilegível.");
    }

    if (Math.floor(Date.now() / 1000) > data.e) {
      throw new HttpException(
        "Pix expirado. Gere um novo QR Code e pague novamente.",
        HttpStatus.PAYMENT_REQUIRED
      );
    }
    if (data.a !== Math.round(expectedAmount * 100)) {
      throw new BadRequestException(
        "O valor do Pix não confere com o valor a pagar nesse meio."
      );
    }
    return { txid: data.t };
  }
}
