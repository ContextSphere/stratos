# Releases

Stratos ships desktop release artifacts through GitHub Releases.

The initial public release track is:

- macOS Apple Silicon (`arm64`) DMG
- signed with an Apple Developer Application certificate
- notarized with Apple ID credentials plus an app-specific password
- uploaded as a draft GitHub Release for manual verification before publish

## Required GitHub Secrets

Add these repository secrets before the first tagged release:

- `MACOS_CERTIFICATE_P12_BASE64`: base64-encoded `Developer ID Application` certificate `.p12`
- `MACOS_CERTIFICATE_PASSWORD`: password used when exporting the `.p12`
- `APPLE_ID`: Apple ID email used for notarization
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password generated for that Apple ID
- `APPLE_TEAM_ID`: Apple Developer Team ID

## One-Time Apple Setup

1. Enroll the signing owner in Apple Developer.
2. Create a `Developer ID Application` certificate in Apple Developer and export it from Keychain as a `.p12`.
3. Create an app-specific password for the Apple ID used for notarization.
4. Base64-encode the `.p12` file for GitHub Actions secrets:

```bash
base64 -i DeveloperID_Application.p12 | pbcopy
```

## Creating a Release

1. Update `packages/desktop/package.json` to the target version.
2. Commit the version change and push it to GitHub.
3. Create and push a matching Git tag:

```bash
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

4. Wait for the `Release` workflow to finish on GitHub.
5. Open the draft release and download the DMG.
6. Verify:
   - the DMG opens cleanly
   - the app installs into `/Applications`
   - macOS does not show an unidentified developer warning
   - the notarized app launches on a machine that has not built Stratos locally
7. Publish the GitHub release once verification passes.

## Local Validation

Use this on a macOS machine that already has the signing identity and notarization credentials configured:

```bash
pnpm install
pnpm build:mac
codesign --verify --deep --strict packages/desktop/dist/mac-arm64/Stratos.app
spctl --assess --type execute packages/desktop/dist/mac-arm64/Stratos.app
```

## Rollback

- If the draft artifact is broken, delete the draft release and fix forward with a new tag.
- Do not reuse a published tag for a different binary.
- If notarization fails, inspect the GitHub Actions logs before retrying.
