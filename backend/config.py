import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path("/tmp/megaloja.db") if os.environ.get("VERCEL") else BASE_DIR / "megaloja.db"

# Estados oficiais do ciclo de vida de um pedido Click & Collect (Trabalho G2).
# Inclui aliases de compatibilidade para versoes anteriores do prototipo.
ORDER_STATUS = {
    # Nomenclatura oficial Trabalho G2 Unilasalle:
    "aguardando_separacao",   # UC003: Pedido registrado com status "Aguardando Separacao"
    "pronto_retirada",        # UC005: Status atualizado para "Pronto para Retirada"
    "entregue_cliente",       # UC007: Pedido finalizado com status "Entregue ao Cliente"
    "cancelado_ruptura",      # UC008: Ruptura de Estoque (falta de item na prateleira + estorno)
    "cancelado_expirado",     # Cancelamento por nao comparecimento / abandono de 7 dias
    # Aliases legados para compatibilidade:
    "aguardando_preparacao",
    "retirado",
    "cancelado",
}

# Modalidades aceitas pelo checkout.
DELIVERY_METHODS = {"entrega_padrao", "retirar_na_loja"}
