# Crazy Cash — Godot game

Godot 4.7 product game for Crazy Cash. It presents reels, cabinet UI, sounds,
FUN/TON-mode UI and result animations. It is a client-only presentation layer:
the React Shell owns browser and Telegram integrations, and the API remains the
authority for sessions, balances, spins and payouts.

## Boundaries

- `scripts/platform/web_bridge.gd` is the only browser integration boundary.
  It exchanges typed `window.postMessage` events with `apps/web`.
- `scripts/game/slots.gd` may display a provisional balance during animation,
  but cannot determine an outcome or persist a balance.
- No API URL, cookie, wallet address, wallet proof, bot token or secret belongs
  in this Godot project.

## Web export

The `Web` preset exports to `../web/public/godot/index.html`. Its custom shell
is `web/crazy_cash_loader.html`: it shows the branded loader and keeps the
1080×1920 game canvas at 9:16, while the Shell-visible outer area uses the
blue `#072846` → `#061937` gradient.

Use Godot **4.7.1** and export from the editor after changing game resources.
Do not manually edit generated files below `apps/web/public/godot`.

## Further reading

- [`../../docs/GODOT.md`](../../docs/GODOT.md) — ownership boundaries, bridge
  contract, mobile input and Web export checks.
- [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) — component
  responsibilities and trust boundaries.
