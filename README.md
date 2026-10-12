# codex-autopsy

> What killed my context window?

A small CLI that shows what's filling your [Codex](https://github.com/openai/codex) context window, broken down by category, for the latest (or any) Codex session.

```bash
npx codex-autopsy                 # latest session in $CODEX_HOME (default ~/.codex)
npx codex-autopsy 01a12f20        # a session by id prefix, or a path to a rollout .jsonl
npx codex-autopsy --list          # recent sessions
npx codex-autopsy --top 10        # the 10 biggest items in the window
npx codex-autopsy --turns         # how the window filled up, turn by turn
npx codex-autopsy --json          # the same breakdown as JSON, for scripts
```

Work in progress.

## Privacy

codex-autopsy reads only local files and sends nothing anywhere.

## License

MIT
