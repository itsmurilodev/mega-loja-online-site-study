// Tipos globais do portal do colaborador (script global, sem import/export).
// As funções "declare" vêm de js/common.js.

type Papel = 'operador' | 'gerente' | 'empresa';
type Aba = 'separacao' | 'retirada' | 'pedidos' | 'produtos';

// Espelha STATUS_PEDIDO do common.js.
// TODO: conferir com backend/src/common/constants.ts se o back tem mais algum.
type StatusPedido =
    | 'aguardando_separacao'
    | 'aguardando_preparacao'
    | 'pronto_retirada'
    | 'entregue_cliente'
    | 'retirado'
    | 'cancelado_ruptura'
    | 'cancelado_expirado'
    | 'cancelado';

interface Usuario {
    name: string;
    email: string;
    role: Papel;
}

interface Sessao {
    access_token: string;
    user: Usuario;
}

interface Loja {
    id: number;
    name: string;
}

interface Pedido {
    id: number;
    status: StatusPedido;
    product_name: string;
    product_sku?: string;
    product_barcode?: string;
    quantity: number;
    customer_name: string;
    customer_cpf?: string;
    pickup_code?: string;
    pickup_slot?: string;
    reserved_until?: string;
    origin_store_name?: string;
    transfer_eta_days?: number;
    third_party_name?: string;
    third_party_cpf?: string;
    created_at: string;
}

interface Produto {
    id: number;
    name: string;
    category: string;
    sku?: string;
    barcode?: string;
    price: number | string;
    image_url?: string;
    stocks?: Record<number, number>;
}

interface Auditoria {
    action: string;
    user_email?: string;
    user_role?: string;
    detail?: string;
    created_at: string;
}

interface Notificacao {
    message: string;
    created_at: string;
}

interface CorpoBaixa {
    order_id: number;
    document_checked: boolean;
    is_third_party: boolean;
}

interface BaixaOffline extends CorpoBaixa {
    queued_at: string;
}

interface CacheFila {
    filialId: number;
    pedidos: Pedido[];
    em: string;
}

// status fica undefined quando não houve resposta HTTP (sem conexão)
interface ErroApi extends Error {
    status?: number;
}

type ApiFetch = <T = any>(path: string, options?: RequestInit) => Promise<T>;

// ---- js/common.js ----
declare function esc(valor: unknown): string;
declare function formatarMoeda(valor: number | string | null | undefined): string;
declare function lerStorage<T = any>(storage: Storage, chave: string, padrao?: T): T;
declare function gravarStorage(storage: Storage, chave: string, valor: unknown): void;
declare function criarApiFetch(opcoes?: {
    getToken?: () => string | null;
    aoNaoAutorizado?: (status: number, mensagem?: string) => void;
}): ApiFetch;
declare function triggerToast(titulo: string, texto: string, tipo?: 'success' | 'warning'): void;
declare function infoStatus(status: string): { rotulo: string; classe: string };