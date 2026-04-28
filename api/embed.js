const fs = require("node:fs");
const path = require("node:path");

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 512;
const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || "*";
const PUZZLE_EMBEDDINGS_PATH =
  process.env.PUZZLE_EMBEDDINGS_PATH || "data/puzzle_embeddings_default.json";
const FALLBACK_PUZZLE_EMBEDDINGS_PATH = "data/puzzle_embeddings_panache.json";

const embeddingCache = new Map();

function normalizeWord(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, "");
}

function embeddingText(word) {
  return `Meaning and associations of the word: ${word}`;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const len = Math.min(a.length, b.length);

  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function loadPuzzle() {
  const primary = path.join(process.cwd(), PUZZLE_EMBEDDINGS_PATH);
  const fallback = path.join(process.cwd(), FALLBACK_PUZZLE_EMBEDDINGS_PATH);
  const selected = fs.existsSync(primary) ? primary : fallback;
  return JSON.parse(fs.readFileSync(selected, "utf8"));
}

function semanticProfile(embedding) {
  const puzzle = loadPuzzle();
  const embeddings = puzzle.embeddings;
  const anchorWords = [puzzle.center.word, ...puzzle.targets.map((t) => t.word)];

  const profile = {};
  for (const word of anchorWords) {
    profile[word] = Number(cosineSimilarity(embedding, embeddings[word]).toFixed(4));
  }
  return profile;
}

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Access-Control-Allow-Origin", CORS_ALLOW_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(payload));
}

function parseBody(req) {
  if (typeof req.body === "object" && req.body !== null) {
    return req.body;
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204);
    res.setHeader("Access-Control-Allow-Origin", CORS_ALLOW_ORIGIN);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed. Use POST." });
    return;
  }

  const body = parseBody(req);
  if (!body) {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const word = normalizeWord(body.word);
  if (!word) {
    sendJson(res, 400, { error: "Missing word" });
    return;
  }

  if (embeddingCache.has(word)) {
    const embedding = embeddingCache.get(word);
    sendJson(res, 200, {
      word,
      embedding,
      profile: semanticProfile(embedding),
      cached: true,
    });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    sendJson(res, 500, {
      error: "Missing OPENAI_API_KEY in Vercel project environment variables.",
    });
    return;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: embeddingText(word),
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: "float",
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      sendJson(res, 500, {
        error: data.error?.message || "OpenAI embeddings request failed.",
      });
      return;
    }

    const embedding = data.data[0].embedding.map((v) => Number(Number(v).toFixed(6)));
    embeddingCache.set(word, embedding);

    sendJson(res, 200, {
      word,
      embedding,
      profile: semanticProfile(embedding),
      cached: false,
    });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
};
