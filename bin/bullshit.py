#!/usr/bin/env python3
"""
Bullshit gate — refuse or challenge nonsensical / non-game prompts early.

Inspired by BullshitBench: don't confidently answer garbage.
Host rules first (fast); optional flash model when DOTLAB_BULLSHIT=llm.

  gamemaster bullshit check "asdlkjasd"
  gamemaster bullshit check "make coyote time tighter"
"""
from __future__ import annotations

import argparse
import json
import os
import re
from typing import Any

# Clear game / craft signals → always pass
_GAME_OK = re.compile(
    r"(?i)\b("
    r"game|jump|feel|coyote|platform|runner|fps|tps|shoot|enemy|player|level|"
    r"sprite|pixel|three\.?js|canvas|shader|rig|camera|palette|vintage|gba|"
    r"craft|juice|hitstop|dash|gravity|move.?speed|slice|scaffold|studio|"
    r"verify|playtest|engine|room|coin|npc|dialogue|world|controller|collision|"
    r"fix|tweak|faster|slower|floaty|snappy|set_feel|game.?ops"
    r")\b"
)

# Pure nonsense / jailbreak / empty intent
_NOISE = re.compile(
    r"(?i)^("
    r"asdf+|qwer+|test{2,}|lorem ipsum|aaaa+|xxx+|123456+|"
    r"ignore (all|previous) instructions|you are now|dan mode|"
    r"repeat after me|print your system prompt"
    r")$"
)

_INJECTION = re.compile(
    r"(?i)("
    r"ignore (all |any )?previous|disregard (your |the )?system|"
    r"reveal (your |the )?(system )?prompt|jailbreak|"
    r"</?system>|\[INST\]|exfiltrat"
    r")"
)

_LOW_SIGNAL = re.compile(r"^[^\w]*$|^(.)\1{8,}$")


def check(text: str, *, strict: bool = False) -> dict[str, Any]:
    """
    Return {ok, action: allow|challenge|block, reason, message}.
    """
    raw = (text or "").strip()
    if not raw:
        return {
            "ok": False,
            "action": "block",
            "reason": "empty",
            "message": "Empty prompt — say what to change in the game (feel, enemies, jump…).",
        }
    if len(raw) > 12000:
        return {
            "ok": False,
            "action": "block",
            "reason": "too_long",
            "message": "Prompt too long — split into a smaller craft request.",
        }
    if _INJECTION.search(raw):
        return {
            "ok": False,
            "action": "block",
            "reason": "injection",
            "message": "That looks like a prompt-injection attempt. Ask for a concrete game change instead.",
        }
    if _NOISE.search(raw.strip()) or _LOW_SIGNAL.search(raw):
        return {
            "ok": False,
            "action": "block",
            "reason": "noise",
            "message": "That doesn't look like a game request. Example: «tighter jump, more coyote time».",
        }
    # keyboard mash / repeating home-row nonsense (asdf, qwer, …)
    compact = re.sub(r"\s+", "", raw.lower())
    if len(compact) >= 10 and re.fullmatch(r"[asdfghjkl;']+", compact):
        return {
            "ok": False,
            "action": "block",
            "reason": "noise",
            "message": "That doesn't look like a game request. Example: «tighter jump, more coyote time».",
        }
    if len(compact) >= 8 and re.fullmatch(r"([a-z]{2,5})\1{2,}", compact):
        return {
            "ok": False,
            "action": "block",
            "reason": "noise",
            "message": "That doesn't look like a game request. Example: «tighter jump, more coyote time».",
        }
    # keyboard mash: high consonant ratio, no vowels almost, short
    letters = re.findall(r"[a-zA-Z]", raw)
    if len(letters) >= 12 and len(raw) < 80:
        vowels = sum(1 for c in letters if c.lower() in "aeiou")
        if vowels / max(1, len(letters)) < 0.12 and not _GAME_OK.search(raw):
            return {
                "ok": False,
                "action": "challenge",
                "reason": "mash",
                "message": "Can't parse that. Describe a gameplay change (jump feel, enemies, palette…).",
            }
    if _GAME_OK.search(raw):
        return {"ok": True, "action": "allow", "reason": "game_signal", "message": ""}
    # short chitchat
    if len(raw) < 24 and not strict:
        if re.search(r"(?i)^(hi|hello|hey|thanks|danke|ok|yes|no)\b", raw):
            return {"ok": True, "action": "allow", "reason": "chitchat", "message": ""}
    if strict and len(raw) < 8:
        return {
            "ok": False,
            "action": "challenge",
            "reason": "vague",
            "message": "Too vague — name genre, feel, or a file-level change.",
        }
    # default allow (host craft can still no-op); challenge only if zero structure
    words = re.findall(r"\w+", raw)
    if len(words) <= 2 and not re.search(r"[.!?]", raw):
        return {
            "ok": False,
            "action": "challenge",
            "reason": "thin",
            "message": "Need a bit more: e.g. «platformer, snappier jump» or «pixel engine runner».",
        }
    return {"ok": True, "action": "allow", "reason": "pass", "message": ""}


def enabled() -> bool:
    return os.environ.get("DOTLAB_BULLSHIT", "1") not in ("0", "false", "off")


def main() -> int:
    ap = argparse.ArgumentParser(description="dotLab bullshit gate")
    ap.add_argument("text", nargs="+")
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()
    print(json.dumps(check(" ".join(args.text), strict=args.strict), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
