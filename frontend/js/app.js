        const isFileProtocol = window.location.protocol === 'file:';
        const isLocalHost = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
        const API_BASE_URL = (isFileProtocol || (isLocalHost && window.location.port !== '5000'))
            ? 'http://127.0.0.1:5000'
            : '';

        // Estado Global da Aplicação
        let dbProdutos = [];
        let dbLojas = {};
        let lojaAtiva = { id: 1, nome: 'MegaLoja - Filial Canoas Centro', endereco: 'Av. Guilherme Schell, 5000' };
        let lojaTemp = lojaAtiva;
        let produtoSelecionado = null;
        let filtroPrecoAtivo = 'todos';
        let categoriaAtiva = 'todos';

        let pedidoAtivo = null;
        let pedidosBalcao = [];
        let pedidoSeparacaoSelecionado = null;
        let pedidoRetiradaLocalizado = null;

        // Estado de Rotas e Autenticação (Cliente vs Operador/Admin)
        let rotaAtual = 'cliente'; // 'cliente' ou 'operador'

        // Cliente Autenticado (salvo em localStorage)
        let clienteLogado = (() => {
            try {
                return JSON.parse(localStorage.getItem('megaloja_cliente') || 'null');
            } catch (e) {
                return null;
            }
        })() || {
            nome: 'Murilo Alves',
            cpf: '123.456.789-00',
            email: 'murilo@unilasalle.edu.br',
            telefone: '(51) 99887-6655'
        };

        // Operador/Admin Autenticado (salvo em sessionStorage para simulação de sessão)
        let operadorLogado = (() => {
            try {
                return JSON.parse(sessionStorage.getItem('megaloja_operador') || 'null');
            } catch (e) {
                return null;
            }
        })();

        // Inicialização
        window.onload = async () => {
            atualizarInterfaceCliente();
            await carregarDadosBackend();
            executarFiltrosCombinados();
            renderizarLojasModal();
            atualizarLayoutFocoLoja();

            // Resolve a rota a partir da URL (/operador ou /cliente)
            const rotaInicial = obterRotaDaUrl();
            navegarPara(rotaInicial, false);

            await recarregarPedidosBalcao();
        };

        window.addEventListener('popstate', () => {
            navegarPara(obterRotaDaUrl(), false);
        });

        async function apiFetch(path, options = {}) {
            const resp = await fetch(`${API_BASE_URL}${path}`, {
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
                ...options
            });
            const data = await resp.json();
            if (!resp.ok) {
                throw new Error(data.error || 'Erro na comunicação com a API.');
            }
            return data;
        }

        function slugCidade(nome) {
            return nome.toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/\s+/g, '-');
        }

        async function carregarDadosBackend() {
            try {
                const health = await apiFetch('/api/health');
                const produtosResp = await apiFetch('/api/products');
                
                const produtosComEstoque = await Promise.all(produtosResp.products.map(async (p) => {
                    const lojasResp = await apiFetch(`/api/stores?product_id=${p.id}`);
                    const estoques = {};
                    lojasResp.stores.forEach(loja => {
                        estoques[loja.id] = loja.stock || 0;
                    });

                    return {
                        id: p.id,
                        nome: p.name,
                        categoria: p.category,
                        preco: p.price,
                        sku: p.sku || `SKU-${p.id}`,
                        barcode: p.barcode || `7891000${p.id}`,
                        img: p.image_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&q=80',
                        estoques
                    };
                }));

                const lojasResp = await apiFetch('/api/stores');
                const lojasAgrupadas = {};
                lojasResp.stores.forEach(loja => {
                    const chave = slugCidade(loja.city);
                    if (!lojasAgrupadas[chave]) lojasAgrupadas[chave] = [];
                    lojasAgrupadas[chave].push({
                        id: loja.id,
                        nome: loja.name,
                        endereco: loja.address,
                        cidade: loja.city
                    });
                });

                dbProdutos = produtosComEstoque;
                dbLojas = lojasAgrupadas;
                lojaAtiva = dbLojas['canoas']?.[0] || Object.values(dbLojas)[0]?.[0] || lojaAtiva;
                lojaTemp = lojaAtiva;
                triggerToast("Sistema Conectado", "Dados sincronizados com o Sistema Central (S.E.).", "success");
            } catch (err) {
                console.warn("Backend offline:", err);
                triggerToast("Modo Offline", "API indisponível. Inicializando em modo de contingência.", "warning");
            }
        }

        // Renderizador da Vitrine
        function renderizarVitrine(lista) {
            const grid = document.getElementById('grid-produtos');
            grid.innerHTML = '';
            document.getElementById('contador-produtos').innerText = `${lista.length} produtos disponíveis`;

            if (lista.length === 0) {
                grid.innerHTML = `
                    <div class="col-span-full text-center py-16 bg-white rounded-2xl border border-gray-200 text-gray-400 font-medium text-xs">
                        <i class="fa-solid fa-box-open text-4xl block mb-2 text-gray-300"></i> Nenhum produto encontrado para estes filtros.
                        <button onclick="limparFiltrosVitrine()" class="block mx-auto mt-3 text-blue-600 hover:text-blue-800 font-bold underline">Limpar busca e filtros</button>
                    </div>`;
                return;
            }

            lista.forEach(p => {
                const qtdEstoque = p.estoques[lojaAtiva.id] || 0;
                const card = document.createElement('div');
                card.className = "bg-white border border-gray-200 rounded-2xl p-4 flex flex-col justify-between hover:shadow-xl transition-all duration-300 group cursor-pointer hover:border-blue-400";
                card.onclick = () => carregarDetalhesProduto(p.id);
                
                card.innerHTML = `
                    <div>
                        <div class="w-full h-44 bg-gray-50 rounded-xl flex items-center justify-center overflow-hidden border border-gray-100 mb-4 relative">
                            <img src="${p.img}" alt="${p.nome}" class="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300">
                        </div>
                        <span class="text-[9px] font-black text-blue-600 uppercase tracking-wider bg-blue-50 px-2 py-0.5 rounded">${p.categoria}</span>
                        <h3 class="font-bold text-xs text-gray-800 mt-2 line-clamp-2 min-h-[32px] group-hover:text-blue-600 transition-colors">${p.nome}</h3>
                        <p class="text-[10px] text-gray-400 font-mono mt-1">SKU: ${p.sku}</p>
                    </div>

                    <div class="mt-4 pt-3 border-t border-gray-100 space-y-3">
                        <div class="flex justify-between items-baseline">
                            <span class="text-base font-black text-slate-950">R$ ${p.preco.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                            <span class="text-[9px] font-black ${qtdEstoque > 0 ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50'} px-2 py-0.5 rounded">
                                <i class="fa-solid ${qtdEstoque > 0 ? 'fa-circle-check' : 'fa-clock'} mr-0.5"></i> ${qtdEstoque > 0 ? `${qtdEstoque} un. na filial` : 'Sem estoque local'}
                            </span>
                        </div>
                        <button onclick="event.stopPropagation(); carregarDetalhesProduto(${p.id})" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm">
                            <i class="fa-solid fa-cart-shopping text-[11px]"></i> Comprar
                        </button>
                    </div>
                `;
                grid.appendChild(card);
            });
        }

        // RF006 (S2-19): descricao, garantia e ficha tecnica.
        // Dados de exemplo guardados no front, indexados pelo SKU do catalogo.
        const FICHAS_PRODUTO = {
            'SKU-TV-55': {
                descricao: 'Smart TV de 55 polegadas com resolução 4K e HDR, que deixa filmes e jogos com mais contraste e cores vivas. Conecta por Wi-Fi e Bluetooth e já vem com os principais aplicativos de streaming.',
                garantia: '12 meses de garantia do fabricante contra defeitos de fabricação.',
                ficha: { 'Dimensões (L x A x P)': '123,1 x 71,0 x 6,0 cm (sem base)', 'Peso': '14,2 kg', 'Voltagem': 'Bivolt (100 a 240 V)', 'Cor': 'Preto', 'Material': 'Gabinete em plástico ABS, painel LED' }
            },
            'SKU-SMART-5G': {
                descricao: 'Smartphone 5G com 256 GB de armazenamento e câmera tripla para fotos nítidas de dia e de noite. Tela ampla, bateria para o dia inteiro e carregamento rápido.',
                garantia: '12 meses de garantia do fabricante (90 dias para o carregador e o cabo).',
                ficha: { 'Dimensões (L x A x P)': '7,6 x 16,3 x 0,8 cm', 'Peso': '195 g', 'Voltagem': 'Carregador bivolt (100 a 240 V)', 'Cor': 'Preto grafite', 'Material': 'Vidro e alumínio' }
            },
            'SKU-FURAD-12': {
                descricao: 'Furadeira de impacto profissional com mandril de 1/2 polegada e função reversível, para furar madeira, metal e alvenaria. Empunhadura lateral e limitador de profundidade inclusos.',
                garantia: '6 meses de garantia do fabricante.',
                ficha: { 'Dimensões (L x A x P)': '28,0 x 21,0 x 7,5 cm', 'Peso': '1,9 kg', 'Voltagem': '127 V', 'Cor': 'Vermelho e preto', 'Material': 'Corpo em polímero reforçado, mandril em aço' }
            },
            'SKU-MALETA-142': {
                descricao: 'Maleta com 142 peças em aço cromo vanádio: soquetes, catracas, chaves combinadas, alicates e bits. Organizada em estojo rígido com trava, para oficina ou manutenção doméstica.',
                garantia: '3 meses de garantia legal contra defeitos de fabricação.',
                ficha: { 'Dimensões (L x A x P)': '44,0 x 33,0 x 10,0 cm', 'Peso': '8,7 kg', 'Voltagem': 'Não se aplica', 'Cor': 'Preto e laranja', 'Material': 'Aço cromo vanádio, estojo em polipropileno' }
            },
            'SKU-GELAD-410': {
                descricao: 'Geladeira duplex frost free de 410 litros com acabamento inox e painel digital externo. Prateleiras de vidro temperado e gavetão para frutas e legumes.',
                garantia: '12 meses de garantia do fabricante (10 anos para o compressor).',
                ficha: { 'Dimensões (L x A x P)': '70,0 x 186,0 x 73,0 cm', 'Peso': '72 kg', 'Voltagem': '127 V ou 220 V (conferir na retirada)', 'Cor': 'Inox', 'Material': 'Aço com acabamento inox, prateleiras em vidro temperado' }
            },
            'SKU-SOFA-SUEDE': {
                descricao: 'Sofá retrátil de 3 lugares revestido em tecido suede, com assentos que avançam e encosto reclinável. Espuma de alta densidade para uso diário.',
                garantia: '12 meses de garantia para a estrutura e 3 meses para o tecido.',
                ficha: { 'Dimensões (L x A x P)': '230 x 95 x 110 cm (fechado)', 'Peso': '68 kg', 'Voltagem': 'Não se aplica', 'Cor': 'Verde', 'Material': 'Estrutura em eucalipto, revestimento em suede' }
            }
        };

        const FICHA_NAO_CADASTRADA = {
            descricao: 'Descrição detalhada ainda não cadastrada para este produto.',
            garantia: '3 meses de garantia legal (Código de Defesa do Consumidor).',
            ficha: {}
        };

        function renderizarFichaProduto(produto) {
            const dados = FICHAS_PRODUTO[produto.sku] || FICHA_NAO_CADASTRADA;

            document.getElementById('detalhe-descricao').textContent = dados.descricao;
            document.getElementById('detalhe-garantia').textContent = dados.garantia;

            const lista = document.getElementById('detalhe-ficha-tecnica');
            lista.replaceChildren();
            const itens = Object.entries(dados.ficha);
            if (itens.length === 0) {
                itens.push(['Ficha técnica', 'Não cadastrada']);
            }
            itens.forEach(([rotulo, valor]) => {
                const linha = document.createElement('div');
                linha.className = 'flex justify-between gap-4 px-3 py-2';
                const termo = document.createElement('dt');
                termo.className = 'text-gray-500 font-semibold shrink-0';
                termo.textContent = rotulo;
                const descricao = document.createElement('dd');
                descricao.className = 'text-gray-900 font-medium text-right';
                descricao.textContent = valor;
                linha.append(termo, descricao);
                lista.appendChild(linha);
            });
        }

        function carregarDetalhesProduto(id) {
            produtoSelecionado = dbProdutos.find(p => p.id === id);
            if (!produtoSelecionado) return;

            const elCat = document.getElementById('detalhe-categoria');
            if (elCat) elCat.innerText = produtoSelecionado.categoria;
            const elNome = document.getElementById('detalhe-nome');
            if (elNome) elNome.innerText = produtoSelecionado.nome;

            const preco = produtoSelecionado.preco;
            const precoPix = preco * 0.95;
            const economiaPix = preco * 0.05;
            const valorParcela = preco / 12;

            const elPreco = document.getElementById('detalhe-preco');
            if (elPreco) elPreco.innerText = `R$ ${preco.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

            const elPix = document.getElementById('detalhe-preco-pix');
            if (elPix) elPix.innerText = `R$ ${precoPix.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

            const elEconomia = document.getElementById('detalhe-economia-pix');
            if (elEconomia) elEconomia.innerText = `R$ ${economiaPix.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

            const elParc = document.getElementById('detalhe-parcelamento');
            if (elParc) elParc.innerText = `ou 12x de R$ ${valorParcela.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})} sem juros`;

            const elCodigos = document.getElementById('detalhe-codigos');
            if (elCodigos) elCodigos.innerText = `SKU: ${produtoSelecionado.sku} | Cód. Barras: ${produtoSelecionado.barcode}`;
            
            const elImg = document.getElementById('detalhe-imagem');
            if (elImg) {
                elImg.src = produtoSelecionado.img;
                elImg.alt = produtoSelecionado.nome;
            }
            renderizarFichaProduto(produtoSelecionado);

            atualizarLayoutFocoLoja();
            mudarAba('detalhe');
        }

        // Funções do Carrinho de Compras
        function irParaCarrinho() {
            if (!produtoSelecionado) {
                triggerToast("Seleção Obrigatória", "Selecione um produto para continuar.", "warning");
                return;
            }
            atualizarDadosCarrinho();
            mudarAba('carrinho');
        }

        function abrirCarrinho() {
            if (produtoSelecionado) {
                atualizarDadosCarrinho();
            } else {
                const elConteudo = document.getElementById('carrinho-conteudo');
                const elVazio = document.getElementById('carrinho-vazio');
                if (elConteudo) elConteudo.classList.add('hidden');
                if (elVazio) elVazio.classList.remove('hidden');
            }
            mudarAba('carrinho');
        }

        function atualizarDadosCarrinho() {
            if (!produtoSelecionado) return;

            const elConteudo = document.getElementById('carrinho-conteudo');
            const elVazio = document.getElementById('carrinho-vazio');
            if (elConteudo) elConteudo.classList.remove('hidden');
            if (elVazio) elVazio.classList.add('hidden');

            const preco = produtoSelecionado.preco;
            const precoPix = preco * 0.95;
            const valorParcela = preco / 12;

            const itemImg = document.getElementById('carrinho-item-img');
            if (itemImg) {
                itemImg.src = produtoSelecionado.img;
                itemImg.alt = produtoSelecionado.nome;
            }
            const itemCat = document.getElementById('carrinho-item-categoria');
            if (itemCat) itemCat.innerText = produtoSelecionado.categoria;
            const itemNome = document.getElementById('carrinho-item-nome');
            if (itemNome) itemNome.innerText = produtoSelecionado.nome;
            const itemSku = document.getElementById('carrinho-item-sku');
            if (itemSku) itemSku.innerText = `SKU: ${produtoSelecionado.sku}`;
            const itemPreco = document.getElementById('carrinho-item-preco');
            if (itemPreco) itemPreco.innerText = `R$ ${preco.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

            const subtotal = document.getElementById('carrinho-resumo-subtotal');
            if (subtotal) subtotal.innerText = `R$ ${preco.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            const total = document.getElementById('carrinho-resumo-total');
            if (total) total.innerText = `R$ ${preco.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            const resumoPix = document.getElementById('carrinho-resumo-pix');
            if (resumoPix) resumoPix.innerText = `R$ ${precoPix.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            const resumoParc = document.getElementById('carrinho-resumo-parcelas');
            if (resumoParc) resumoParc.innerText = `ou em até 12x de R$ ${valorParcela.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})} sem juros no cartão`;

            const badge = document.getElementById('nav-carrinho-badge');
            if (badge) badge.innerText = '1';

            atualizarLayoutFocoLoja();
        }

        // Filtros e Busca
        function filtrarCategoria(cat) {
            categoriaAtiva = cat;
            ['todos', 'eletronicos', 'casa', 'eletrodomesticos'].forEach(c => {
                const btn = document.getElementById(`cat-${c}`);
                if (btn) {
                    btn.className = (c === cat)
                        ? "bg-white text-blue-700 px-3 py-1 rounded-lg font-bold shadow-sm whitespace-nowrap"
                        : "hover:bg-blue-700 px-3 py-1 rounded-lg transition-colors whitespace-nowrap";
                }
            });
            document.getElementById('titulo-vitrine').innerText = cat === 'todos' ? "Todos os Departamentos" : `Departamento: ${cat}`;
            executarFiltrosCombinados();
        }

        function filtrarPorPreco(range) {
            filtroPrecoAtivo = range;
            executarFiltrosCombinados();
        }

        function filtrarPorNome() {
            // Quem digita na busca estando na pagina do produto ou carrinho volta para a vitrine.
            const abaDetalhe = document.getElementById('aba-detalhe');
            const abaCarrinho = document.getElementById('aba-carrinho');
            if ((abaDetalhe && !abaDetalhe.classList.contains('hidden')) || (abaCarrinho && !abaCarrinho.classList.contains('hidden'))) {
                mudarAba('vitrine');
            }
            executarFiltrosCombinados();
        }

        // S2-11: busca sem diferenciar maiusculas nem acentos ("eletronicos" acha "Eletrônicos").
        function normalizarTexto(texto) {
            return String(texto)
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
        }

        function produtoCombinaComBusca(produto, termos) {
            const textoDoProduto = normalizarTexto(
                `${produto.nome} ${produto.categoria} ${produto.sku} ${produto.barcode}`
            );
            return termos.every(termo => textoDoProduto.includes(termo));
        }

        const ORDENACOES_VITRINE = {
            'menor-preco': (a, b) => a.preco - b.preco,
            'maior-preco': (a, b) => b.preco - a.preco,
            'nome': (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
            'estoque': (a, b) => (b.estoques[lojaAtiva.id] || 0) - (a.estoques[lojaAtiva.id] || 0)
        };

        function limparFiltrosVitrine() {
            document.getElementById('input-busca').value = '';
            document.getElementById('filtro-com-estoque').checked = false;
            document.getElementById('ordenacao-vitrine').value = 'padrao';
            document.querySelector('input[name="filtro-preco"][value="todos"]').checked = true;
            filtroPrecoAtivo = 'todos';
            filtrarCategoria('todos');
        }

        function executarFiltrosCombinados() {
            let resultado = dbProdutos;
            if (categoriaAtiva !== 'todos') {
                resultado = resultado.filter(p => p.categoria === categoriaAtiva);
            }
            if (filtroPrecoAtivo === 'ate500') {
                resultado = resultado.filter(p => p.preco <= 500);
            } else if (filtroPrecoAtivo === 'de500a2000') {
                resultado = resultado.filter(p => p.preco > 500 && p.preco <= 2000);
            } else if (filtroPrecoAtivo === 'acima2000') {
                resultado = resultado.filter(p => p.preco > 2000);
            }
            const termos = normalizarTexto(document.getElementById('input-busca').value)
                .split(/\s+/)
                .filter(Boolean);
            if (termos.length > 0) {
                resultado = resultado.filter(p => produtoCombinaComBusca(p, termos));
            }
            if (document.getElementById('filtro-com-estoque').checked) {
                resultado = resultado.filter(p => (p.estoques[lojaAtiva.id] || 0) > 0);
            }
            const comparar = ORDENACOES_VITRINE[document.getElementById('ordenacao-vitrine').value];
            if (comparar) {
                resultado = [...resultado].sort(comparar);
            }
            renderizarVitrine(resultado);
        }

        // =====================================================================
        // ROTEAMENTO DINÂMICO (ROTA DO CLIENTE VS ROTA DO OPERADOR/ADMIN)
        // =====================================================================
        function obterRotaDaUrl() {
            const path = window.location.pathname.toLowerCase();
            const hash = window.location.hash.toLowerCase();
            const search = new URLSearchParams(window.location.search);
            const paramRota = search.get('rota')?.toLowerCase();

            if (path.includes('/operador') || path.includes('/balcao') || path.includes('/admin') ||
                hash.includes('operador') || hash.includes('balcao') || hash.includes('admin') ||
                paramRota === 'operador' || paramRota === 'balcao' || paramRota === 'admin') {
                return 'operador';
            }
            return 'cliente';
        }

        function navegarPara(rota, atualizarHistorico = true) {
            const destino = (rota === '/operador' || rota === 'operador' || rota === '/balcao' || rota === '/admin')
                ? 'operador'
                : 'cliente';

            rotaAtual = destino;

            const pillCliente = document.getElementById('pill-rota-cliente');
            const pillOperador = document.getElementById('pill-rota-operador');
            const headerCliente = document.getElementById('header-cliente');
            const headerOperador = document.getElementById('header-operador');
            const banner = document.getElementById('wrapper-banner');

            if (destino === 'operador') {
                // Atualiza abas institucionais da barra superior
                if (pillOperador && pillCliente) {
                    pillOperador.className = "px-2.5 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 bg-amber-400 text-slate-950 shadow-sm";
                    pillCliente.className = "px-2.5 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 text-blue-200 hover:text-white";
                }

                // Exibe cabeçalho exclusivo do operador
                headerCliente?.classList.add('hidden');
                headerOperador?.classList.remove('hidden');
                banner?.classList.add('hidden');

                // Oculta abas do cliente
                ['vitrine', 'detalhe', 'carrinho', 'sucesso'].forEach(aba => {
                    document.getElementById(`aba-${aba}`)?.classList.add('hidden');
                });

                // Verifica se operador está autenticado
                if (operadorLogado) {
                    document.getElementById('aba-login-operador')?.classList.add('hidden');
                    document.getElementById('aba-balcao')?.classList.remove('hidden');
                    atualizarInterfaceOperador();
                    recarregarPedidosBalcao();
                } else {
                    document.getElementById('aba-balcao')?.classList.add('hidden');
                    document.getElementById('aba-login-operador')?.classList.remove('hidden');
                }

                if (atualizarHistorico) {
                    try {
                        if (!isFileProtocol) {
                            window.history.pushState({ rota: 'operador' }, '', '/operador');
                        } else {
                            window.location.hash = '/operador';
                        }
                    } catch (e) {
                        // Modo estático seguro
                    }
                }
            } else {
                // Destino: Rota do Cliente
                if (pillCliente && pillOperador) {
                    pillCliente.className = "px-2.5 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 bg-white text-blue-950 shadow-sm";
                    pillOperador.className = "px-2.5 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 text-blue-200 hover:text-white";
                }

                // Exibe cabeçalho do cliente e oculta o do operador
                headerOperador?.classList.add('hidden');
                headerCliente?.classList.remove('hidden');
                banner?.classList.remove('hidden');

                // Oculta abas do operador
                document.getElementById('aba-login-operador')?.classList.add('hidden');
                document.getElementById('aba-balcao')?.classList.add('hidden');

                // Exibe a aba ativa do cliente
                mudarAba(pedidoAtivo ? 'sucesso' : 'vitrine');

                if (atualizarHistorico) {
                    try {
                        if (!isFileProtocol) {
                            window.history.pushState({ rota: 'cliente' }, '', '/cliente');
                        } else {
                            window.location.hash = '/cliente';
                        }
                    } catch (e) {
                        // Modo estático seguro
                    }
                }
            }

            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Retrocompatibilidade
        function alternarAtor(ator) {
            if (ator === 'balcao' || ator === 'operador') {
                navegarPara('/operador');
            } else {
                navegarPara('/cliente');
            }
        }

        function mudarAba(destino) {
            ['vitrine', 'detalhe', 'carrinho', 'sucesso', 'balcao', 'login-operador'].forEach(aba => {
                document.getElementById(`aba-${aba}`)?.classList.add('hidden');
            });
            document.getElementById(`aba-${destino}`)?.classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // =====================================================================
        // CONTROLE DE ACESSO DO OPERADOR (ADMIN / BALCÃO)
        // =====================================================================
        function realizarLoginOperador(event) {
            if (event) event.preventDefault();
            const user = document.getElementById('op-login-user')?.value.trim();
            const pass = document.getElementById('op-login-pass')?.value;
            const filialId = document.getElementById('op-login-filial')?.value;

            if (!user || !pass) {
                triggerToast("Atenção", "Preencha o usuário e a senha do operador.", "warning");
                return;
            }

            operadorLogado = {
                usuario: user,
                nome: user.toLowerCase() === 'admin' ? 'Administrador Central' : 'Murilo Alves',
                matricula: user.toLowerCase() === 'admin' ? 'ADM-001' : 'OP-2024',
                perfil: user.toLowerCase() === 'admin' ? 'Administrador' : 'Operador de Balcão',
                filialId: parseInt(filialId || '1', 10)
            };

            try {
                sessionStorage.setItem('megaloja_operador', JSON.stringify(operadorLogado));
            } catch (e) {}

            triggerToast("Acesso Autorizado", `Bem-vindo ao Balcão, ${operadorLogado.nome}!`, "success");
            navegarPara('/operador', false);
        }

        function logoutOperador() {
            operadorLogado = null;
            try {
                sessionStorage.removeItem('megaloja_operador');
            } catch (e) {}
            triggerToast("Sessão Encerrada", "Operador desconectado com sucesso.", "warning");
            navegarPara('/operador', false);
        }

        function atualizarInterfaceOperador() {
            if (!operadorLogado) return;
            const badgeNome = document.getElementById('txt-operador-nome-badge');
            const badgeMat = document.getElementById('txt-operador-matricula');
            const navLojaOp = document.getElementById('nav-loja-operador-nome');

            if (badgeNome) badgeNome.innerText = `${operadorLogado.perfil}: ${operadorLogado.nome}`;
            if (badgeMat) badgeMat.innerText = `Matrícula: ${operadorLogado.matricula}`;
            if (navLojaOp) navLojaOp.innerText = lojaAtiva.nome.replace('MegaLoja - Filial ', '');
        }

        // =====================================================================
        // AUTENTICAÇÃO DO CLIENTE (LOGIN & SENHA / CADASTRO)
        // =====================================================================
        function abrirModalAuthCliente(tab = 'login') {
            const modal = document.getElementById('modal-auth-cliente');
            const content = document.getElementById('modal-auth-content');
            if (!modal) return;
            alternarTabAuthCliente(tab);
            modal.classList.remove('hidden');
            setTimeout(() => {
                modal.classList.remove('opacity-0');
                content?.classList.remove('scale-95');
            }, 15);
        }

        function fecharModalAuthCliente() {
            const modal = document.getElementById('modal-auth-cliente');
            const content = document.getElementById('modal-auth-content');
            if (!modal) return;
            modal.classList.add('opacity-0');
            content?.classList.add('scale-95');
            setTimeout(() => modal.classList.add('hidden'), 200);
        }

        function alternarTabAuthCliente(tab) {
            const tabLogin = document.getElementById('tab-auth-login');
            const tabCadastro = document.getElementById('tab-auth-cadastro');
            const formLogin = document.getElementById('form-auth-login');
            const formCadastro = document.getElementById('form-auth-cadastro');

            if (!tabLogin || !tabCadastro) return;

            if (tab === 'login') {
                tabLogin.className = "flex-1 py-3 text-center border-b-2 border-blue-600 text-blue-600 bg-white transition-all flex items-center justify-center gap-1.5";
                tabCadastro.className = "flex-1 py-3 text-center border-b-2 border-transparent text-gray-500 hover:text-gray-800 transition-all flex items-center justify-center gap-1.5";
                formLogin?.classList.remove('hidden');
                formCadastro?.classList.add('hidden');
            } else {
                tabCadastro.className = "flex-1 py-3 text-center border-b-2 border-emerald-600 text-emerald-600 bg-white transition-all flex items-center justify-center gap-1.5";
                tabLogin.className = "flex-1 py-3 text-center border-b-2 border-transparent text-gray-500 hover:text-gray-800 transition-all flex items-center justify-center gap-1.5";
                formCadastro?.classList.remove('hidden');
                formLogin?.classList.add('hidden');
            }
        }

        function executarLoginCliente(event) {
            if (event) event.preventDefault();
            const usuario = document.getElementById('cli-login-usuario')?.value.trim();
            const senha = document.getElementById('cli-login-senha')?.value;

            if (!usuario || !senha) {
                triggerToast("Atenção", "Preencha o e-mail/CPF e a senha.", "warning");
                return;
            }

            let cadastros = [];
            try {
                cadastros = JSON.parse(localStorage.getItem('megaloja_cadastros') || '[]');
            } catch (e) {}

            const contaEncontrada = cadastros.find(c =>
                (c.email && c.email.toLowerCase() === usuario.toLowerCase()) ||
                (c.cpf && c.cpf === usuario)
            );

            if (contaEncontrada) {
                clienteLogado = {
                    nome: contaEncontrada.nome,
                    cpf: contaEncontrada.cpf,
                    email: contaEncontrada.email,
                    telefone: contaEncontrada.telefone
                };
            } else {
                clienteLogado = {
                    nome: usuario.includes('@') ? usuario.split('@')[0] : 'Cliente MegaLoja',
                    email: usuario.includes('@') ? usuario : 'cliente@unilasalle.edu.br',
                    cpf: usuario.includes('@') ? '123.456.789-00' : usuario,
                    telefone: '(51) 99887-6655'
                };
            }

            try {
                localStorage.setItem('megaloja_cliente', JSON.stringify(clienteLogado));
            } catch (e) {}

            atualizarInterfaceCliente();
            fecharModalAuthCliente();
            triggerToast("Login Concluído", `Bem-vindo de volta, ${clienteLogado.nome}!`, "success");
        }

        function executarCadastroCliente(event) {
            if (event) event.preventDefault();
            const nome = document.getElementById('cli-cad-nome')?.value.trim();
            const cpf = document.getElementById('cli-cad-cpf')?.value.trim();
            const telefone = document.getElementById('cli-cad-telefone')?.value.trim();
            const email = document.getElementById('cli-cad-email')?.value.trim();
            const senha = document.getElementById('cli-cad-senha')?.value;
            const senhaConf = document.getElementById('cli-cad-senha-conf')?.value;

            if (!nome || !cpf || !email || !senha) {
                triggerToast("Atenção", "Preencha todos os campos obrigatórios.", "warning");
                return;
            }

            if (senha !== senhaConf) {
                triggerToast("Erro no Cadastro", "A confirmação de senha não coincide com a senha digitada.", "warning");
                return;
            }

            clienteLogado = { nome, cpf, telefone, email };

            try {
                const cadastros = JSON.parse(localStorage.getItem('megaloja_cadastros') || '[]');
                cadastros.push({ ...clienteLogado, senha });
                localStorage.setItem('megaloja_cadastros', JSON.stringify(cadastros));
                localStorage.setItem('megaloja_cliente', JSON.stringify(clienteLogado));
            } catch (e) {}

            atualizarInterfaceCliente();
            fecharModalAuthCliente();
            triggerToast("Cadastro Realizado", `Conta criada com sucesso! Bem-vindo, ${clienteLogado.nome}.`, "success");
        }

        function logoutCliente() {
            clienteLogado = null;
            try {
                localStorage.removeItem('megaloja_cliente');
            } catch (e) {}
            atualizarInterfaceCliente();
            triggerToast("Sessão Finalizada", "Você desconectou da sua conta de cliente.", "warning");
        }

        function atualizarInterfaceCliente() {
            const boxDeslogado = document.getElementById('auth-cliente-deslogado');
            const boxLogado = document.getElementById('auth-cliente-logado');
            const navNome = document.getElementById('nav-cliente-nome');
            const menuEmail = document.getElementById('menu-cliente-email');
            const menuCpf = document.getElementById('menu-cliente-cpf');

            if (clienteLogado) {
                boxDeslogado?.classList.add('hidden');
                boxLogado?.classList.remove('hidden');
                if (navNome) navNome.innerText = clienteLogado.nome.split(' ')[0] || clienteLogado.nome;
                if (menuEmail) menuEmail.innerText = clienteLogado.email || '---';
                if (menuCpf) menuCpf.innerText = `CPF: ${clienteLogado.cpf || '---'}`;

                // Preenche campos do checkout com dados do cliente
                const inputNome = document.getElementById('chk-nome-cliente');
                const inputCpf = document.getElementById('chk-cpf-cliente');
                if (inputNome && !inputNome.value) inputNome.value = clienteLogado.nome;
                if (inputCpf && !inputCpf.value) inputCpf.value = clienteLogado.cpf;
            } else {
                boxLogado?.classList.add('hidden');
                boxDeslogado?.classList.remove('hidden');
            }
        }

        function abrirMeusPedidos() {
            if (pedidoAtivo) {
                mudarAba('sucesso');
            } else {
                triggerToast("Meus Pedidos", "Você ainda não possui pedidos em andamento nesta sessão.", "warning");
                mudarAba('vitrine');
            }
        }

        function abrirCarrinho() {
            triggerToast("Carrinho Click & Collect", "Selecione qualquer produto na vitrine para comprar e retirar na filial com frete grátis!", "success");
        }

        // Modal de Filiais (RF001)
        function abrirModalLoja() {
            const m = document.getElementById('modal-loja');
            const c = document.getElementById('modal-content');
            m.classList.remove('hidden');
            setTimeout(() => { m.classList.remove('opacity-0'); c.classList.remove('scale-95'); }, 15);
        }

        function fecharModalLoja() {
            const m = document.getElementById('modal-loja');
            const c = document.getElementById('modal-content');
            m.classList.add('opacity-0'); c.classList.add('scale-95');
            setTimeout(() => m.classList.add('hidden'), 200);
        }

        function renderizarLojasModal() {
            const cid = document.getElementById('seletor-cidade').value;
            const box = document.getElementById('box-lista-lojas');
            box.innerHTML = '';

            const lojasCidade = dbLojas[cid] || [];
            lojasCidade.forEach(l => {
                const isChecked = l.id === lojaTemp.id;
                const div = document.createElement('div');
                div.className = `border p-3 rounded-xl flex items-center justify-between cursor-pointer transition-all ${isChecked ? 'border-blue-600 bg-blue-50/50' : 'border-gray-200 hover:bg-gray-50'}`;
                div.onclick = () => { lojaTemp = l; renderizarLojasModal(); };

                div.innerHTML = `
                    <div>
                        <p class="text-xs font-bold text-gray-900">${l.nome}</p>
                        <p class="text-[10px] text-gray-500">${l.endereco}</p>
                    </div>
                    <div class="w-4 h-4 rounded-full border flex items-center justify-center ${isChecked ? 'border-blue-600' : 'border-gray-300'}">
                        <div class="w-2 h-2 rounded-full ${isChecked ? 'bg-blue-600' : 'bg-transparent'}"></div>
                    </div>
                `;
                box.appendChild(div);
            });
        }

        function salvarEscolhaLoja() {
            lojaAtiva = lojaTemp;
            fecharModalLoja();
            atualizarLayoutFocoLoja();
            executarFiltrosCombinados();
            recarregarPedidosBalcao();
            triggerToast("Filial Atualizada (RF001)", `Unidade ativa definida para: ${lojaAtiva.nome}`, "success");
        }

        function atualizarLayoutFocoLoja() {
            const nomeCurto = lojaAtiva.nome.replace('MegaLoja - Filial ', '');
            const elNav = document.getElementById('nav-loja-nome');
            const elStatus = document.getElementById('txt-status-loja-nome');
            const elBalcao = document.getElementById('txt-balcao-loja-nome');
            const elNavOp = document.getElementById('nav-loja-operador-nome');

            if (elNav) elNav.innerText = nomeCurto;
            if (elStatus) elStatus.innerText = lojaAtiva.nome;
            if (elBalcao) elBalcao.innerText = lojaAtiva.nome;
            if (elNavOp) elNavOp.innerText = nomeCurto;

            if (!produtoSelecionado) return;

            const estoqueFisico = produtoSelecionado.estoques[lojaAtiva.id] || 0;
            const statusInfo = document.getElementById('txt-status-loja-info');
            const badgeEstoque = document.getElementById('badge-estoque-status');

            if (estoqueFisico > 0) {
                statusInfo.className = "text-[11px] font-semibold text-emerald-600";
                statusInfo.innerHTML = `<i class="fa-solid fa-circle-check"></i> Estoque Confirmado Local (${estoqueFisico} un.)`;
                badgeEstoque.className = "text-[10px] font-bold px-2 py-1 rounded bg-emerald-100 text-emerald-800";
                badgeEstoque.innerText = "Estoque OK";
            } else {
                statusInfo.className = "text-[11px] font-semibold text-red-600";
                statusInfo.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Indisponível nesta filial física`;
                badgeEstoque.className = "text-[10px] font-bold px-2 py-1 rounded bg-red-100 text-red-800";
                badgeEstoque.innerText = "Sem Estoque";
            }
        }

        function toggleCamposTerceiro() {
            const habilitado = document.getElementById('chk-habilitar-terceiro').checked;
            document.getElementById('box-terceiro').classList.toggle('hidden', !habilitado);
        }

        // =====================================================================
        // EXECUÇÃO DO CASO DE USO 1: UC003 - FINALIZAR COMPRA
        // =====================================================================
        async function executarCheckoutUC003() {
            if (!produtoSelecionado) {
                triggerToast("Seleção Obrigatória", "Selecione um produto na vitrine.", "warning");
                return;
            }

            const nomeCliente = document.getElementById('chk-nome-cliente').value.trim();
            const cpfCliente = document.getElementById('chk-cpf-cliente').value.trim();
            const simularRecusa = document.getElementById('chk-simular-recusa').checked;
            const numeroCartao = document.getElementById('chk-cartao-numero').value.trim();

            const comTerceiro = document.getElementById('chk-habilitar-terceiro').checked;
            const nomeTerceiro = comTerceiro ? document.getElementById('chk-nome-terceiro').value.trim() : null;
            const cpfTerceiro = comTerceiro ? document.getElementById('chk-cpf-terceiro').value.trim() : null;

            if (!nomeCliente || !cpfCliente) {
                triggerToast("Dados Incompletos", "Preencha o nome e CPF do titular.", "warning");
                return;
            }

            if (comTerceiro && (!nomeTerceiro || !cpfTerceiro)) {
                triggerToast("Dados do Terceiro", "Preencha o nome e CPF do terceiro autorizado.", "warning");
                return;
            }

            try {
                // UC003 invoca o ControladorPedido no Backend
                const payload = {
                    customer_name: nomeCliente,
                    customer_cpf: cpfCliente,
                    delivery_method: "retirar_na_loja",
                    store_id: lojaAtiva.id,
                    product_id: produtoSelecionado.id,
                    quantity: 1,
                    card_number: numeroCartao,
                    simulate_payment_failure: simularRecusa,
                    third_party_name: nomeTerceiro,
                    third_party_cpf: cpfTerceiro
                };

                const resp = await apiFetch('/api/orders', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });

                pedidoAtivo = resp.order;
                atualizarTelaSucessoComprovante(pedidoAtivo);
                const badge = document.getElementById('nav-carrinho-badge');
                if (badge) badge.innerText = '0';
                mudarAba('sucesso');
                triggerToast("Pedido Confirmado!", "Ordem de separação enviada ao operador da filial (UC004).", "success");
                await recarregarPedidosBalcao();

                // Atualiza estoque local na memória
                if (produtoSelecionado.estoques[lojaAtiva.id] > 0) {
                    produtoSelecionado.estoques[lojaAtiva.id] -= 1;
                    atualizarLayoutFocoLoja();
                }
            } catch (err) {
                // Fluxo Alternativo 5.1.5.2 (Recusa) ou 5.1.5.1 (Estoque indisponível)
                triggerToast("Atenção no Checkout", err.message, "warning");
            }
        }

        function atualizarTelaSucessoComprovante(pedido) {
            document.getElementById('txt-sucesso-id').innerText = `PEDIDO #${String(pedido.id).padStart(4, '0')}`;
            document.getElementById('resumo-filial').innerText = pedido.store_name || lojaAtiva.nome;
            document.getElementById('resumo-produto').innerText = `${pedido.quantity}x ${pedido.product_name}`;
            document.getElementById('resumo-titular').innerText = `${pedido.customer_name} (${pedido.customer_cpf || 'CPF informado'})`;

            const linhaTerceiro = document.getElementById('linha-resumo-terceiro');
            if (pedido.third_party_name) {
                linhaTerceiro.classList.remove('hidden');
                document.getElementById('resumo-terceiro').innerText = `${pedido.third_party_name} (CPF: ${pedido.third_party_cpf})`;
            } else {
                linhaTerceiro.classList.add('hidden');
            }

            configurarLayoutStatusCliente(pedido.status, pedido.pickup_code);
        }

        function configurarLayoutStatusCliente(status, pickupCode) {
            const badge = document.getElementById('badge-status-cliente');
            const txtStatus = document.getElementById('txt-status-cliente');
            const txtInstrucao = document.getElementById('txt-instrucao-cliente');
            const wrap = document.getElementById('wrapper-qrcode');
            const overlay = document.getElementById('overlay-qr');
            const token = document.getElementById('txt-token-numerico');
            const imgQr = document.getElementById('img-qrcode');

            if (status === 'aguardando_separacao' || status === 'aguardando_preparacao') {
                badge.className = "bg-amber-50 text-amber-800 text-xs font-bold px-3 py-1.5 rounded-full border border-amber-200 flex items-center gap-2";
                txtStatus.innerText = "Aguardando Separação Física";
                txtInstrucao.innerText = "O estoquista da filial está coletando os itens nas prateleiras físicas.";
                wrap.classList.add('opacity-60');
                overlay.classList.remove('hidden');
                token.innerText = "••••-••••";
                imgQr.src = "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=PENDENTE";
            }
            else if (status === 'pronto_retirada') {
                badge.className = "bg-emerald-50 text-emerald-800 text-xs font-bold px-3 py-1.5 rounded-full border border-emerald-200 flex items-center gap-2";
                txtStatus.innerText = "Pronto para Retirada no Balcão";
                txtInstrucao.innerText = "Separação física concluída! Dirija-se à filial escolhida com este QR Code e seu documento com foto.";
                wrap.classList.remove('opacity-60');
                overlay.classList.add('hidden');
                token.innerText = pickupCode || "HV-0000-0000";
                imgQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(pickupCode || 'VOUCHER')}`;
            }
            else if (status === 'entregue_cliente' || status === 'retirado') {
                badge.className = "bg-emerald-100 text-emerald-900 text-xs font-bold px-3 py-1.5 rounded-full border border-emerald-300 flex items-center gap-2";
                txtStatus.innerText = "Pedido Entregue com Sucesso";
                txtInstrucao.innerText = "Baixa final efetuada presencialmente no balcão da filial.";
                wrap.classList.add('opacity-40');
                overlay.classList.add('hidden');
                token.innerText = "BAIXA FINALIZADA";
            }
            else if (status === 'cancelado_ruptura') {
                badge.className = "bg-rose-50 text-rose-800 text-xs font-bold px-3 py-1.5 rounded-full border border-rose-200 flex items-center gap-2";
                txtStatus.innerText = "Cancelado por Ruptura de Estoque (UC008)";
                txtInstrucao.innerText = "O item não estava disponível na prateleira física. Solicitação de estorno enviada à operadora de cartão.";
                wrap.classList.add('opacity-40');
                overlay.classList.remove('hidden');
                token.innerText = "ESTORNO SOLICITADO";
            }
            else {
                badge.className = "bg-gray-100 text-gray-800 text-xs font-bold px-3 py-1.5 rounded-full border border-gray-300 flex items-center gap-2";
                txtStatus.innerText = "Cancelado / Expirado";
                txtInstrucao.innerText = "O pedido atingiu o prazo limite ou foi cancelado.";
            }
        }

        // =====================================================================
        // PAINEL DO OPERADOR DE BALCÃO (UC005, UC007, UC008)
        // =====================================================================
        async function recarregarPedidosBalcao() {
            try {
                const resp = await apiFetch(`/api/orders?store_id=${lojaAtiva.id}`);
                pedidosBalcao = resp.orders || [];

                const pendentes = pedidosBalcao.filter(o => o.status === 'aguardando_separacao' || o.status === 'aguardando_preparacao');
                const prontos = pedidosBalcao.filter(o => o.status === 'pronto_retirada');

                document.getElementById('badge-contador-separacao').innerText = `${pendentes.length} pendentes`;
                document.getElementById('badge-contador-prontos').innerText = `${prontos.length} prontos`;

                // Popula select de separação (UC005)
                const selectSep = document.getElementById('select-pedido-separacao');
                selectSep.innerHTML = '';
                if (pendentes.length === 0) {
                    selectSep.innerHTML = '<option value="">Nenhum pedido aguardando separação nesta filial</option>';
                    pedidoSeparacaoSelecionado = null;
                } else {
                    pendentes.forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = p.id;
                        opt.innerText = `Pedido #${String(p.id).padStart(4, '0')} • ${p.product_name} (${p.quantity} un.)`;
                        selectSep.appendChild(opt);
                    });
                    pedidoSeparacaoSelecionado = pendentes[0];
                }
                atualizarCardSeparacao();
            } catch (err) {
                console.warn("Falha ao recarregar pedidos do balcão:", err);
            }
        }

        function selecionarPedidoParaSeparar() {
            const id = parseInt(document.getElementById('select-pedido-separacao').value);
            pedidoSeparacaoSelecionado = pedidosBalcao.find(p => p.id === id) || null;
            atualizarCardSeparacao();
        }

        function atualizarCardSeparacao() {
            const p = pedidoSeparacaoSelecionado;
            if (!p) {
                document.getElementById('sep-prod-nome').innerText = "Nenhum pedido selecionado";
                document.getElementById('sep-prod-qtd').innerText = "-";
                document.getElementById('sep-prod-sku').innerText = "---";
                document.getElementById('sep-prod-barcode').innerText = "---";
                return;
            }
            document.getElementById('sep-prod-nome').innerText = p.product_name;
            document.getElementById('sep-prod-qtd').innerText = `${p.quantity} un.`;
            document.getElementById('sep-prod-sku').innerText = p.product_sku || "SKU-PADRAO";
            document.getElementById('sep-prod-barcode').innerText = p.product_barcode || "7891000";
        }

        function preencherSkuTeste() {
            if (!pedidoSeparacaoSelecionado) return;
            document.getElementById('input-leitor-sku').value = pedidoSeparacaoSelecionado.product_sku || pedidoSeparacaoSelecionado.product_barcode;
            triggerToast("Leitura Simulada", "Código de barras óptico lido com sucesso.", "success");
        }

        // Executar UC005: Concluir Separação
        async function executarSeparacaoUC005() {
            if (!pedidoSeparacaoSelecionado) {
                triggerToast("Atenção", "Selecione um pedido pendente para separar.", "warning");
                return;
            }

            const barcodeOuSku = document.getElementById('input-leitor-sku').value.trim();
            if (!barcodeOuSku) {
                triggerToast("Conferência Obrigatória", "Informe o código de barras ou SKU do item coletado (Fluxo 5.2.4).", "warning");
                return;
            }

            try {
                const resp = await apiFetch(`/api/orders/${pedidoSeparacaoSelecionado.id}/separate`, {
                    method: 'POST',
                    body: JSON.stringify({ barcode_or_sku: barcodeOuSku })
                });

                triggerToast("Separação Concluída (UC005)", "Voucher digital único gerado e liberado ao cliente.", "success");
                document.getElementById('input-leitor-sku').value = '';
                
                // Se for o pedido ativo do cliente aberto, atualiza a tela
                if (pedidoAtivo && pedidoAtivo.id === resp.order.id) {
                    pedidoAtivo = resp.order;
                    configurarLayoutStatusCliente(pedidoAtivo.status, pedidoAtivo.pickup_code);
                }

                await recarregarPedidosBalcao();
            } catch (err) {
                triggerToast("Erro na Conferência (UC005)", err.message, "warning");
            }
        }

        // Executar UC008: Ruptura de Estoque
        async function executarRupturaUC008() {
            if (!pedidoSeparacaoSelecionado) {
                triggerToast("Atenção", "Selecione um pedido para registrar a ruptura.", "warning");
                return;
            }

            const motivo = prompt("Motivo da indisponibilidade física na prateleira:", "Falta de item na prateleira física (ruptura)");
            if (!motivo) return;

            try {
                const resp = await apiFetch(`/api/orders/${pedidoSeparacaoSelecionado.id}/rupture`, {
                    method: 'POST',
                    body: JSON.stringify({ reason: motivo })
                });

                triggerToast("Ruptura Registrada (UC008)", "Pedido cancelado e solicitação de estorno emitida à operadora.", "warning");
                if (pedidoAtivo && pedidoAtivo.id === resp.order.id) {
                    pedidoAtivo = resp.order;
                    configurarLayoutStatusCliente(pedidoAtivo.status, null, null);
                }
                await recarregarPedidosBalcao();
            } catch (err) {
                triggerToast("Erro ao Registrar Ruptura", err.message, "warning");
            }
        }

        // Localizar Pedido para Retirada (Voucher ou Busca Manual)
        function localizarPedidoRetirada(modo) {
            let pedido = null;

            if (modo === 'voucher') {
                const voucher = document.getElementById('input-busca-voucher').value.trim();
                if (!voucher) {
                    triggerToast("Campo Vazio", "Informe o código do voucher.", "warning");
                    return;
                }
                pedido = pedidosBalcao.find(o => o.pickup_code && o.pickup_code.toUpperCase() === voucher.toUpperCase());
            } else {
                const cpf = document.getElementById('input-busca-cpf').value.trim();
                if (!cpf) {
                    triggerToast("Campo Vazio", "Informe o CPF para busca manual (Fluxo 5.3.5.2).", "warning");
                    return;
                }
                pedido = pedidosBalcao.find(o => 
                    (o.customer_cpf && o.customer_cpf.includes(cpf)) ||
                    (o.third_party_cpf && o.third_party_cpf.includes(cpf))
                );
            }

            if (!pedido) {
                triggerToast("Não Localizado", "Nenhum pedido pronto para retirada encontrado para estes dados.", "warning");
                pedidoRetiradaLocalizado = null;
                atualizarCardConferenciaRetirada();
                return;
            }

            pedidoRetiradaLocalizado = pedido;
            atualizarCardConferenciaRetirada();
            triggerToast("Pedido Localizado (UC007)", `Pedido #${pedido.id} encontrado. Confira a documentação.`, "success");
        }

        function atualizarCardConferenciaRetirada() {
            const p = pedidoRetiradaLocalizado;
            const alertaTerceiro = document.getElementById('alerta-terceiro-balcao');

            if (!p) {
                document.getElementById('ret-pedido-id').innerText = "Nenhum pedido localizado";
                document.getElementById('ret-titular-dados').innerText = "Titular: ---";
                alertaTerceiro.classList.add('hidden');
                document.getElementById('chk-doc-conferido').checked = false;
                return;
            }

            document.getElementById('ret-pedido-id').innerText = `Pedido #${String(p.id).padStart(4, '0')} • ${p.product_name}`;
            document.getElementById('ret-titular-dados').innerText = `Titular Cadastrado: ${p.customer_name} (CPF: ${p.customer_cpf || '---'})`;

            if (p.third_party_name) {
                alertaTerceiro.classList.remove('hidden');
                document.getElementById('ret-terceiro-dados').innerText = `${p.third_party_name} — CPF: ${p.third_party_cpf}`;
            } else {
                alertaTerceiro.classList.add('hidden');
            }
        }

        // Executar UC007: Validar Retirada Presencial
        async function executarBaixaUC007() {
            if (!pedidoRetiradaLocalizado) {
                triggerToast("Atenção", "Localize um pedido pronto para entrega antes de dar baixa.", "warning");
                return;
            }

            const docConferido = document.getElementById('chk-doc-conferido').checked;
            if (!docConferido) {
                triggerToast("Segurança Obrigatória", "Confira a documentação física com foto antes de validar a entrega (Fluxo 5.3.4).", "warning");
                return;
            }

            const ehTerceiro = !!pedidoRetiradaLocalizado.third_party_name;

            try {
                const resp = await apiFetch('/api/orders/validate-pickup', {
                    method: 'POST',
                    body: JSON.stringify({
                        order_id: pedidoRetiradaLocalizado.id,
                        document_checked: true,
                        is_third_party: ehTerceiro
                    })
                });

                triggerToast("Entrega Concluída (UC007)", "Baixa presencial confirmada com sucesso!", "success");

                if (pedidoAtivo && pedidoAtivo.id === resp.order.id) {
                    pedidoAtivo = resp.order;
                    configurarLayoutStatusCliente(pedidoAtivo.status, pedidoAtivo.pickup_code);
                }

                pedidoRetiradaLocalizado = null;
                atualizarCardConferenciaRetirada();
                document.getElementById('input-busca-voucher').value = '';
                document.getElementById('input-busca-cpf').value = '';
                await recarregarPedidosBalcao();
            } catch (err) {
                triggerToast("Erro na Validação (UC007)", err.message, "warning");
            }
        }

        // Simulação de Abandono (7 dias)
        async function simularAbandonoPedido() {
            if (!pedidoRetiradaLocalizado) {
                triggerToast("Atenção", "Localize um pedido no balcão para simular a expiração por abandono.", "warning");
                return;
            }

            if (!confirm(`Simular abandono de 7 dias para o Pedido #${pedidoRetiradaLocalizado.id}? O item retornará ao estoque e a compra será cancelada.`)) {
                return;
            }

            try {
                const resp = await apiFetch(`/api/orders/${pedidoRetiradaLocalizado.id}/expire`, {
                    method: 'POST'
                });

                triggerToast("Regra de Abandono", "Pedido expirado. Item retornado à prateleira e estorno efetuado.", "warning");
                if (pedidoAtivo && pedidoAtivo.id === resp.order.id) {
                    pedidoAtivo = resp.order;
                    configurarLayoutStatusCliente(pedidoAtivo.status, null, null);
                }
                pedidoRetiradaLocalizado = null;
                atualizarCardConferenciaRetirada();
                await recarregarPedidosBalcao();
            } catch (err) {
                triggerToast("Erro na Operação", err.message, "warning");
            }
        }

        // Toast de Notificação
        function triggerToast(title, text, type) {
            const toast = document.getElementById('toast');
            const bg = document.getElementById('toast-icon-bg');
            const ic = document.getElementById('toast-icon');

            document.getElementById('toast-title').innerText = title;
            document.getElementById('toast-msg').innerText = text;

            if (type === 'success') {
                bg.className = "p-1 rounded bg-emerald-500 text-white text-xs flex items-center justify-center w-6 h-6";
                ic.className = "fa-solid fa-circle-check";
            } else {
                bg.className = "p-1 rounded bg-amber-500 text-slate-900 text-xs flex items-center justify-center w-6 h-6";
                ic.className = "fa-solid fa-triangle-exclamation";
            }

            toast.classList.remove('translate-y-24', 'opacity-0');
            setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 3500);
        }
