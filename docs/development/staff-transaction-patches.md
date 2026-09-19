# Local staff transaction prerequisite

The task delegation module needs atomic staff task, delegation and audit writes. Open Mercato 0.8.0 does not supply this contract. Until the framework correction is released, this application installs two Yarn patches for `@open-mercato/core` and `@open-mercato/shared`.

The source change is local Core commit `d04c65202` (`fix(staff): compose task commands in managed transactions`), based on canonical Core commit `ab23d45ff`. It has not been published upstream. The patches include the changed TypeScript source, compiled JavaScript and matching source maps. They do not add migrations or new dependencies. Yarn resolutions ensure transitive consumers use the same patched packages.

Install and verify:

```sh
corepack yarn install --immutable --mode=skip-build
node scripts/verify-staff-transaction-patches.mjs
corepack yarn generate
corepack yarn typecheck
```

The verifier compares installed source and runtime hashes with `staff-transaction-patches.json`, checks that Core and the app resolve the same shared command registry, and exercises the compiled commit/effect ordering. The Core source change separately passed 19 isolated PostgreSQL regressions, 181 shared command tests and 88 selected Core tests, package builds, typechecks, and correctness/security re-review. These checks do not certify application delegation, full CI, paid agent execution or deployment.

Patch authoring uses `corepack yarn patch <package>@npm:0.8.0` and `corepack yarn patch-commit -s <extracted-directory>`. Apply reviewed source and matching build outputs to the extracted patch directory, never to `node_modules`. Update the manifest when the reviewed candidate changes. Remove both patches together once a released Core/shared pair supplies the same contract, then regenerate, typecheck and rerun delegation transaction tests.
