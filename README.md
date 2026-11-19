# ARK-09 // Cold Horizon

A slow, atmospheric browser game. You are the ship mind of a colony ark, waking alone in the dark with 10,000 sleepers in the hold and no memory of how you got here.

**Play:** https://shinobi163.github.io/cold-horizon/

- `index.html` — the page: title screen, layout, and the script tags
- `style.css` — all styles
- `js/engine.js` — shared engine: voyage save, narration and log, questions, decision tree, act gating
- `js/act0.js` — Act 0 · Dark, the current vertical slice (about 5 minutes)
- `classic.html` — the original ARK-09 idle prototype

No build step. Each act is its own file and registers with the engine; long acts can split further (`act2.1.js`).

## Saves

One voyage save in the browser holds the current act, an act ledger that later acts read, and a checkpoint at the start of each act (replay from **chapters** on the title screen). **Export save** / **import save** move a voyage between browsers as a `.json` file. An act opens only after the previous one is complete.

## Run locally

```
node serve.js
```

Then open http://localhost:8766. Testing flags:

- `?reset` wipes the save
- `?speed=10` runs the game faster
- `?dev` adds a menu on the title screen to jump to the start of any built act
