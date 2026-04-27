import json
import math
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from openai import OpenAI, OpenAIError


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 512
CACHE_PATH = Path("data/embedding_cache.json")
PUZZLE_PATH = Path(os.environ.get("PUZZLE_EMBEDDINGS_PATH", "data/puzzle_embeddings_default.json"))
FALLBACK_PUZZLE_PATH = Path("data/puzzle_embeddings_panache.json")
CORS_ALLOW_ORIGIN = os.environ.get("CORS_ALLOW_ORIGIN", "*")


def normalize_word(value):
    return re.sub(r"[^a-z-]", "", value.strip().lower())


def embedding_text(word):
    return f"Meaning and associations of the word: {word}"


def read_cache():
    if not CACHE_PATH.exists():
        return {}

    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_cache(cache):
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, indent=2), encoding="utf-8")


def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(y * y for y in b))
    return dot / (mag_a * mag_b)


def read_puzzle():
    path = PUZZLE_PATH if PUZZLE_PATH.exists() else FALLBACK_PUZZLE_PATH
    return json.loads(path.read_text(encoding="utf-8"))


def semantic_profile(embedding):
    puzzle = read_puzzle()
    embeddings = puzzle["embeddings"]
    anchor_words = [puzzle["center"]["word"]]
    anchor_words.extend(target["word"] for target in puzzle["targets"])

    return {
        word: round(cosine_similarity(embedding, embeddings[word]), 4)
        for word in anchor_words
    }


class GameRequestHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        if self.path != "/api/embed":
            self.send_error(404, "Not found")
            return

        self.send_response(204)
        self.send_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_POST(self):
        if self.path != "/api/embed":
            self.send_error(404, "Not found")
            return

        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length)

        try:
            body = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON body"}, status=400)
            return

        word = normalize_word(body.get("word", ""))
        if not word:
            self.send_json({"error": "Missing word"}, status=400)
            return

        cache = read_cache()
        if word in cache:
            embedding = cache[word]
            self.send_json({
                "word": word,
                "embedding": embedding,
                "profile": semantic_profile(embedding),
                "cached": True,
            })
            return

        if not os.environ.get("OPENAI_API_KEY"):
            self.send_json({
                "error": "Live embeddings need OPENAI_API_KEY. Restart the server from a terminal where the key is exported."
            }, status=500)
            return

        try:
            client = OpenAI()
            response = client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=embedding_text(word),
                dimensions=EMBEDDING_DIMENSIONS,
                encoding_format="float",
            )
        except OpenAIError as error:
            self.send_json({"error": str(error)}, status=500)
            return

        embedding = [
            round(float(value), 6)
            for value in response.data[0].embedding
        ]
        cache[word] = embedding
        write_cache(cache)

        self.send_json({
            "word": word,
            "embedding": embedding,
            "profile": semantic_profile(embedding),
            "cached": False,
        })

    def send_json(self, payload, status=200):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", CORS_ALLOW_ORIGIN)
        self.send_header("Vary", "Origin")


def main():
    server = ThreadingHTTPServer((HOST, PORT), GameRequestHandler)
    print(f"Serving game and API at http://{HOST}:{PORT}/index.html")
    print("Press Control+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
