from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import cloud
import skills
import turbo
import zoo


SAMPLE_402 = {
    "x402Version": 1,
    "error": "payment required",
    "help": "https://x402.accrue.fund/start",
    "accepts": [
        {
            "scheme": "exact",
            "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
            "asset": zoo.YUSDCX,
            "maxAmountRequired": "337",
            "payTo": zoo.PAY_TO,
            "extra": {
                "symbol": "yUSDCx",
                "decimals": 6,
                "feePayer": zoo.PAY_TO,
                "pricing": "markup",
                "markup": 3,
                "billedUsd": 0.000336,
            },
        },
        {
            "scheme": "exact",
            "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
            "asset": zoo.WTOKENX,
            "maxAmountRequired": "6301490",
            "payTo": zoo.PAY_TO,
            "extra": {
                "symbol": "wTOKENx",
                "decimals": 6,
                "feePayer": zoo.PAY_TO,
                "pricing": "markup",
                "markup": 3,
                "billedUsd": 0.000336,
                "tokenUsd": 5.3e-5,
            },
        },
        {
            "scheme": "exact",
            "network": "eip155:4663",
            "asset": "0xdead",
            "maxAmountRequired": "1",
            "extra": {"symbol": "ODDBALLER", "decimals": 18},
        },
    ],
}


class TestCodecs(unittest.TestCase):
    def test_b58_roundtrip(self) -> None:
        raw = bytes(range(32))
        self.assertEqual(zoo.b58decode(zoo.b58encode(raw)), raw)

    def test_compact_u16(self) -> None:
        self.assertEqual(zoo.compact_u16(0), b"\x00")
        self.assertEqual(zoo.compact_u16(127), b"\x7f")
        self.assertEqual(zoo.compact_u16(128), b"\x80\x01")

    def test_ata_deterministic(self) -> None:
        a = zoo.associated_token_address(zoo.PAY_TO, zoo.YUSDCX)
        b = zoo.associated_token_address(zoo.PAY_TO, zoo.YUSDCX)
        self.assertEqual(a, b)
        self.assertEqual(len(zoo.b58decode(a)), 32)
        other = zoo.associated_token_address(zoo.PAY_TO, zoo.WTOKENX)
        self.assertNotEqual(a, other)

    def test_transfer_checked_layout(self) -> None:
        data = zoo.transfer_checked_ix(337, 6)
        self.assertEqual(data[0], 12)
        self.assertEqual(int.from_bytes(data[1:9], "little"), 337)
        self.assertEqual(data[9], 6)
        self.assertEqual(len(data), 10)


class Test402(unittest.TestCase):
    def test_parse_and_summarize(self) -> None:
        req = zoo.parse_402(SAMPLE_402)
        self.assertEqual(req["x402Version"], 1)
        self.assertEqual(len(req["accepts"]), 3)
        row = zoo.pick_accept(req["accepts"], prefer="yUSDCx")
        self.assertEqual(zoo.accept_symbol(row), "yUSDCx")
        self.assertEqual(zoo.accept_amount(row), 337)
        self.assertEqual(zoo.accept_decimals(row), 6)
        summary = zoo.summarize_accept(row)
        self.assertEqual(summary["pricing"], "markup")
        self.assertEqual(summary["markup"], 3)
        self.assertNotEqual(summary["pricing"], "counterfactual")

    def test_skips_evm_by_default(self) -> None:
        row = zoo.pick_accept(SAMPLE_402["accepts"])
        self.assertTrue(str(row["network"]).startswith("solana"))
        self.assertNotEqual(zoo.accept_symbol(row), "ODDBALLER")

    def test_picks_funded_rail(self) -> None:
        row = zoo.pick_accept(
            SAMPLE_402["accepts"],
            prefer="yUSDCx",
            balances={"yUSDCx": 0, "wTOKENx": 9_000_000},
        )
        self.assertEqual(zoo.accept_symbol(row), "wTOKENx")

    def test_payment_header_shape(self) -> None:
        token = zoo.encode_payment(1, "exact", zoo.SOLANA_NET, "dGVzdA==")
        blob = json.loads(zoo.base64.b64decode(token))
        self.assertEqual(blob["x402Version"], 1)
        self.assertEqual(blob["scheme"], "exact")
        self.assertEqual(blob["payload"]["transaction"], "dGVzdA==")

    def test_does_not_hardcode_save_multiple(self) -> None:
        src = Path(zoo.__file__).read_text(encoding="utf-8")
        self.assertNotIn("savesVsDirect = 10", src)
        self.assertIn("extra.pricing", Path(__file__).resolve().parents[1].joinpath("knowledge/openzoo.md").read_text(encoding="utf-8"))

    def test_default_chat_is_official_site(self) -> None:
        os.environ.pop("ZOO_CHAT_URL", None)
        self.assertEqual(zoo.chat_url(), zoo.SITE_CHAT)
        self.assertTrue(zoo.chat_url().startswith("https://openzoo.fun/"))
        self.assertEqual(cloud.CATALOG["zoo"]["base"], "https://openzoo.fun/api/v1")

    def test_quote_reads_official_402(self) -> None:
        fake = json.dumps(SAMPLE_402).encode()
        with mock.patch.object(zoo, "http", return_value=(402, {}, fake)):
            q = zoo.quote("openai/gpt-4o-mini")
        self.assertEqual(q["source"], zoo.SITE_CHAT)
        self.assertEqual(q["pricing"], "markup")
        self.assertEqual(q["accepts"][0]["symbol"], "yUSDCx")
        self.assertEqual(q["accepts"][0]["grossRaw"], "337")

    def test_probe_ok_on_402(self) -> None:
        fake = json.dumps(SAMPLE_402).encode()
        with mock.patch.object(zoo, "http", return_value=(402, {}, fake)):
            p = zoo.probe("openai/gpt-4o-mini")
        self.assertTrue(p["ok"])
        self.assertEqual(p["status"], 402)
        self.assertTrue(p["official"])

    def test_rail_decimals_from_catalog(self) -> None:
        self.assertEqual(zoo.rail_decimals(zoo.YUSDCX, {}), 6)
        self.assertEqual(zoo.rail_decimals(zoo.YUSDCX, SAMPLE_402["accepts"][0]), 6)


class TestWalletAndCloud(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.wallet = root / "zoo-wallet.json"
        self.zcfg = root / "zoo.json"
        self.ccfg = root / "cloud.json"
        self.env = mock.patch.dict(
            os.environ,
            {
                "GAMEMASTER_ZOO_WALLET": str(self.wallet),
                "GAMEMASTER_ZOO_CONFIG": str(self.zcfg),
                "GAMEMASTER_CLOUD_CONFIG": str(self.ccfg),
            },
            clear=False,
        )
        self.env.start()
        os.environ.pop("GAMEMASTER_CLOUD", None)

    def tearDown(self) -> None:
        self.env.stop()
        self.tmp.cleanup()

    def test_ensure_wallet_and_sign(self) -> None:
        info = zoo.ensure_wallet()
        self.assertTrue(info["ok"])
        self.assertTrue(self.wallet.is_file())
        seed, pub = zoo.load_keypair()
        self.assertEqual(len(seed), 32)
        self.assertEqual(pub, info["public"])
        sig = zoo.ed25519_sign(seed, b"openzoo-test")
        self.assertEqual(len(sig), 64)
        again = zoo.ensure_wallet()
        self.assertFalse(again["created"])
        self.assertEqual(again["public"], pub)

    def test_cloud_on_zoo_needs_no_api_key(self) -> None:
        os.environ.pop("XAI_API_KEY", None)
        self.assertEqual(cloud.canon("openzoo"), "zoo")
        self.assertTrue(cloud.is_x402("zoo"))
        self.assertEqual(cloud.cmd_on("openzoo"), 0)
        self.assertEqual(cloud.active_provider(), "zoo")
        st = cloud.status_dict()
        self.assertEqual(st["providers"]["zoo"]["kind"], "x402")
        self.assertTrue(self.wallet.is_file())

    def test_handle_http_status_is_official(self) -> None:
        code, data = zoo.handle_http("GET", "/api/zoo", {})
        self.assertEqual(code, 200)
        self.assertTrue(data["ok"])
        self.assertTrue(str(data.get("chat_url") or "").startswith("https://openzoo.fun/"))
        self.assertFalse(data.get("active"))

    def test_handle_http_unknown_route(self) -> None:
        code, data = zoo.handle_http("GET", "/api/zoo/nope", {})
        self.assertEqual(code, 404)
        self.assertFalse(data["ok"])

    def test_handle_http_wallet_and_on(self) -> None:
        code, data = zoo.handle_http("POST", "/api/zoo", {"action": "wallet"})
        self.assertEqual(code, 200, data)
        self.assertTrue(data.get("wallet") or data.get("public"))
        code, data = zoo.handle_http("POST", "/api/zoo", {"action": "on"})
        self.assertEqual(code, 200, data)
        self.assertTrue(data.get("active"))
        code, data = zoo.handle_http("POST", "/api/zoo", {"action": "off"})
        self.assertEqual(code, 200)
        self.assertFalse(data.get("active"))

    def test_handle_http_ping_uses_official_url(self) -> None:
        fake = json.dumps(SAMPLE_402).encode()
        with mock.patch.object(zoo, "http", return_value=(402, {}, fake)):
            code, data = zoo.handle_http("GET", "/api/zoo/ping", {"model": "openai/gpt-4o-mini"})
        self.assertEqual(code, 200)
        self.assertTrue(data["ok"])
        self.assertTrue(str(data.get("url") or "").startswith("https://openzoo.fun/"))

    def test_cloud_chat_routes_to_zoo(self) -> None:
        os.environ["GAMEMASTER_CLOUD"] = "zoo"
        with mock.patch.object(zoo, "chat", return_value="ok-from-floor") as mocked:
            text = cloud.chat([{"role": "user", "content": "hi"}], model="x-ai/grok-4.6")
        self.assertEqual(text, "ok-from-floor")
        mocked.assert_called_once()


class TestCatalogHooks(unittest.TestCase):
    def test_skill_routes_openzoo(self) -> None:
        r = skills.route("use openzoo")
        self.assertIn(r["decision"], ("act", "choose"), r)
        names = [r["skill"]["name"]] if r.get("skill") else [h["name"] for h in r.get("hits") or []]
        self.assertIn("openzoo", names)

    def test_skill_check_still_clean(self) -> None:
        r = skills.check()
        self.assertTrue(r["ok"], r.get("errors"))

    def test_readme_and_dashboard_name_official_site(self) -> None:
        root = Path(__file__).resolve().parents[1]
        readme = (root / "README.md").read_text(encoding="utf-8")
        dash = (root / "live" / "dashboard.html").read_text(encoding="utf-8")
        self.assertIn("https://openzoo.fun/", readme)
        self.assertIn("dotlab zoo ping", readme)
        self.assertIn("id=\"zooModal\"", dash)
        self.assertIn("https://openzoo.fun/api/v1/chat/completions", dash)

    def test_turbo_routes_openzoo_pack(self) -> None:
        kn = turbo.select_knowledge("openzoo x402 stall", max_chars=14000)
        self.assertIn("openzoo.md", kn)
        self.assertIn("leCore", kn)


if __name__ == "__main__":
    unittest.main()
