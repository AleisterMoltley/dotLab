# OpenZoo — x402 floor, leCore in front

You can send the whole game. Short pings are marked up. Long bodies are cheaper here than buying the model direct.

## What it is

OpenZoo (`https://openzoo.fun`) is a model yard. Every floor model has leCore memory in front. You do not call OpenRouter. You `POST` the **official** chat URL, get HTTP **402**, pay one Token-2022 transfer, retry with `X-PAYMENT` on the **same** URL.

Official option:

```
POST https://openzoo.fun/api/v1/chat/completions
```

That is what the stall in the browser uses. The 402 `resource` may name the floor (`x402-tokens.fly.dev`); still retry on openzoo.fun. Do not default to the floor.

```
dotlab zoo ping
dotlab zoo status
dotlab zoo models grok
dotlab zoo quote --model x-ai/grok-4.6
dotlab zoo wallet
dotlab cloud on zoo
dotlab --cloud zoo "Tighten coyote time"
```

No API key. Wallet lives in `config/zoo-wallet.json` (gitignored).

## Pricing law (do not invent a multiple)

Read `extra` on the live 402. Do not hardcode 10× or 3×.

| extra.pricing | meaning |
|---------------|---------|
| `counterfactual` | Discount vs buying this exact body direct (`extra.directUsd`, `extra.savesVsDirect`) |
| `markup` | Short body, nothing to spill — currently ×3 |
| fail-open | Sidecar down → billed at **direct** (markup 1). Never extra for their outage |

Amount to transfer = `extra.amount` or `maxAmountRequired` in **native units**. Use `extra.decimals` for TransferChecked. Never rescale by guessing 6.

## Rails

Solana `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`. feePayer is theirs — you do not pay SOL.

- yUSDCx `6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv` (wrap USDC)
- wTOKENx `Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9` (wrap TOKEN `EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump`)
- Facilitator `https://x402.accrue.fund`
- Wrap help `https://x402.accrue.fund/start`

Raw USDC / raw TOKEN will not settle. Wrap first.

## How to talk to it

1. `POST https://x402-tokens.fly.dev/v1/chat/completions` (or `https://openzoo.fun/api/v1/chat/completions`)
2. Body is a normal OpenAI chat: `{model, messages, max_tokens}`
3. 402 → pick one `accepts[]` row → Token-2022 TransferChecked to `payTo`, amount = `maxAmountRequired`
4. Sign as the token owner. Leave the feePayer signature empty.
5. `X-PAYMENT` = base64 of `{"x402Version":1,"scheme":"exact","network":"solana:…","payload":{"transaction":"<base64-tx>"}}`
6. POST the **same** body again. Do not change model/messages/max_tokens after the 402.

Do not use `lecore-front.fly.dev`. Memory is already in front of the floor.

## Studio rule when zoo is on

Send **more** project, not less. leCore spills; the floor never sees the raw 5M. A tiny ping pays markup. A full tree is the cheap path.

Featured floor: `x-ai/grok-4.6`, `google/gemini-2.5-flash`, `anthropic/claude-sonnet-4`, `openai/gpt-4o-mini`. Hundreds more via `dotlab zoo models`.
