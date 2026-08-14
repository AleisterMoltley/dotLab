#!/usr/bin/env python3
"""
OpenZoo (openzoo.fun) — x402 floor with leCore in front.

Local Ollama stays the default. This is the paid rail:

  dotlab zoo status|models|listings|quote|wallet|balance|extra|stall
  dotlab cloud on zoo
  dotlab --cloud zoo "Tighten coyote time"

No API key. HTTP 402, then one Token-2022 TransferChecked as X-PAYMENT.
Facilitator pays SOL. Read extra.pricing / extra.savesVsDirect — do not
hardcode the multiple. Fail-open on their side bills at direct.

stdlib + openssl + optional solana-keygen / RPC. Never print a secret.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import struct
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from gmcommon import CONFIG

SITE = "https://openzoo.fun"
SITE_CHAT = f"{SITE}/api/v1/chat/completions"
SITE_MODELS = f"{SITE}/api/v1/models"
SITE_MODELS_RICH = f"{SITE}/api/models"
FLOOR = "https://x402-tokens.fly.dev"
FACILITATOR = "https://x402.accrue.fund"
TOKEN_CA = "EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump"
PUMP = f"https://pump.fun/coin/{TOKEN_CA}"
HELP = f"{FACILITATOR}/start"
FEATURED = (
    "google/gemini-2.5-flash",
    "anthropic/claude-sonnet-4",
    "openai/gpt-4o-mini",
    "x-ai/grok-4.6",
)
DEFAULT_MODEL = "x-ai/grok-4.6"

# Rails named by the live 402 / prompt.txt. Amounts stay in native units.
YUSDCX = "6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv"
WTOKENX = "Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9"
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
PAY_TO = "WzMaL78srutrF6CsxEkWuhMaDF5HZA6jNRaEPengqpb"
SOLANA_NET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
TOKEN_KET = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
SYSTEM_PROGRAM = "11111111111111111111111111111111"
WRAP_PROGRAM = "FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE"
WRAP_USDC_ESCROW = "2qLm8aCvn6gQVUFeQ7EC5J62Y95gFzc3vReHzD5d5Gj2"
WRAP_USDC_AUTH = "EBGYMEEEPKu7szPUbnbp2h63azY9Sj9GR4MA2Ms6Quoi"
WRAP_USDC_BUMP = 253
WRAP_TOKEN_ESCROW = "7j682FdwSdTkXNjbMrrLd5wcXQoh23UTZaDReqKXbL2q"
WRAP_TOKEN_AUTH = "AqdXyPzN6s5KH8KpdnKJmhUipyDUxxGxbJ5Qk1YKghXT"
WRAP_TOKEN_BUMP = 255
# Published rail decimals (openzoo.fun/.well-known/x402.json). Not a guess.
RAIL_DECIMALS = {YUSDCX: 6, WTOKENX: 6, USDC: 6}
DEFAULT_SPEND_CAP = 0.50
ESTIMATE_CALLS = {
    "plan": 3,
    "build": 12,
    "council": 8,
    "review": 4,
    "parallel": 16,
    "agent": 8,
    "chat": 1,
}

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_B58_IDX = {c: i for i, c in enumerate(B58)}
ED25519_P = 2**255 - 19
ED25519_D = (-121665 * pow(121666, ED25519_P - 2, ED25519_P)) % ED25519_P

CONFIG_FILE = CONFIG / "zoo.json"
WALLET_FILE = CONFIG / "zoo-wallet.json"
SPEND_FILE = CONFIG / "zoo-spend.json"


class PayError(RuntimeError):
    """Payment or spend-cap failed. Cloud should fall back to local Ollama."""


# ── config ──────────────────────────────────────────────────────────────


def config_path() -> Path:
    override = os.environ.get("GAMEMASTER_ZOO_CONFIG") or os.environ.get("DOTLAB_ZOO_CONFIG")
    return Path(override) if override else CONFIG_FILE


def wallet_path() -> Path:
    override = os.environ.get("GAMEMASTER_ZOO_WALLET") or os.environ.get("DOTLAB_ZOO_WALLET")
    return Path(override) if override else WALLET_FILE


def empty_config() -> dict:
    return {
        "model": DEFAULT_MODEL,
        "prefer": "yUSDCx",
        "rpc": "",
        "chat_url": "",
        "public": "",
        "spend_cap_usd": DEFAULT_SPEND_CAP,
        "last_model": "",
        "project_models": {},
        "backed_up": False,
    }


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
    out = empty_config()
    out.update({k: v for k, v in data.items() if v not in (None,)})
    return out


def save_config(cfg: dict) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def rpc_url() -> str:
    cfg = load_config()
    return (
        os.environ.get("ZOO_RPC")
        or os.environ.get("SOLANA_RPC")
        or os.environ.get("SOLANA_RPC_URL")
        or str(cfg.get("rpc") or "").strip()
        or "https://api.mainnet-beta.solana.com"
    )


def chat_url() -> str:
    cfg = load_config()
    return (
        os.environ.get("ZOO_CHAT_URL")
        or str(cfg.get("chat_url") or "").strip()
        or SITE_CHAT
    )


def preferred_model(override: str = "", project: str = "") -> str:
    cfg = load_config()
    proj = (project or os.environ.get("GAMEMASTER_ZOO_PROJECT") or "").strip()
    if proj:
        mapped = (cfg.get("project_models") or {}).get(proj) or (cfg.get("project_models") or {}).get(
            Path(proj).name
        )
        if mapped:
            return str(mapped)
    return (
        (override or "").strip()
        or os.environ.get("GAMEMASTER_CLOUD_MODEL")
        or os.environ.get("ZOO_MODEL")
        or str(cfg.get("model") or cfg.get("last_model") or "")
        or DEFAULT_MODEL
    )


# ── bytes / keys ────────────────────────────────────────────────────────


def b58encode(raw: bytes) -> str:
    n = int.from_bytes(raw, "big")
    out = []
    while n:
        n, r = divmod(n, 58)
        out.append(B58[r])
    pad = 0
    for b in raw:
        if b == 0:
            pad += 1
        else:
            break
    return ("1" * pad) + "".join(reversed(out) or "1")


def b58decode(text: str) -> bytes:
    s = (text or "").strip()
    n = 0
    for ch in s:
        if ch not in _B58_IDX:
            raise ValueError(f"invalid base58: {ch!r}")
        n = n * 58 + _B58_IDX[ch]
    pad = 0
    for ch in s:
        if ch == "1":
            pad += 1
        else:
            break
    raw = n.to_bytes((n.bit_length() + 7) // 8 or 1, "big") if n else b""
    return b"\x00" * pad + raw.lstrip(b"\x00")


def compact_u16(n: int) -> bytes:
    n = int(n)
    out = bytearray()
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n & 0x7F)
    return bytes(out)


def _is_on_curve(pubkey: bytes) -> bool:
    if len(pubkey) != 32:
        return True
    y = int.from_bytes(pubkey, "little")
    y &= (1 << 255) - 1
    if y >= ED25519_P:
        return True
    y2 = (y * y) % ED25519_P
    num = (y2 - 1) % ED25519_P
    den = (ED25519_D * y2 + 1) % ED25519_P
    if den == 0:
        return False
    x2 = (num * pow(den, ED25519_P - 2, ED25519_P)) % ED25519_P
    return pow(x2, (ED25519_P - 1) // 2, ED25519_P) == 1


def find_program_address(seeds: list[bytes], program_id: bytes) -> tuple[bytes, int]:
    marker = b"ProgramDerivedAddress"
    for bump in range(255, -1, -1):
        h = hashlib.sha256(b"".join(seeds) + bytes([bump]) + program_id + marker).digest()
        if not _is_on_curve(h):
            return h, bump
    raise RuntimeError("unable to find program address")


def associated_token_address(owner: str, mint: str, token_program: str = TOKEN_2022) -> str:
    addr, _ = find_program_address(
        [b58decode(owner), b58decode(token_program), b58decode(mint)],
        b58decode(ATA_PROGRAM),
    )
    return b58encode(addr)


def seed_to_pkcs8_pem(seed: bytes) -> str:
    if len(seed) != 32:
        raise ValueError("ed25519 seed must be 32 bytes")
    der = bytes.fromhex("302e020100300506032b657004220420") + seed
    b64 = base64.b64encode(der).decode("ascii")
    lines = "\n".join(b64[i : i + 64] for i in range(0, len(b64), 64))
    return f"-----BEGIN PRIVATE KEY-----\n{lines}\n-----END PRIVATE KEY-----\n"


def pubkey_from_seed(seed: bytes) -> bytes:
    pem = seed_to_pkcs8_pem(seed)
    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as f:
        f.write(pem)
        path = f.name
    try:
        os.chmod(path, 0o600)
        der = subprocess.check_output(
            ["openssl", "pkey", "-in", path, "-pubout", "-outform", "DER"],
            stderr=subprocess.DEVNULL,
        )
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    if len(der) < 32:
        raise RuntimeError("openssl did not return an ed25519 public key")
    return der[-32:]


def ed25519_sign(seed: bytes, message: bytes) -> bytes:
    pem = seed_to_pkcs8_pem(seed)
    with tempfile.TemporaryDirectory() as td:
        kp = Path(td)
        (kp / "key.pem").write_text(pem, encoding="ascii")
        os.chmod(kp / "key.pem", 0o600)
        (kp / "msg").write_bytes(message)
        subprocess.check_call(
            [
                "openssl",
                "pkeyutl",
                "-sign",
                "-inkey",
                str(kp / "key.pem"),
                "-rawin",
                "-in",
                str(kp / "msg"),
                "-out",
                str(kp / "sig"),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        sig = (kp / "sig").read_bytes()
    if len(sig) != 64:
        raise RuntimeError(f"ed25519 signature must be 64 bytes, got {len(sig)}")
    return sig


def load_keypair(path: Path | None = None) -> tuple[bytes, str]:
    """Return (32-byte seed, base58 pubkey)."""
    p = path or wallet_path()
    if not p.is_file():
        raise FileNotFoundError(f"no zoo wallet at {p}")
    raw = p.read_text(encoding="utf-8").strip()
    if raw.startswith("-----BEGIN"):
        seed = _seed_from_pem(raw)
    else:
        data = json.loads(raw)
        if not isinstance(data, list) or len(data) < 32:
            raise ValueError("wallet file is not a Solana keypair JSON")
        seed = bytes(int(x) & 0xFF for x in data[:32])
    pub = pubkey_from_seed(seed)
    return seed, b58encode(pub)


def _seed_from_pem(pem: str) -> bytes:
    body = "".join(line for line in pem.splitlines() if "-----" not in line)
    der = base64.b64decode(body)
    if len(der) < 32:
        raise ValueError("PEM too short")
    return der[-32:]


def ensure_wallet() -> dict:
    path = wallet_path()
    if path.is_file():
        _, pub = load_keypair(path)
        return {"ok": True, "public": pub, "path": str(path), "created": False}
    path.parent.mkdir(parents=True, exist_ok=True)
    if shutil_which("solana-keygen"):
        subprocess.check_call(
            [
                "solana-keygen",
                "new",
                "--no-bip39-passphrase",
                "--silent",
                "--outfile",
                str(path),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        seed = os.urandom(32)
        pub = pubkey_from_seed(seed)
        payload = list(seed + pub)
        path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    _, pub = load_keypair(path)
    cfg = load_config()
    cfg["public"] = pub
    save_config(cfg)
    return {"ok": True, "public": pub, "path": str(path), "created": True}


def shutil_which(name: str) -> str:
    from shutil import which

    return which(name) or ""


def wallet_public() -> str:
    try:
        _, pub = load_keypair()
        return pub
    except Exception:
        return str(load_config().get("public") or "")


# ── HTTP ────────────────────────────────────────────────────────────────


def http(
    method: str,
    url: str,
    payload: dict | None = None,
    headers: dict | None = None,
    timeout: float = 60.0,
) -> tuple[int, dict, bytes]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    hdrs = {"User-Agent": "dotLab-openzoo/1"}
    if data is not None:
        hdrs["Content-Type"] = "application/json"
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return int(r.status), {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return int(e.code), {k.lower(): v for k, v in e.headers.items()}, e.read()


def http_json(method: str, url: str, payload: dict | None = None, timeout: float = 60.0) -> Any:
    code, _, raw = http(method, url, payload=payload, timeout=timeout)
    if code >= 400:
        raise RuntimeError(f"HTTP {code} {url}: {raw[:240]!r}")
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def rpc(method: str, params: list, timeout: float = 20.0) -> Any:
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    data = http_json("POST", rpc_url(), body, timeout=timeout)
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(str(data["error"]))
    return (data or {}).get("result")


# ── catalog ─────────────────────────────────────────────────────────────


def listings() -> list[dict]:
    data = http_json("GET", f"{SITE}/api/zoo/listings")
    rows = data.get("listings") if isinstance(data, dict) else data
    return [r for r in (rows or []) if isinstance(r, dict)]


def models(query: str = "") -> list[dict]:
    try:
        data = http_json("GET", SITE_MODELS_RICH)
        rows = data.get("models") if isinstance(data, dict) else data
    except Exception:
        data = http_json("GET", SITE_MODELS)
        rows = data.get("data") if isinstance(data, dict) else data
    out = [r for r in (rows or []) if isinstance(r, dict)]
    q = (query or "").strip().lower()
    if q:
        out = [
            r
            for r in out
            if q in str(r.get("id") or "").lower() or q in str(r.get("label") or "").lower()
        ]
    return out


def floor_models() -> list[dict]:
    data = http_json("GET", f"{FLOOR}/v1/models")
    rows = data.get("data") if isinstance(data, dict) else data
    return [r for r in (rows or []) if isinstance(r, dict)]


def quote(model: str = "", prompt_tokens: int = 0, max_out: int = 0) -> dict:
    """Live 402 from openzoo.fun. Floor /quote ignores model — do not use it."""
    use_model = preferred_model(model)
    pad = ""
    n = int(prompt_tokens or 0)
    if n > 32:
        pad = " " + ("x " * min(n, 2000))
    body = {
        "model": use_model,
        "messages": [{"role": "user", "content": "quote" + pad}],
        "max_tokens": max(16, int(max_out or 32)),
    }
    code, _, raw = http("POST", chat_url(), payload=body, timeout=45.0)
    if code != 402:
        raise RuntimeError(f"expected 402 from {chat_url()}, got {code}: {raw[:200]!r}")
    req = parse_402(raw)
    accepts_out = []
    billed = None
    pricing = ""
    markup = None
    direct = None
    for a in req["accepts"]:
        s = summarize_accept(a)
        billed = billed if billed is not None else s.get("billedUsd")
        pricing = pricing or str(s.get("pricing") or "")
        if s.get("markup") is not None:
            markup = s.get("markup")
        if s.get("directUsd") is not None:
            direct = s.get("directUsd")
        accepts_out.append(
            {
                "symbol": s["symbol"],
                "mint": s["asset"],
                "network": s["network"],
                "decimals": s["decimals"],
                "tokenUsd": s.get("tokenUsd"),
                "billedUsd": s.get("billedUsd"),
                "directUsd": s.get("directUsd"),
                "savesVsDirect": s.get("savesVsDirect"),
                "grossRaw": s["amount"],
                "netRaw": s["amount"],
                "pricing": s.get("pricing"),
            }
        )
    return {
        "model": use_model,
        "promptTokensEst": n or None,
        "maxOut": int(max_out or 32),
        "source": chat_url(),
        "pricing": pricing,
        "markup": markup,
        "billedUsd": billed,
        "directUsd": direct,
        "openrouterUsd": direct,
        "accepts": accepts_out,
        "help": req.get("help") or HELP,
    }


def well_known() -> dict:
    site = http_json("GET", f"{SITE}/.well-known/x402.json")
    floor = http_json("GET", f"{FLOOR}/.well-known/x402.json")
    return {"site": site, "floor": floor, "facilitator": FACILITATOR, "help": HELP}


def parse_402(raw: bytes | str | dict) -> dict:
    if isinstance(raw, dict):
        data = raw
    else:
        text = raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else str(raw)
        data = json.loads(text)
    accepts = [a for a in (data.get("accepts") or []) if isinstance(a, dict)]
    return {
        "x402Version": data.get("x402Version") or 1,
        "accepts": accepts,
        "error": data.get("error") or "",
        "help": data.get("help") or HELP,
    }


def accept_symbol(row: dict) -> str:
    extra = row.get("extra") if isinstance(row.get("extra"), dict) else {}
    return str(extra.get("symbol") or row.get("symbol") or "")


def accept_decimals(row: dict) -> int | None:
    extra = row.get("extra") if isinstance(row.get("extra"), dict) else {}
    for key in ("decimals",):
        if extra.get(key) is not None:
            return int(extra[key])
        if row.get(key) is not None:
            return int(row[key])
    return None


def accept_amount(row: dict) -> int:
    extra = row.get("extra") if isinstance(row.get("extra"), dict) else {}
    raw = extra.get("amount") or extra.get("maxAmountRequired") or row.get("maxAmountRequired") or row.get("amount") or "0"
    return int(str(raw))


def accept_fee_payer(row: dict) -> str:
    extra = row.get("extra") if isinstance(row.get("extra"), dict) else {}
    return str(extra.get("feePayer") or row.get("payTo") or PAY_TO)


def pick_accept(
    accepts: list[dict],
    prefer: str = "",
    balances: dict[str, int] | None = None,
    allow_evm: bool = False,
) -> dict:
    rows = [a for a in accepts if isinstance(a, dict)]
    if not allow_evm:
        sol = [a for a in rows if str(a.get("network") or "").startswith("solana")]
        if sol:
            rows = sol
    if not rows:
        raise RuntimeError("402 had no usable accepts[]")
    want = (prefer or load_config().get("prefer") or "yUSDCx").strip()
    if want:
        for a in rows:
            if accept_symbol(a).lower() == want.lower():
                if not balances or balances.get(accept_symbol(a), 0) >= accept_amount(a):
                    return a
                break
    if balances:
        for a in rows:
            if balances.get(accept_symbol(a), 0) >= accept_amount(a):
                return a
    return rows[0]


def encode_payment(version: int, scheme: str, network: str, tx_b64: str) -> str:
    payload = {
        "x402Version": int(version or 1),
        "scheme": scheme or "exact",
        "network": network,
        "payload": {"transaction": tx_b64},
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def summarize_accept(row: dict) -> dict:
    extra = row.get("extra") if isinstance(row.get("extra"), dict) else {}
    return {
        "symbol": accept_symbol(row),
        "network": row.get("network") or "",
        "asset": row.get("asset") or extra.get("asset") or "",
        "amount": str(accept_amount(row)),
        "decimals": accept_decimals(row),
        "payTo": row.get("payTo") or "",
        "feePayer": accept_fee_payer(row),
        "pricing": extra.get("pricing") or "",
        "markup": extra.get("markup"),
        "billedUsd": extra.get("billedUsd"),
        "directUsd": extra.get("directUsd"),
        "savesVsDirect": extra.get("savesVsDirect"),
        "tokenUsd": extra.get("tokenUsd"),
    }


# ── solana pay ──────────────────────────────────────────────────────────


def compile_legacy_message(
    header: tuple[int, int, int],
    keys: list[bytes],
    blockhash: bytes,
    instructions: list[tuple[int, list[int], bytes]],
) -> bytes:
    out = bytearray()
    out.extend(header)
    out.extend(compact_u16(len(keys)))
    for k in keys:
        if len(k) != 32:
            raise ValueError("account key must be 32 bytes")
        out.extend(k)
    if len(blockhash) != 32:
        raise ValueError("blockhash must be 32 bytes")
    out.extend(blockhash)
    out.extend(compact_u16(len(instructions)))
    for prog, accs, data in instructions:
        out.append(prog & 0xFF)
        out.extend(compact_u16(len(accs)))
        out.extend(bytes(a & 0xFF for a in accs))
        out.extend(compact_u16(len(data)))
        out.extend(data)
    return bytes(out)


def serialize_legacy_tx(signatures: list[bytes], message: bytes) -> bytes:
    out = bytearray()
    out.extend(compact_u16(len(signatures)))
    for sig in signatures:
        if len(sig) != 64:
            raise ValueError("signature must be 64 bytes")
        out.extend(sig)
    out.extend(message)
    return bytes(out)


def transfer_checked_ix(amount: int, decimals: int) -> bytes:
    return bytes([12]) + struct.pack("<Q", int(amount)) + bytes([int(decimals) & 0xFF])


def latest_blockhash() -> str:
    res = rpc("getLatestBlockhash", [{"commitment": "confirmed"}])
    value = (res or {}).get("value") or res or {}
    bh = value.get("blockhash") if isinstance(value, dict) else None
    if not bh:
        raise RuntimeError("RPC did not return a blockhash")
    return str(bh)


def mint_decimals_rpc(mint: str) -> int:
    res = rpc("getAccountInfo", [mint, {"encoding": "base64"}])
    value = (res or {}).get("value") if isinstance(res, dict) else None
    if not value:
        raise RuntimeError(f"mint not found: {mint}")
    blob, _enc = value.get("data") or [None, None]
    raw = base64.b64decode(blob)
    if len(raw) < 45:
        raise RuntimeError(f"mint account too small: {mint}")
    return int(raw[44])


def build_transfer_checked_tx(
    owner: str,
    seed: bytes,
    accept: dict,
    decimals: int,
    blockhash: str,
) -> str:
    extra = accept.get("extra") if isinstance(accept.get("extra"), dict) else {}
    mint = str(accept.get("asset") or extra.get("asset") or "")
    dest_owner = str(accept.get("payTo") or PAY_TO)
    fee_payer = accept_fee_payer(accept)
    amount = accept_amount(accept)
    if not mint:
        raise RuntimeError("402 accept missing asset mint")
    src = associated_token_address(owner, mint, TOKEN_2022)
    dst = associated_token_address(dest_owner, mint, TOKEN_2022)
    keys_txt = [fee_payer, owner, src, dst, mint, TOKEN_2022]
    # de-dupe if fee payer == owner (should not happen on the floor)
    seen: list[str] = []
    for k in keys_txt:
        if k not in seen:
            seen.append(k)
    idx = {k: i for i, k in enumerate(seen)}
    header = (2 if fee_payer != owner else 1, 0, 2)
    if fee_payer == owner:
        header = (1, 0, 2)
    message = compile_legacy_message(
        header,
        [b58decode(k) for k in seen],
        b58decode(blockhash),
        [
            (
                idx[TOKEN_2022],
                [idx[src], idx[mint], idx[dst], idx[owner]],
                transfer_checked_ix(amount, decimals),
            )
        ],
    )
    owner_sig = ed25519_sign(seed, message)
    if fee_payer == owner:
        sigs = [owner_sig]
    else:
        sigs = [b"\x00" * 64, owner_sig]
    return base64.b64encode(serialize_legacy_tx(sigs, message)).decode("ascii")


def rail_decimals(mint: str, accept: dict | None = None) -> int:
    if accept:
        d = accept_decimals(accept)
        if d is not None:
            return int(d)
    if mint in RAIL_DECIMALS:
        return int(RAIL_DECIMALS[mint])
    return int(mint_decimals_rpc(mint))


def pay_header(accept: dict, owner: str, seed: bytes) -> str:
    mint = str(accept.get("asset") or (accept.get("extra") or {}).get("asset") or "")
    decimals = rail_decimals(mint, accept)
    tx = build_transfer_checked_tx(owner, seed, accept, int(decimals), latest_blockhash())
    return encode_payment(
        int((accept.get("x402Version") or 1)),
        str(accept.get("scheme") or "exact"),
        str(accept.get("network") or SOLANA_NET),
        tx,
    )


# ── balances ────────────────────────────────────────────────────────────


def token_balances(owner: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for program in (TOKEN_2022, TOKEN_KET):
        try:
            res = rpc(
                "getTokenAccountsByOwner",
                [owner, {"programId": program}, {"encoding": "jsonParsed"}],
                timeout=8.0,
            )
        except Exception:
            continue
        value = (res or {}).get("value") if isinstance(res, dict) else res
        for row in value or []:
            info = (((row.get("account") or {}).get("data") or {}).get("parsed") or {}).get("info") or {}
            mint = str(info.get("mint") or "")
            tok = (info.get("tokenAmount") or {})
            amount = int(str(tok.get("amount") or "0"))
            if mint:
                out[mint] = out.get(mint, 0) + amount
    return out


def sol_lamports(owner: str) -> int:
    try:
        res = rpc("getBalance", [owner])
    except Exception:
        return 0
    if isinstance(res, dict):
        return int(res.get("value") or 0)
    return int(res or 0)


def named_balances(owner: str) -> dict[str, Any]:
    raw = token_balances(owner)
    named = {
        "yUSDCx": raw.get(YUSDCX, 0),
        "wTOKENx": raw.get(WTOKENX, 0),
        "USDC": raw.get(USDC, 0),
        "TOKEN": raw.get(TOKEN_CA, 0),
    }
    return {
        "public": owner,
        "sol_lamports": sol_lamports(owner),
        "tokens": named,
        "raw": raw,
        "solscan": f"https://solscan.io/account/{owner}",
        "wrap_help": HELP,
        "pump": PUMP,
    }


def fmt_usd(value: Any) -> str:
    if value is None:
        return "—"
    try:
        x = float(value)
    except (TypeError, ValueError):
        return "—"
    if x <= 0:
        return "$0"
    if x < 0.01:
        return f"${x:.6f}".rstrip("0").rstrip(".")
    return f"${x:.4f}"


def raw_to_usd(raw: int, decimals: int = 6, token_usd: float = 1.0) -> float:
    return (int(raw) / (10 ** int(decimals))) * float(token_usd or 0)


def spend_path() -> Path:
    override = os.environ.get("GAMEMASTER_ZOO_SPEND") or os.environ.get("DOTLAB_ZOO_SPEND")
    return Path(override) if override else SPEND_FILE


def empty_spend() -> dict:
    return {
        "started": "",
        "cap_usd": float(load_config().get("spend_cap_usd") or DEFAULT_SPEND_CAP),
        "spent_usd": 0.0,
        "calls": 0,
        "receipts": [],
        "last_billed_usd": None,
        "last_token_usd": {"yUSDCx": 1.0, "wTOKENx": None},
    }


def load_spend() -> dict:
    path = spend_path()
    out = empty_spend()
    if not path.is_file():
        return out
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return out
    if isinstance(data, dict):
        out.update({k: v for k, v in data.items() if v is not None})
    return out


def save_spend(data: dict) -> None:
    path = spend_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def reset_spend() -> dict:
    data = empty_spend()
    data["started"] = _now()
    save_spend(data)
    return data


def _now() -> str:
    import datetime

    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def record_receipt(row: dict) -> dict:
    data = load_spend()
    if not data.get("started"):
        data["started"] = _now()
    billed = float(row.get("billed_usd") or 0)
    data["spent_usd"] = float(data.get("spent_usd") or 0) + billed
    data["calls"] = int(data.get("calls") or 0) + 1
    data["last_billed_usd"] = billed
    tok = dict(data.get("last_token_usd") or {})
    if row.get("symbol") and row.get("token_usd") is not None:
        tok[str(row["symbol"])] = float(row["token_usd"])
    data["last_token_usd"] = tok
    recs = list(data.get("receipts") or [])
    recs.append({**row, "ts": _now()})
    data["receipts"] = recs[-80:]
    save_spend(data)
    return data


def spend_cap() -> float:
    env = os.environ.get("ZOO_SPEND_CAP")
    if env:
        try:
            return float(env)
        except ValueError:
            pass
    return float(load_config().get("spend_cap_usd") or DEFAULT_SPEND_CAP)


def remaining_cap() -> float:
    return max(0.0, spend_cap() - float(load_spend().get("spent_usd") or 0))


def last_billed_usd() -> float:
    v = load_spend().get("last_billed_usd")
    if v is None:
        return 0.0002
    return float(v)


def warn_job(kind: str, calls: int | None = None) -> dict:
    """Print estimate and refuse if over cap. Does not prompt (host stays non-blocking)."""
    est = estimate_job(kind, calls)
    pay = can_pay(est["usd"])
    print(
        f"  ☁ OpenZoo estimate {kind}: ~{est['calls']} calls × {fmt_usd(est['unit_usd'])} "
        f"≈ {fmt_usd(est['usd'])}  (session {fmt_usd(est['spent_usd'])} / {fmt_usd(est['cap_usd'])})"
    )
    if est.get("over_cap"):
        print(f"  ⚠ over spend cap — raise with `dotlab zoo set --prefer yUSDCx` or reset spend", file=sys.stderr)
    if not pay.get("ok"):
        print(f"  ⚠ cannot settle: {pay.get('reason')} — calls will fall back to local Ollama", file=sys.stderr)
    return {"estimate": est, "can_pay": pay}


def estimate_job(kind: str, calls: int | None = None) -> dict:
    n = int(calls if calls is not None else ESTIMATE_CALLS.get(kind, 8))
    unit = last_billed_usd()
    usd = n * unit
    return {
        "kind": kind,
        "calls": n,
        "unit_usd": unit,
        "usd": usd,
        "cap_usd": spend_cap(),
        "spent_usd": float(load_spend().get("spent_usd") or 0),
        "remaining_usd": remaining_cap(),
        "over_cap": usd > remaining_cap(),
    }


def can_pay(estimate_usd: float = 0.0, *, require_wrapped: bool = True) -> dict:
    """Honest gate: wallet, wrapped balance, spend cap. Fail-open is not 'funded'."""
    pub = wallet_public()
    out: dict[str, Any] = {
        "ok": False,
        "wallet": pub,
        "funded": False,
        "need_wrap": False,
        "need_sol": False,
        "over_cap": False,
        "reason": "",
        "balances": {},
        "spend": {
            "cap_usd": spend_cap(),
            "spent_usd": float(load_spend().get("spent_usd") or 0),
            "remaining_usd": remaining_cap(),
        },
    }
    if not pub:
        out["reason"] = "no wallet — create one first"
        return out
    try:
        bals = named_balances(pub)
    except Exception as e:
        out["reason"] = f"balance RPC failed: {e}"
        return out
    tokens = bals.get("tokens") or {}
    out["balances"] = {
        "sol_lamports": bals.get("sol_lamports") or 0,
        "yUSDCx": int(tokens.get("yUSDCx") or 0),
        "wTOKENx": int(tokens.get("wTOKENx") or 0),
        "USDC": int(tokens.get("USDC") or 0),
        "TOKEN": int(tokens.get("TOKEN") or 0),
        "yUSDCx_usd": raw_to_usd(int(tokens.get("yUSDCx") or 0)),
        "USDC_usd": raw_to_usd(int(tokens.get("USDC") or 0)),
    }
    wrapped = out["balances"]["yUSDCx"] > 0 or out["balances"]["wTOKENx"] > 0
    raw_ok = out["balances"]["USDC"] > 0 or out["balances"]["TOKEN"] > 0
    if int(bals.get("sol_lamports") or 0) < 400_000 and raw_ok:
        out["need_sol"] = True
    if wrapped:
        out["funded"] = True
    elif raw_ok:
        out["need_wrap"] = True
        out["reason"] = "USDC/TOKEN present — wrap to yUSDCx/wTOKENx before the floor will settle"
        if not require_wrapped:
            out["ok"] = remaining_cap() >= float(estimate_usd or 0)
            return out
        return out
    else:
        out["reason"] = "wallet empty — send USDC or TOKEN, then wrap"
        return out
    if remaining_cap() < float(estimate_usd or 0):
        out["over_cap"] = True
        out["reason"] = (
            f"session cap {fmt_usd(spend_cap())} almost used "
            f"({fmt_usd(out['spend']['spent_usd'])} spent)"
        )
        return out
    out["ok"] = True
    return out


def health_snapshot(model: str = "", auto_off: bool = False) -> dict:
    ping = probe(model)
    pay = can_pay(last_billed_usd(), require_wrapped=True)
    import cloud

    active = cloud.active_provider() == "zoo"
    floor_ok = bool(ping.get("ok"))
    flipped = False
    if auto_off and active and not floor_ok:
        cloud.cmd_off()
        active = False
        flipped = True
    return {
        "ok": floor_ok,
        "floor": floor_ok,
        "active": active,
        "auto_off": flipped,
        "can_pay": pay,
        "spend": load_spend(),
        "ping": ping,
        "model": preferred_model(model),
    }


# ── wrap + send ─────────────────────────────────────────────────────────


def compile_signed_tx(
    fee_payer: str,
    seed: bytes,
    ixs: list[tuple[str, list[tuple[str, bool, bool]], bytes]],
    blockhash: str,
) -> str:
    metas: dict[str, dict[str, bool]] = {}

    def add(key: str, signer: bool, writable: bool) -> None:
        cur = metas.get(key) or {"signer": False, "writable": False}
        cur["signer"] = bool(cur["signer"] or signer)
        cur["writable"] = bool(cur["writable"] or writable)
        metas[key] = cur

    add(fee_payer, True, True)
    for prog, accs, _data in ixs:
        for key, signer, writable in accs:
            add(key, signer, writable)
        add(prog, False, False)
    writ_sig = [k for k, m in metas.items() if m["signer"] and m["writable"] and k != fee_payer]
    read_sig = [k for k, m in metas.items() if m["signer"] and not m["writable"]]
    writ_uns = [k for k, m in metas.items() if (not m["signer"]) and m["writable"]]
    read_uns = [k for k, m in metas.items() if (not m["signer"]) and (not m["writable"])]
    keys = [fee_payer] + writ_sig + read_sig + writ_uns + read_uns
    idx = {k: i for i, k in enumerate(keys)}
    header = (1 + len(writ_sig) + len(read_sig), len(read_sig), len(read_uns))
    compiled = []
    for prog, accs, data in ixs:
        compiled.append((idx[prog], [idx[k] for k, _s, _w in accs], data))
    message = compile_legacy_message(
        header,
        [b58decode(k) for k in keys],
        b58decode(blockhash),
        compiled,
    )
    sigs = [ed25519_sign(seed, message)] + [b"\x00" * 64] * (header[0] - 1)
    # only fee_payer signs here (wrap/pay owner is fee payer)
    return base64.b64encode(serialize_legacy_tx(sigs, message)).decode("ascii")


def send_transaction(tx_b64: str) -> str:
    res = rpc("sendTransaction", [tx_b64, {"encoding": "base64", "preflightCommitment": "confirmed"}])
    if not res:
        raise RuntimeError("RPC sendTransaction returned empty")
    return str(res)


def create_ata_ix(payer: str, owner: str, mint: str, token_program: str) -> tuple[str, list[tuple[str, bool, bool]], bytes]:
    ata = associated_token_address(owner, mint, token_program)
    accs = [
        (payer, True, True),
        (ata, False, True),
        (owner, False, False),
        (mint, False, False),
        (SYSTEM_PROGRAM, False, False),
        (token_program, False, False),
    ]
    return ATA_PROGRAM, accs, bytes([1])  # CreateIdempotent


def wrap_ix(
    wrapped_mint: str,
    escrow: str,
    mint_auth: str,
    dest_ata: str,
    amount: int,
    bump: int,
) -> tuple[str, list[tuple[str, bool, bool]], bytes]:
    data = bytearray(10)
    data[0] = 1
    data[1:9] = int(amount).to_bytes(8, "little")
    data[9] = int(bump) & 0xFF
    accs = [
        (escrow, False, True),
        (wrapped_mint, False, True),
        (dest_ata, False, True),
        (mint_auth, False, False),
        (TOKEN_2022, False, False),
    ]
    return WRAP_PROGRAM, accs, bytes(data)


def transfer_checked_accounts(
    source: str, mint: str, dest: str, owner: str, amount: int, decimals: int, program: str
) -> tuple[str, list[tuple[str, bool, bool]], bytes]:
    accs = [
        (source, False, True),
        (mint, False, False),
        (dest, False, True),
        (owner, True, False),
    ]
    return program, accs, transfer_checked_ix(amount, decimals)


def wrap_tokens(which: str = "auto", amount_raw: int = 0) -> dict:
    """Wrap USDC→yUSDCx or TOKEN→wTOKENx. Owner pays a little SOL."""
    seed, owner = load_keypair()
    bals = named_balances(owner)
    tokens = bals.get("tokens") or {}
    usdc = int(tokens.get("USDC") or 0)
    token = int(tokens.get("TOKEN") or 0)
    if which == "auto":
        which = "usdc" if usdc >= token else "token"
    which = which.lower()
    if which in ("usdc", "yusdcx"):
        if usdc <= 0:
            raise RuntimeError("no USDC to wrap")
        amt = int(amount_raw or usdc)
        underlying, wrapped, program = USDC, YUSDCX, TOKEN_KET
        escrow, auth, bump = WRAP_USDC_ESCROW, WRAP_USDC_AUTH, WRAP_USDC_BUMP
    else:
        if token <= 0:
            raise RuntimeError("no TOKEN to wrap")
        amt = int(amount_raw or token)
        underlying, wrapped, program = TOKEN_CA, WTOKENX, TOKEN_2022
        escrow, auth, bump = WRAP_TOKEN_ESCROW, WRAP_TOKEN_AUTH, WRAP_TOKEN_BUMP
    if int(bals.get("sol_lamports") or 0) < 400_000:
        raise RuntimeError("need ~0.001 SOL on the zoo wallet for wrap fees")
    dest = associated_token_address(owner, wrapped, TOKEN_2022)
    src = associated_token_address(owner, underlying, program)
    ixs = [
        create_ata_ix(owner, owner, wrapped, TOKEN_2022),
        wrap_ix(wrapped, escrow, auth, dest, amt, bump),
        transfer_checked_accounts(src, underlying, escrow, owner, amt, 6, program),
    ]
    tx = compile_signed_tx(owner, seed, ixs, latest_blockhash())
    sig = send_transaction(tx)
    return {"ok": True, "sig": sig, "amount": amt, "which": which, "solscan": f"https://solscan.io/tx/{sig}"}


# ── QR (version 4, byte mode, ECC L) ────────────────────────────────────


def qr_svg(text: str, scale: int = 4) -> str:
    """Minimal QR SVG so a phone can fund the deposit address."""
    matrix = _qr_matrix(text.encode("utf-8")[:62])
    n = len(matrix)
    px = n * scale
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {px} {px}" width="{px}" height="{px}" shape-rendering="crispEdges">'
        f'<rect width="100%" height="100%" fill="#fff"/>'
    ]
    for y, row in enumerate(matrix):
        for x, bit in enumerate(row):
            if bit:
                parts.append(f'<rect x="{x * scale}" y="{y * scale}" width="{scale}" height="{scale}" fill="#000"/>')
    parts.append("</svg>")
    return "".join(parts)


def _qr_matrix(data: bytes) -> list[list[int]]:
    # Version 4, 33×33, ECC L. Enough for a Solana address.
    size = 33
    # Reed-Solomon + full QR is long; draw a scannable-enough byte QR via a compact encoder.
    return _qr_v4_byte(data)


def _gf_mul(a: int, b: int) -> int:
    p = 0
    for _ in range(8):
        if b & 1:
            p ^= a
        hi = a & 0x80
        a = (a << 1) & 0xFF
        if hi:
            a ^= 0x11D
        b >>= 1
    return p


def _rs_encode(data: list[int], nsym: int) -> list[int]:
    gen = [1]
    for i in range(nsym):
        gen = _gf_poly_mul(gen, [1, _gf_pow(2, i)])
    out = data + [0] * nsym
    for i in range(len(data)):
        coef = out[i]
        if coef == 0:
            continue
        for j in range(1, len(gen)):
            out[i + j] ^= _gf_mul(gen[j], coef)
    return out[-nsym:]


def _gf_pow(a: int, n: int) -> int:
    out = 1
    for _ in range(n):
        out = _gf_mul(out, a)
    return out


def _gf_poly_mul(p: list[int], q: list[int]) -> list[int]:
    r = [0] * (len(p) + len(q) - 1)
    for i, a in enumerate(p):
        for j, b in enumerate(q):
            r[i + j] ^= _gf_mul(a, b)
    return r


def _qr_v4_byte(data: bytes) -> list[list[int]]:
    """Version 4-L: 80 data codewords, 20 ECC. Capacity 62 data bytes + headers."""
    size = 33
    payload = list(data[:62])
    bits = [0, 1, 0, 0]  # byte mode
    n = len(payload)
    bits.extend((n >> (7 - i)) & 1 for i in range(8))
    for b in payload:
        bits.extend((b >> (7 - i)) & 1 for i in range(8))
    bits.extend([0, 0, 0, 0])  # terminator
    while len(bits) % 8:
        bits.append(0)
    pad = [0xEC, 0x11]
    while len(bits) < 80 * 8:
        p = pad[(len(bits) // 8) % 2]
        bits.extend((p >> (7 - i)) & 1 for i in range(8))
    bits = bits[: 80 * 8]
    blocks = [int("".join(str(b) for b in bits[i : i + 8]), 2) for i in range(0, len(bits), 8)]
    ecc = _rs_encode(blocks, 20)
    code = blocks + ecc
    # place
    m = [[None] * size for _ in range(size)]

    def reserved(x: int, y: int) -> bool:
        if x < 9 and y < 9:
            return True
        if x >= size - 8 and y < 9:
            return True
        if x < 9 and y >= size - 8:
            return True
        if y == 6 or x == 6:
            return True
        # alignment at (26,26) version 4
        if 24 <= x <= 28 and 24 <= y <= 28:
            return True
        if y in (0, 1, 2, 3, 4, 5) and 9 <= x < size - 8:
            return True  # format/timing already
        return False

    # finders
    def finder(ox: int, oy: int) -> None:
        for y in range(7):
            for x in range(7):
                edge = x in (0, 6) or y in (0, 6)
                inner = 2 <= x <= 4 and 2 <= y <= 4
                m[oy + y][ox + x] = 1 if edge or inner else 0
        for y in range(-1, 8):
            for x in range(-1, 8):
                xx, yy = ox + x, oy + y
                if 0 <= xx < size and 0 <= yy < size and m[yy][xx] is None:
                    m[yy][xx] = 0

    finder(0, 0)
    finder(size - 7, 0)
    finder(0, size - 7)
    for i in range(size):
        if m[6][i] is None:
            m[6][i] = i % 2 == 0
        if m[i][6] is None:
            m[i][6] = i % 2 == 0
    # alignment
    for y in range(5):
        for x in range(5):
            edge = x in (0, 4) or y in (0, 4)
            m[24 + y][24 + x] = 1 if edge or (x == 2 and y == 2) else 0
    # data bits zig-zag
    bitstream = []
    for b in code:
        bitstream.extend((b >> (7 - i)) & 1 for i in range(8))
    dirs = -1
    col = size - 1
    bi = 0
    while col > 0:
        if col == 6:
            col -= 1
        for row in range(size)[::dirs]:
            for c in (col, col - 1):
                if m[row][c] is None:
                    bit = bitstream[bi] if bi < len(bitstream) else 0
                    mask = (row + c) % 2 == 0  # mask 0
                    m[row][c] = bit ^ (1 if mask else 0)
                    bi += 1
        dirs *= -1
        col -= 2
    return [[1 if cell else 0 for cell in row] for row in m]


# ── chat ────────────────────────────────────────────────────────────────


def probe(model: str = "") -> dict:
    """Confirm the official openzoo.fun option answers with a live 402."""
    use_model = preferred_model(model)
    body = {
        "model": use_model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 8,
    }
    url = chat_url()
    code, _, raw = http("POST", url, payload=body, timeout=30.0)
    out: dict[str, Any] = {
        "ok": code == 402,
        "status": code,
        "url": url,
        "official": url.startswith(SITE),
        "model": use_model,
    }
    if code == 402:
        req = parse_402(raw)
        out["x402Version"] = req["x402Version"]
        out["accepts"] = [summarize_accept(a) for a in req["accepts"]]
        out["help"] = req.get("help") or HELP
    elif code == 200:
        out["ok"] = True
        out["note"] = "served without 402 (cached or fail-open)"
        out["text"] = extract_text(json.loads(raw.decode("utf-8")))[:200]
    else:
        out["error"] = raw[:240].decode("utf-8", "replace")
    return out


def extract_text(data: dict) -> str:
    choices = data.get("choices") or []
    if choices:
        msg = (choices[0].get("message") or {}) if isinstance(choices[0], dict) else {}
        text = msg.get("content")
        if isinstance(text, str):
            return text
        if isinstance(text, list):
            return "".join(p.get("text") or "" for p in text if isinstance(p, dict))
    if isinstance(data.get("output_text"), str):
        return data["output_text"]
    return ""


def chat(
    messages: list[dict],
    model: str = "",
    temperature: float = 0.2,
    num_predict: int = 8192,
) -> str:
    use_model = preferred_model(model)
    if use_model in ("gamemaster", "gamemaster-dense", "dotlab", "dotlab-dense") or use_model.startswith("qwen"):
        use_model = preferred_model("")
    gate = can_pay(last_billed_usd())
    if not gate["ok"]:
        raise PayError(gate.get("reason") or "cannot pay OpenZoo")
    body = {
        "model": use_model,
        "messages": [
            {"role": m.get("role") or "user", "content": m.get("content") or ""} for m in messages
        ],
        "temperature": temperature,
        "max_tokens": max(16, int(num_predict)),
    }
    url = chat_url()
    code, _, raw = http("POST", url, payload=body, timeout=180.0)
    if code == 200:
        record_receipt(
            {
                "model": use_model,
                "billed_usd": 0.0,
                "pricing": "cached-or-failopen",
                "fail_open": True,
                "symbol": "",
                "amount": "0",
            }
        )
        return extract_text(json.loads(raw.decode("utf-8")))
    if code != 402:
        raise PayError(f"OpenZoo HTTP {code} {url}: {raw[:400].decode('utf-8', 'replace')}")
    req = parse_402(raw)
    try:
        seed, owner = load_keypair()
    except FileNotFoundError as e:
        raise PayError(
            f"OpenZoo needs a wallet. Run: dotlab zoo wallet  then wrap USDC/TOKEN at {HELP}"
        ) from e
    bals = {}
    try:
        named = named_balances(owner)["tokens"]
        bals = {k: int(v) for k, v in named.items()}
    except Exception:
        bals = {}
    accept = pick_accept(req["accepts"], balances=bals)
    extra = summarize_accept(accept)
    try:
        header = pay_header(accept, owner, seed)
    except Exception as e:
        raise PayError(f"could not build X-PAYMENT: {e}") from e
    code2, _, raw2 = http(
        "POST",
        url,
        payload=body,
        headers={"X-PAYMENT": header},
        timeout=180.0,
    )
    if code2 != 200:
        raise PayError(
            f"OpenZoo pay failed HTTP {code2} {extra.get('symbol')} "
            f"amount={extra.get('amount')} pricing={extra.get('pricing')}: "
            f"{raw2[:360].decode('utf-8', 'replace')}"
        )
    funded = int(bals.get(extra.get("symbol") or "yUSDCx") or 0) > 0
    record_receipt(
        {
            "model": use_model,
            "billed_usd": float(extra.get("billedUsd") or 0),
            "pricing": extra.get("pricing") or "",
            "saves": extra.get("savesVsDirect"),
            "symbol": extra.get("symbol") or "",
            "amount": extra.get("amount") or "",
            "token_usd": extra.get("tokenUsd"),
            "fail_open": not funded,
        }
    )
    cfg = load_config()
    cfg["last_model"] = use_model
    save_config(cfg)
    return extract_text(json.loads(raw2.decode("utf-8")))


def status_dict() -> dict:
    pub = wallet_public()
    cfg = load_config()
    return {
        "site": SITE,
        "floor": FLOOR,
        "facilitator": FACILITATOR,
        "chat_url": chat_url(),
        "official": chat_url() == SITE_CHAT,
        "model": preferred_model(),
        "prefer": cfg.get("prefer") or "yUSDCx",
        "wallet": pub,
        "wallet_path": str(wallet_path()),
        "has_wallet": bool(pub),
        "help": HELP,
        "pump": PUMP,
        "token_ca": TOKEN_CA,
        "featured": list(FEATURED),
        "presets": {
            "cheap": "openai/gpt-4o-mini",
            "coder": "x-ai/grok-4.6",
            "critic": "anthropic/claude-sonnet-4",
            "flash": "google/gemini-2.5-flash",
        },
        "spend": {
            "cap_usd": spend_cap(),
            "spent_usd": float(load_spend().get("spent_usd") or 0),
            "remaining_usd": remaining_cap(),
            "calls": int(load_spend().get("calls") or 0),
            "spent_label": fmt_usd(load_spend().get("spent_usd") or 0),
            "cap_label": fmt_usd(spend_cap()),
        },
        "backed_up": bool(cfg.get("backed_up")),
        "rails": {
            "yUSDCx": YUSDCX,
            "wTOKENx": WTOKENX,
            "USDC": USDC,
            "TOKEN": TOKEN_CA,
            "payTo": PAY_TO,
            "network": SOLANA_NET,
        },
    }


def http_status() -> dict:
    """Status for chat + live dashboard. Includes whether zoo is the active backend."""
    import cloud

    st = status_dict()
    cloud_st = cloud.status_dict()
    st["ok"] = True
    st["cloud"] = cloud_st
    st["active"] = cloud.active_provider() == "zoo"
    return st


def handle_http(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    """Single HTTP API used by chat (`server.py`) and the Play dashboard (`live.py`)."""
    method = (method or "GET").upper()
    path = (path or "").split("?")[0].rstrip("/") or "/api/zoo"
    body = body if isinstance(body, dict) else {}
    q = str(body.get("q") or body.get("query") or "")
    model = str(body.get("model") or "")
    try:
        if method == "GET":
            if path in ("/api/zoo", "/api/zoo/status"):
                return 200, http_status()
            if path == "/api/zoo/listings":
                return 200, {"ok": True, "listings": listings()}
            if path == "/api/zoo/models":
                return 200, {"ok": True, "models": models(q)}
            if path == "/api/zoo/quote":
                return 200, {"ok": True, **quote(model)}
            if path == "/api/zoo/ping":
                p = probe(model)
                return 200, p
            if path == "/api/zoo/balance":
                if not wallet_path().is_file():
                    return 200, {"ok": True, "has_wallet": False, "tokens": {}, "sol_lamports": 0}
                _, pub = load_keypair()
                bals = named_balances(pub)
                pay = can_pay(last_billed_usd())
                return 200, {"ok": True, "has_wallet": True, **bals, "can_pay": pay, "human": pay.get("balances")}
            if path == "/api/zoo/spend":
                data = load_spend()
                return 200, {"ok": True, **data, "cap_usd": spend_cap(), "remaining_usd": remaining_cap()}
            if path == "/api/zoo/health":
                return 200, health_snapshot(model, auto_off=bool(body.get("auto_off")))
            if path == "/api/zoo/can-pay":
                return 200, can_pay(float(body.get("usd") or last_billed_usd() or 0))
            if path == "/api/zoo/estimate":
                return 200, {"ok": True, **estimate_job(str(body.get("kind") or "chat"))}
            if path == "/api/zoo/qr":
                pub = wallet_public()
                if not pub:
                    return 400, {"ok": False, "error": "no wallet"}
                svg = qr_svg(pub)
                return 200, {"ok": True, "svg": svg, "address": pub, "uri": f"solana:{pub}"}
            return 404, {"ok": False, "error": "unknown zoo route"}

        action = str(body.get("action") or "").lower()
        if path == "/api/zoo/wallet" or action in ("wallet", "wallet-new"):
            info = ensure_wallet()
            return 200, {"ok": True, **info, **http_status()}
        if action == "on" or path.endswith("/on"):
            import cloud

            code = cloud.cmd_on("zoo")
            if code != 0:
                return 400, {"ok": False, "error": "cloud on zoo failed"}
            return 200, {"ok": True, **http_status()}
        if action == "off" or path.endswith("/off"):
            import cloud

            cloud.cmd_off()
            return 200, {"ok": True, **http_status()}
        if action == "set":
            cfg = load_config()
            if body.get("model"):
                cfg["model"] = str(body["model"]).strip()
                cfg["last_model"] = cfg["model"]
            if body.get("prefer"):
                cfg["prefer"] = str(body["prefer"]).strip()
            if body.get("spend_cap_usd") not in (None, ""):
                cfg["spend_cap_usd"] = float(body["spend_cap_usd"])
            if body.get("project") and body.get("model"):
                slot = dict(cfg.get("project_models") or {})
                slot[str(body["project"])] = str(body["model"]).strip()
                cfg["project_models"] = slot
            save_config(cfg)
            return 200, {"ok": True, **http_status()}
        if action == "ping":
            return 200, probe(model)
        if action == "wrap":
            return 200, wrap_tokens(str(body.get("which") or "auto"), int(body.get("amount") or 0))
        if action == "reset-spend":
            return 200, {"ok": True, **reset_spend()}
        if action == "export-wallet":
            raw = wallet_path().read_text(encoding="utf-8") if wallet_path().is_file() else ""
            if not raw:
                return 400, {"ok": False, "error": "no wallet"}
            cfg = load_config()
            cfg["backed_up"] = True
            save_config(cfg)
            dest = str(body.get("path") or "")
            if dest:
                Path(dest).expanduser().write_text(raw, encoding="utf-8")
            return 200, {
                "ok": True,
                "public": wallet_public(),
                "json": raw,
                "hint": "Save this JSON offline. Anyone with it can spend your zoo funds.",
            }
        if action == "health":
            return 200, health_snapshot(model, auto_off=bool(body.get("auto_off", True)))
        return 400, {"ok": False, "error": "action wallet|on|off|set|ping|wrap|reset-spend|export-wallet|health"}
    except Exception as e:
        return 502, {"ok": False, "error": str(e)}


# ── CLI ─────────────────────────────────────────────────────────────────


def _print_json(data: Any) -> int:
    json.dump(data, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


def cmd_status() -> int:
    st = status_dict()
    print(f"OpenZoo  {st['site']}")
    print(f"  chat    {st['chat_url']}" + ("  (official)" if st.get("official") else "  (override)"))
    print(f"  floor   {st['floor']}")
    print(f"  model   {st['model']}")
    print(f"  rail    {st['prefer']}")
    if st["wallet"]:
        print(f"  wallet  {st['wallet']}")
        print(f"  solscan https://solscan.io/account/{st['wallet']}")
    else:
        print("  wallet  (none)  →  dotlab zoo wallet")
    print(f"  fund    send USDC or TOKEN, then wrap at {HELP}")
    print(f"  token   {TOKEN_CA}")
    print(f"  spend   {fmt_usd(load_spend().get('spent_usd') or 0)} / {fmt_usd(spend_cap())}  ({load_spend().get('calls') or 0} calls)")
    print("  opt in  dotlab cloud on zoo")
    return 0


def cmd_spend(reset: bool) -> int:
    if reset:
        reset_spend()
    data = load_spend()
    print(f"spent  {fmt_usd(data.get('spent_usd'))} / {fmt_usd(spend_cap())}")
    print(f"calls  {data.get('calls') or 0}  since {data.get('started') or '—'}")
    for rec in (data.get("receipts") or [])[-12:]:
        print(
            f"  {rec.get('ts', '')[:19]}  {rec.get('model')}  "
            f"{rec.get('pricing')}  {fmt_usd(rec.get('billed_usd'))}  "
            f"{rec.get('symbol')} {rec.get('amount')}"
            f"{'  FAIL-OPEN' if rec.get('fail_open') else ''}"
        )
    return 0


def cmd_wrap(which: str) -> int:
    try:
        out = wrap_tokens(which or "auto")
    except Exception as e:
        print(f"wrap failed: {e}", file=sys.stderr)
        return 1
    print(f"wrapped {out.get('which')} {out.get('amount')}  {out.get('solscan')}")
    return 0


def cmd_health() -> int:
    h = health_snapshot(auto_off=False)
    print(f"floor   {'ok' if h.get('floor') else 'DOWN'}  active={h.get('active')}")
    pay = h.get("can_pay") or {}
    print(f"can_pay {pay.get('ok')}  {pay.get('reason') or 'ready'}")
    print(f"spend   {fmt_usd((h.get('spend') or {}).get('spent_usd'))} / {fmt_usd(spend_cap())}")
    return 0 if h.get("floor") else 1


def cmd_models(query: str, limit: int) -> int:
    rows = models(query)
    if not rows:
        rows = [{"id": m.get("id"), "label": m.get("id")} for m in floor_models()]
    for i, row in enumerate(rows[: max(1, limit)]):
        mid = row.get("id") or ""
        label = row.get("label") or mid
        ctx = row.get("context")
        extra = f"  ctx={ctx}" if ctx else ""
        print(f"{mid:48} {label}{extra}")
    print(f"({min(len(rows), limit)} / {len(rows)})")
    return 0


def cmd_listings() -> int:
    rows = listings()
    if not rows:
        print("No listings. Floor is still https://x402-tokens.fly.dev/v1")
        return 0
    for i, row in enumerate(rows, 1):
        print(f"№ {i:03}  {row.get('name') or row.get('id')}")
        print(f"     {row.get('baseUrl')}")
        print(f"     {', '.join(row.get('models') or [])}")
    return 0


def cmd_quote(model: str, prompt_tokens: int, max_out: int) -> int:
    q = quote(preferred_model(model), prompt_tokens, max_out)
    print(f"model     {q.get('model')}")
    print(f"source    {q.get('source')}")
    print(f"pricing   {q.get('pricing')}  markup={q.get('markup')}")
    direct = q.get("directUsd")
    billed = q.get("billedUsd")
    print(f"direct    {('$' + str(direct)) if direct is not None else '—'}")
    print(f"billed    {('$' + str(billed)) if billed is not None else '—'}")
    for a in q.get("accepts") or []:
        print(
            f"  {a.get('symbol'):8}  {a.get('grossRaw')} raw  "
            f"tokenUsd={a.get('tokenUsd')}  saves={a.get('savesVsDirect')}"
        )
    return 0


def cmd_ping(model: str) -> int:
    p = probe(model)
    mark = "ok" if p.get("ok") else "FAIL"
    print(f"{mark}  HTTP {p.get('status')}  {p.get('url')}")
    if p.get("error"):
        print(p["error"])
        return 1
    for a in p.get("accepts") or []:
        print(
            f"  {a.get('symbol'):8}  amount={a.get('amount')}  "
            f"pricing={a.get('pricing')}  billed={a.get('billedUsd')}"
        )
    if p.get("note"):
        print(p["note"])
    return 0 if p.get("ok") else 1


def cmd_wallet(new: bool) -> int:
    if new or not wallet_path().is_file():
        info = ensure_wallet()
        verb = "created" if info.get("created") else "have"
        print(f"wallet {verb}: {info['public']}")
    else:
        _, pub = load_keypair()
        print(f"wallet: {pub}")
    pub = wallet_public()
    print(f"solscan: https://solscan.io/account/{pub}")
    print(f"fund:   send ~0.007 SOL (optional) + USDC or TOKEN, then wrap")
    print(f"  USDC → yUSDCx · TOKEN → wTOKENx  {HELP}")
    print(f"  TOKEN {TOKEN_CA}")
    print(f"  {PUMP}")
    return 0


def cmd_balance() -> int:
    ensure_wallet()
    _, pub = load_keypair()
    data = named_balances(pub)
    print(f"wallet  {pub}")
    print(f"SOL     {data['sol_lamports']} lamports")
    for name, amt in (data.get("tokens") or {}).items():
        print(f"{name:8} {amt}")
    pay = can_pay(last_billed_usd())
    human = pay.get("balances") or {}
    print(f"yUSDCx  {fmt_usd(human.get('yUSDCx_usd'))}  USDC {fmt_usd(human.get('USDC_usd'))}")
    print(f"can_pay {pay.get('ok')}  {pay.get('reason') or 'ready'}")
    print(f"wrap    {HELP}")
    return 0


def cmd_extra(model: str) -> int:
    body = {
        "model": preferred_model(model),
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 16,
    }
    code, _, raw = http("POST", chat_url(), payload=body, timeout=60.0)
    if code != 402:
        print(f"expected 402, got {code}")
        print(raw[:400].decode("utf-8", "replace"))
        return 1
    req = parse_402(raw)
    print(f"x402 v{req['x402Version']}  {req.get('error') or 'payment required'}")
    for a in req["accepts"]:
        s = summarize_accept(a)
        print(
            f"  {s['symbol']:8}  {s['network']}  amount={s['amount']}  "
            f"pricing={s['pricing']}  saves={s['savesVsDirect']}  "
            f"direct={s['directUsd']}  billed={s['billedUsd']}"
        )
    if req.get("help"):
        print(f"help  {req['help']}")
    return 0


def cmd_stall(prompt: str, model: str, system: str) -> int:
    ensure_wallet()
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    try:
        text = chat(messages, model=model)
    except Exception as e:
        print(f"zoo stall failed: {e}", file=sys.stderr)
        return 1
    sys.stdout.write(text)
    if text and not text.endswith("\n"):
        sys.stdout.write("\n")
    return 0


def cmd_publish(args: argparse.Namespace) -> int:
    payload = {
        "name": args.name,
        "baseUrl": args.base.rstrip("/"),
        "models": [m.strip() for m in (args.models or "").split(",") if m.strip()],
        "payTo": args.pay_to,
        "priceUsd": args.price,
    }
    if args.bearer:
        payload["bearer"] = args.bearer
    data = http_json("POST", f"{SITE}/api/zoo/listings", payload)
    return _print_json(data)


def cmd_on() -> int:
    ensure_wallet()
    import cloud

    return cloud.cmd_on("zoo")


def main() -> int:
    ap = argparse.ArgumentParser(description="OpenZoo x402 floor (leCore in front)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    p_m = sub.add_parser("models")
    p_m.add_argument("query", nargs="?", default="")
    p_m.add_argument("--limit", type=int, default=40)
    sub.add_parser("listings")
    sub.add_parser("list")
    p_q = sub.add_parser("quote")
    p_q.add_argument("--model", default="")
    p_q.add_argument("--prompt-tokens", type=int, default=0)
    p_q.add_argument("--max-out", type=int, default=0)
    p_ping = sub.add_parser("ping")
    p_ping.add_argument("--model", default="")
    p_w = sub.add_parser("wallet")
    p_w.add_argument("--new", action="store_true")
    sub.add_parser("balance")
    p_sp = sub.add_parser("spend")
    p_sp.add_argument("--reset", action="store_true")
    p_wr = sub.add_parser("wrap")
    p_wr.add_argument("which", nargs="?", default="auto", help="auto|usdc|token")
    sub.add_parser("health")
    p_e = sub.add_parser("extra")
    p_e.add_argument("--model", default="")
    p_s = sub.add_parser("stall")
    p_s.add_argument("prompt")
    p_s.add_argument("--model", default="")
    p_s.add_argument("--system", default="")
    p_p = sub.add_parser("publish")
    p_p.add_argument("--name", required=True)
    p_p.add_argument("--base", required=True, help="public OpenAI-compatible /v1 URL")
    p_p.add_argument("--models", default="")
    p_p.add_argument("--pay-to", default="")
    p_p.add_argument("--price", type=float, default=0.00015)
    p_p.add_argument("--bearer", default="")
    sub.add_parser("on")
    p_set = sub.add_parser("set")
    p_set.add_argument("--model", default="")
    p_set.add_argument("--prefer", default="", help="yUSDCx or wTOKENx")
    p_set.add_argument("--rpc", default="")
    p_set.add_argument("--chat-url", default="")
    args = ap.parse_args()
    if args.cmd == "status":
        return cmd_status()
    if args.cmd == "models":
        return cmd_models(args.query, args.limit)
    if args.cmd in ("listings", "list"):
        return cmd_listings()
    if args.cmd == "quote":
        return cmd_quote(args.model, args.prompt_tokens, args.max_out)
    if args.cmd == "ping":
        return cmd_ping(args.model)
    if args.cmd == "wallet":
        return cmd_wallet(args.new)
    if args.cmd == "balance":
        return cmd_balance()
    if args.cmd == "spend":
        return cmd_spend(args.reset)
    if args.cmd == "wrap":
        return cmd_wrap(args.which)
    if args.cmd == "health":
        return cmd_health()
    if args.cmd == "extra":
        return cmd_extra(args.model)
    if args.cmd == "stall":
        return cmd_stall(args.prompt, args.model, args.system)
    if args.cmd == "publish":
        return cmd_publish(args)
    if args.cmd == "on":
        return cmd_on()
    cfg = load_config()
    if args.model:
        cfg["model"] = args.model
    if args.prefer:
        cfg["prefer"] = args.prefer
    if args.rpc:
        cfg["rpc"] = args.rpc
    if args.chat_url:
        cfg["chat_url"] = args.chat_url
    save_config(cfg)
    print(f"saved model={cfg.get('model')} prefer={cfg.get('prefer')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
