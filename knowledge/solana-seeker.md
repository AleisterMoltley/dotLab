# Solana Seeker — Games first (Three.js + wallet)

**Solana Seeker** = Solana Mobile phone (successor to Saga).  
Gamemaster builds **games**. Wallet is a system, not the product.

## Target platforms (priority)
1. **Three.js web game + Mobile Wallet Adapter** (default — same engine as desktop)
2. **Expo / React Native Android shell** hosting the Three.js canvas (WebView) or a thin native HUD + GL view — use when they need **dApp Store** packaging
3. **Expo utility dApp** (no 3D) only if the user asked for a wallet tool, not a game
4. **Kotlin native** only if the user asks

## Seeker game architecture (default)

```
Vite + three.js game   ← camera, physics, dialogue, shaders, ragdoll
        ↓
wallet/mwa.js          ← connect, sign, cluster visible
        ↓
optional on-chain      ← score, claim, entry fee, NFT cosmetic
```

Rules:
- Core loop must be fun **offline** (devnet down ≠ unplayable).
- Wallet connect is a button, never a boot blocker.
- Never store seeds. MWA / Seed Vault only.
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`, 1 shadow or none, pause rAF on hide.
- Touch: virtual stick + action ≥44px, portrait-first, safe areas.
- On-chain after the slice is fun: claim idle, entry ticket, cosmetic unlock.

## Target platforms (legacy notes)

## Core stack (default Seeker app)
```
Expo (dev client) or React Native CLI
@solana/web3.js
@solana-mobile/mobile-wallet-adapter-protocol-web3js
@solana-mobile/mobile-wallet-adapter-protocol
react-native-get-random-values
buffer / text-encoding polyfills
```

Optional:
- `@solana/spl-token` for tokens
- Metaplex UMI for NFTs
- Anchor client for program calls
- Three.js / R3F only when 3D is needed (check mobile performance)

## App identity (always set)
```ts
export const APP_IDENTITY = {
  name: 'My Seeker Game',
  uri: 'https://mygame.example',
  icon: 'favicon.ico',
};
```

## Mobile Wallet Adapter — authorize + sign
```ts
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { Connection, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';

const APP_IDENTITY = {
  name: 'Seeker Arena',
  uri: 'https://seeker-arena.app',
  icon: 'icon.png',
};

export async function connectWallet() {
  return await transact(async (wallet) => {
    const auth = await wallet.authorize({
      cluster: 'devnet',
      identity: APP_IDENTITY,
    });
    const pubkey = new PublicKey(auth.accounts[0].address);
    return { auth, pubkey };
  });
}
```

> Note: API details can vary by package version (`cluster` vs `chain: "solana:devnet"`).  
> Always check the package README. Defaults: **devnet** for prototypes, **mainnet-beta** for production.

## Seeker UX rules
1. Touch targets ≥ 44–48px, thumb zones at the bottom
2. Portrait-first; landscape optional
3. Safe areas (notch / gesture bar)
4. Short wallet flows: 1-tap connect, clear fee/sign previews
5. Offline-tolerant UI for RPC failures
6. Battery: pause rAF on background; lower pixelRatio on low-end
7. No desktop hover-only UX
8. Loading states on every chain tx
9. Never store seed phrases in app storage — Seed Vault / MWA only
10. Cluster switch (devnet/mainnet) clearly visible

## Mobile performance (games on Seeker)
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`
- Shadows often off or 512 mapSize, 1 light
- InstancedMesh for many props
- Pause loop on `document.hidden` / AppState background
- Target stable 30–60 FPS

## dApp Store checklist
- Unique Android applicationId
- Icons + phone screenshots
- Privacy policy URL
- MWA works with Seed Vault / mock wallet
- Clear network (devnet vs mainnet)
- No private key export UI
- Crash-free cold start

## Testing without a physical Seeker
- Android emulator + Mock MWA Wallet
- Or physical Android + Solflare / Jupiter Mobile
- Seeker device for final Seed Vault UX polish
