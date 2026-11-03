# Contributing to TicketSenpai

Thanks for taking the time to contribute! Bug reports, documentation fixes,
tests, and code changes are all welcome. This guide explains how to get a change
from idea to merged.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

- [Ground rules](#ground-rules)
- [Ways to contribute](#ways-to-contribute)
- [Reporting bugs](#reporting-bugs)
- [Suggesting features](#suggesting-features)
- [Your first contribution](#your-first-contribution)
- [Development workflow](#development-workflow)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Review process](#review-process)

## Ground rules

- **Local and synthetic only.** TicketSenpai is a local learning project. Never
  add real personal data, real payment handling, or production deployment
  configuration.
- **Security first.** Do not report vulnerabilities in public issues. Follow
  [SECURITY.md](SECURITY.md).
- **Keep the fixes fixed.** Changes must not reintroduce V01–V06. The
  `test_v0*` regression tests must keep passing.
- **Behavior changes need tests.** Bug fixes need a test that fails without the fix.
- **Docs travel with code.** If you change behavior, update the README and the
  relevant page in [`docs/`](docs/README.md) in the same pull request.

## Ways to contribute

| You want to… | Start here |
| --- | --- |
| Report a bug | [Open a bug report](https://github.com/Kandel-Bibas/TicketSenpai/issues/new?template=bug_report.yml) |
| Suggest an improvement | [Open a feature request](https://github.com/Kandel-Bibas/TicketSenpai/issues/new?template=feature_request.yml) |
| Fix documentation | [Open a docs issue](https://github.com/Kandel-Bibas/TicketSenpai/issues/new?template=documentation.yml) or send a pull request directly |
| Report a security issue | [SECURITY.md](SECURITY.md), privately |
| Ask a question | [SUPPORT.md](SUPPORT.md) |

## Reporting bugs

Before opening an issue:

1. Update to the latest `main` and check the bug still happens.
2. Check the [troubleshooting guide](docs/troubleshooting.md).
3. Search [existing issues](https://github.com/Kandel-Bibas/TicketSenpai/issues),
   including closed ones.

A great bug report includes:

- What you did, step by step, starting from `make reset CONFIRM=reset` if possible.
- What you expected and what happened instead.
- The exact error `code` and `message` from the API, or the browser console output.
- Your OS, `node --version`, and `python3 --version`.

## Suggesting features

Open a feature request describing the problem first, then your proposed
solution. Explain how it fits a local, single-machine learning app. Large
changes, such as a new dependency, a schema change, or a new subsystem, should
be agreed in an issue before you write the code.

## Your first contribution

Good first contributions:

- Documentation improvements and typo fixes.
- Additional tests for existing behavior in `backend/tests/test_app.py`.
- Accessibility improvements in the frontend.

Look for issues labeled
[`good first issue`](https://github.com/Kandel-Bibas/TicketSenpai/labels/good%20first%20issue)
and [`help wanted`](https://github.com/Kandel-Bibas/TicketSenpai/labels/help%20wanted).
Comment on an issue to say you are working on it so effort is not duplicated.

## Development workflow

1. **Fork** the repository and clone your fork.

   ```sh
   git clone https://github.com/<your-username>/TicketSenpai.git
   cd TicketSenpai
   git remote add upstream https://github.com/Kandel-Bibas/TicketSenpai.git
   ```

2. **Set up** and confirm everything passes before you change anything.

   ```sh
   make setup
   make check
   ```

3. **Create a branch** from an up-to-date `main`. Use a prefix that matches the
   change type:

   ```sh
   git switch main && git pull upstream main
   git switch -c fix/hold-expiry-message
   ```

   Prefixes: `feat/`, `fix/`, `docs/`, `test/`, `refactor/`, `chore/`.

4. **Make your change.** The [development guide](docs/development.md) explains the
   layout and conventions, and the [architecture guide](docs/architecture.md)
   explains how the parts fit together.

5. **Check your work.**

   ```sh
   make check   # Node suite + Flask suite + frontend build
   ```

   If you changed setup, the dev supervisor, or packaging, also run `make smoke`
   (ports 3000 and 5001 must be free).

6. **Push** and open a pull request against `main`.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<optional scope>): <short summary in the imperative>

<optional body: what changed and why, wrapped at 72 characters>
```

| Type | Use for |
| --- | --- |
| `feat` | New user-facing behavior |
| `fix` | Bug fixes |
| `docs` | Documentation only |
| `test` | Adding or fixing tests only |
| `refactor` | Code changes that do not change behavior |
| `chore` | Tooling, dependencies, and maintenance |

Examples:

```text
fix(holds): reject duplicate seat ids before touching the database
docs(api): document the price_locked error
test: cover checkout of an unpublished event
```

Keep each commit focused on one logical change.

## Pull requests

Before you request review, make sure that:

- [ ] `make check` passes locally.
- [ ] New behavior has tests, and bug fixes have a regression test.
- [ ] SQL uses bound parameters and user content is rendered as text.
- [ ] User-owned data is scoped to the signed-in user.
- [ ] The README and `docs/` reflect any behavior change.
- [ ] New API error codes are added to the [error table](docs/api.md#error-codes).
- [ ] Schema changes are called out, since they require `make reset CONFIRM=reset`.
- [ ] The pull request description explains *what* and *why*, and links the issue.

Keep pull requests small. Several small pull requests are reviewed faster than
one large one.

## Review process

- A maintainer will review your pull request, usually within a few days.
- Reviewers may ask for changes. Push new commits to the same branch; there is
  no need to open a new pull request.
- Changes to authentication, sessions, password handling, or access control need
  a second reviewer.
- Once approved and green, a maintainer will merge it.

Thank you for helping make TicketSenpai better!
