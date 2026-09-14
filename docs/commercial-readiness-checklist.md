# AI XiaoBao Academy Commercial Readiness Checklist

This checklist covers the work that is independent from Web deployment.

## Desktop Package

- Build a signed Windows installer before public distribution.
- Keep `build.win.target` including `nsis` for the downloadable installer and `dir` for local smoke testing.
- Use the same XiaoBao icon assets in `resources/icons/` for the installer, uninstaller, executable, and desktop shortcut.
- Do not distribute `release/win-unpacked` directly to schools; use the generated installer after cloud account configuration is complete.

## Unified Accounts

- Desktop commercial builds must use `DESKTOP_AUTH_MODE=cloud`.
- Configure `CENTRAL_AUTH_BASE_URL` or `XIAOBAO_CLOUD_API_URL` to the deployed Web/API origin before packaging.
- Keep `DESKTOP_AUTH_MODE=local` only for private development builds.
- Verify this flow before release: Web register -> Web login -> Desktop login with the same account -> Desktop logout -> Desktop login again.

## Secrets

- Generate strong `JWE_SECRET` and `ENCRYPTION_KEY` values for production.
- Set `INITIAL_ADMIN_PASSWORD` only to a strong temporary admin password, then rotate it after first login.
- Never paste Tencent Cloud, CodeBuddy, Volcengine, GitHub, or archive credentials into logs, screenshots, support tickets, or chat.
- Store production secrets in the server environment or deployment console, not in source files.

## Student Safety

- Add privacy policy, user agreement, and minor protection policy before opening registration.
- Enable content safety checks for generated text, images, audio, and video.
- Add teacher/admin review workflows before enabling public sharing features.
- Keep default daily usage limits conservative for school pilots.

## Release Smoke Test

- Health endpoint returns `{"status":"ok"}`.
- Web registration succeeds.
- Web login succeeds.
- Desktop login succeeds with the same Web account.
- AI chat can create a coding task.
- Image, video, music, and game-generation entries either work or show a clear unavailable state.
- Logout and relaunch preserve expected account state.
- Installer can install, launch, uninstall, and reinstall cleanly.
