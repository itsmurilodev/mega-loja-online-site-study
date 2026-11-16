// Utilitários compartilhados entre a loja (front.html) e o portal do operador (operador.html).

const isFileProtocol = window.location.protocol === 'file:';
const isLocalHost = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
const API_BASE_URL = (isFileProtocol || (isLocalHost && window.location.port !== '5000'))
    ? 'http://127.0.0.1:5000'
    : '';

/** Escapa texto vindo do banco antes de colocar em innerHTML (evita XSS em nomes de produto). */
function esc(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

function formatarMoeda(valor) {
    return `R$ ${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function lerStorage(storage, chave, padrao = null) {
    try {
        const bruto = storage.getItem(chave);
        return bruto ? JSON.parse(bruto) : padrao;
    } catch (e) {
        return padrao;
    }
}

function gravarStorage(storage, chave, valor) {
    try {
        if (valor === null || valor === undefined) storage.removeItem(chave);
        else storage.setItem(chave, JSON.stringify(valor));
    } catch (e) { /* modo privado: segue sem persistir */ }
}

/**
 * Chamada à API. `getToken` (opcional) devolve o token da sessão atual;
 * `aoNaoAutorizado` é chamado em 401/403 de rotas protegidas.
 */
function criarApiFetch({ getToken, aoNaoAutorizado } = {}) {
    return async function apiFetch(path, options = {}) {
        const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        const token = getToken ? getToken() : null;
        if (token) headers.Authorization = `Bearer ${token}`;

        let resp;
        try {
            resp = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
        } catch (e) {
            throw new Error('Não foi possível falar com o servidor. Verifique sua conexão.');
        }

        let data = {};
        try { data = await resp.json(); } catch (e) { /* resposta sem corpo */ }

        if (!resp.ok) {
            if ((resp.status === 401 || resp.status === 403) && token && aoNaoAutorizado) {
                aoNaoAutorizado(resp.status, data.error);
            }
            const erro = new Error(data.error || 'Erro na comunicação com a API.');
            erro.status = resp.status;
            throw erro;
        }
        return data;
    };
}

function slugCidade(nome) {
    return String(nome).toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '-');
}

let toastTimer = null;
function triggerToast(title, text, type) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    const bg = document.getElementById('toast-icon-bg');
    const ic = document.getElementById('toast-icon');

    document.getElementById('toast-title').innerText = title;
    document.getElementById('toast-msg').innerText = text;

    if (type === 'success') {
        bg.className = 'p-1 rounded bg-emerald-500 text-white text-xs flex items-center justify-center w-6 h-6';
        ic.className = 'fa-solid fa-circle-check';
    } else {
        bg.className = 'p-1 rounded bg-amber-500 text-slate-900 text-xs flex items-center justify-center w-6 h-6';
        ic.className = 'fa-solid fa-triangle-exclamation';
    }

    toast.classList.remove('translate-y-24', 'opacity-0');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 3500);
}

// Estados do pedido -> texto e cor (usado pela loja e pelo operador).
const STATUS_PEDIDO = {
    aguardando_separacao: { rotulo: 'Aguardando separação', classe: 'bg-amber-50 text-amber-800 border-amber-200' },
    aguardando_preparacao: { rotulo: 'Aguardando separação', classe: 'bg-amber-50 text-amber-800 border-amber-200' },
    pronto_retirada: { rotulo: 'Pronto para retirada', classe: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    entregue_cliente: { rotulo: 'Entregue', classe: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
    retirado: { rotulo: 'Entregue', classe: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
    cancelado_ruptura: { rotulo: 'Cancelado (item em falta)', classe: 'bg-rose-50 text-rose-800 border-rose-200' },
    cancelado_expirado: { rotulo: 'Expirado (não retirado)', classe: 'bg-gray-100 text-gray-800 border-gray-300' },
    cancelado: { rotulo: 'Cancelado', classe: 'bg-gray-100 text-gray-800 border-gray-300' },
};

function infoStatus(status) {
    return STATUS_PEDIDO[status] || { rotulo: status, classe: 'bg-gray-100 text-gray-800 border-gray-300' };
}
