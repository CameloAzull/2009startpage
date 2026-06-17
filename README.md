# VIVAZ — startpage pessoal (estética 2009, arquitetura 2026)

Startpage pessoal pronta para publicar no GitHub Pages. Notícias, esportes,
Spotify, busca, favoritos, notas, clima e câmbio — tudo num único
`index.html`, com uma camada opcional de pré-processamento via GitHub
Actions para tornar o módulo de notícias praticamente imune a CORS e a
rate limit de proxy público.

## 1. Publicar (uso mínimo, sem configurar nada)

1. Crie um repositório no GitHub (ex.: `usuario/vivaz`).
2. Suba **todo o conteúdo desta pasta** (`index.html`, `data/`, `scripts/`,
   `.github/`, `package.json`) para a branch principal.
3. Em **Settings → Pages**, selecione a branch principal e a pasta raiz (`/`).
4. Acesse `https://usuario.github.io/vivaz/`.

Funciona assim, do zero, sem nenhuma configuração adicional. O arquivo
`data/news.json` enviado é só uma semente vazia — a página detecta isso
automaticamente e busca as notícias ao vivo direto do navegador (camada 2,
explicada abaixo).

## 2. Ativar a camada de pré-processamento (recomendado)

Isso elimina por completo a dependência de proxies públicos de RSS no
módulo de notícias — o ponto mais frágil de qualquer startpage hospedada
estaticamente.

1. Em **Settings → Actions → General → Workflow permissions**, marque
   **"Read and write permissions"** (o workflow precisa commitar
   `data/news.json` de volta no repositório).
2. Em **Actions**, rode o workflow **"Atualizar notícias"** manualmente uma
   vez (`Run workflow`) — ou espere até 30 minutos pelo agendamento automático.
3. A partir daí, `data/news.json` passa a ser atualizado automaticamente a
   cada 30 minutos, e o `index.html` o lê como fonte primária (mesma
   origem — zero CORS, zero limite de requisições de terceiro).

Se você não fizer nada, a página continua funcionando — só passa a
depender mais de um proxy público de RSS para o módulo de notícias, que é
menos estável (ver seção 4).

## 3. Estrutura

```
index.html                          ← a página inteira (HTML+CSS+JS embutidos)
data/news.json                      ← semente vazia; o Action sobrescreve isso
scripts/fetch-news.mjs              ← roda dentro do Action; busca RSS e normaliza
.github/workflows/update-news.yml   ← agenda o Action a cada 30 min
package.json                        ← só a dependência do script (fast-xml-parser)
```

## 4. Fontes de dados, status e estratégia de fallback

| Módulo            | Fonte                                  | Chave de API | Camadas de resiliência |
|--------------------|-----------------------------------------|:---:|---|
| Notícias (G1)       | g1.globo.com/rss/g1/\*                  | não | (1) `data/news.json` via Action → (2) RSS ao vivo via rss2json/allorigins → (3) cache local (`localStorage`) → (4) link de saída |
| RSS · Outras Fontes | cnnbrasil.com.br/feed (e categorias)    | não | mesmas 4 camadas acima |
| Esportes (tabelas)  | TheSportsDB `lookuptable.php` (chave pública `3`) | não | live → cache local → link de saída |
| Esportes (resultados)| TheSportsDB `eventspastleague.php`    | não | live → cache local → bloco fica oculto se não houver nada confiável |
| F1                  | Jolpica (sucessor do Ergast)           | não | live → cache local → link de saída |
| Clima               | Open-Meteo                             | não | live → cache local → mensagem de indisponível |
| Câmbio              | AwesomeAPI                              | não | live → cache local → mensagem de indisponível |
| Spotify              | embed oficial `open.spotify.com/embed` | não | URL configurável pelo usuário (salva no `localStorage`); link inválido nunca substitui o player anterior |
| Busca, favoritos, notas | locais (`localStorage`)            | —   | não dependem de rede |

**Por que rss2json e allorigins.win NUNCA são a fonte principal:** o plano
gratuito do rss2json sem chave de API tem um limite de uso muito agressivo
na prática (a própria documentação recomenda registrar uma chave para uso
sério); allorigins.win não publica nenhuma garantia de uptime. Os dois são
tratados como **contingência de navegador**, nunca como arquitetura
principal — daí a camada 1 (JSON pré-processado pelo Action, mesma
origem) descrita na seção 2.

**Por que TheSportsDB com a chave pública `3` é aceitável aqui:** ao
contrário do rss2json, essa chamada roda no navegador de cada visitante
(não num servidor compartilhado), então o limite de uso é por IP do
visitante, não uma cota global compartilhada por todos os usuários da
página — risco bem menor.

## 5. O que acontece quando uma fonte falha (testado)

Cada módulo segue a mesma regra: tenta a fonte ao vivo → se falhar, mostra
o último dado válido conhecido (rotulado com a hora, ex. "em cache · há 12
min") → se nunca houve dado válido, mostra uma mensagem honesta com link
de saída para a fonte original. Nenhum módulo finge estar atualizado
quando não está, e nenhum módulo trava a página (todas as chamadas de
rede têm timeout via `AbortController`).

## 6. Limitações reais

- GitHub Pages não tem backend: tudo aqui é estático ou roda no navegador
  do visitante (ou, opcionalmente, no GitHub Action agendado).
- O Spotify embed precisa que o usuário tenha uma sessão/app do Spotify
  para reproduzir (comportamento padrão do player oficial, não uma
  limitação desta página).
- O Action de notícias depende de `Settings → Actions → Workflow
  permissions` estar como "Read and write" — sem isso, o commit automático
  falha silenciosamente (a página continua funcionando pela camada 2).
- `file://` local (abrir o HTML direto, sem servidor) não é o ambiente de
  produção alvo; alguns `fetch` podem se comportar de forma diferente do
  que em `https://`. Use `python3 -m http.server` ou similar para testar
  localmente antes de publicar.
