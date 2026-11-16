/**
 * S2-07 - Testes de contrato da API Click & Collect.
 *
 * Falam com a API somente por HTTP, entao rodam contra qualquer implementacao
 * (local, Preview ou producao). Variaveis:
 *
 *   API_URL                endereco da API (padrao http://127.0.0.1:5000)
 *   API_TOKEN              token de login de um operador ou da empresa (S3-14).
 *                          Sem ele, os testes que usam endpoints do operador sao
 *                          pulados e so a protecao (401) e conferida.
 *   CONTRACT_WRITE=1       libera os fluxos que criam pedidos no banco (exige API_TOKEN)
 *   CONTRACT_DESTRUCTIVE=1 libera o teste de ruptura, que ZERA o estoque do
 *                          produto na filial usada (so em banco descartavel)
 */
import { beforeAll, describe, expect, it } from "vitest";

const API_URL = (process.env.API_URL ?? "http://127.0.0.1:5000").replace(/\/+$/, "");
const API_TOKEN = process.env.API_TOKEN ?? "";
const temToken = API_TOKEN.length > 0;
const podeEscrever = process.env.CONTRACT_WRITE === "1" && temToken;
const podeDestruir = process.env.CONTRACT_DESTRUCTIVE === "1";

const ID_INEXISTENTE = 99999999;
const CPF_TITULAR = "111.222.333-44";
const FORMATO_VOUCHER = /^HV-\d{4,}-[0-9A-F]{4}-[0-9A-F]{4}$/;
const ESTOQUE_MINIMO_PARA_ESCRITA = 2;

interface Resposta {
  status: number;
  body: any;
}

async function chamar(
  metodo: string,
  caminho: string,
  corpo?: unknown,
  token: string | null = API_TOKEN || null
): Promise<Resposta> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resposta = await fetch(`${API_URL}${caminho}`, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  try {
    return { status: resposta.status, body: JSON.parse(texto) };
  } catch {
    throw new Error(
      `${metodo} ${caminho} respondeu ${resposta.status} sem JSON: ${texto.slice(0, 120)}`
    );
  }
}

const get = (caminho: string) => chamar("GET", caminho);
const post = (caminho: string, corpo: unknown = {}) => chamar("POST", caminho, corpo);

function esperarErro(resposta: Resposta, statusEsperado: number): void {
  expect(resposta.status).toBe(statusEsperado);
  expect(typeof resposta.body.error).toBe("string");
  expect(resposta.body.error.length).toBeGreaterThan(0);
}

async function consultarEstoque(lojaId: number, produtoId: number): Promise<number> {
  const { body } = await get(`/api/stores?product_id=${produtoId}`);
  return body.stores.find((loja: any) => loja.id === lojaId).stock;
}

/** Produto e filial com mais estoque, para os testes nao esbarrarem em falta de item. */
async function escolherProdutoComEstoque() {
  const { body } = await get("/api/products");
  let melhor = { produto: body.products[0], lojaId: 0, estoque: -1 };
  for (const produto of body.products) {
    const lojas = (await get(`/api/stores?product_id=${produto.id}`)).body.stores;
    for (const loja of lojas) {
      if (loja.stock > melhor.estoque) {
        melhor = { produto, lojaId: loja.id, estoque: loja.stock };
      }
    }
  }
  return melhor;
}

let alvo: Awaited<ReturnType<typeof escolherProdutoComEstoque>>;

beforeAll(async () => {
  alvo = await escolherProdutoComEstoque();
});

function pedidoValido(extra: Record<string, unknown> = {}) {
  return {
    customer_name: "Teste de Contrato S2-07",
    customer_cpf: CPF_TITULAR,
    delivery_method: "retirar_na_loja",
    store_id: alvo.lojaId,
    product_id: alvo.produto.id,
    quantity: 1,
    card_number: "4111 1111 1111 1234",
    ...extra,
  };
}

describe("Consultas (somente leitura)", () => {
  it("GET /api/health informa que a API esta online", async () => {
    const { status, body } = await get("/api/health");
    expect(status).toBe(200);
    expect(body.status).toBe("online");
  });

  it("GET /api lista os casos de uso", async () => {
    const { status, body } = await get("/api");
    expect(status).toBe(200);
    expect(body.casos_de_uso.UC003_finalizar_compra).toBe("POST /api/orders");
  });

  it("GET /api/products devolve o catalogo com os campos usados pelo front", async () => {
    const { status, body } = await get("/api/products");
    expect(status).toBe(200);
    expect(body.products.length).toBeGreaterThan(0);
    for (const produto of body.products) {
      expect(produto).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        category: expect.any(String),
        price: expect.any(Number),
        sku: expect.any(String),
        barcode: expect.any(String),
      });
    }
  });

  it("GET /api/stores devolve as filiais ativas", async () => {
    const { status, body } = await get("/api/stores");
    expect(status).toBe(200);
    expect(body.stores.length).toBeGreaterThan(0);
    for (const loja of body.stores) {
      expect(loja).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        city: expect.any(String),
        active: 1,
      });
    }
  });

  it("GET /api/stores?product_id inclui o estoque por filial (UC002)", async () => {
    const { status, body } = await get(`/api/stores?product_id=${alvo.produto.id}`);
    expect(status).toBe(200);
    for (const loja of body.stores) {
      expect(loja.stock).toEqual(expect.any(Number));
      expect(loja.stock).toBeGreaterThanOrEqual(0);
    }
  });

  it.skipIf(!temToken)("GET /api/orders lista os pedidos de uma filial (fila do balcao)", async () => {
    const { status, body } = await get(`/api/orders?store_id=${alvo.lojaId}`);
    expect(status).toBe(200);
    expect(Array.isArray(body.orders)).toBe(true);
    for (const pedido of body.orders) {
      expect(pedido.store_id).toBe(alvo.lojaId);
    }
  });

  it("GET /api/orders/{id} inexistente responde 404", async () => {
    esperarErro(await get(`/api/orders/${ID_INEXISTENTE}`), 404);
  });

  it("GET /api/orders/{id} com id nao numerico responde 400", async () => {
    esperarErro(await get("/api/orders/abc"), 400);
  });

  it("GET /api/orders/{id}/notifications de pedido inexistente responde 404", async () => {
    esperarErro(await get(`/api/orders/${ID_INEXISTENTE}/notifications`), 404);
  });

  it("rota desconhecida responde 404 com { error }", async () => {
    esperarErro(await get("/api/rota-que-nao-existe"), 404);
  });
});

describe("UC003 Finalizar Compra: recusas (nao gravam pedido)", () => {
  it("sem product_id responde 400", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ product_id: undefined })), 400);
  });

  it("delivery_method invalido responde 400", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ delivery_method: "drone" })), 400);
  });

  it("retirada na loja sem filial responde 400", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ store_id: undefined })), 400);
  });

  it("quantidade zero responde 400", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ quantity: 0 })), 400);
  });

  it("produto inexistente responde 404", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ product_id: ID_INEXISTENTE })), 404);
  });

  it("filial inexistente responde 404", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ store_id: ID_INEXISTENTE })), 404);
  });

  it("estoque insuficiente responde 409", async () => {
    const acimaDoEstoque = alvo.estoque + 1000;
    esperarErro(await post("/api/orders", pedidoValido({ quantity: acimaDoEstoque })), 409);
  });

  it("pagamento recusado pela operadora responde 402 (fluxo 5.1.5.2)", async () => {
    const estoqueAntes = await consultarEstoque(alvo.lojaId, alvo.produto.id);
    esperarErro(
      await post("/api/orders", pedidoValido({ simulate_payment_failure: true })),
      402
    );
    expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(estoqueAntes);
  });

  it("cartao invalido responde 400", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ card_number: "123" })), 400);
  });
});

// S3-15: carrinho com varios itens. Todas as recusas acontecem antes de gravar qualquer pedido.
describe("Carrinho: POST /api/orders/checkout, recusas (nao gravam pedido)", () => {
  const carrinhoValido = (extra: Record<string, unknown> = {}) => ({
    customer_name: "Cliente Teste de Contrato",
    customer_cpf: CPF_TITULAR,
    delivery_method: "retirar_na_loja",
    store_id: alvo.lojaId,
    items: [{ product_id: alvo.produto.id, quantity: 1 }],
    card_number: "4111 1111 1111 1234",
    ...extra,
  });

  it("carrinho vazio responde 400", async () => {
    esperarErro(await post("/api/orders/checkout", carrinhoValido({ items: [] })), 400);
  });

  it("item com quantidade zero responde 400", async () => {
    esperarErro(
      await post("/api/orders/checkout", carrinhoValido({ items: [{ product_id: alvo.produto.id, quantity: 0 }] })),
      400
    );
  });

  it("retirada na loja sem filial responde 400", async () => {
    esperarErro(await post("/api/orders/checkout", carrinhoValido({ store_id: undefined })), 400);
  });

  it("produto inexistente responde 404", async () => {
    esperarErro(
      await post("/api/orders/checkout", carrinhoValido({ items: [{ product_id: ID_INEXISTENTE, quantity: 1 }] })),
      404
    );
  });

  it("um item sem estoque barra o carrinho inteiro (409) e a mensagem cita o produto", async () => {
    const resposta = await post(
      "/api/orders/checkout",
      carrinhoValido({
        items: [
          { product_id: alvo.produto.id, quantity: 1 },
          { product_id: alvo.produto.id, quantity: alvo.estoque + 1000 },
        ],
      })
    );
    esperarErro(resposta, 409);
    expect(resposta.body.error).toContain(alvo.produto.name);
  });

  it("pagamento recusado responde 402 sem reservar estoque", async () => {
    const antes = await consultarEstoque(alvo.lojaId, alvo.produto.id);
    esperarErro(await post("/api/orders/checkout", carrinhoValido({ simulate_payment_failure: true })), 402);
    expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(antes);
  });
});

// S3-14: o servidor, e nao o front, decide quem pode operar a loja.
describe("Protecao dos endpoints do operador e da empresa (S3-14)", () => {
  const SEM_TOKEN = null;
  const TOKEN_INVALIDO = "token.invalido.de-teste";

  const protegidos: [string, string, unknown][] = [
    ["GET", "/api/orders", undefined],
    ["GET", "/api/orders/mine", undefined],
    ["POST", "/api/orders/1/separate", { barcode_or_sku: "X" }],
    ["POST", "/api/orders/1/rupture", { reason: "teste" }],
    ["POST", "/api/orders/1/expire", {}],
    ["POST", "/api/orders/validate-pickup", { pickup_code: "HV-0000-ZZZZ-ZZZZ", document_checked: true }],
    ["POST", "/api/orders/pickup", { pickup_code: "HV-0000-ZZZZ-ZZZZ", document_checked: true }],
    ["PATCH", "/api/orders/1/status", { status: "pronto_retirada" }],
    ["POST", "/api/products", { name: "x", category: "x", price: 1, sku: "X-TESTE" }],
    ["PATCH", "/api/products/1", { price: 1 }],
  ];

  for (const [metodo, caminho, corpo] of protegidos) {
    it(`${metodo} ${caminho} sem login responde 401`, async () => {
      esperarErro(await chamar(metodo, caminho, corpo, SEM_TOKEN), 401);
    });

    it(`${metodo} ${caminho} com token invalido responde 401`, async () => {
      esperarErro(await chamar(metodo, caminho, corpo, TOKEN_INVALIDO), 401);
    });
  }

  it("login com senha errada responde 401 e nao entrega token", async () => {
    const { status, body } = await chamar(
      "POST",
      "/api/auth/login",
      { email: "ninguem@megaloja.invalid", password: "senha-errada", portal: "operador" },
      SEM_TOKEN
    );
    expect(status).toBe(401);
    expect(body.access_token).toBeUndefined();
  });

  it("login sem e-mail e senha responde 400", async () => {
    esperarErro(await chamar("POST", "/api/auth/login", {}, SEM_TOKEN), 400);
  });

  it("cadastro com senha curta responde 400", async () => {
    esperarErro(
      await chamar(
        "POST",
        "/api/auth/register",
        { name: "Teste", email: "teste@megaloja.invalid", cpf: "000.000.000-00", password: "123" },
        SEM_TOKEN
      ),
      400
    );
  });

  it("o cliente continua criando pedido sem login de operador", async () => {
    // Recusa de pagamento prova que a rota passou do guard sem gravar nada.
    esperarErro(
      await chamar(
        "POST",
        "/api/orders",
        pedidoValido({ simulate_payment_failure: true }),
        SEM_TOKEN
      ),
      402
    );
  });
});

describe.skipIf(!temToken)("UC007 Validar Retirada: recusas (nao gravam nada)", () => {
  it("voucher desconhecido responde 404", async () => {
    esperarErro(
      await post("/api/orders/validate-pickup", {
        pickup_code: "HV-0000-ZZZZ-ZZZZ",
        document_checked: true,
      }),
      404
    );
  });

  it("sem nenhum dado de busca responde 404", async () => {
    esperarErro(await post("/api/orders/validate-pickup", {}), 404);
  });
});

describe.skipIf(!podeEscrever)("Fluxos que gravam pedidos (CONTRACT_WRITE=1)", () => {
  beforeAll(() => {
    expect(
      alvo.estoque,
      "nenhuma filial tem estoque suficiente para os testes de escrita"
    ).toBeGreaterThanOrEqual(ESTOQUE_MINIMO_PARA_ESCRITA);
  });

  describe("compra, separacao e expiracao (devolve o estoque ao final)", () => {
    let pedidoId: number;
    let estoqueInicial: number;
    let voucher: string;

    it("UC003: cria o pedido com status aguardando_separacao e reserva o estoque", async () => {
      estoqueInicial = await consultarEstoque(alvo.lojaId, alvo.produto.id);
      const { status, body } = await post("/api/orders", pedidoValido());
      expect(status).toBe(201);
      expect(body.order).toMatchObject({
        id: expect.any(Number),
        status: "aguardando_separacao",
        pickup_code: null,
        store_id: alvo.lojaId,
        product_id: alvo.produto.id,
        quantity: 1,
      });
      pedidoId = body.order.id;
      expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(estoqueInicial - 1);
    });

    it("RNF002: a resposta nao expoe o numero completo do cartao", async () => {
      const { body } = await get(`/api/orders/${pedidoId}`);
      expect(JSON.stringify(body)).not.toContain("4111 1111 1111");
      expect(JSON.stringify(body)).not.toContain("4111111111111234");
    });

    it("UC007: retirada antes da separacao responde 400", async () => {
      esperarErro(
        await post("/api/orders/validate-pickup", { order_id: pedidoId, document_checked: true }),
        400
      );
    });

    it("UC005: SKU errado na conferencia responde 400", async () => {
      esperarErro(
        await post(`/api/orders/${pedidoId}/separate`, { barcode_or_sku: "SKU-ERRADO" }),
        400
      );
    });

    it("UC005: separacao com o SKU certo libera o voucher", async () => {
      const { status, body } = await post(`/api/orders/${pedidoId}/separate`, {
        barcode_or_sku: alvo.produto.sku,
      });
      expect(status).toBe(200);
      expect(body.order.status).toBe("pronto_retirada");
      expect(body.order.pickup_code).toMatch(FORMATO_VOUCHER);
      voucher = body.order.pickup_code;
    });

    it("UC005: separar de novo responde 400", async () => {
      esperarErro(
        await post(`/api/orders/${pedidoId}/separate`, { barcode_or_sku: alvo.produto.sku }),
        400
      );
    });

    it("UC006: as notificacoes registram a compra e o voucher", async () => {
      const { status, body } = await get(`/api/orders/${pedidoId}/notifications`);
      expect(status).toBe(200);
      expect(body.notifications.length).toBeGreaterThanOrEqual(2);
      const mensagens = body.notifications.map((n: any) => n.message).join("\n");
      expect(mensagens).toContain(voucher);
    });

    it("UC007: retirada sem conferir o documento responde 400", async () => {
      esperarErro(
        await post("/api/orders/validate-pickup", { pickup_code: voucher, document_checked: false }),
        400
      );
    });

    it("UC007: retirada por terceiro sem terceiro cadastrado responde 403", async () => {
      esperarErro(
        await post("/api/orders/validate-pickup", {
          pickup_code: voucher,
          document_checked: true,
          is_third_party: true,
        }),
        403
      );
    });

    it("abandono: expirar cancela o pedido e devolve o estoque", async () => {
      const { status, body } = await post(`/api/orders/${pedidoId}/expire`);
      expect(status).toBe(200);
      expect(body.order.status).toBe("cancelado_expirado");
      expect(body.order.refund_requested).toBe(1);
      expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(estoqueInicial);
    });

    it("pedido expirado nao pode ser retirado (409) nem expirado de novo (409)", async () => {
      esperarErro(
        await post("/api/orders/validate-pickup", { pickup_code: voucher, document_checked: true }),
        409
      );
      esperarErro(await post(`/api/orders/${pedidoId}/expire`), 409);
    });
  });

  describe("retirada por terceiro ate a entrega (consome 1 unidade do estoque)", () => {
    let voucher: string;

    it("compra com terceiro autorizado e separa o pedido", async () => {
      const compra = await post(
        "/api/orders",
        pedidoValido({ third_party_name: "Terceiro de Teste", third_party_cpf: "555.666.777-88" })
      );
      expect(compra.status).toBe(201);
      expect(compra.body.order.third_party_name).toBe("Terceiro de Teste");

      const separacao = await post(`/api/orders/${compra.body.order.id}/separate`, {
        barcode_or_sku: alvo.produto.barcode,
      });
      expect(separacao.status).toBe(200);
      voucher = separacao.body.order.pickup_code;
    });

    it("UC007: terceiro retira com o voucher e o pedido fica entregue_cliente", async () => {
      const { status, body } = await post("/api/orders/validate-pickup", {
        pickup_code: voucher,
        document_checked: true,
        is_third_party: true,
      });
      expect(status).toBe(200);
      expect(body.order.status).toBe("entregue_cliente");
    });

    it("UC007: voucher reutilizado responde 409", async () => {
      esperarErro(
        await post("/api/orders/validate-pickup", { pickup_code: voucher, document_checked: true }),
        409
      );
    });
  });

  // S3-14: hoje os endpoints do operador respondem 200 sem credencial.
  it.todo("S3-14: separar pedido sem credencial de operador responde 401 ou 403");
});

describe.skipIf(!podeEscrever || !podeDestruir)(
  "UC008 Ruptura (CONTRACT_DESTRUCTIVE=1: zera o estoque da filial)",
  () => {
    let pedidoId: number;

    it("ruptura cancela o pedido, pede estorno e zera o estoque da filial", async () => {
      const compra = await post("/api/orders", pedidoValido());
      expect(compra.status).toBe(201);
      pedidoId = compra.body.order.id;

      const { status, body } = await post(`/api/orders/${pedidoId}/rupture`, {
        reason: "Teste de contrato: item nao encontrado na prateleira.",
      });
      expect(status).toBe(200);
      expect(body.order.status).toBe("cancelado_ruptura");
      expect(body.order.refund_requested).toBe(1);
      expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(0);
    });

    it("pedido com ruptura nao pode ser retirado (409) nem cancelado de novo (409)", async () => {
      esperarErro(
        await post("/api/orders/validate-pickup", { order_id: pedidoId, document_checked: true }),
        409
      );
      esperarErro(await post(`/api/orders/${pedidoId}/rupture`), 409);
    });
  }
);
