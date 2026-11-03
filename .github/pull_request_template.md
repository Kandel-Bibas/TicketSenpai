## Summary

<!-- What does this change do, and why? -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Tests
- [ ] Refactor (no behavior change)
- [ ] Tooling / dependencies

## How was this tested?

<!-- Commands you ran and anything you checked by hand in the browser. -->

- [ ] `make check` passes
- [ ] `make smoke` passes (if setup, dev supervisor, or packaging changed)

## Checklist

- [ ] New behavior has tests; bug fixes include a regression test
- [ ] SQL uses bound parameters; user content is rendered as text
- [ ] User-owned data is scoped to the signed-in user
- [ ] README and `docs/` are updated for any behavior change
- [ ] New API error codes are listed in `docs/api.md`
- [ ] Schema changes are called out below (they require `make reset CONFIRM=reset`)
- [ ] `CHANGELOG.md` has an entry under **Unreleased**

## Notes for reviewers

<!-- Screenshots, trade-offs, follow-ups. Auth/session/access-control changes need a second reviewer. -->
