# Filby

A framework for temporal reference data on Postgres. The library is in `lib/`, Filby's own migrations in `migrations/`, tests in `test/`, and an example application in `examples/holiday-park`.

The October 2026 review is tracked in https://github.com/acuminous/filby/issues/2. Read its implementer conventions before starting any issue; they are not repeated here. Its Concurrency section says which issues can be worked on at the same time and the rules for concurrent PRs.

## Environment

Two Postgres containers, started once from the main checkout with `npm run docker`:

| Port | Used by | Default database |
|------|---------|------------------|
| 5432 | `npm test` | `fby_test` |
| 5433 | `examples/holiday-park` | `fby_example` |

Tests wipe their database before every test, so each worktree must use its own. The database name comes from `PGDATABASE`, which the npm scripts load from a gitignored `.env` file in the worktree root. With no `.env` the defaults above apply, which is what the main checkout and CI use.

Never run `docker compose down`, `npm run docker` or `npm run test:all` from a worktree. The containers are shared with every other worktree.

## Working on an issue in a worktree

1. Create a worktree on a branch named `m-<item>-<slug>`, for example `m-b5-csv-typing`. If the worktree tool chose a different branch name, rename it with `git branch -m`.
2. In the worktree root, write `.env` containing `PGDATABASE=fby_<slug>` using only lower case letters, digits and underscores, for example `PGDATABASE=fby_b5_csv_typing`.
3. Run `npm ci` in the root and `examples/holiday-park`.
4. Run `npm run db:create`. This creates the database on both servers.
5. Work as normal. `npm test`, `npm run coverage` and the example suite refuse to run in a worktree that has no `PGDATABASE`.
6. When the branch is merged, run `npm run db:drop` before removing the worktree.

## Before claiming done

Run all of these and paste the results in the PR:

```
npm test
npm run lint
(cd examples/holiday-park && npm test)
```

One PR per issue, branched from `main`. Reference the issue with `Fixes #N`. The maintainer merges.

## README and documentation style

Write clear, practical documentation in professional UK English. The reader should understand what the software does, why it is useful and how to use it without having to reconstruct the explanation from implementation details.

### Start with the reader's problem

Open with a direct explanation of what the project does and the problem it solves. Make its usefulness apparent through concrete behaviour and examples.

Introduce concepts before explaining their mechanics. Do not begin with configuration, architecture or internal terminology that the reader cannot yet place in context.

Assume the reader is competent but unfamiliar with this project. Explain project-specific concepts without teaching general programming unnecessarily. For tools used by non-engineers, explain their workflow in familiar language and put engineering reference material separately.

### Build a connected explanation

Organise the README around the questions a reader will ask, in roughly the order they will ask them. A useful progression is: purpose, a small working example, essential concepts, normal usage, configuration and relevant limitations. Adapt this to the project rather than mechanically including every section.

Each paragraph should develop one idea, and each sentence should follow naturally from the previous one. Explain the relationship between facts: why a rule exists, what it changes or what the reader should do because of it.

Prefer cohesive paragraphs to a succession of isolated one-line statements. Avoid excessive headings, especially headings followed by a single sentence. Use lists for genuinely parallel items or ordered steps.

Explain each rule fully in its natural location. Elsewhere, refer back to it only where the reader needs a reminder. Remove repeated introductions, benefits and summaries.

### Explain observable behaviour precisely

Describe what happens when the reader takes an action. Be explicit about relevant defaults, conditions, scope and consequences.

Prefer “Rows with dates in the past are ignored” to “The tool intelligently handles historical data.”

Where applicable, explain:

- What triggers an operation.
- Which files, rows, records or fields it affects.
- What happens to anything outside that scope.
- Whether the result is immediate, scheduled, draft or published.
- What happens when the operation is repeated or fails.

Include these details where they affect the reader's decisions. Do not turn every section into an exhaustive catalogue of edge cases.

Distinguish requirements from recommendations, supported behaviour from future ideas, and examples from restrictions. A business-specific example must not accidentally imply that a general-purpose tool only supports that business case.

### Use examples to carry the explanation

Introduce the simplest realistic example that demonstrates the project's value. Keep names, data and terminology consistent as the explanation develops.

Show enough input and output for the reader to understand the result. Explain the significant behaviour without narrating every line of code.

Use compact Markdown tables for condition-to-result rules, comparisons, options and related query examples. Use numbered steps for workflows and fenced code blocks with language identifiers for commands, configuration and code.

Keep examples focused. Avoid large outputs, repeated commands and implementation scaffolding that obscure the point. Put advanced details after the reader has understood the normal case.

### Keep the language direct

Use familiar words, concrete nouns and active verbs. Be succinct by removing repetition and unnecessary framing, while preserving the reasoning and technical detail the reader needs.

Avoid:

- Marketing claims such as “powerful”, “seamless”, “robust” and “flexible” without a specific, useful explanation.
- Agent-like phrases such as “Let's dive in”, “It's worth noting” and “This ensures”.
- “Simply”, “just”, “obviously” and “of course”.
- Rhetorical questions, philosophical commentary and unnecessary analogies.
- Contrastive slogans such as “This isn't X. It's Y.”
- Em dashes and bold emphasis within sentences.

State limitations plainly. Do not oversell the project or disparage alternatives.

### Verify before finishing

Read the relevant code, tests and existing documentation before asserting behaviour. Check commands, option names, defaults and examples against the implementation. When documenting a proposed design, identify it as proposed.

Do not invent behaviour to make the explanation smoother. Flag material ambiguities or contradictions rather than silently resolving them. During a prose rewrite, preserve the intended technical meaning and raise any proposed behavioural changes separately.

Finally, read the document from the perspective of someone encountering the project for the first time. Remove unexplained terms, abrupt jumps, duplication and sentences that add no useful information.

### Updating existing documentation

Treat the existing README as an established document. Apply the writing guidance to the material you change, without using it as a reason to rewrite unrelated sections.

Before editing, read enough of the document to understand its structure, terminology, audience and where the information belongs.

Integrate the change into the existing explanation:

- Update the relevant passages rather than appending a new section by default.
- Replace superseded information and remove any repetition your change would introduce.
- Check related examples, tables and cross-references for consistency.
- Adjust surrounding prose where necessary so the explanation still flows naturally.
- Preserve useful detail, established terminology and unaffected content.

Match the surrounding style where it is clear and effective. Improve awkward wording within the affected passage, but leave unrelated stylistic improvements for a separate task.

Keep the scope proportionate to the request. A local change usually needs a local edit. A change to a core concept may require updates across several sections. Follow its consequences through the document rather than merely adding a caveat.

If the requested change reveals a wider structural problem, explain it separately unless restructuring is necessary to make the update accurate and understandable.
