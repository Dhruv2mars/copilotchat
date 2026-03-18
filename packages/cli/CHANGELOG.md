# @dhruv2mars/copilotchat

## 0.1.4

### Patch Changes

- Remove all Keychain and system secret-store usage from auth storage paths.
- Save local auth only in `~/.copilotchat/session.json` with locked file permissions.
- Remove the old bridge Keychain path too, so no shipped app path depends on system secret-store prompts.

## 0.1.3

### Patch Changes

- Publish the first working Rust CLI release with GitHub Copilot auth, model listing, terminal chat, and npm/GitHub Release distribution.
