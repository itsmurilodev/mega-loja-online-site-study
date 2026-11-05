import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  getApiIndex() {
    return {
      name: "MegaLoja Click & Collect API - Trabalho G2 Unilasalle",
      status: "online",
      framework: "NestJS + TypeScript + Supabase",
      casos_de_uso: {
        UC003_finalizar_compra: "POST /api/orders",
        UC005_separar_pedido: "POST /api/orders/{id}/separate",
        UC008_registrar_ruptura: "POST /api/orders/{id}/rupture",
        UC007_validar_retirada: "POST /api/orders/validate-pickup",
        regra_abandono_expirar: "POST /api/orders/{id}/expire",
        consultas: {
          lojas: "GET /api/stores",
          produtos: "GET /api/products",
          pedidos: "GET /api/orders",
          notificacoes: "GET /api/orders/{id}/notifications",
        },
      },
    };
  }

  getHealth() {
    return {
      status: "online",
      database: "supabase-postgresql",
      sprint: "Trabalho G2 Unilasalle",
    };
  }
}
