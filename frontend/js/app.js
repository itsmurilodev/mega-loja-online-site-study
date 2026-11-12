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

        // Inicialização
        window.onload = async () => {
            await carregarDadosBackend();
            executarFiltrosCombinados();
            renderizarLojasModal();
            atualizarLayoutFocoLoja();
            await recarregarPedidosBalcao();
        };

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
                    </div>`;
                return;
            }

            lista.forEach(p => {
                const qtdEstoque = p.estoques[lojaAtiva.id] || 0;
                const card = document.createElement('div');
                card.className = "bg-white border border-gray-200 rounded-2xl p-4 flex flex-col justify-between hover:shadow-xl transition-all duration-300 group";
                
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
                        <button onclick="carregarDetalhesProduto(${p.id})" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-xl text-xs transition-colors flex items-center justify-center gap-1">
                            Retirar na Loja <i class="fa-solid fa-chevron-right text-[9px]"></i>
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

            document.getElementById('detalhe-categoria').innerText = produtoSelecionado.categoria;
            document.getElementById('detalhe-nome').innerText = produtoSelecionado.nome;
            document.getElementById('detalhe-preco').innerText = `R$ ${produtoSelecionado.preco.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
            document.getElementById('detalhe-codigos').innerText = `SKU: ${produtoSelecionado.sku} | Cód. Barras: ${produtoSelecionado.barcode}`;
            document.getElementById('detalhe-imagem').src = produtoSelecionado.img;
            document.getElementById('detalhe-imagem').alt = produtoSelecionado.nome;
            renderizarFichaProduto(produtoSelecionado);

            atualizarLayoutFocoLoja();
            mudarAba('detalhe');
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
            executarFiltrosCombinados();
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
            const query = document.getElementById('input-busca').value.toLowerCase().trim();
            if (query) {
                resultado = resultado.filter(p => p.nome.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query));
            }
            renderizarVitrine(resultado);
        }

        // Alternância de Atores (Cliente vs Operador de Balcão)
        function alternarAtor(ator) {
            const btnC = document.getElementById('btn-visao-cliente');
            const btnB = document.getElementById('btn-visao-balcao');

            if (ator === 'cliente') {
                btnC.className = "bg-white text-gray-900 font-bold px-3 py-1.5 rounded-lg shadow-sm transition-all flex items-center gap-1.5";
                btnB.className = "text-gray-500 hover:text-gray-900 font-semibold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5";
                document.getElementById('wrapper-banner').classList.remove('hidden');
                mudarAba(pedidoAtivo ? 'sucesso' : 'vitrine');
            } else {
                btnB.className = "bg-white text-gray-900 font-bold px-3 py-1.5 rounded-lg shadow-sm transition-all flex items-center gap-1.5";
                btnC.className = "text-gray-500 hover:text-gray-900 font-semibold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5";
                document.getElementById('wrapper-banner').classList.add('hidden');
                mudarAba('balcao');
                recarregarPedidosBalcao();
            }
        }

        function mudarAba(destino) {
            ['vitrine', 'detalhe', 'sucesso', 'balcao'].forEach(aba => {
                document.getElementById(`aba-${aba}`)?.classList.add('hidden');
            });
            document.getElementById(`aba-${destino}`)?.classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
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
            document.getElementById('nav-loja-nome').innerText = lojaAtiva.nome.replace('MegaLoja - Filial ', '');
            document.getElementById('txt-status-loja-nome').innerText = lojaAtiva.nome;
            document.getElementById('txt-balcao-loja-nome').innerText = lojaAtiva.nome;

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
