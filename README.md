# Desktop Tower Defense

Recreating Desktop Tower Defense.  The original flash game seems to be lost to the internet.  This is an attempt at rebuilding it with canvas tag.

Initial work credit grok3 -> 	https://grok.com/share/bGVnYWN5_6c0f58f0-d797-4160-8e3a-5d3951813d31
Sound credit to ElevenLabs

Further enhanced with opus 4.6

## Latest improvements

- Hand-drawn / graph-paper visual theme: sketchy towers, doodle creeps, paper UI and desk background.
- Difficulty selection intro menu: Easy, Medium, Hard, Challenge, and Fun modes.
- Tower prices and base stats matched to the original Desktop Tower Defense screenshots.
- Corrected tower roles: Squirt is now the fast single-target tower; Dart is the slow splash-damage tower.
- Game economy closer to the original: starting cash $80, instant tower upgrades, 70% sell value.
- Classic Desktop TD mechanics: send waves early for bonus gold and earn interest on banked cash at wave clear.

<img width="1040" height="822" alt="gameplay" src="https://github.com/user-attachments/assets/19e37c54-1955-44de-bd9d-d1ead5973a50" />

## Development

The game is plain HTML/CSS/JS — just open `index.html` in a browser.

Run the headless test suite (drives the real game globals in Chrome/Chromium;
set `CHROME_BIN` if the browser isn't on your `PATH`):

```sh
node tests/run-tests.js
```

The suite lives in [`tests/tests.js`](tests/tests.js) and covers wave scheduling,
spawn queueing, delta-time scaling, early-send bonuses, pathfinding/repathing, and
placement guards.


