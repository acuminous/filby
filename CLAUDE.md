# Filby

A framework for temporal reference data on Postgres. The library is in `lib/`, Filby's own migrations in `migrations/`, tests in `test/`, and two example applications in `examples/javascript` and `examples/typescript`.

The October 2026 review is tracked in https://github.com/acuminous/filby/issues/2. Read its implementer conventions before starting any issue; they are not repeated here. Its Concurrency section says which issues can be worked on at the same time and the rules for concurrent PRs.

## Environment

Three Postgres containers, started once from the main checkout with `npm run docker`:

| Port | Used by | Default database |
|------|---------|------------------|
| 5432 | `npm test` | `fby_test` |
| 5433 | `examples/javascript` | `fby_example` |
| 5434 | `examples/typescript` | `fby_example` |

Tests wipe their database before every test, so each worktree must use its own. The database name comes from `PGDATABASE`, which the npm scripts load from a gitignored `.env` file in the worktree root. With no `.env` the defaults above apply, which is what the main checkout and CI use.

Never run `docker compose down`, `npm run docker` or `npm run test:all` from a worktree. The containers are shared with every other worktree.

## Working on an issue in a worktree

1. Create a worktree on a branch named `m-<item>-<slug>`, for example `m-b5-csv-typing`. If the worktree tool chose a different branch name, rename it with `git branch -m`.
2. In the worktree root, write `.env` containing `PGDATABASE=fby_<slug>` using only lower case letters, digits and underscores, for example `PGDATABASE=fby_b5_csv_typing`.
3. Run `npm ci` in the root, `examples/javascript` and `examples/typescript`.
4. Run `npm run db:create`. This creates the database on all three servers.
5. Work as normal. `npm test`, `npm run coverage` and the example suites refuse to run in a worktree that has no `PGDATABASE`.
6. When the branch is merged, run `npm run db:drop` before removing the worktree.

## Before claiming done

Run all of these and paste the results in the PR:

```
npm test
npm run lint
(cd examples/javascript && npm test)
(cd examples/typescript && npm test)
```

One PR per issue, branched from `main`. Reference the issue with `Fixes #N`. The maintainer merges.
