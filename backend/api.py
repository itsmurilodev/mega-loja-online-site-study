from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import json
import sqlite3

try:
    from .config import DB_PATH
    from .services import (
        ApiError,
        create_order,
        expire_abandoned_order,
        find_order,
        list_notifications,
        list_orders,
        list_products,
        list_stores,
        register_ruptura,
        separate_order,
        update_order_status,
        validate_pickup,
    )
except ImportError:
    from config import DB_PATH
    from services import (
        ApiError,
        create_order,
        expire_abandoned_order,
        find_order,
        list_notifications,
        list_orders,
        list_products,
        list_stores,
        register_ruptura,
        separate_order,
        update_order_status,
        validate_pickup,
    )


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "MegaLojaAPI/2.0-ClickCollect"

    def do_OPTIONS(self):
        # Pre-flight CORS para o navegador
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)

        try:
            if path in ("/", "/api"):
                self.show_api_index()
            elif path == "/api/health":
                self.respond_json({"status": "online", "database": str(DB_PATH.name), "sprint": "Trabalho G2 Unilasalle"})
            elif path == "/api/stores":
                self.respond_json(
                    {
                        "stores": list_stores(
                            city=query.get("city", [None])[0],
                            product_id=query.get("product_id", [None])[0],
                        )
                    }
                )
            elif path == "/api/products":
                self.respond_json({"products": list_products(query.get("store_id", [None])[0])})
            elif path == "/api/orders":
                self.respond_json(
                    {
                        "orders": list_orders(
                            store_id=query.get("store_id", [None])[0],
                            status=query.get("status", [None])[0],
                        )
                    }
                )
            elif path.startswith("/api/orders/") and path.endswith("/notifications"):
                order_id = self.extract_id(path, "/api/orders/", "/notifications")
                self.respond_json({"notifications": list_notifications(order_id)})
            elif path.startswith("/api/orders/"):
                order_id = self.extract_id(path, "/api/orders/")
                self.respond_json({"order": find_order(order_id)})
            else:
                self.respond_error(404, "Rota nao encontrada.")
        except ApiError as exc:
            self.respond_error(exc.status, exc.message)
        except ValueError as exc:
            self.respond_error(400, str(exc))
        except sqlite3.Error as exc:
            self.respond_error(500, f"Erro no banco de dados: {exc}")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        try:
            # UC003: Finalizar Compra
            if path == "/api/orders":
                self.respond_json({"order": create_order(self.read_json())}, status=201)

            # UC005: Separar Pedido (com leitura de codigo de barras / SKU)
            elif path.startswith("/api/orders/") and path.endswith("/separate"):
                order_id = self.extract_id(path, "/api/orders/", "/separate")
                self.respond_json({"order": separate_order(order_id, self.read_json())})

            # UC008: Registrar Ruptura (Falta de Item na Prateleira)
            elif path.startswith("/api/orders/") and path.endswith("/rupture"):
                order_id = self.extract_id(path, "/api/orders/", "/rupture")
                self.respond_json({"order": register_ruptura(order_id, self.read_json())})

            # UC007: Validar Retirada Presencial
            elif path in ("/api/orders/validate-pickup", "/api/orders/pickup"):
                self.respond_json({"order": validate_pickup(self.read_json())})

            # Regra de Abandono (7 dias)
            elif path.startswith("/api/orders/") and path.endswith("/expire"):
                order_id = self.extract_id(path, "/api/orders/", "/expire")
                self.respond_json({"order": expire_abandoned_order(order_id)})

            else:
                self.respond_error(404, "Rota nao encontrada.")
        except ApiError as exc:
            self.respond_error(exc.status, exc.message)
        except ValueError as exc:
            self.respond_error(400, str(exc))
        except sqlite3.Error as exc:
            self.respond_error(500, f"Erro no banco de dados: {exc}")

    def do_PATCH(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        try:
            if path.startswith("/api/orders/") and path.endswith("/status"):
                order_id = self.extract_id(path, "/api/orders/", "/status")
                self.respond_json({"order": update_order_status(order_id, self.read_json())})
            else:
                self.respond_error(404, "Rota nao encontrada.")
        except ApiError as exc:
            self.respond_error(exc.status, exc.message)
        except ValueError as exc:
            self.respond_error(400, str(exc))
        except sqlite3.Error as exc:
            self.respond_error(500, f"Erro no banco de dados: {exc}")

    def show_api_index(self):
        self.respond_json(
            {
                "name": "MegaLoja Click & Collect API - Trabalho G2 Unilasalle",
                "status": "online",
                "casos_de_uso": {
                    "UC003_finalizar_compra": "POST /api/orders",
                    "UC005_separar_pedido": "POST /api/orders/{id}/separate",
                    "UC008_registrar_ruptura": "POST /api/orders/{id}/rupture",
                    "UC007_validar_retirada": "POST /api/orders/validate-pickup",
                    "regra_abandono_expirar": "POST /api/orders/{id}/expire",
                    "consultas": {
                        "lojas": "GET /api/stores",
                        "produtos": "GET /api/products",
                        "pedidos": "GET /api/orders",
                        "notificacoes": "GET /api/orders/{id}/notifications"
                    }
                }
            }
        )

    def extract_id(self, path, prefix, suffix=""):
        value = path.removeprefix(prefix)
        if suffix:
            value = value.removesuffix(suffix)
        if not value.isdigit():
            raise ValueError("ID invalido na URL.")
        return int(value)

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        if not raw.strip():
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            raise ValueError("Corpo da requisicao nao e um JSON valido.")

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def respond_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def respond_error(self, status, message):
        self.respond_json({"error": message}, status=status)
