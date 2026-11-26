# Validador de Nota · Vitalbor — nuvem, login e Omie

Sem configurar nada, o `index.html` funciona como antes: tudo fica no navegador, sem login e sem Omie.
Ligado à nuvem (Supabase), ele passa a ter:

- **Entrada com a conta Google**, só para os e-mails que o gestor liberar, cada um com um perfil.
- **Dados compartilhados**: cadastros, histórico de conferências e cotações iguais para todo mundo.
- **Pedidos na Omie**: a carteira de pedidos de venda direto da Omie.
- **Conferir e faturar**: o pedido da Omie vira o lado "nota" da conferência; com 100% OK, quem tem perfil de faturamento fatura na Omie pelo próprio validador.

| Perfil | Pode |
|---|---|
| Gestor | Tudo, inclusive liberar e-mails, ver a auditoria e enviar dados para a nuvem |
| Faturamento | Conferir e faturar na Omie, mexer em cadastros e cotações |
| Comercial | Conferir, cotações e cadastros. Não fatura |
| Só leitura | Vê tudo, não altera nada |

---

## Antes de tudo: segurança

1. **A chave da Omie do print está exposta.** Na mesma tela do print, clique em **Gerar nova chave de acesso**. A antiga para de funcionar.
2. A nova **App Secret** não vai para o chat, nem para o `index.html`, nem para o GitHub. Ela vai **só** nos segredos da função, no passo 4.
3. No `index.html` vai apenas a chave **publishable** (ou "anon") do Supabase. Nunca a chave secreta (`sb_secret_...` ou `service_role`). Se colar a errada, o validador se recusa a abrir e avisa.
4. Confirme que o aplicativo da Omie tem o **plano de API** ativo.

---

## Passo a passo (uma vez, uns 40 minutos)

### 1. Criar o projeto no Supabase
Em supabase.com, crie um projeto (região **South America (São Paulo)**). Guarde a senha do banco.

### 2. Criar as tabelas
1. Abra o arquivo `supabase/01_estrutura.sql` e, na **última parte**, troque `SEU-EMAIL@gmail.com` e `Seu nome` pelo **seu e-mail Google** e seu nome. Esse é o primeiro gestor.
2. No Supabase: **SQL Editor › New query**, cole o arquivo inteiro e clique em **Run**. Tem que aparecer "Success".

### 3. Entrada com Google
1. No Supabase, abra **Authentication › Sign In / Providers › Google** e copie a **Callback URL** (algo como `https://SEU-PROJETO.supabase.co/auth/v1/callback`).
2. No Google Cloud Console (console.cloud.google.com), crie um projeto e configure a **tela de consentimento OAuth**:
   - Se a empresa usa Google Workspace, escolha **Interno**: só contas da empresa conseguem entrar.
   - Se a equipe usa Gmail, escolha **Externo** e coloque os e-mails da equipe como usuários de teste (ou publique o app).
3. Em **Credenciais › Criar credenciais › ID do cliente OAuth › Aplicativo da Web**:
   - **Origens JavaScript autorizadas**: o endereço do validador, só o domínio. Ex.: `https://seuusuario.github.io`
   - **URIs de redirecionamento autorizados**: a Callback URL do item 1.
4. Copie o **ID do cliente** e a **chave secreta do cliente** para a tela do Google no Supabase (item 1), ative e salve.
5. Em **Authentication › Sign In / Providers › Email**, **desative**. O sistema só aceita entrada pelo Google (o banco também confere isso), mas desligar evita contas de e-mail e senha soltas.
6. Em **Authentication › URL Configuration**:
   - **Site URL**: o endereço completo do validador, como você abre no navegador. Ex.: `https://seuusuario.github.io/validador/`
   - **Redirect URLs**: adicione o mesmo endereço e também `https://seuusuario.github.io/**` (vale para qualquer página do seu GitHub Pages, com ou sem `index.html` no fim).

### 4. Publicar a função que fala com a Omie
1. No Supabase: **Edge Functions › Deploy a new function › Via Editor**.
2. Nome: `omie` (exatamente assim). Apague o exemplo, cole o conteúdo de `supabase/functions/omie/index.ts` e clique em **Deploy**.
3. Em **Edge Functions › Secrets**, adicione três segredos:
   - `OMIE_APP_KEY`: a App Key **nova**
   - `OMIE_APP_SECRET`: a App Secret **nova**
   - `ORIGENS_PERMITIDAS`: o domínio do validador, sem o caminho. Ex.: `https://seuusuario.github.io`
4. Deixe a opção **Verify JWT** como veio. Se o validador mostrar erro 401 mesmo com você logado, desligue essa opção nos detalhes da função: a própria função confere o login e o perfil em toda chamada.

### 5. Ligar o validador
1. No Supabase: **Project Settings › API Keys**. Copie a **Project URL** e a chave **publishable** (`sb_publishable_...`). Se o projeto só mostrar as chaves antigas, use a **anon**.
2. Abra o `index.html` num editor de texto (Bloco de Notas serve). Logo no topo há:
   ```
   const SB_URL = '';
   const SB_KEY = '';
   ```
   Cole os dois valores entre as aspas e salve.
3. Publique no GitHub Pages no lugar do arquivo antigo.
4. Abra o endereço, clique em **Entrar com Google** e entre com o e-mail que você colocou no SQL.

### 6. Primeiros ajustes (como gestor)
1. **Levar os dados antigos**: no computador onde o validador era usado, abra **Configurações › Levar dados para a nuvem**. Na primeira vez, marque **Substituir os cadastros que já estão na nuvem**, porque a nuvem começa com a tabela de preços padrão. Histórico e cotações são sempre somados. Também dá para enviar uma cópia de segurança (arquivo `.json`).
2. **Liberar a equipe**: **Configurações › Acesso ao sistema**. E-mail Google, nome e perfil.
3. **Testar a Omie**: **Configurações › Omie › Testar a conexão com a Omie**.
4. **Texto do cenário fiscal**: se o cenário fiscal da Omie coloca um texto fixo nas informações complementares da nota (o do diferimento no PR, por exemplo), cole em **Configurações › Omie**. A conferência conta com ele.

---

## No dia a dia (faturamento)

1. **Pedidos na Omie** › mostrar **Prontos para faturar**.
2. **Conferir** no pedido. O pedido da Omie preenche o lado da nota e fica travado: para corrigir algo, altere na Omie e clique em **Recarregar da Omie**.
3. Anexe o **pedido do cliente** do lado esquerdo e clique em **Validar nota**.
4. Com **100% OK**, clique em **Faturar na Omie** e confirme. A Omie emite a NF-e e envia para a SEFAZ. O pedido passa para "Faturado" na Omie quando a SEFAZ autoriza.

### O que o servidor confere antes de faturar
O faturamento só sai se **tudo** isso for verdade, e quem confere é a função no servidor, não o navegador:

- quem pediu tem perfil Faturamento ou Gestor e entrou pelo Google;
- existe uma conferência deste pedido, 100% OK, feita há no máximo 30 minutos e ainda não faturada;
- o pedido na Omie, consultado na hora, está **igual** ao que foi conferido: itens, quantidades, preços, impostos, cliente, frete, parcelas e informações. Só etapa e datas de controle podem mudar. Se mudou, ele diz o quê;
- a Omie não indica o pedido como faturado ou cancelado;
- a própria Omie aprova o pedido para faturamento (validação dela);
- uma gravação por vez na Omie.

Toda tentativa de faturar fica registrada (quem, quando, resposta da Omie) em **Configurações › Omie › Ver as últimas gravações na Omie**.

**O que essa trava não faz:** ela evita erro, não fraude. Quem tem acesso de faturamento na Omie consegue faturar direto lá. O validador também não cancela nota: cancelamento continua só na Omie, de propósito.

---

## Cuidados (leia antes do primeiro faturamento)

- **Os nomes dos campos do pedido da Omie foram mapeados pela documentação e por integrações públicas, não por um pedido real da Vitalbor.** Antes do primeiro faturamento:
  1. Em **Pedidos na Omie**, abra um pedido real (**Abrir**) e clique em **Ver dados da Omie**. É o pedido exatamente como a Omie devolve.
  2. Clique em **Conferir** nesse pedido e veja se cliente, UF, cidade, itens, impostos, volumes, pesos, transportadora e vencimento aparecem certos no lado da nota.
  3. Se algo vier vazio ou errado, me mande esses dados (pode apagar CNPJ e nomes) e eu ajusto o mapeamento.
  4. Faça o primeiro faturamento com alguém olhando a tela da Omie.
- **Supabase gratuito**: o projeto pausa depois de 7 dias sem uso (dá para reativar no painel) e **não tem backup automático**. Exporte a cópia de segurança toda semana (**Configurações › Exportar tudo**) ou assine o plano Pro (US$ 25/mês, backup diário de 7 dias).
- **Limites da Omie**: a mesma consulta repetida em menos de 60 segundos é recusada pela Omie, então o sistema guarda cada consulta por 60 s. Se pedir para esperar, o botão conta os segundos sozinho.
- **Carteira**: mostra até 1.500 pedidos do período escolhido.
- **Gestão de pedidos antiga**: continua só no navegador onde foi usada, como "Gestão antiga". A carteira da Omie substitui ela.

## Próxima etapa: lançar pedidos na Omie
Lançar um pedido na Omie a partir da cotação precisa de dados da configuração da Vitalbor na Omie (categoria, conta corrente, cenário fiscal, condições de pagamento) e do código de cada produto na Omie. Com um pedido real em mãos (o "Ver os dados" acima), dá para montar isso sem chutar.

## Arquivos
- `index.html`: o sistema (vai para o GitHub Pages).
- `supabase/01_estrutura.sql`: tabelas e regras de acesso do banco.
- `supabase/functions/omie/index.ts`: a função que fala com a Omie. É a única parte que conhece a chave da Omie.
