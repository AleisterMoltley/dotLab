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
# Published rail decimals (openzoo.fun/.well-known/x402.json). Not a guess.
RAIL_DECIMALS = {YUSDCX: 6, WTOKENX: 6, USDC: 6}

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_B58_IDX = {c: i for i, c in enumerate(B58)}
ED25519_P = 2**255 - 19
ED25519_D = (-121665 * pow(121666, ED25519_P - 2, ED25519_P)) % ED25519_P

CONFIG_FILE = CONFIG / "zoo.json"
WALLET_FILE = CONFIG / "zoo-wallet.json"


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


def preferred_model(override: str = "") -> str:
    return (
        (override or "").strip()
        or os.environ.get("GAMEMASTER_CLOUD_MODEL")
        or os.environ.get("ZOO_MODEL")
        or str(load_config().get("model") or "")
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
        return extract_text(json.loads(raw.decode("utf-8")))
    if code != 402:
        raise RuntimeError(f"OpenZoo HTTP {code} {url}: {raw[:400].decode('utf-8', 'replace')}")
    req = parse_402(raw)
    try:
        seed, owner = load_keypair()
    except FileNotFoundError:
        raise RuntimeError(
            f"OpenZoo needs a wallet. Run: dotlab zoo wallet  then wrap USDC/TOKEN at {HELP}"
        ) from None
    bals = {}
    try:
        named = named_balances(owner)["tokens"]
        bals = {k: int(v) for k, v in named.items()}
    except Exception:
        bals = {}
    accept = pick_accept(req["accepts"], balances=bals)
    header = pay_header(accept, owner, seed)
    code2, _, raw2 = http(
        "POST",
        url,
        payload=body,
        headers={"X-PAYMENT": header},
        timeout=180.0,
    )
    if code2 != 200:
        extra = summarize_accept(accept)
        raise RuntimeError(
            f"OpenZoo pay failed HTTP {code2} {extra.get('symbol')} "
            f"amount={extra.get('amount')} pricing={extra.get('pricing')}: "
            f"{raw2[:360].decode('utf-8', 'replace')}"
        )
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
                return 200, {"ok": True, "has_wallet": True, **named_balances(pub)}
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
            if body.get("prefer"):
                cfg["prefer"] = str(body["prefer"]).strip()
            save_config(cfg)
            return 200, {"ok": True, **http_status()}
        if action == "ping":
            return 200, probe(model)
        return 400, {"ok": False, "error": "action wallet|on|off|set|ping"}
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
    print("  opt in  dotlab cloud on zoo")
    return 0


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
