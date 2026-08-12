from __future__ import annotations

import unittest

import agent


class TestParseTools(unittest.TestCase):
    def test_fenced_write(self) -> None:
        text = """```
tool call write_file
path: src/main.js
content:
export const x = 1
```"""
        tools = agent.parse_tools(text)
        self.assertEqual(len(tools), 1)
        name, args = tools[0]
        self.assertEqual(name, "write_file")
        self.assertEqual(args.get("path"), "src/main.js")
        self.assertIn("export const x = 1", args.get("content") or "")

    def test_bare_list_dir(self) -> None:
        text = "tool call list_dir\npath: src\n"
        tools = agent.parse_tools(text)
        self.assertEqual(tools[0][0], "list_dir")
        self.assertEqual(tools[0][1].get("path"), "src")

    def test_done(self) -> None:
        text = "tool call done\nsummary: added jump\n"
        tools = agent.parse_tools(text)
        self.assertEqual(tools[0][0], "done")
        self.assertEqual(tools[0][1].get("summary"), "added jump")

    def test_empty(self) -> None:
        self.assertEqual(agent.parse_tools("just prose"), [])


if __name__ == "__main__":
    unittest.main()
