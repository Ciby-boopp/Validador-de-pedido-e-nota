# Vitalbor · Validador de Nota e Cotação

Sistema de página única (HTML + JavaScript, sem build) com:

- **Validar nota:** confere o pedido do cliente contra a nota fiscal.
- **Histórico** das análises, com PDF e CSV do período.
- **Cadastros:** produtos e preços, transportadoras e peças por caixa.
- **Cotação:** lê o PDF do pedido do cliente (ou lançamento manual), liga os itens ao cadastro, calcula caixas + peças, ICMS/IPI/PIS/COFINS por UF ou cidade, cadastra o cliente e gera o PDF da cotação.

## Estrutura

```
index.html   # o sistema inteiro
vercel.json  # cabeçalhos de segurança e noindex
robots.txt   # bloqueia indexação
```

## Publicar no GitHub

```bash
git init
git add .
git commit -m "Sistema Vitalbor: validador de nota e cotação"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/vitalbor-sistema.git
git push -u origin main
```

Crie o repositório como **privado**: o código contém a tabela de preços inicial e os dados da empresa.

## Publicar na Vercel

1. Em vercel.com, clique em **Add New > Project** e importe o repositório.
2. **Framework Preset:** Other. Deixe **Build Command** e **Output Directory** em branco.
3. Clique em **Deploy**. Cada `git push` na `main` publica de novo sozinho.

Em projeto privado, ative **Settings > Deployment Protection** para pedir login ou senha antes de abrir o site.

## Onde ficam os dados

Cadastros, histórico, clientes, cotações e equivalências ficam no **navegador** de quem usa (localStorage), separados por endereço e por computador. Ao abrir o site publicado pela primeira vez, ele começa só com a tabela inicial de produtos. Para levar os dados do arquivo local ou de um computador para outro, use **Exportar CSV** em Cadastros e **Importar lista** no destino.

## Bibliotecas externas (CDN)

jsPDF e pdf.js, carregados de `cdnjs.cloudflare.com`. É preciso internet para ler e gerar PDF.
