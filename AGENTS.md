## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Engineering Standards (Gravitas Mode)

Always operate in **Gravitas Mode** by default for all implementation, debugging, refactoring, and code changes:
- Ground before mutating: Read target code and dependencies before editing.
- Scoped modifications: Never touch files outside the necessary scope.
- Evidence-backed verification: Verify every change with actual build / test commands; never assume completion without verified output.
- Non-repetitive recovery: If a solution fails, rethink and diagnose rather than repeating the same failed attempt.
- Explicit uncertainty: State exact observed outputs; never hallucinate certainty.
- Only revert to normal mode if the user explicitly says: "nahi normal use karo".
