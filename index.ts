// =====================================================================
//  Função "omie" — a única parte do sistema que conhece a chave da Omie.
//
//  Cada chamada do validador chega com o login (Google) de quem está usando.
//  A função confere se o e-mail está liberado e qual o perfil, repassa à Omie
//  só as consultas da lista abaixo e registra tudo que grava na Omie.
//  A única gravação possível é faturar um pedido conferido 100% OK.
//
//  Segredos (Supabase › Edge Functions › Secrets):
//    OMIE_APP_KEY, OMIE_APP_SECRET  → chave da Omie (gere uma nova e cole só aqui)
//    ORIGENS_PERMITIDAS             → endereço do validador, ex.: https://seuusuario.github.io
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_OMIE = 'https://app.omie.com.br/api/v1/';
const APP_KEY = Deno.env.get('OMIE_APP_KEY') ?? '';
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET') ?? '';
const ORIGENS = (Deno.env.get('ORIGENS_PERMITIDAS') ?? '*').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

// Chave de servidor do Supabase: formato antigo (service_role) ou novo (sb_secret_...)
function chaveServidor(): string {
  const antiga = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (antiga) return antiga;
  try {
    const novas = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    return novas.default ?? Object.values(novas)[0] ?? '';
  } catch { return ''; }
}
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', chaveServidor(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Consultas liberadas para qualquer perfil ativo. Qualquer outra chamada é recusada.
const LEITURA: Record<string, string[]> = {
  'produtos/pedido': ['ListarPedidos', 'ConsultarPedido', 'StatusPedido'],
  'produtos/pedidovendafat': ['ObterPedidosVenda', 'ValidarPedidoVenda'],
  'produtos/etapafat': ['ListarEtapasFaturamento'],
  'geral/clientes': ['ConsultarCliente', 'ListarClientes'],
  'geral/produtos': ['ConsultarProduto', 'ListarProdutos'],
  'produtos/nfconsultar': ['ListarNF', 'ConsultarNF'],
};
const PODE_FATURAR = ['gestor', 'faturamento'];
const CACHE_SEG = 60;     // a Omie recusa a mesma consulta repetida em menos de 60 s
const VALIDADE_MIN = 30;  // conferência mais antiga que isso precisa ser refeita antes de faturar

type Usuario = { email: string; papel: string };
type RespOmie = { ok: boolean; dados: any; erro: string; cache?: boolean };

function cabecalhos(origem: string | null): Record<string, string> {
  const o = (origem ?? '').replace(/\/$/, '');
  const permitido = ORIGENS.includes('*') ? '*' : ORIGENS.includes(o) ? o : ORIGENS[0] ?? 'null';
  return {
    'Access-Control-Allow-Origin': permitido,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}
const responder = (h: Record<string, string>, status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...h, 'Content-Type': 'application/json; charset=utf-8' } });

async function chamarOmie(endpoint: string, call: string, param: unknown): Promise<RespOmie> {
  try {
    const r = await fetch(URL_OMIE + endpoint + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param ?? {}] }),
    });
    let j: any = null;
    try { j = await r.json(); } catch { /* resposta sem JSON */ }
    const falha = j?.faultstring ? String(j.faultstring) : !r.ok ? 'HTTP ' + r.status : '';
    return { ok: !falha, dados: j, erro: falha };
  } catch (e) {
    return { ok: false, dados: null, erro: 'Sem resposta da Omie: ' + (e as Error).message };
  }
}

const semRegistros = (m: string) => /n[ãa]o existem registros|nenhum registro/i.test(m);
const redundante = (m: string) => /redundante/i.test(m);
const limite = (m: string) => /too many|consumo indevido|bloquead[oa] (por|temporariamente)/i.test(m);
function mensagemAmigavel(m: string): string {
  if (redundante(m)) return 'A Omie pediu um intervalo entre consultas iguais. Tente de novo em alguns segundos.';
  if (limite(m)) return 'A Omie bloqueou temporariamente por excesso de chamadas. Aguarde alguns minutos.';
  return m.replace(/^ERROR:\s*/i, '');
}
// Algumas respostas da Omie trazem código de situação: "0" é sucesso.
function situacao(d: any): { codigo: string; texto: string } | null {
  const codigo = d?.cCodStatus ?? d?.codigo_status;
  if (codigo === undefined || codigo === null) return null;
  return { codigo: String(codigo), texto: String(d?.cDescStatus ?? d?.descricao_status ?? '') };
}
const sucesso = (s: { codigo: string } | null) => !s || /^0+$/.test(s.codigo);

const chaveCache = (endpoint: string, call: string, param: unknown) => endpoint + ':' + call + ':' + JSON.stringify(param ?? {});
async function lerComCache(endpoint: string, call: string, param: unknown): Promise<RespOmie> {
  const chave = chaveCache(endpoint, call, param);
  const { data: c } = await admin.from('omie_cache').select('resposta, em').eq('chave', chave).maybeSingle();
  if (c && Date.now() - new Date(c.em).getTime() < CACHE_SEG * 1000) return { ok: true, dados: c.resposta, erro: '', cache: true };
  const r = await chamarOmie(endpoint, call, param);
  if (!r.ok && semRegistros(r.erro)) return { ok: true, dados: { vazio: true, mensagem: r.erro }, erro: '' };
  if (!r.ok && redundante(r.erro) && c) return { ok: true, dados: c.resposta, erro: '', cache: true };
  if (r.ok) await admin.from('omie_cache').upsert({ chave, resposta: r.dados, em: new Date().toISOString() });
  return r;
}

async function travar(): Promise<boolean> {
  const agora = new Date();
  const { data } = await admin.from('omie_trava')
    .update({ ate: new Date(agora.getTime() + 45_000).toISOString() })
    .eq('id', 1).lt('ate', agora.toISOString()).select('id');
  return !!(data && data.length);
}
async function soltar() {
  await admin.from('omie_trava').update({ ate: new Date(0).toISOString() }).eq('id', 1);
}
async function registrar(u: Usuario, endpoint: string, call: string, param: unknown, r: RespOmie) {
  await admin.from('omie_log').insert({ email: u.email, papel: u.papel, endpoint, chamada: call, parametros: param, ok: r.ok, resposta: r.dados });
}

// ---------- o pedido mudou desde a conferência? ----------
// Ignora só o que muda sem mexer na nota: etapa do kanban e datas de controle.
function semControle(pv: any) {
  const c = JSON.parse(JSON.stringify(pv ?? {}));
  delete c.infoCadastro;
  if (c.cabecalho) delete c.cabecalho.etapa;
  return c;
}
function iguais(a: any, b: any): boolean {
  if (a === b) return true;
  const vazio = (x: any) => x === null || x === undefined || x === '';
  if (vazio(a) && vazio(b)) return true;
  const na = Number(a), nb = Number(b);
  return typeof a !== 'object' && typeof b !== 'object' && !vazio(a) && !vazio(b) && isFinite(na) && isFinite(nb) && na === nb;
}
function diferencas(a: any, b: any, caminho: (string | number)[] = [], saida: (string | number)[][] = []) {
  if (saida.length >= 12) return saida;
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a : [], y = Array.isArray(b) ? b : [];
    if (x.length !== y.length) saida.push([...caminho, '#']);
    for (let i = 0; i < Math.min(x.length, y.length); i++) diferencas(x[i], y[i], [...caminho, i], saida);
    return saida;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) diferencas(a[k], b[k], [...caminho, k], saida);
    return saida;
  }
  if (!iguais(a, b)) saida.push(caminho);
  return saida;
}
function nomeDoCampo(c: (string | number)[]): string {
  const [g, i, s, campo] = c;
  if (g === 'det') {
    if (i === '#') return 'quantidade de itens';
    const item = 'item ' + (Number(i) + 1);
    if (campo === 'quantidade') return 'quantidade do ' + item;
    if (campo === 'valor_unitario') return 'preço do ' + item;
    if (s === 'produto') return 'produto do ' + item;
    if (s === 'imposto') return 'impostos do ' + item;
    return item;
  }
  if (g === 'frete') return 'frete/transportadora';
  if (g === 'cabecalho' && i === 'codigo_cliente') return 'cliente';
  if (g === 'cabecalho' && i === 'data_previsao') return 'previsão de faturamento';
  if (g === 'lista_parcelas') return 'parcelas';
  if (g === 'total_pedido') return 'totais';
  if (g === 'informacoes_adicionais') return 'informações adicionais';
  return c.join('.');
}

async function faturar(u: Usuario, corpo: any, h: Record<string, string>) {
  if (!PODE_FATURAR.includes(u.papel)) return responder(h, 403, { erro: 'Seu perfil não pode faturar.' });
  const cod = Number(corpo?.codigo_pedido), hid = Number(corpo?.historico_id);
  if (!cod || !hid) return responder(h, 400, { erro: 'Pedido ou conferência não informados.' });

  // 1) A conferência precisa ser deste pedido, estar 100% OK, ser recente e ainda não faturada
  const { data: conf } = await admin.from('historico').select('*').eq('id', hid).maybeSingle();
  if (!conf || !conf.ok || !conf.liberada || Number(conf.omie_codigo_pedido) !== cod || !conf.omie_snapshot) {
    return responder(h, 409, { erro: 'A conferência deste pedido não está 100% OK.' });
  }
  if (conf.faturado_em) {
    const quando = new Date(conf.faturado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return responder(h, 409, { erro: 'Este pedido já foi faturado pelo validador em ' + quando + ' por ' + conf.faturado_por + '.' });
  }
  if (Date.now() - new Date(conf.atualizado_em ?? conf.criado_em).getTime() > VALIDADE_MIN * 60_000) {
    return responder(h, 409, { erro: 'A conferência tem mais de ' + VALIDADE_MIN + ' minutos. Confira de novo antes de faturar.' });
  }

  // 2) Uma gravação por vez na Omie
  if (!(await travar())) return responder(h, 429, { erro: 'Outra gravação na Omie está em andamento. Tente em alguns segundos.', espera: 10 });
  try {
    // 3) Consulta o pedido agora, direto na Omie (sem cache), e compara com o que foi conferido
    const param = { codigo_pedido: cod };
    const atual = await chamarOmie('produtos/pedido', 'ConsultarPedido', param);
    if (!atual.ok && redundante(atual.erro)) {
      const { data: c } = await admin.from('omie_cache').select('em').eq('chave', chaveCache('produtos/pedido', 'ConsultarPedido', param)).maybeSingle();
      const passou = c ? (Date.now() - new Date(c.em).getTime()) / 1000 : 0;
      const espera = Math.min(62, Math.max(5, Math.ceil(CACHE_SEG - passou) + 2));
      return responder(h, 429, { erro: 'A Omie só deixa consultar este pedido de novo daqui a ' + espera + ' segundos. Clique em Faturar depois disso.', espera });
    }
    if (!atual.ok) return responder(h, 502, { erro: 'Não consegui consultar o pedido na Omie: ' + mensagemAmigavel(atual.erro) });
    await admin.from('omie_cache').upsert({ chave: chaveCache('produtos/pedido', 'ConsultarPedido', param), resposta: atual.dados, em: new Date().toISOString() });
    const pv = atual.dados?.pedido_venda_produto ?? atual.dados;
    if (String(pv?.infoCadastro?.faturado ?? '') === 'S') return responder(h, 409, { erro: 'A Omie indica que este pedido já está faturado.' });
    if (String(pv?.infoCadastro?.cancelado ?? '') === 'S') return responder(h, 409, { erro: 'A Omie indica que este pedido está cancelado.' });
    const mudou = [...new Set(diferencas(semControle(conf.omie_snapshot), semControle(pv)).map(nomeDoCampo))];
    if (mudou.length) {
      return responder(h, 409, { erro: 'O pedido mudou na Omie depois da conferência (' + mudou.slice(0, 5).join(', ') + '). Abra o pedido de novo e confira antes de faturar.', mudou });
    }

    // 4) A própria Omie valida o pedido para faturamento
    const v = await chamarOmie('produtos/pedidovendafat', 'ValidarPedidoVenda', { nCodPed: cod });
    const sv = situacao(v.dados);
    if (v.ok && !sucesso(sv)) v.ok = false;
    await registrar(u, 'produtos/pedidovendafat', 'ValidarPedidoVenda', { nCodPed: cod, historico_id: hid }, v);
    if (!v.ok) return responder(h, 422, { erro: 'A Omie recusou o pedido: ' + mensagemAmigavel(v.erro || sv?.texto || 'sem detalhes'), omie: v.dados });

    // 5) Fatura: a Omie gera a NF-e e envia para a SEFAZ
    const f = await chamarOmie('produtos/pedidovendafat', 'FaturarPedidoVenda', { nCodPed: cod });
    const sf = situacao(f.dados);
    if (f.ok && !sucesso(sf)) {
      f.ok = false;
      await registrar(u, 'produtos/pedidovendafat', 'FaturarPedidoVenda', { nCodPed: cod, historico_id: hid }, f);
      return responder(h, 422, { erro: 'A Omie respondeu "' + (sf?.texto || 'sem detalhes') + '" (código ' + sf?.codigo + '). Confira o pedido na Omie antes de tentar de novo.', omie: f.dados });
    }
    await registrar(u, 'produtos/pedidovendafat', 'FaturarPedidoVenda', { nCodPed: cod, historico_id: hid }, f);
    if (!f.ok) return responder(h, 422, { erro: 'A Omie não faturou: ' + mensagemAmigavel(f.erro) + '. Confira o pedido na Omie antes de tentar de novo.', omie: f.dados });

    await admin.from('historico').update({ faturado_em: new Date().toISOString(), faturado_por: u.email, omie_resposta: f.dados }).eq('id', hid);
    return responder(h, 200, { ok: true, dados: f.dados });
  } finally {
    await soltar();
  }
}

// Só vale login feito pelo Google (mesma regra do banco)
function entrouPeloGoogle(jwt: string, user: any): boolean {
  const provedores: string[] = user?.app_metadata?.providers ?? [];
  if (!provedores.includes('google')) return false;
  try {
    const b = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4)));
    return (claims.amr ?? []).some((a: any) => (typeof a === 'string' ? a : a?.method) === 'oauth');
  } catch { return false; }
}

Deno.serve(async (req) => {
  const h = cabecalhos(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return responder(h, 405, { erro: 'Use POST.' });
  if (!APP_KEY || !APP_SECRET) return responder(h, 500, { erro: 'A chave da Omie não está configurada no servidor (OMIE_APP_KEY e OMIE_APP_SECRET).' });

  // Quem está chamando?
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return responder(h, 401, { erro: 'Sua sessão expirou. Entre de novo no sistema.' });
  const { data: ud, error } = await admin.auth.getUser(jwt);
  const email = ud?.user?.email?.toLowerCase();
  if (error || !email) return responder(h, 401, { erro: 'Sua sessão expirou. Entre de novo no sistema.' });
  if (!entrouPeloGoogle(jwt, ud.user)) return responder(h, 403, { erro: 'Entre com a sua conta Google para usar a Omie pelo validador.' });
  const { data: perfil } = await admin.from('usuarios').select('papel, ativo').eq('email', email).maybeSingle();
  if (!perfil?.ativo) return responder(h, 403, { erro: 'Seu e-mail não está liberado no sistema.' });
  const u: Usuario = { email, papel: perfil.papel };

  let corpo: any;
  try { corpo = await req.json(); } catch { return responder(h, 400, { erro: 'Pedido inválido.' }); }

  if (corpo?.acao === 'faturar') return faturar(u, corpo, h);

  const { endpoint, call, param } = corpo ?? {};
  if (!(LEITURA[endpoint] ?? []).includes(call)) return responder(h, 403, { erro: 'Chamada não liberada: ' + endpoint + ' / ' + call });
  const r = await lerComCache(endpoint, call, param);
  if (Math.random() < 0.02) await admin.from('omie_cache').delete().lt('em', new Date(Date.now() - 86_400_000).toISOString());
  return r.ok
    ? responder(h, 200, { ok: true, dados: r.dados, cache: !!r.cache })
    : responder(h, 502, { erro: mensagemAmigavel(r.erro), omie: r.dados });
});
