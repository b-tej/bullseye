import argparse
import json
import os
import sys
from pathlib import Path

from openai import OpenAI, OpenAIError


DEFAULT_MODEL = "text-embedding-3-small"
DEFAULT_DIMENSIONS = 512


def normalize_word(word):
    return word.strip().lower()


def unique_words(source):
    words = [source["center"]["word"]]
    words.extend(target["word"] for target in source["targets"])
    words.extend(source.get("guessWords", []))

    seen = set()
    cleaned = []
    for word in words:
        normalized = normalize_word(word)
        if normalized and normalized not in seen:
            seen.add(normalized)
            cleaned.append(normalized)
    return cleaned


def embedding_text(word):
    return f"Meaning and associations of the word: {word}"


def main():
    parser = argparse.ArgumentParser(
        description="Generate browser-friendly OpenAI embeddings for the p5 semantic map."
    )
    parser.add_argument("--input", default="data/puzzle_words.json")
    parser.add_argument("--output", default="data/puzzle_embeddings.json")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dimensions", type=int, default=DEFAULT_DIMENSIONS)
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    source = json.loads(input_path.read_text(encoding="utf-8"))
    words = unique_words(source)
    if not os.environ.get("OPENAI_API_KEY"):
        print(
            "Missing OPENAI_API_KEY. Set it in your shell, then run this script again.",
            file=sys.stderr,
        )
        return 1

    client = OpenAI()

    try:
        response = client.embeddings.create(
            model=args.model,
            input=[embedding_text(word) for word in words],
            dimensions=args.dimensions,
            encoding_format="float",
        )
    except OpenAIError as error:
        print(f"OpenAI embeddings request failed: {error}", file=sys.stderr)
        return 1

    vectors = [item.embedding for item in sorted(response.data, key=lambda item: item.index)]
    embeddings = {
        word: [round(float(value), 6) for value in vector]
        for word, vector in zip(words, vectors)
    }

    output = {
        "date": source["date"],
        "model": args.model,
        "dimensions": args.dimensions,
        "embeddingTextTemplate": "Meaning and associations of the word: {word}",
        "center": {
            **source["center"],
            "word": normalize_word(source["center"]["word"]),
        },
        "targets": [
            {"word": normalize_word(target["word"])}
            for target in source["targets"]
        ],
        "embeddings": embeddings,
        "usage": {
            "promptTokens": response.usage.prompt_tokens,
            "totalTokens": response.usage.total_tokens,
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(
        f"Wrote {len(embeddings)} {args.model} embeddings "
        f"({args.dimensions} dimensions) to {output_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
