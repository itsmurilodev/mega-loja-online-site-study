import { Injectable, InternalServerErrorException } from "@nestjs/common";
import crypto from "node:crypto";
import { SECRET_TOKEN_KEY } from "../common/constants";

/**
 * Chave de acesso de um pedido (privacidade).
 * Quem finaliza a compra, com ou sem conta, recebe uma chave assinada (HMAC com
 * SECRET_TOKEN_KEY) que só vale para aquele pedido. Sem ela, nem o número do
 * pedido, nem o CPF, nem o QR Code podem ser lidos por ninguém que não seja
 * colaborador ou o próprio cliente logado.
 */
@Injectable()
export class OrderAccessService {
  tokenFor(orderId: number): string {
    if (!SECRET_TOKEN_KEY) {
      throw new InternalServerErrorException(
        "SECRET_TOKEN_KEY ausente nas variáveis de ambiente (RNF002/RNF003: segredos fora do código)."
      );
    }
    return crypto
      .createHmac("sha256", Buffer.from(SECRET_TOKEN_KEY, "utf-8"))
      .update(`order-access|${orderId}`)
      .digest("base64url")
      .slice(0, 32);
  }

  isValid(orderId: number, token: unknown): boolean {
    const informado = String(token ?? "");
    if (!informado) return false;
    const esperado = this.tokenFor(orderId);
    const a = Buffer.from(informado);
    const b = Buffer.from(esperado);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}
