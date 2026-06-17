// scripts/fetch-news.mjs
//
// Roda dentro do GitHub Action (.github/workflows/update-news.yml), em
// horário agendado. Busca os feeds RSS diretamente (sem proxy — o runner
// do GitHub Actions não tem o problema de CORS que o navegador tem) e
// grava o resultado normalizado em data/news.json, no próprio repositório.
//
// Por que isso existe:
//   - rss2json.com sem chave de API tem limite de uso muito agressivo
//     (na prática, poucas conversões por período antes de devolver 429).
//   - allorigins.win não tem SLA de uptime e cai com frequência.
//   - Um GitHub Action agendado elimina os dois problemas: o navegador do
//     usuário final passa a ler um JSON estático do próprio domínio
//     (zero CORS, zero rate limit, zero dependência de terceiro instável).
//
// Se este script falhar (rede fora, feed mudou de formato, etc.), o
// index.html NÃO trava: ele simplesmente não encontra itens para aquela
// categoria na camada 1 e cai para a camada 2 (proxy ao vivo, no browser).

import { writeFile, mkdir } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';

const FEEDS = {
  // G1 — fonte principal de notícias (coração do produto)
  brasil:       'https://g1.globo.com/rss/g1/brasil/',
  rj:           'https://g1.globo.com/rss/g1/rio-de-janeiro/',
  mundo:        'https://g1.globo.com/rss/g1/mundo/',
  economia:     'https://g1.globo.com/rss/g1/economia/',
  tech:         'https://g1.globo.com/rss/g1/tecnologia/',
  pop:          'https://g1.globo.com/rss/g1/pop-arte/',
  // CNN Brasil — diversificação de fonte para o módulo "RSS · Outras Fontes"
  // (propositalmente diferente do G1, que já cobre a coluna central)
  'rss-geral':  'https://www.cnnbrasil.com.br/feed/',
  'rss-mundo2': 'https://www.cnnbrasil.com.br/internacional/feed/',
  'rss-tech2':  'https://www.cnnbrasil.com.br/tecnologia/feed/',
};

const ITENS_POR_CATEGORIA = 12;
const TIMEOUT_MS = 15000;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function limparHtml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

async function buscarFeed(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'VivazPortalBot/1.0 (+https://github.com/; startpage pessoal, uso nao-comercial)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const xml = await res.text();
  const dados = parser.parse(xml);
  const canal = dados?.rss?.channel || dados?.feed; // tolera Atom básico também
  let itens = canal?.item ?? canal?.entry ?? [];
  if (!Array.isArray(itens)) itens = [itens];

  return itens.slice(0, ITENS_POR_CATEGORIA).map((it) => {
    const link = typeof it.link === 'string' ? it.link
      : (it.link?.['@_href'] || it.link?.href || '');
    const enclosureUrl =
      it.enclosure?.['@_url'] ||
      it['media:content']?.['@_url'] ||
      '';
    return {
      title: limparHtml(it.title),
      link: String(link || '').trim(),
      pubDate: String(it.pubDate || it.published || it.updated || '').trim(),
      description: limparHtml(it.description || it.summary),
      enclosure: { link: enclosureUrl },
    };
  }).filter((it) => it.title && it.link);
}

async function carregarJsonAnterior() {
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile('data/news.json', 'utf-8');
    const json = JSON.parse(raw);
    return (json && json.categorias) ? json.categorias : {};
  } catch (e) {
    return {}; // primeira execução — sem histórico ainda, e está tudo bem
  }
}

async function main() {
  const anterior = await carregarJsonAnterior();
  const categorias = {};
  let falhas = 0;

  for (const [chave, url] of Object.entries(FEEDS)) {
    try {
      const itens = await buscarFeed(url);
      if (itens.length > 0) {
        categorias[chave] = itens;
        console.log(`OK   ${chave.padEnd(12)} ${itens.length} itens`);
      } else {
        throw new Error('feed retornou 0 itens válidos');
      }
    } catch (erro) {
      falhas++;
      // Falha pontual nesta categoria: preserva o snapshot anterior em vez
      // de zerar — uma categoria ruim numa execução não deve apagar dados
      // bons só porque essa rodada específica teve problema.
      categorias[chave] = anterior[chave] || [];
      console.error(`FALHA ${chave.padEnd(12)} ${erro.message} — mantendo snapshot anterior (${categorias[chave].length} itens)`);
    }
  }

  const totalFeeds = Object.keys(FEEDS).length;

  if (falhas === totalFeeds) {
    // Não sobrescreve o último news.json válido já commitado no repositório
    // com um payload totalmente vazio — isso destruiria o cache de produção
    // para todo mundo. Encerra com erro; o workflow simplesmente não terá
    // nada para commitar nesta rodada.
    console.error('Todas as fontes falharam — mantendo o último data/news.json já commitado, sem gravar.');
    process.exit(1);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    categorias,
  };

  await mkdir('data', { recursive: true });
  await writeFile('data/news.json', JSON.stringify(payload, null, 2) + '\n');

  console.log(`\nConcluído. ${totalFeeds - falhas}/${totalFeeds} feeds OK.`);
}

main();
