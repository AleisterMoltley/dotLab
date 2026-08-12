#!/usr/bin/env python3
"""
Gamemaster — Project Scaffolder
Creates runnable starters: web-game, world-game, pixel-game, seeker-app, seeker-game, shader-lab.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

from gmcommon import GAME_GITIGNORE, ROOT, TEMPLATES, slugify_project

GENRES = [
    "arena",
    "platformer",
    "fps",
    "tps",
    "adventure",
    "open-world",
    "racing",
    "runner",
    "tower-defense",
    "rpg",
    "card",
    "puzzle",
    "idle",
    "sports",
    "horror",
    "sandbox",
    "rhythm",
    "tycoon",
]


def slugify(name: str) -> str:
    return slugify_project(name)


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"  + {path}")


def scaffold_web_game(
    dest: Path,
    name: str,
    genre: str,
    prompt: str | None = None,
    engine: str | None = None,
) -> None:
    import slice as slicelib

    spec = slicelib.compile_prompt(
        prompt or f"{genre} {name}",
        genre=None if prompt else genre,
        engine=engine or "three",
    )
    spec["title"] = name
    for rel in slicelib.write_slice(dest, spec):
        print(f"  + {dest / rel}")


def scaffold_seeker_app(dest: Path, name: str, genre: str | None = None) -> None:
    slug = slugify(name)
    is_game = genre is not None
    write(
        dest / "package.json",
        json.dumps(
            {
                "name": slug,
                "version": "0.1.0",
                "private": True,
                "main": "expo/AppEntry.js",
                "scripts": {
                    "start": "expo start",
                    "android": "expo run:android",
                    "lint": "echo ok",
                },
                "dependencies": {
                    "expo": "~52.0.0",
                    "expo-status-bar": "~2.0.0",
                    "react": "18.3.1",
                    "react-native": "0.76.3",
                    "@solana/web3.js": "^1.98.0",
                    "@solana-mobile/mobile-wallet-adapter-protocol-web3js": "^2.1.0",
                    "@solana-mobile/mobile-wallet-adapter-protocol": "^2.1.0",
                    "react-native-get-random-values": "~1.11.0",
                    "buffer": "^6.0.3",
                    "text-encoding": "^0.7.0",
                },
                "devDependencies": {
                    "@babel/core": "^7.25.0",
                    "typescript": "~5.6.0",
                    "@types/react": "~18.3.0"
                },
            },
            indent=2,
        )
        + "\n",
    )
    write(
        dest / "app.json",
        json.dumps(
            {
                "expo": {
                    "name": name,
                    "slug": slug,
                    "version": "1.0.0",
                    "orientation": "portrait",
                    "userInterfaceStyle": "dark",
                    "android": {
                        "package": f"com.gamemaster.{slug.replace('-', '')}",
                        "permissions": [],
                    },
                    "extra": {
                        "gamemaster": {
                            "target": "solana-seeker",
                            "genre": genre,
                        }
                    },
                }
            },
            indent=2,
        )
        + "\n",
    )
    genre_line = f" · genre: {genre}" if is_game else ""
    game_slot = ""
    if is_game:
        game_slot = (
            "\n        {/* Game slot — expand with Gamemaster agent */}\n"
            "        <View style={styles.gameSlot}>\n"
            "          <Text style={styles.gameSlotText}>Game surface</Text>\n"
            f"          <Text style={{styles.sub}}>Ask Gamemaster: add {genre} core loop here</Text>\n"
            "        </View>\n"
        )
    # Avoid f-string brace hell: token replace on a plain template
    app_tsx = r"""import 'react-native-get-random-values';
import { Buffer } from 'buffer';
global.Buffer = global.Buffer || Buffer;

import { useCallback, useMemo, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Connection, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { connectAndGetPubkey, APP_IDENTITY } from './src/wallet/mwa';

export default function App() {
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string>('Ready · Solana Seeker optimized');
  const connection = useMemo(
    () => new Connection(process.env.EXPO_PUBLIC_RPC_URL || clusterApiUrl('devnet'), 'confirmed'),
    []
  );

  const onConnect = useCallback(async () => {
    setBusy(true);
    try {
      const pk = await connectAndGetPubkey();
      setPubkey(pk.toBase58());
      const lamports = await connection.getBalance(pk);
      setBalance(lamports / LAMPORTS_PER_SOL);
      setLog('Connected via Mobile Wallet Adapter');
    } catch (e: any) {
      setLog(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [connection]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.pad}>
        <Text style={styles.kicker}>Gamemaster · Seeker</Text>
        <Text style={styles.title}>__APP_NAME__</Text>
        <Text style={styles.sub}>
          {APP_IDENTITY.name} · MWA · Seed Vault ready__GENRE_LINE__
        </Text>

        <Pressable
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed, busy && styles.btnDisabled]}
          onPress={onConnect}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#042f1a" />
          ) : (
            <Text style={styles.btnText}>{pubkey ? 'Reconnect Wallet' : 'Connect Wallet'}</Text>
          )}
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.label}>Public key</Text>
          <Text style={styles.mono}>{pubkey ?? '—'}</Text>
          <Text style={styles.label}>Balance (devnet)</Text>
          <Text style={styles.mono}>
            {balance == null ? '—' : `${balance.toFixed(4)} SOL`}
          </Text>
        </View>
__GAME_SLOT__
        <Text style={styles.log}>{log}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  pad: { padding: 20, paddingBottom: 48 },
  kicker: { color: '#6ee7b7', fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 6 },
  sub: { color: '#8b92a5', marginTop: 6, marginBottom: 20, lineHeight: 20 },
  btn: {
    backgroundColor: '#6ee7b7',
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  btnPressed: { opacity: 0.9 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#042f1a', fontWeight: '800', fontSize: 16 },
  card: {
    marginTop: 18,
    backgroundColor: '#12141a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#23262f',
    padding: 16,
    gap: 6,
  },
  label: { color: '#8b92a5', fontSize: 12, marginTop: 8 },
  mono: { color: '#e8eaef', fontFamily: 'Courier', fontSize: 13 },
  gameSlot: {
    marginTop: 18,
    minHeight: 220,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#23262f',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f1218',
  },
  gameSlotText: { color: '#e8eaef', fontWeight: '700', fontSize: 16 },
  log: { marginTop: 18, color: '#8b92a5', fontSize: 13 },
});
"""
    app_tsx = (
        app_tsx.replace("__APP_NAME__", name)
        .replace("__GENRE_LINE__", genre_line)
        .replace("__GAME_SLOT__", game_slot)
    )
    write(dest / "App.tsx", app_tsx)
    write(
        dest / "src/wallet/identity.ts",
        f"""export const APP_IDENTITY = {{
  name: {name!r},
  uri: 'https://gamemaster.local/{slug}',
  icon: 'favicon.ico',
}} as const;
""",
    )
    write(
        dest / "src/wallet/mwa.ts",
        """import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { PublicKey } from '@solana/web3.js';
import { APP_IDENTITY } from './identity';

/** Connect via Mobile Wallet Adapter (Seed Vault on Seeker, Mock MWA in dev). */
export async function connectAndGetPubkey(): Promise<PublicKey> {
  return await transact(async (wallet) => {
    const auth = await wallet.authorize({
      cluster: 'devnet',
      identity: APP_IDENTITY,
    });
    if (!auth.accounts?.length) {
      throw new Error('No accounts authorized');
    }
    // accounts[0].address may be base64 or base58 depending on adapter version
    const raw = auth.accounts[0].address as string;
    try {
      return new PublicKey(raw);
    } catch {
      // base64 pubkey bytes
      const bytes = Buffer.from(raw, 'base64');
      return new PublicKey(bytes);
    }
  });
}

export { APP_IDENTITY };
""",
    )
    write(
        dest / "src/chain/connection.ts",
        """import { Connection, clusterApiUrl } from '@solana/web3.js';

export function makeConnection() {
  const url = process.env.EXPO_PUBLIC_RPC_URL || clusterApiUrl('devnet');
  return new Connection(url, 'confirmed');
}
""",
    )
    write(
        dest / "README.md",
        f"""# {name}

**Solana Seeker optimized** scaffold by Gamemaster  
{f'Genre focus: **{genre}**' if genre else 'Utility / dApp shell'}

## Stack
- Expo / React Native (Android)
- Mobile Wallet Adapter (MWA)
- Seed Vault ready on Seeker
- devnet by default

## Run
```bash
npm install
npx expo start
# Android device/emulator with Mock MWA Wallet or Seeker Seed Vault
```

## Next with Gamemaster
```bash
gamemaster -p . --agent "Add {genre or 'token transfer'} screen with big Seeker touch UI"
tjc update   # keep knowledge + models current
```

## dApp Store notes
- Set real `uri` + icon in `src/wallet/identity.ts`
- Use production RPC via `EXPO_PUBLIC_RPC_URL`
- Test authorize/sign on device before submit
""",
    )
    write(
        dest / "tsconfig.json",
        json.dumps(
            {
                "extends": "expo/tsconfig.base",
                "compilerOptions": {"strict": True},
            },
            indent=2,
        )
        + "\n",
    )
    write(dest / ".gitignore", GAME_GITIGNORE)


def scaffold_world_game(dest: Path, name: str) -> None:
    """Copy explorable Three.js world template."""
    src = TEMPLATES / "world-game"
    if not src.is_dir():
        raise SystemExit(f"Template missing: {src}")
    for item in src.iterdir():
        target = dest / item.name
        if item.is_dir():
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
        print(f"  + {target}")
    pkg_path = dest / "package.json"
    if pkg_path.exists():
        pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
        pkg["name"] = slugify(name)
        pkg_path.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
    readme = dest / "README.md"
    if readme.exists():
        text = readme.read_text(encoding="utf-8")
        readme.write_text(f"# {name}\n\n" + text, encoding="utf-8")
    gi = dest / ".gitignore"
    if not gi.exists():
        write(gi, GAME_GITIGNORE)
    design = dest / "DESIGN.md"
    if not design.exists():
        write(
            design,
            f"""# {name}

## Engine
Three.js (Vite) · Worlds-ready

## Core loop
Walk the world → talk to one NPC → change a flag → see the place react

## Backlog
- [ ] `gamemaster worlds generate -p . "your biomes"`
- [ ] Player controller + follow cam
- [ ] One dialogue tree
- [ ] Collision on terrain + houses
- [ ] Shader accent (sky or water)
""",
        )


def scaffold_pixel_game(dest: Path, name: str, prompt: str | None = None, genre: str | None = None) -> None:
    """Pure Canvas2D pixel engine (pixelart.js + pixelart-fx.js)."""
    import slice as slicelib

    spec = slicelib.compile_prompt(
        prompt or f"pixel art {genre or 'adventure'} {name}",
        genre=genre,
        engine="pixel",
    )
    spec["title"] = name
    for rel in slicelib.write_pixel_slice(dest, spec):
        print(f"  + {dest / rel}")


def scaffold_shader_lab(dest: Path, name: str) -> None:
    """Copy multipass shader lab template."""
    src = TEMPLATES / "shader-lab"
    if not src.is_dir():
        raise SystemExit(f"Template missing: {src}")
    # dest already created empty
    for item in src.iterdir():
        target = dest / item.name
        if item.is_dir():
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
        print(f"  + {target}")
    # stamp name into package.json
    pkg_path = dest / "package.json"
    if pkg_path.exists():
        pkg = json.loads(pkg_path.read_text())
        pkg["name"] = slugify(name)
        pkg_path.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
    readme = dest / "README.md"
    if readme.exists():
        text = readme.read_text(encoding="utf-8")
        readme.write_text(f"# {name}\n\n" + text, encoding="utf-8")
    gi = dest / ".gitignore"
    if not gi.exists():
        write(gi, GAME_GITIGNORE)


def main() -> int:
    ap = argparse.ArgumentParser(description="Gamemaster scaffold")
    ap.add_argument(
        "kind",
        choices=[
            "web-game",
            "world-game",
            "pixel-game",
            "seeker-app",
            "seeker-game",
            "shader-lab",
            "fragcoord",
            "list-genres",
        ],
        help="Project type",
    )
    ap.add_argument("--name", default=None, help="Project name")
    ap.add_argument("--genre", default="arena", choices=GENRES)
    ap.add_argument(
        "--engine",
        default=None,
        choices=["three", "pixel"],
        help="Game engine: three (WebGL) or pixel (Canvas2D pixelart.js)",
    )
    ap.add_argument(
        "--out",
        default=None,
        help="Output directory (default ~/Gamemaster/Projects)",
    )
    args = ap.parse_args()

    if args.kind == "list-genres":
        print("\n".join(GENRES))
        return 0

    kind = "shader-lab" if args.kind == "fragcoord" else args.kind

    name = args.name or {
        "web-game": f"Web {args.genre.title()}",
        "world-game": "World",
        "pixel-game": "Pixel Grove",
        "seeker-app": "Seeker App",
        "seeker-game": f"Seeker {args.genre.title()}",
        "shader-lab": "Shader Lab",
    }[kind]

    default_root = Path.home() / "Gamemaster" / "Projects"
    dest = Path(args.out).expanduser() if args.out else default_root / slugify(name)
    if dest.exists() and any(dest.iterdir()):
        print(f"❌ Target not empty: {dest}", file=sys.stderr)
        return 1
    dest.mkdir(parents=True, exist_ok=True)

    print(f"🎮 Scaffold {kind} → {dest}")
    if kind == "web-game":
        scaffold_web_game(dest, name, args.genre, engine=args.engine or "three")
    elif kind == "world-game":
        scaffold_world_game(dest, name)
    elif kind == "pixel-game":
        scaffold_pixel_game(dest, name, genre=args.genre)
    elif kind == "seeker-app":
        scaffold_seeker_app(dest, name, genre=None)
    elif kind == "seeker-game":
        scaffold_seeker_app(dest, name, genre=args.genre)
    else:
        scaffold_shader_lab(dest, name)

    print("\n✅ Done.")
    print(f"   cd {dest}")
    if kind in ("web-game", "world-game", "pixel-game", "shader-lab"):
        print("   npm i && npm run dev")
        if kind == "world-game":
            print(f'   gamemaster worlds generate -p "{dest}" "coastal village, pine ridge"')
        if kind == "pixel-game":
            print("   # pure Canvas2D · src/pixelart/pixelart.js + pixelart-fx.js")
    else:
        print("   npm i && npx expo start")
    print(f'   gamemaster -p "{dest}" --agent "Expand vertical slice"')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
