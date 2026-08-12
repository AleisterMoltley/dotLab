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


def scaffold_web_game(dest: Path, name: str, genre: str) -> None:
    write(
        dest / "package.json",
        json.dumps(
            {
                "name": slugify(name),
                "private": True,
                "version": "0.1.0",
                "type": "module",
                "scripts": {
                    "dev": "vite",
                    "build": "vite build",
                    "preview": "vite preview",
                },
                "dependencies": {"three": "^0.170.0"},
                "devDependencies": {"vite": "^6.0.0"},
            },
            indent=2,
        )
        + "\n",
    )
    write(
        dest / "index.html",
        f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>{name}</title>
  <style>
    html, body {{ margin: 0; height: 100%; overflow: hidden; background: #0a0a0f; }}
    canvas {{ display: block; }}
    #hud {{
      position: fixed; left: 12px; top: 12px; color: #e8eaef;
      font: 600 14px/1.4 system-ui, sans-serif; text-shadow: 0 1px 2px #000;
      pointer-events: none;
    }}
  </style>
</head>
<body>
  <div id="hud">{name} · {genre}</div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
""",
    )
    write(
        dest / "src/main.js",
        f"""import * as THREE from 'three';
import {{ createGame }} from './game.js';

const game = createGame({{
  genre: {genre!r},
  title: {name!r},
}});
game.start();
""",
    )
    write(
        dest / "src/game.js",
        f"""import * as THREE from 'three';

/** Genre: {genre} — vertical slice, Gamemaster scaffold */
export function createGame({{ genre, title }}) {{
  const CONFIG = {{
    genre,
    moveSpeed: 6,
    gravity: 22,
    jumpForce: 8,
    camLag: 8,
  }};

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);
  scene.fog = new THREE.Fog(0x0b1020, 25, 80);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(0, 4, 10);

  const renderer = new THREE.WebGLRenderer({{ antialias: true, powerPreference: 'high-performance' }});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x444444, 0.7);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(20, 40, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(hemi, sun);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({{ color: 0x1a3d2e, roughness: 0.9 }})
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Player placeholder
  const player = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 0.8, 4, 8),
    new THREE.MeshStandardMaterial({{ color: 0x6ee7b7 }})
  );
  player.position.y = 1.2;
  player.castShadow = true;
  scene.add(player);

  const keys = Object.create(null);
  addEventListener('keydown', (e) => {{ keys[e.code] = true; }});
  addEventListener('keyup', (e) => {{ keys[e.code] = false; }});
  addEventListener('resize', () => {{
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }});

  let last = performance.now();
  const vel = new THREE.Vector3();
  const _f = new THREE.Vector3();
  const _s = new THREE.Vector3();

  function update(dt) {{
    // WASD on XZ
    _f.set(0, 0, 0);
    if (keys['KeyW'] || keys['ArrowUp']) _f.z -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) _f.z += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) _f.x -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) _f.x += 1;
    if (_f.lengthSq() > 0) _f.normalize().multiplyScalar(CONFIG.moveSpeed);
    vel.x = THREE.MathUtils.damp(vel.x, _f.x, 12, dt);
    vel.z = THREE.MathUtils.damp(vel.z, _f.z, 12, dt);
    player.position.x += vel.x * dt;
    player.position.z += vel.z * dt;

    // Simple follow cam
    const ideal = _s.set(player.position.x, player.position.y + 3.5, player.position.z + 8);
    camera.position.lerp(ideal, 1 - Math.exp(-CONFIG.camLag * dt));
    camera.lookAt(player.position.x, player.position.y + 1, player.position.z);

    // Genre tag for future systems
    player.userData.genre = genre;
  }}

  function frame(now) {{
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }}

  // Playtest hooks (Gamemaster Playwright harness)
  function pt(method) {{
    try {{ window.__GF_PLAYTEST__?.[method]?.(); }} catch {{}}
  }}

  return {{
    start() {{
      console.log(`[Gamemaster] ${{title}} · ${{genre}}`);
      requestAnimationFrame(frame);
    }},
    die() {{ pt('recordDeath'); }},
    restart() {{ pt('recordRestart'); }},
    jump() {{ pt('recordJump'); }},
    scene,
    player,
    CONFIG,
  }};
}}
""",
    )
    write(
        dest / "README.md",
        f"""# {name}

Genre: **{genre}** · Scaffold by **Gamemaster**

```bash
npm install
npm run dev
```

Next: open chat `gamemaster -p {dest.name} --agent "Add jump + collectibles for {genre}"`
""",
    )
    write(dest / ".gitignore", GAME_GITIGNORE)
    write(
        dest / "WIKI.md",
        f"""# Wiki

Living facts for this game. One bullet + **Why:**. Loaded into every Studio/Agent turn.

- Engine is Three.js (Vite, vanilla). **Why:** Gamemaster invariant.
- Genre: {genre}. **Why:** scaffold default — change if the verb moves.
""",
    )
    write(
        dest / "DESIGN.md",
        f"""# {name}

## Genre
{genre}

## Core loop
(define with Gamemaster)

## Target
Web / Desktop browser first. Mobile polish optional.

## Backlog
- [ ] Vertical slice fun for 60s
- [ ] Juice (shake, particles)
- [ ] Audio
""",
    )


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


def scaffold_pixel_game(dest: Path, name: str) -> None:
    """Vite + Three.js with vendored Canvas2D pixel kit as textures."""
    src = TEMPLATES / "pixel-game"
    lib = ROOT / "lib" / "pixel"
    if not src.is_dir() or not lib.is_dir():
        raise SystemExit("pixel-game template or lib/pixel missing")
    for item in src.iterdir():
        target = dest / item.name
        if item.is_dir():
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
        print(f"  + {target}")
    pixel_dest = dest / "src" / "pixel"
    shutil.copytree(lib, pixel_dest, dirs_exist_ok=True)
    print(f"  + {pixel_dest}/")
    pkg_path = dest / "package.json"
    if pkg_path.exists():
        pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
        pkg["name"] = slugify(name)
        pkg_path.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
    for stamped in (dest / "index.html", dest / "README.md"):
        if stamped.exists():
            stamped.write_text(
                stamped.read_text(encoding="utf-8").replace("Pixel Grove", name),
                encoding="utf-8",
            )
    gi = dest / ".gitignore"
    if not gi.exists():
        write(gi, GAME_GITIGNORE)
    if not (dest / "DESIGN.md").exists():
        write(
            dest / "DESIGN.md",
            f"""# {name}

## Engine
Three.js (Vite) + lib/pixel bake (nearest quads)

## Core loop
Walk the grove — baked sprites, live camera

## Backlog
- [ ] Tune CONFIG feel
- [ ] Bake more props with draw.js
- [ ] One juice FX (pxJelly on land)
""",
        )


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
        "--out",
        default=None,
        help="Output directory (default under ~/GamemasterProjects)",
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
        scaffold_web_game(dest, name, args.genre)
    elif kind == "world-game":
        scaffold_world_game(dest, name)
    elif kind == "pixel-game":
        scaffold_pixel_game(dest, name)
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
            print("   # bake sprites in src/main.js — Three.js stays the engine")
    else:
        print("   npm i && npx expo start")
    print(f'   gamemaster -p "{dest}" --agent "Expand vertical slice"')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
