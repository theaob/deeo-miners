# Deeo Miners

A procedurally generated mining roguelike platformer for the browser. Every
mine is different, your lamp is always running low, and the only way out is
down.

No build step and no dependencies: open `index.html` in a browser and play.

## How to play

Find the lift at the bottom of each mine and ride it deeper. Grab as much gold
as you can on the way and spend it at the supply cart between depths. One life;
when the mine wins, you start again from the top.

| Action | Keys |
| --- | --- |
| Move / climb ropes | Arrow keys or WASD |
| Jump | Z, Space or K |
| Pickaxe (hold Up / Down to aim) | X or J |
| Throw dynamite (Down drops it, Up lobs it high) | C or L |
| Rope (hooks upward; hold Down to hang it off the ledge in front) | V or I |
| Ride the lift | Up while standing in it |
| Pause / mute | P / M |

On a touch screen an on-screen pad appears.

Things worth knowing:

- **The pickaxe digs.** Dirt takes two swings, stone four. Gold ore and gem
  veins drop loot when broken. Dark hard rock only yields to dynamite.
- **The lamp burns oil.** The light shrinks as it drains; once it is out, the
  dark itself starts to hurt. Oil cans and the supply cart refill it.
- **Stomp or swing.** Jump on beetles, slimes and bats, or hit them with the
  pickaxe. Stalactites drop when you walk beneath them.
- **Long falls hurt**, spikes hurt if you land on them, lava always hurts.
- Mines get stonier, darker and meaner every three depths.

## Development

```
npm test            # level generator tests (Node, no dependencies)
npm run test:smoke  # headless browser playthrough (needs Playwright)
npm run build       # single-file build at dist/deeo-miners.html
```

Layout:

- `src/level.js` – mine generation and the solvability check (pure logic, shared with tests)
- `src/sprites.js` – all art, generated at load time from pixel maps and noise
- `src/audio.js` – synthesised sound effects
- `src/game.js` – game loop, physics, entities, lighting, HUD and menus

The generator carves a guaranteed route through a 4x4 grid of rooms, so the
lift is always reachable without spending tools; `isSolvable` verifies this for
every mine and the tests check it across thousands of seeds.
