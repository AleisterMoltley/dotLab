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
tool call kit
action: todo_add
text: tune gravity after first play
```

```
tool call kit
action: wiki_add
fact: Gravity 28
why: user said floaty
```

```
tool call kit
action: feel
```

```
tool call skills
action: route
task: juice the jump
```

```
tool call kit
action: art_test
```

```
tool call read_file
path: src/game.js
start: 1
end: 80
```

```
tool call done
summary: What was done and how to test
```

Rules:
- One tool block per step, then wait for the result
- write_file = complete file (not partial patch unless tiny)
- run only safe non-interactive commands (npm, node, ls) — no sudo
- Unknown tools do not exist. `skills route` abstains instead of guessing.
- Always finish with `done`
