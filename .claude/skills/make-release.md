# Skill: make-release

Create a Stratos release by bumping the repo version, committing it, and creating the matching Git tag with a leading `v`.

## Workflow

1. Read `docs/release.md` before making changes. Use it as the canonical workflow.
2. Confirm the target version if the user did not provide one.
3. Update `packages/desktop/package.json` `version` to the target version.
4. Bump `packages/core/package.json` and `packages/ui/package.json` only if the release needs those package versions aligned too.
5. Verify the final version fields match what will be tagged.
6. Commit the version change.
7. Push the commit to the remote branch.
8. Create a Git tag named `v<version>`, such as `v0.1.0` or `v0.1.0-alpha.1`.
9. Push the tag with `git push origin v<version>`.
10. Follow the GitHub Release workflow in `docs/release.md` and validate the artifact with `docs/release-validation.md`.

## Commands

Use these commands after updating the version fields:

```bash
git add packages/desktop/package.json packages/core/package.json packages/ui/package.json
git commit -m "release: v<version>"
git push
git tag v<version>
git push origin v<version>
```

If only `packages/desktop/package.json` changed, stage only that file.

## Guardrails

- Keep the package version and Git tag identical except for the tag's leading `v`.
- Do not create a bare tag like `0.1.0`; always use `v0.1.0`.
- Do not reuse an existing published tag for a different build.
- If the release breaks, fix forward with a new version and a new tag.
