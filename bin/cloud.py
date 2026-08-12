#!/usr/bin/env python3
"""
Optional paid LLMs (Grok, Claude, OpenAI, Gemini).

Local Ollama stays the default. Cloud is off until the user runs
`gamemaster cloud on <provider>` or passes `--cloud grok` / GAMEMASTER_CLOUD.

Keys: env var first, optional local config/cloud.json (gitignored). Never print a key.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from gmcommon import CONFIG, DEFAULT_MODEL, ollama_json, ensure_ollama

CONFIG_FILE = CONFIG / "cloud.json"

# Built-in catalogs. Model IDs are overridable; these are 2026 defaults.
CATALOG: dict[str, dict[str, str]] = {
    "grok": {
        "kind": "openai",
        "base": "https://api.x.ai/v1",
        "model": "grok-4.5",
        "key_env": "XAI_API_KEY",
        "label": "xAI Grok",
    },
    "claude": {
        "kind": "anthropic",
        "base": "https://api.anthropic.com",
        "model": "claude-sonnet-4-5",
        "key_env": "ANTHROPIC_API_KEY",
        "label": "Anthropic Claude",
    },
    "openai": {
        "kind": "openai",
        "base": "https://api.openai.com/v1",
        "model": "gpt-5",
        "key_env": "OPENAI_API_KEY",
        "label": "OpenAI",
    },
    "gemini": {
        "kind": "gemini",
        "base": "https://generativelanguage.googleapis.com/v1beta",
        "model": "gemini-2.5-pro",
        "key_env": "GEMINI_API_KEY",
        "label": "Google Gemini",
    },
}


def config_path() -> Path:
    override = os.environ.get("GAMEMASTER_CLOUD_CONFIG")
    return Path(override) if override else CONFIG_FILE


def empty_config() -> dict:
    return {"enabled": False, "default": "", "providers": {}}


def load_config() -> dict:
    path = config_path()
    if not path.is_file():
        return empty_config()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return empty_config()
    if not isinstance(data, dict):
        return empty_config()
    data.setdefault("enabled", False)
    data.setdefault("default", "")
    data.setdefault("providers", {})
    return data


def save_config(cfg: dict) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def known_names() -> list[str]:
    cfg = load_config()
    names = list(CATALOG)
    for n in cfg.get("providers") or {}:
        if n not in names:
            names.append(str(n))
    return names


def merged_provider(name: str) -> dict:
    name = (name or "").strip().lower()
    base = dict(CATALOG.get(name) or {})
    stored = (load_config().get("providers") or {}).get(name) or {}
    if isinstance(stored, dict):
        for k, v in stored.items():
            if v not in (None, ""):
                base[k] = v
    base["name"] = name
    return base


def provider_key(name: str) -> str:
    p = merged_provider(name)
    env_name = str(p.get("key_env") or "")
    if env_name:
        env = os.environ.get(env_name, "").strip()
        if env:
            return env
    return str(p.get("key") or "").strip()


def mask_key(key: str) -> str:
    if not key:
        return "(none)"
    if len(key) <= 8:
        return "****"
    return f"…{key[-4:]}"


def active_provider() -> str:
    """Empty unless the user opted in. A key sitting in the env is not enough."""
    forced = os.environ.get("GAMEMASTER_CLOUD", "").strip().lower()
    if forced in ("0", "off", "false", "local", "ollama"):
        return ""
    if forced:
        return forced
    cfg = load_config()
    if not cfg.get("enabled"):
        return ""
    return str(cfg.get("default") or "").strip().lower()


def require_backend() -> None:
    name = active_provider()
    if not name:
        ensure_ollama()
        return
    if name not in known_names() and name not in CATALOG:
        raise SystemExit(f"Unknown cloud provider '{name}'. Use: {', '.join(CATALOG)}")
    if not provider_key(name):
        env = merged_provider(name).get("key_env") or "API key"
        raise SystemExit(
            f"Cloud provider '{name}' has no key. "
            f"Set {env} or: gamemaster cloud set {name} --key …"
        )


def _http_json(url: str, payload: dict, headers: dict, timeout: float = 180.0) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"HTTP {e.code} {url}: {body}") from e


def openai_payload(messages: list[dict], model: str, temperature: float, num_predict: int) -> dict:
    return {
        "model": model,
        "messages": [{"role": m.get("role", "user"), "content": m.get("content") or ""} for m in messages],
        "temperature": temperature,
        "max_tokens": num_predict,
    }


def split_system(messages: list[dict]) -> tuple[str, list[dict]]:
    systems: list[str] = []
    rest: list[dict] = []
    for m in messages:
        role = m.get("role") or "user"
        text = m.get("content") or ""
        if role == "system":
            if text:
                systems.append(text)
            continue
        mapped = "assistant" if role == "assistant" else "user"
        if rest and rest[-1]["role"] == mapped:
            rest[-1]["content"] += "\n\n" + text
        else:
            rest.append({"role": mapped, "content": text})
    if not rest:
        rest = [{"role": "user", "content": "(empty)"}]
    if rest[0]["role"] != "user":
        rest.insert(0, {"role": "user", "content": "(continue)"})
    return "\n\n".join(systems), rest


def anthropic_payload(messages: list[dict], model: str, temperature: float, num_predict: int) -> dict:
    system, rest = split_system(messages)
    body: dict[str, Any] = {
        "model": model,
        "max_tokens": max(256, num_predict),
        "temperature": temperature,
        "messages": rest,
    }
    if system:
        body["system"] = system
    return body


def gemini_payload(messages: list[dict], temperature: float, num_predict: int) -> dict:
    system, rest = split_system(messages)
    contents = []
    for m in rest:
        role = "model" if m["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})
    body: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max(256, num_predict),
        },
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    return body


def _cloud_chat(name: str, messages: list[dict], model: str, temperature: float, num_predict: int) -> str:
    p = merged_provider(name)
    kind = str(p.get("kind") or "openai")
    key = provider_key(name)
    if not key:
        raise RuntimeError(f"no API key for {name}")
    use_model = (
        os.environ.get("GAMEMASTER_CLOUD_MODEL")
        or model
        or p.get("model")
        or CATALOG.get(name, {}).get("model")
        or "unknown"
    )
    # If the caller passed a local Ollama tag, use the provider default.
    if use_model in ("gamemaster", "gamemaster-dense") or use_model.startswith("qwen"):
        use_model = p.get("model") or use_model

    if kind == "anthropic":
        url = str(p.get("base") or "https://api.anthropic.com").rstrip("/") + "/v1/messages"
        headers = {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        }
        data = _http_json(url, anthropic_payload(messages, use_model, temperature, num_predict), headers)
        blocks = data.get("content") or []
        return "".join(b.get("text") or "" for b in blocks if isinstance(b, dict))

    if kind == "gemini":
        base = str(p.get("base") or CATALOG["gemini"]["base"]).rstrip("/")
        url = f"{base}/models/{use_model}:generateContent?key={urllib.parse.quote(key)}"
        data = _http_json(url, gemini_payload(messages, temperature, num_predict), {})
        out = []
        for cand in data.get("candidates") or []:
            for part in ((cand.get("content") or {}).get("parts") or []):
                if part.get("text"):
                    out.append(part["text"])
        return "".join(out)

    base = str(p.get("base") or "").rstrip("/")
    url = base + "/chat/completions"
    headers = {"Authorization": f"Bearer {key}"}
    data = _http_json(url, openai_payload(messages, use_model, temperature, num_predict), headers)
    choices = data.get("choices") or []
    if not choices:
        return ""
    return ((choices[0].get("message") or {}).get("content")) or ""


def ollama_chat(messages: list[dict], model: str, temperature: float, num_predict: int, num_ctx: int | None) -> str:
    payload = {
        "model": model or DEFAULT_MODEL,
        "messages": messages,
        "stream": False,
        "keep_alive": "24h",
        "options": {
            "temperature": temperature,
            "num_ctx": num_ctx or int(os.environ.get("GAMEMASTER_NUM_CTX", "32768")),
            "num_predict": num_predict,
            "num_batch": 512,
        },
    }
    res = ollama_json("/api/chat", payload, timeout=600)
    return (res.get("message") or {}).get("content") or ""


def chat(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.2,
    num_predict: int = 8192,
    num_ctx: int | None = None,
    provider: str | None = None,
) -> str:
    """Route to opted-in cloud provider, else Ollama."""
    name = (provider or active_provider() or "").strip().lower()
    if name:
        return _cloud_chat(name, messages, model or "", temperature, num_predict)
    return ollama_chat(messages, model or DEFAULT_MODEL, temperature, num_predict, num_ctx)


def status_dict() -> dict:
    name = active_provider()
    cfg = load_config()
    providers = {}
    for n in known_names():
        p = merged_provider(n)
        providers[n] = {
            "label": p.get("label") or n,
            "model": p.get("model"),
            "kind": p.get("kind"),
            "has_key": bool(provider_key(n)),
            "key_env": p.get("key_env") or "",
            "key_preview": mask_key(provider_key(n)),
        }
    return {
        "enabled": bool(name),
        "provider": name,
        "model": merged_provider(name).get("model") if name else "",
        "local": not bool(name),
        "persisted": bool(cfg.get("enabled")),
        "default": cfg.get("default") or "",
        "providers": providers,
    }


def cmd_status() -> int:
    st = status_dict()
    if st["local"]:
        print("Cloud: OFF  (local Ollama, $0)")
        print("  Opt in:  gamemaster cloud on grok|claude|openai|gemini")
        print("  One shot: gamemaster --cloud grok \"…\"")
    else:
        print(f"Cloud: ON  provider={st['provider']}  model={st['model']}  (paid)")
        print("  Off:     gamemaster cloud off")
    print("Providers:")
    for n, p in st["providers"].items():
        mark = "*" if n == st["provider"] else " "
        key = "key" if p["has_key"] else "no-key"
        print(f"  {mark} {n:8} {p['model']:22} {key:7} {p['key_preview']}  (${p['key_env']})")
    return 0


def cmd_on(name: str) -> int:
    name = name.strip().lower()
    if name not in CATALOG and name not in (load_config().get("providers") or {}):
        print(f"Unknown provider '{name}'. Choose: {', '.join(CATALOG)}", file=sys.stderr)
        return 1
    if not provider_key(name):
        env = merged_provider(name).get("key_env") or "API_KEY"
        print(f"No key for {name}. export {env}=…  or  gamemaster cloud set {name} --key …", file=sys.stderr)
        return 1
    cfg = load_config()
    cfg["enabled"] = True
    cfg["default"] = name
    save_config(cfg)
    print(f"Cloud ON → {name} ({merged_provider(name).get('model')}). Local Ollama unused until `cloud off`.")
    return 0


def cmd_off() -> int:
    cfg = load_config()
    cfg["enabled"] = False
    save_config(cfg)
    print("Cloud OFF. Back to local Ollama.")
    return 0


def cmd_set(args: argparse.Namespace) -> int:
    name = args.name.strip().lower()
    cfg = load_config()
    slot = dict((cfg.get("providers") or {}).get(name) or {})
    if args.model:
        slot["model"] = args.model
    if args.base:
        slot["base"] = args.base.rstrip("/")
        slot.setdefault("kind", "openai")
    if args.kind:
        slot["kind"] = args.kind
    if args.key_env:
        slot["key_env"] = args.key_env
    if args.key:
        slot["key"] = args.key.strip()
    if name in CATALOG:
        slot.setdefault("kind", CATALOG[name]["kind"])
        slot.setdefault("base", CATALOG[name]["base"])
        slot.setdefault("model", CATALOG[name]["model"])
        slot.setdefault("key_env", CATALOG[name]["key_env"])
        slot.setdefault("label", CATALOG[name]["label"])
    elif not slot.get("base"):
        print("Custom provider needs --base (OpenAI-compatible URL)", file=sys.stderr)
        return 1
    cfg.setdefault("providers", {})[name] = slot
    if args.on:
        if not provider_key(name) and not slot.get("key"):
            print("Cannot --on without a key", file=sys.stderr)
            return 1
        cfg["enabled"] = True
        cfg["default"] = name
    save_config(cfg)
    print(f"Saved {name} model={slot.get('model')} key={mask_key(provider_key(name) or slot.get('key') or '')}")
    if cfg.get("enabled") and cfg.get("default") == name:
        print("  Cloud is ON for this provider.")
    else:
        print(f"  Not active yet.  gamemaster cloud on {name}")
    return 0


def cmd_unset(name: str) -> int:
    cfg = load_config()
    (cfg.get("providers") or {}).pop(name, None)
    if cfg.get("default") == name:
        cfg["enabled"] = False
        cfg["default"] = ""
    save_config(cfg)
    print(f"Removed stored settings for {name}")
    return 0


def cmd_complete(args: argparse.Namespace) -> int:
    if args.json:
        payload = json.load(sys.stdin)
        messages = payload.get("messages") or []
        model = payload.get("model") or args.model
        temperature = float(payload.get("temperature", args.temperature))
        num_predict = int(payload.get("num_predict", args.predict))
    else:
        messages = []
        if args.system:
            messages.append({"role": "system", "content": args.system})
        messages.append({"role": "user", "content": args.user or ""})
        model = args.model
        temperature = args.temperature
        num_predict = args.predict
    try:
        text = chat(messages, model=model, temperature=temperature, num_predict=num_predict)
    except Exception as e:
        print(f"cloud complete failed: {e}", file=sys.stderr)
        return 1
    sys.stdout.write(text)
    if text and not text.endswith("\n"):
        sys.stdout.write("\n")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Optional paid cloud LLMs (off by default)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sub.add_parser("active")
    p_on = sub.add_parser("on")
    p_on.add_argument("name")
    sub.add_parser("off")
    p_set = sub.add_parser("set")
    p_set.add_argument("name")
    p_set.add_argument("--key", default="")
    p_set.add_argument("--key-env", default="")
    p_set.add_argument("--model", default="")
    p_set.add_argument("--base", default="")
    p_set.add_argument("--kind", choices=["openai", "anthropic", "gemini"], default="")
    p_set.add_argument("--on", action="store_true", help="also enable this provider")
    p_un = sub.add_parser("unset")
    p_un.add_argument("name")
    p_c = sub.add_parser("complete")
    p_c.add_argument("--json", action="store_true")
    p_c.add_argument("--system", default="")
    p_c.add_argument("--user", default="")
    p_c.add_argument("--model", default="")
    p_c.add_argument("--temperature", type=float, default=0.2)
    p_c.add_argument("--predict", type=int, default=8192)
    args = ap.parse_args()
    if args.cmd == "status":
        return cmd_status()
    if args.cmd == "active":
        name = active_provider()
        if not name:
            return 1
        print(name)
        return 0
    if args.cmd == "on":
        return cmd_on(args.name)
    if args.cmd == "off":
        return cmd_off()
    if args.cmd == "set":
        return cmd_set(args)
    if args.cmd == "unset":
        return cmd_unset(args.name)
    return cmd_complete(args)


if __name__ == "__main__":
    raise SystemExit(main())
