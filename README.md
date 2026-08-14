# Relaunch Demo

A self-contained demo of the relaunch protocol on a surfpool fork of mainnet, wrapped in a small web UI. The interface is product-generic — it presents *a relaunch*, whatever token it's pointed at; this instance defaults to a real pump-graduated Raydium token (MOBY).

## Run

```bash
./run.sh
```

Boots the fork, deploys relaunch + futarchy, injects the frozen global ALT, initializes a 30-day / 2%-threshold relaunch, and opens the UI at [http://localhost:5173](http://localhost:5173). Ctrl-C tears everything down; re-running is the reset button.

Needs: `surfpool` ≥ 1.2 on PATH, `yarn`, a mainnet RPC URL in `.env` (`SURFPOOL_DATASOURCE_RPC_URL=…`), and a built programs repo (see below).

Env knobs (all optional): `TARGET_MINT` / `TARGET_POOL` (default: MOBY's mint and AMM v4 pool), `TOKEN_NAME` / `TOKEN_SYMBOL`, `DEPOSIT_WINDOW_SECONDS`, `GRACE_SECONDS`, `THRESHOLD_BPS`, `UI_PORT`.

## Coupling to the programs repo (temporary)

Program binaries (`programs/relaunch.so`, `programs/futarchy.so`) are vendored copies — after rebuilding the programs repo (`./rebuild.sh` there), copy the fresh `.so` files from its `target/deploy/` into `programs/`.

`fixtures/relaunch-global-alt` is a frozen copy of the repo's test fixture (the bytes behind the SDK's pinned `RELAUNCH_V0_1_GLOBAL_ALT`) and doesn't change with rebuilds.

## Layout

```
run.sh                  # the single entrypoint
bootstrap/bootstrap.ts  # fork setup: admin keygen (throwaway, per run), ALT inject, pool preflight, init, config emit
programs/               # vendored relaunch.so + futarchy.so (deployed into the fork)
fixtures/               # frozen global-ALT account bytes
runbooks/ + txtx.yml    # surfpool runbook deploying relaunch + futarchy
ui/                     # Vite + React app (wallet deposits, lifecycle cards, demo controls)
```

