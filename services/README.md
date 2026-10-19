# Self-hosted Helium services

Helium fetches uBlock Origin filter lists, the !bangs list and Chrome Web Store extensions through a services server. [helium-services](https://github.com/imputnet/helium-services) is that server's open-source code. `run-local.sh` runs a pinned copy of it on your Mac at `https://localhost`, so Helium never needs imputnet's servers.

## Run it

You need Docker Desktop (running) and mkcert:

```sh
brew install mkcert
mkcert -install        # once; asks for your password so the browser trusts the certificate
sh services/run-local.sh
```

The script:
1. clones helium-services at a pinned commit into `services/helium-services/`;
2. writes a `.env` with a random `HMAC_SECRET`;
3. creates a `localhost` certificate with mkcert;
4. starts nginx, the uBO list mirror and the extension proxy.

The `.env`, the certificates and the clone are all gitignored.

Then in Helium:

1. On the first-run screen, **decline** services.
2. Settings → Privacy → Services → custom origin: `https://localhost`.
3. Turn services on.

## Check it

```sh
cd services/helium-services
docker compose ps                  # all containers "running"
docker compose logs -f nginx       # Helium's requests appear here
```

## Stop or update

```sh
cd services/helium-services
docker compose down                # stop
```

To update, change `SERVICES_COMMIT` in `run-local.sh` and run it again.

## Differences from upstream's `setup.sh`

| | Upstream `setup.sh` | `run-local.sh` |
|---|---|---|
| Certificate | Let's Encrypt via acme.sh (needs a public domain) | mkcert, trusted only on this Mac |
| ACME container | Running | Disabled through a compose profile |
| IPv6 network | On | Off, because Docker Desktop has no IPv6 bridge by default |

## Moving it to a server

On a Linux server with a domain pointing at it, use upstream's own `setup.sh`. Set `SERVICES_HOSTNAME`, `SSL_CERT_EMAIL` and the base URLs in `.env` to your domain, then enter `https://your-domain` as the custom origin in Helium.

**Note:** anyone who can reach the server can use it. The extension proxy also downloads extensions from Google from the server's IP.
