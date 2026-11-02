# Contributing

Thanks for helping with Hillium.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting a bug or asking for a feature

Open an [issue](https://github.com/Gitguy268/hillium/issues/new/choose) and use the template. Say which look you use and your system.

Report security problems privately: see [SECURITY.md](SECURITY.md).

## Making a change

1. Fork the repository and create a branch from `main`.
2. `cd app && npm ci && npm start` (Node 24, see `.nvmrc`). On macOS you can double-click `app/start.command`.
3. Keep commits small, each with a clear message.
4. Run the checks below, and update the README and `docs/` if behaviour changed.
5. Open a pull request and fill in the template.

## Checks

```sh
cd app
npm run lint
npm test                                   # unit tests, no Electron needed
PLAYWRIGHT=/path/to/node_modules/playwright npm run e2e
PLAYWRIGHT=/path/to/node_modules/playwright sh test/arch/run.sh   # Arch Linux in Docker
```

CI runs lint, the unit tests, shellcheck and a Linux build. The end-to-end tests drive a real window, so run them yourself and say in the pull request that you did.

Ground rules:
- **One webRequest listener per session.** Electron keeps only the last one, so everything goes through `main/privacy/filter.js`.
- **Pages in tabs get no Node and no preload.** `hillium://` pages talk to main through the token-checked API in `main/protocol.js`.
- **Agents never see private windows.** `main/agent.js` only reaches the normal model.
- **No request to Google** in normal use. The e2e test checks the network log.

## Licences

Hillium is MIT (see [LICENSE](LICENSE)), and your contribution is accepted under the same licence. Files in `app/ui/vendor/zen/` are MPL-2.0: changes to them stay MPL-2.0. Don't add libraries, fonts or images unless their licence allows redistribution, and list each one in [NOTICE](NOTICE) in the same pull request. Don't copy code from GPL or unlicensed projects; credit ideas under "Ideas, no code" in NOTICE.
