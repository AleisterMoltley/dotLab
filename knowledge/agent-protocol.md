# Agent Tool Protocol (local)

In agent mode, call tools between thinking steps:

```
tool call list_dir
path: .
```

```
tool call read_file
path: src/player.js
```

```
tool call write_file
path: src/player.js
content:
...full new file contents...
```

```
tool call search
query: class Player|function update
glob: *.{js,ts}
```

```
tool call run
cmd: npm test
```

```
tool call done
summary: What was done and how to test
```

Rules:
- One tool block per step, then wait for the result
- write_file = complete file (not partial patch unless tiny)
- run only safe non-interactive commands (npm, node, ls) — no sudo
- Always finish with `done`
