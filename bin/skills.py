#!/usr/bin/env python3
"""
Studio skill catalog — discoverable, callable, honest.

A skill this catalog cannot surface does not exist.
Route-or-abstain: below the noise floor we say so instead of guessing.

  gamemaster skills list
  gamemaster skills suggest "juice the jump"
  gamemaster skills route "make it gold"
  gamemaster skills card set_feel
  gamemaster skills check
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from typing import Any

SCHEMA_VERSION = 1

# Host-owned agent tools (must match agent.run_tool).
AGENT_TOOLS = (
    "list_dir",
    "read_file",
    "apply_patch",
    "write_file",
    "game_ops",
    "search",
    "run",
    "kit",
    "skills",
    "done",
)

# Decision floors. Measured against the catalog's own vocabulary — keep loud.
MIN_ACT = 0.55
MIN_CHOOSE = 0.28
MIN_Z = 0.8

_STOP = frozenset(
    "a an the to of for in on and or is it my this that with from into me we you "
    "as at be by do if no not so vs up out how what when where who why can should "
    "please just some any all".split()
)
_WORD = re.compile(r"[a-z0-9]+")


def _skill(
    name: str,
    kind: str,
    does: str,
    example: str,
    aliases: tuple[str, ...] | list[str],
    invoke: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "name": name,
        "kind": kind,
        "does": does,
        "example": example,
        "aliases": list(aliases),
        "invoke": invoke or {},
    }


def catalog() -> list[dict[str, Any]]:
    """Source of truth. Add a skill here or it does not exist."""
    agent = [
        _skill(
            "list_dir",
            "agent",
            "List files in the game folder.",
            "tool call list_dir\npath: src",
            ("list files", "ls", "what's in the folder", "directory", "tree"),
            {"tool": "list_dir", "args": {"path": "."}},
        ),
        _skill(
            "read_file",
            "agent",
            "Read a project file (optional line slice).",
            "tool call read_file\npath: src/game.js\nstart: 1\nend: 80",
            ("read file", "open file", "show source", "look at game.js", "inspect"),
            {"tool": "read_file", "args": {"path": "src/game.js"}},
        ),
        _skill(
            "apply_patch",
            "agent",
            "Surgical search/replace in one file. Prefer this over full rewrites.",
            "tool call apply_patch\npath: src/game.js\nsearch:\nold\nreplace:\nnew",
            ("patch code", "search replace", "edit file", "fix this function", "surgical edit"),
            {"tool": "apply_patch", "args": {"path": "src/game.js"}},
        ),
        _skill(
            "write_file",
            "agent",
            "Write a new file (full replace of large game.js is blocked).",
            "tool call write_file\npath: src/systems/foo.js\ncontent:\nexport const x = 1",
            ("write file", "create file", "new module", "add a file"),
            {"tool": "write_file", "args": {"path": "src/systems/foo.js"}},
        ),
        _skill(
            "game_ops",
            "agent",
            "Host applies typed events (feel, counts, palette, flags). LLM proposes only.",
            'tool call game_ops\nevents:\n[{"type":"set_feel","gravity":28}]',
            ("game ops", "typed events", "host apply", "set feel", "event protocol"),
            {"tool": "game_ops", "args": {"events": "[]"}},
        ),
        _skill(
            "search",
            "agent",
            "Regex search across the project source.",
            "tool call search\nquery: jumpForce|coyoteMs",
            ("search code", "find in files", "grep", "where is gravity"),
            {"tool": "search", "args": {"query": "CONFIG"}},
        ),
        _skill(
            "run",
            "agent",
            "Run a short safe command in the project (no sudo, secrets stripped).",
            "tool call run\ncmd: npm run build",
            ("run command", "npm test", "shell", "build the game"),
            {"tool": "run", "args": {"cmd": "npm run build"}},
        ),
        _skill(
            "kit",
            "agent",
            "Todos, wiki, map, feel audit, art-test, verify, vendor pixel kit.",
            "tool call kit\naction: feel",
            ("todo", "feel audit", "art test", "wiki add", "pixel kit", "kit verify"),
            {"tool": "kit", "args": {"action": "feel"}},
        ),
        _skill(
            "skills",
            "agent",
            "Ask the catalog which skill matches a task. Abstain if none do.",
            "tool call skills\naction: route\ntask: juice the jump",
            ("find capability", "what can you do", "which tool", "skill catalog", "route or abstain"),
            {"tool": "skills", "args": {"action": "route", "task": ""}},
        ),
        _skill(
            "done",
            "agent",
            "Finish the agent loop. Host still grades the slice; P0 fail blocks done.",
            "tool call done\nsummary: what + how to test",
            ("finish", "i'm done", "complete the task", "ship it"),
            {"tool": "done", "args": {"summary": ""}},
        ),
    ]
    ops = [
        _skill(
            "set_feel",
            "ops",
            "Set CONFIG feel numbers (gravity, jump, coyote, camera). Host-owned.",
            '{"type":"set_feel","gravity":28,"jumpForce":11}',
            (
                "juice the jump",
                "tighter jump",
                "floaty",
                "coyote time",
                "gravity",
                "move speed",
                "snappy controls",
                "feel numbers",
                "faster movement",
                "camera lag",
            ),
            {"type": "set_feel"},
        ),
        _skill(
            "set_counts",
            "ops",
            "Set enemy/coin/room/juice counts.",
            '{"type":"set_counts","enemyCount":5,"coinCount":8}',
            ("more enemies", "more coins", "enemy count", "room count", "juice count"),
            {"type": "set_counts"},
        ),
        _skill(
            "set_palette",
            "ops",
            "Lock the Three/pixel palette id.",
            '{"type":"set_palette","id":"neon-ink"}',
            ("change palette", "color palette", "colour scheme", "make it neon"),
            {"type": "set_palette"},
        ),
        _skill(
            "set_vintage_palette",
            "ops",
            "Set a Game Boy / GBC / GBA palette (dmg, gbc-*).",
            '{"type":"set_vintage_palette","id":"dmg"}',
            ("game boy palette", "dmg greens", "gbc palette", "vintage colors"),
            {"type": "set_vintage_palette"},
        ),
        _skill(
            "set_engine",
            "ops",
            "Switch host engine: three | pixel | vintage.",
            '{"type":"set_engine","engine":"pixel"}',
            ("switch engine", "pixel engine", "vintage mode", "three.js engine"),
            {"type": "set_engine"},
        ),
        _skill(
            "set_genre",
            "ops",
            "Recompile genre tables; keeps the current engine.",
            '{"type":"set_genre","genre":"platformer"}',
            ("change genre", "make it a platformer", "fps genre", "runner genre"),
            {"type": "set_genre"},
        ),
        _skill(
            "set_flag",
            "ops",
            "Set a named flag in .dotlab/flags.json.",
            '{"type":"set_flag","flag":"met_npc","value":true}',
            ("set flag", "story flag", "met npc", "unlock flag"),
            {"type": "set_flag"},
        ),
        _skill(
            "lock",
            "ops",
            "Lock a path so later ops cannot overwrite it.",
            '{"type":"lock","path":"feel.gravity"}',
            ("lock gravity", "don't change feel", "freeze palette", "lock this number"),
            {"type": "lock"},
        ),
        _skill(
            "unlock",
            "ops",
            "Remove a lock so ops can write that path again.",
            '{"type":"unlock","path":"feel.gravity"}',
            ("unlock gravity", "allow feel edits", "unfreeze"),
            {"type": "unlock"},
        ),
        _skill(
            "add_room",
            "ops",
            "Host adds one more room (no LLM rewrite).",
            '{"type":"add_room"}',
            ("add a room", "one more room", "another room", "extra room"),
            {"type": "add_room"},
        ),
        _skill(
            "craft",
            "ops",
            "Instant continue patch from a short feel/juice phrase. No LLM.",
            '{"type":"craft","text":"tighter snappy controls"}',
            ("juice it", "faster", "tighter", "instant craft", "continue patch"),
            {"type": "craft"},
        ),
        _skill(
            "request_context",
            "ops",
            "Pull targeted knowledge packs (feel, ship-bar, vintage…).",
            '{"type":"request_context","topics":["feel","ship-bar"]}',
            ("request context", "load feel tables", "knowledge for this"),
            {"type": "request_context"},
        ),
        _skill(
            "note",
            "ops",
            "Audit-only note. Changes nothing.",
            '{"type":"note","text":"player liked dash"}',
            ("leave a note", "remember this", "audit note"),
            {"type": "note"},
        ),
    ]
    cli = [
        _skill(
            "scaffold",
            "cli",
            "Start a new Three.js / pixel / vintage / Seeker / shader game.",
            "gamemaster scaffold web-game --genre platformer --name Skyjump",
            ("new game", "scaffold", "create project", "starter", "pixel-game", "seeker-game"),
            {"cli": "scaffold"},
        ),
        _skill(
            "worlds",
            "cli",
            "Prompt → regions → height field → walkable world.",
            'gamemaster worlds generate -p DIR "coastal village, pine ridge"',
            ("generate world", "open world", "terrain", "biomes", "heightfield", "worldclaw"),
            {"cli": "worlds generate"},
        ),
        _skill(
            "studio",
            "cli",
            "Director → Architect → Coder → Critic pipeline.",
            'gamemaster studio build -p DIR "one quest" --live',
            ("studio build", "multi agent", "council", "full production"),
            {"cli": "studio build"},
        ),
        _skill(
            "live",
            "cli",
            "Play window that stays up while files change.",
            "gamemaster live -p DIR",
            ("play window", "live preview", "open the game", "hot reload play"),
            {"cli": "live"},
        ),
        _skill(
            "playtest",
            "cli",
            "Headless Playwright run, screenshots, metrics.",
            "gamemaster playtest -p DIR --critic",
            ("playtest", "headless run", "critic pass", "screenshots"),
            {"cli": "playtest"},
        ),
        _skill(
            "verify",
            "cli",
            "Deterministic slice grade. P0 fail blocks done.",
            "gamemaster verify -p DIR",
            ("verify slice", "grade the game", "p0 check", "ship bar score"),
            {"cli": "verify"},
        ),
        _skill(
            "wiki",
            "cli",
            "Per-game WIKI.md + MAP.md (auto-injected).",
            'gamemaster wiki add -p DIR "Gravity 28" --why "user said floaty"',
            ("project wiki", "file map", "durable fact"),
            {"cli": "wiki"},
        ),
        _skill(
            "ship",
            "cli",
            "Commit and push a private GitHub repo for the game.",
            'gamemaster ship -p DIR -m "vertical slice"',
            ("ship to github", "push the game", "create repo"),
            {"cli": "ship"},
        ),
        _skill(
            "prefs",
            "cli",
            "Remember player taste (like / dislike) across sessions.",
            'gamemaster prefs set like "tight jumps"',
            ("remember prefs", "i like tight jumps", "player taste"),
            {"cli": "prefs"},
        ),
        _skill(
            "rlm",
            "cli",
            "Deep build: peek/grep/sub over the project. No context dump.",
            'gamemaster rlm -p DIR "deepen the slice"',
            ("deep build", "rlm", "deepen the game", "not a toy", "recursive coder"),
            {"cli": "rlm"},
        ),
        _skill(
            "turbo",
            "cli",
            "Route the task to flash/max/dense and slim knowledge packs.",
            'gamemaster turbo route "fix jump feel"',
            ("which model", "warmup", "knowledge packs", "tier route"),
            {"cli": "turbo"},
        ),
        _skill(
            "cloud",
            "cli",
            "Optional paid model (off until you turn it on).",
            "gamemaster cloud on grok",
            ("use grok", "paid model", "claude", "gemini", "openai"),
            {"cli": "cloud"},
        ),
    ]
    return agent + ops + cli


def tokens(text: str) -> set[str]:
    words = _WORD.findall((text or "").lower())
    return {w for w in words if w not in _STOP and len(w) > 1}


def _bag(skill: dict[str, Any]) -> set[str]:
    parts = [skill["name"], skill["does"], " ".join(skill.get("aliases") or [])]
    return tokens(" ".join(parts))


def _phrase_bonus(query: str, skill: dict[str, Any]) -> float:
    q = (query or "").lower()
    bonus = 0.0
    if skill["name"].replace("_", " ") in q or skill["name"] in q.replace(" ", "_"):
        bonus += 0.35
    for alias in skill.get("aliases") or []:
        a = alias.lower().strip()
        if len(a) < 4:
            continue
        if a in q:
            bonus += 0.25
        elif q and q in a and len(q) >= 6:
            bonus += 0.12
    return min(bonus, 0.7)


def score(query: str, skill: dict[str, Any]) -> float:
    q = tokens(query)
    if not q:
        return 0.0
    bag = _bag(skill)
    overlap = len(q & bag)
    return overlap / len(q) + _phrase_bonus(query, skill)


def suggest(query: str, k: int = 5) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    for skill in catalog():
        s = score(query, skill)
        if s <= 0:
            continue
        item = dict(skill)
        item["score"] = round(s, 4)
        ranked.append(item)
    ranked.sort(key=lambda x: (-float(x["score"]), x["name"]))
    return ranked[: max(1, int(k))]


def _null_query(query: str) -> str:
    """Matched-length ask from catalog words the query does *not* use.

    Permuting the query is useless: score() is a set overlap, so an anagram
    of a real hit scores the same and the z-gap collapses to zero.
    """
    q = tokens(query)
    vocab = sorted({w for s in catalog() for w in _bag(s)} - q)
    if len(vocab) < 2:
        vocab = ["zzzz", "qqqq", "xxxx"]
    n = max(2, len(q) or 2)
    seed = int(hashlib.sha256((query or "∅").encode()).hexdigest()[:8], 16)
    picked: list[str] = []
    for _ in range(n):
        seed = (1_103_515_245 * seed + 12_345) & 0x7FFFFFFF
        picked.append(vocab[seed % len(vocab)])
    return " ".join(picked)


def route(query: str, k: int = 3) -> dict[str, Any]:
    """act | choose | abstain. Abstain beats a confident wrong skill."""
    q = (query or "").strip()
    hits = suggest(q, k=max(3, int(k)))
    if not hits:
        return {
            "ok": True,
            "decision": "abstain",
            "why": "no skill shares any tokens with this ask",
            "z": 0.0,
            "hits": [],
            "query": q,
        }
    top = hits[0]
    second = float(hits[1]["score"]) if len(hits) > 1 else 0.0
    gap = float(top["score"]) - second
    null_hits = suggest(_null_query(q), k=1)
    null_score = float(null_hits[0]["score"]) if null_hits else 0.0
    z = float(top["score"]) - null_score
    # Act when the hit is strong AND (ahead of the field OR above the catalog null).
    if float(top["score"]) >= MIN_ACT and (gap >= 0.2 or z >= MIN_Z):
        return {
            "ok": True,
            "decision": "act",
            "why": "confident match",
            "z": round(z, 4),
            "skill": {k: top[k] for k in ("name", "kind", "does", "example", "score") if k in top},
            "hits": hits[:k],
            "query": q,
        }
    if float(top["score"]) >= MIN_CHOOSE:
        return {
            "ok": True,
            "decision": "choose",
            "why": "several skills could apply — pick, do not invent",
            "z": round(z, 4),
            "hits": hits[:k],
            "query": q,
        }
    return {
        "ok": True,
        "decision": "abstain",
        "why": "below noise floor — no studio skill matches",
        "z": round(z, 4),
        "hits": hits[:k],
        "query": q,
    }


def by_name(name: str) -> dict[str, Any] | None:
    want = (name or "").strip().lower().replace("ops.", "").replace("cli.", "")
    for skill in catalog():
        if skill["name"] == want:
            return dict(skill)
    return None


def card(name: str) -> dict[str, Any]:
    skill = by_name(name)
    if not skill:
        return {"ok": False, "error": f"unknown skill: {name}", "hits": suggest(name, k=3)}
    return {"ok": True, "skill": skill}


def dump() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "capabilities": [
            {k: s[k] for k in ("name", "kind", "does", "example", "aliases")} for s in catalog()
        ],
    }


def check() -> dict[str, Any]:
    """Lint the catalog. Failures are named — a skill that can't be found is a gap."""
    skills = catalog()
    errors: list[str] = []
    names = [s["name"] for s in skills]
    seen: set[str] = set()
    for n in names:
        if n in seen:
            errors.append(f"duplicate:{n}")
        seen.add(n)
        s = by_name(n)
        assert s is not None
        if not (s.get("does") or "").strip():
            errors.append(f"empty-does:{n}")
        if not (s.get("example") or "").strip():
            errors.append(f"empty-example:{n}")
        if len(s.get("aliases") or []) < 3:
            errors.append(f"few-aliases:{n}")
    for tool in AGENT_TOOLS:
        if tool not in seen:
            errors.append(f"missing-agent-tool:{tool}")
    try:
        import game_ops as golib

        for otype in golib.OP_TYPES:
            if otype not in seen:
                errors.append(f"missing-op:{otype}")
    except Exception as e:
        errors.append(f"game_ops-import:{e}")
    return {"ok": not errors, "n": len(skills), "errors": errors}


def prompt_block(task: str, max_chars: int = 900) -> str:
    """Compact host route for the agent system prompt."""
    r = route(task)
    lines = [
        "STUDIO SKILLS (host-owned). Unknown tools do not exist.",
        f"ROUTE: {r['decision']}" + (f" — {r.get('why')}" if r.get("why") else ""),
    ]
    if r["decision"] == "act":
        s = r.get("skill") or {}
        lines.append(f"use {s.get('name')}: {s.get('does')}")
        if s.get("example"):
            lines.append("call:\n" + str(s["example"]))
    elif r["decision"] == "choose":
        lines.append("pick one of:")
        for h in r.get("hits") or []:
            lines.append(f"  {h['name']}: {h['does']}")
    else:
        lines.append("No dedicated skill. Use read_file / apply_patch / game_ops or done.")
        lines.append("Do not invent tools or claim a capability this catalog cannot name.")
    return "\n".join(lines)[:max_chars]


def format_suggest(hits: list[dict[str, Any]]) -> str:
    if not hits:
        return "(no matches)"
    lines = []
    for h in hits:
        lines.append(f"{h['score']:.2f}  {h['name']:22} {h['does']}")
    return "\n".join(lines)


def format_route(r: dict[str, Any]) -> str:
    d = r.get("decision")
    lines = [f"{d}  z={r.get('z')}  {r.get('why', '')}".rstrip()]
    if d == "act" and r.get("skill"):
        s = r["skill"]
        lines.append(f"  → {s['name']}: {s['does']}")
        lines.append(s.get("example") or "")
    else:
        for h in r.get("hits") or []:
            lines.append(f"  {h.get('score', 0):.2f}  {h['name']}: {h['does']}")
    return "\n".join(lines).rstrip()


def handle_http(method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
    """Dashboard / agent HTTP face. GET catalog; POST suggest|route|card."""
    body = body or {}
    tail = path.rstrip("/").split("/api/skills")[-1].strip("/")
    task = str(body.get("task") or body.get("query") or body.get("q") or "").strip()
    if method == "GET" and tail in ("", "list"):
        return 200, {"ok": True, **dump()}
    if method == "GET" and tail == "check":
        return 200, check()
    if tail in ("suggest",) or (method == "POST" and tail == ""):
        if not task:
            return 400, {"ok": False, "error": "task required"}
        try:
            k = int(body.get("k") or 5)
        except (TypeError, ValueError):
            k = 5
        return 200, {"ok": True, "hits": suggest(task, k=k), "query": task}
    if tail == "route":
        if not task:
            return 400, {"ok": False, "error": "task required"}
        return 200, route(task)
    if tail == "card":
        name = str(body.get("name") or task)
        c = card(name)
        return (200 if c.get("ok") else 404), c
    return 404, {"ok": False, "error": "skills: list|suggest|route|card|check"}


def run_skills(action: str, args: dict[str, Any] | None = None) -> str:
    """Agent tool face."""
    args = args or {}
    a = (action or "route").strip().lower().replace("-", "_")
    task = str(args.get("task") or args.get("query") or args.get("text") or "").strip()
    if a in ("list", "catalog"):
        rows = [f"{s['kind']:6} {s['name']:22} {s['does']}" for s in catalog()]
        return f"{len(rows)} skills\n" + "\n".join(rows)
    if a in ("suggest", "find", "search"):
        if not task:
            return "ERROR: skills suggest needs task:"
        k = 5
        try:
            k = int(args.get("k") or 5)
        except (TypeError, ValueError):
            k = 5
        return format_suggest(suggest(task, k=k))
    if a in ("route", "route_or_abstain", "decide"):
        if not task:
            return "ERROR: skills route needs task:"
        return format_route(route(task))
    if a in ("card", "describe"):
        name = str(args.get("name") or task)
        c = card(name)
        if not c.get("ok"):
            extra = format_suggest(c.get("hits") or [])
            return f"ERROR: {c.get('error')}\n{extra}"
        s = c["skill"]
        aliases = ", ".join(s.get("aliases") or [])
        return f"{s['name']} ({s['kind']})\n{s['does']}\ncall:\n{s['example']}\naliases: {aliases}"
    if a in ("check", "lint"):
        r = check()
        if r["ok"]:
            return f"OK {r['n']} skills"
        return "ERROR catalog:\n" + "\n".join(r["errors"])
    return "ERROR: skills action is list|suggest|route|card|check"


def main() -> int:
    ap = argparse.ArgumentParser(description="dotLab skill catalog (route or abstain)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    p_sug = sub.add_parser("suggest")
    p_sug.add_argument("task", nargs="+")
    p_sug.add_argument("-k", type=int, default=5)
    p_route = sub.add_parser("route")
    p_route.add_argument("task", nargs="+")
    p_card = sub.add_parser("card")
    p_card.add_argument("name")
    sub.add_parser("check")
    p_dump = sub.add_parser("dump")
    p_dump.add_argument("--pretty", action="store_true")
    args = ap.parse_args()

    if args.cmd == "list":
        print(run_skills("list"))
        return 0
    if args.cmd == "suggest":
        print(format_suggest(suggest(" ".join(args.task), k=args.k)))
        return 0
    if args.cmd == "route":
        r = route(" ".join(args.task))
        print(format_route(r))
        return 0 if r["decision"] != "abstain" else 2
    if args.cmd == "card":
        c = card(args.name)
        if not c.get("ok"):
            print(c.get("error"), file=sys.stderr)
            return 1
        print(json.dumps(c["skill"], indent=2))
        return 0
    if args.cmd == "check":
        r = check()
        print(json.dumps(r, indent=2))
        return 0 if r["ok"] else 1
    if args.cmd == "dump":
        data = dump()
        print(json.dumps(data, indent=2 if args.pretty else None))
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
