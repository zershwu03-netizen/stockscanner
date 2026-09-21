import { readFile, writeFile, rename } from "node:fs/promises";

const SYMBOLS_PATH = new URL("./symbols.json", import.meta.url);
const QUOTES_PATH = new URL("./quotes.json", import.meta.url);
const TEMP_PATH = new URL("./quotes.tmp.json", import.meta.url);
const CONCURRENCY = 4;
const TIMEOUT_MS = 10_000;

function cleanSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function validPrice(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function lastValid(values) {
  if (!Array.isArray(values)) return null;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (validPrice(values[i])) return Number(values[i]);
  }
  return null;
}

async function fetchChart(symbol, host) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=false&events=div%2Csplits`;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "Mozilla/5.0 StockRadarPersonal/1.0"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error(data?.chart?.error?.description || "No result");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveChart(requestedSymbol) {
  const candidates = [requestedSymbol];
  if (requestedSymbol.endsWith(".TW")) {
    candidates.push(`${requestedSymbol.slice(0, -3)}.TWO`);
  }

  const failures = [];
  for (const candidate of candidates) {
    for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
      try {
        return { result: await fetchChart(candidate, host), resolvedSymbol: candidate };
      } catch (error) {
        failures.push(`${candidate}@${host}: ${error?.message || error}`);
      }
    }
  }
  throw new Error(failures.join(" | ").slice(0, 800));
}

async function fetchQuote(requestedSymbol) {
  const { result, resolvedSymbol } = await resolveChart(requestedSymbol);
  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const price = validPrice(meta.regularMarketPrice)
    ? Number(meta.regularMarketPrice)
    : lastValid(quote.close);
  if (!validPrice(price)) throw new Error("Invalid price");

  const marketTime = Number(meta.regularMarketTime) || lastValid(result.timestamp) || null;
  return {
    symbol: requestedSymbol,
    resolvedSymbol,
    name: meta.shortName || meta.longName || meta.symbol || resolvedSymbol,
    price,
    currency: meta.currency || (requestedSymbol === "USDTWD=X" ? "TWD" : null),
    exchange: meta.exchangeName || null,
    marketTime,
    fetchedAt: new Date().toISOString(),
    stale: false
  };
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return output;
}

const symbolsFile = await readJson(SYMBOLS_PATH, { symbols: [] });
const rawSymbols = Array.isArray(symbolsFile) ? symbolsFile : symbolsFile.symbols;
const symbols = [...new Set([...(Array.isArray(rawSymbols) ? rawSymbols : []), "USDTWD=X"]
  .map(cleanSymbol)
  .filter(Boolean))];

const previous = await readJson(QUOTES_PATH, { quotes: {} });
const previousQuotes = previous?.quotes && typeof previous.quotes === "object" ? previous.quotes : {};
const nextQuotes = {};
const errors = {};
let fresh = 0;
let preserved = 0;

await mapLimit(symbols, CONCURRENCY, async (symbol, index) => {
  try {
    nextQuotes[symbol] = await fetchQuote(symbol);
    fresh += 1;
    process.stdout.write(`[${index + 1}/${symbols.length}] ${symbol} OK\n`);
  } catch (error) {
    const message = String(error?.message || error).slice(0, 800);
    errors[symbol] = message;
    if (previousQuotes[symbol] && validPrice(previousQuotes[symbol].price)) {
      nextQuotes[symbol] = {
        ...previousQuotes[symbol],
        stale: true,
        lastAttemptAt: new Date().toISOString(),
        lastError: message
      };
      preserved += 1;
      process.stdout.write(`[${index + 1}/${symbols.length}] ${symbol} PRESERVED\n`);
    } else {
      process.stdout.write(`[${index + 1}/${symbols.length}] ${symbol} FAILED\n`);
    }
  }
});

const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: "Yahoo Finance chart via GitHub Actions",
  quotes: nextQuotes,
  errors,
  stats: {
    requested: symbols.length,
    fresh,
    preserved,
    failed: symbols.length - fresh - preserved
  }
};

function comparable(snapshot) {
  const quotes = Object.fromEntries(Object.entries(snapshot?.quotes || {}).map(([symbol, quote]) => [
    symbol,
    {
      price: Number(quote?.price),
      marketTime: quote?.marketTime || null,
      resolvedSymbol: quote?.resolvedSymbol || symbol,
      stale: Boolean(quote?.stale)
    }
  ]));
  return JSON.stringify({ quotes, errors: snapshot?.errors || {} });
}

if (comparable(previous) === comparable(payload)) {
  process.stdout.write(`No market changes: ${JSON.stringify(payload.stats)}\n`);
  process.exit(0);
}

await writeFile(TEMP_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await rename(TEMP_PATH, QUOTES_PATH);
process.stdout.write(`Done: ${JSON.stringify(payload.stats)}\n`);
