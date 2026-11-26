# Read Aloud: developer guide

## What this is

A Raycast extension for macOS, in `raycast/`. The user selects text in any app and runs the
**Read Selection** command, usually through a hotkey. The extension reads the selection out loud
with an ElevenLabs voice, and can lower Spotify's volume while it speaks. Running the command
again stops it early.

Design goals, in order: start speaking as fast as possible; stay simple (one command, one source
file, one player script); do not add features nobody asked for.

## Layout

| Path | Purpose |
| --- | --- |
| `raycast/package.json` | Extension manifest: the command and the settings page (preferences) |
| `raycast/src/read-selection.ts` | The command: toggle, get the text, choose the model, fetch the audio, start the player |
| `raycast/assets/play.sh` | The player: plays one file with `afplay`, lowers and restores Spotify |
| `raycast/assets/icon.png` | Extension icon, rendered from `assets/icon.svg` |
| `raycast/README.md`, `raycast/CHANGELOG.md` | Store-facing documentation |
| `assets/icon.svg` | Source of the icon; also shown in the root README |

## Build, install, check

```
cd raycast
npm install
npm run dev      # builds, installs the extension into Raycast, rebuilds on every save; Ctrl+C to end
npm run build    # production build and typecheck
npm run lint     # manifest, icon, ESLint and Prettier checks; `npm run fix-lint` fixes formatting
```

The extension stays installed in Raycast after `npm run dev` ends. After changing code, run
`npm run dev` again briefly so Raycast picks up the new build. Both `build` and `lint` must pass
before a Store submission (`npm run publish` opens the pull request to `raycast/extensions`).

API keys are entered only through Raycast's settings (`password` preferences). Never read them
from files or commit them.

## How it works

Every run of the command starts from scratch, and a Raycast command should end quickly, so the
audio is played by a separate detached process and the state lives in a file.

- **State**: `state.json` in the extension's support folder
  (`~/Library/Application Support/com.raycast.macos/extensions/read-aloud/`). It holds a token and,
  once the voice has started, the player's process id, the model used, and whether the audio came
  from the cache.
- **Toggle**: if the state names a live player, the command sends it SIGTERM and shows "Stopped".
  If the state is younger than 60 seconds and has no player yet, a fetch is under way: the command
  deletes the state, and the fetching run sees its token is gone and does not play.
- **Text**: `getSelectedText()` from Raycast, which uses Raycast's own Accessibility permission.
  A deeplink can pass the text instead (`launchContext.text`); this exists for testing.
- **Model choice**: the "Models, in Order" preference is a list of ElevenLabs model IDs, fastest
  first (default `eleven_flash_v2_5, eleven_v4_turbo`). One request to Jev, TypeSafe's decision
  model (`POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`), asks a yes/no ("noul")
  question per model: is every word of the text in one of this model's languages? The first model
  answered 0.5 or more is used; if none, the last model, which is the catch-all and is never asked
  about. The language names come from ElevenLabs' `GET /v1/models` (needs the `models_read`
  permission on the key), cached for a week in `model-languages.json` in the support folder; a
  stale cache is used when the refresh fails. If Jev cannot be asked (no key, error, 3-second
  timeout, no language list), the first model is used and the HUD says why. This fallback is
  deliberate: do not add a local language check.
- **Audio**: one request to the ElevenLabs text-to-speech API, whole text in, MP3 out.
- **Cache**: the MP3 is kept in `cache/` in the support folder, named by a hash of the text, the
  voice and the model list. Reading the same selection again plays the file directly, with no Jev
  or ElevenLabs request. Speed is not in the name, since it is applied on playback. The most
  recently played readings are kept: 10 by default ("Readings to Keep"); 0 turns the cache off.
  The player never deletes the file.
- **Spotify is opt-in** (default off). Two checkboxes: "Lower Spotify's volume while reading", and
  "Also lower it when Spotify is not playing on this Mac". With the second off, the volume is
  touched only while the Spotify app is producing sound on this Mac, so not when it is paused or
  playing on another device (Spotify Connect). The test is `plays_here` in `play.sh`:
  `pmset -g assertions` lists a coreaudiod entry "Created for PID: <Spotify's pid>" while Spotify
  outputs audio. AppleScript cannot tell which device Spotify is playing on, which is why this
  indirect test is used.
- **Player** (`play.sh`): starts `afplay -q 1 -r <speed>` first and only then asks Spotify for its
  volume and lowers it, so Spotify never delays the voice. The change is one step with no fade,
  on purpose. When `afplay` ends or the script gets SIGTERM, it restores the volume (nudging it,
  because Spotify sometimes lands one below the requested value).
- **Feedback**: `showHUD`: "Reading…" when the command runs, "Stopped", or the error text.
- **Preferences**: Raycast has no slider or list preference types (only text field, password,
  checkbox, dropdown, and app, file and folder pickers). That is why the Spotify volume is a
  dropdown of fixed steps and the model list is a comma-separated text field. Speed applies from
  the next reading; it cannot change mid-reading.

## Why these defaults

Measured in November 2026 with one English and one Hebrew sentence:

- Flash v2.5 returns English in about 0.6 s. Eleven v4 Turbo takes about 1.5 s for English and
  1.1 s for Hebrew. Eleven v3 took about 2.5 s for Hebrew, costs double, and is limited to 5,000
  characters. Flash and v4 Turbo cost the same.
- Flash v2.5 lists 32 languages, without Hebrew; v4 Turbo lists 94.
- Jev answered the model-choice question correctly for 33 of 33 short samples (16 that Flash
  supports, 17 that it does not, including single foreign words inside English and languages that
  share an alphabet with supported ones), with a median of 228 ms. A local library (`franc`) plus
  a writing-system check got 26, misreading short and technical English.

## Testing without a hotkey

```
open -g 'raycast://extensions/eran_knafo/read-aloud/read-selection?context=%7B%22text%22%3A%22A%20test%20sentence.%22%7D'
```

The first time, Raycast asks the person at the Mac to confirm ("Request to run Read Selection").
`state.json` then shows the model used and whether the cache was hit. With Spotify lowering on,
`osascript -e 'tell application "Spotify" to get sound volume'` shows the lowered volume while it
reads and the original afterwards.

Running the link without `context` stops a reading only while one is certainly still playing.
Otherwise it starts a new reading of whatever is selected on screen.

`play.sh` can be run directly: `bash raycast/assets/play.sh <file.mp3> <speed> <percent> <here|always>`.

## Verified and not verified

Verified by running it: build and install; reading text passed by deeplink; stop; the model
choice for English, Hebrew, mixed and Thai text; the cache (1.1 s fresh, 0.2 s cached) and its
trimming; the Spotify cases for off, playing on this Mac, and paused.

Not verified: Spotify playing on another device (that `plays_here` is false then, and that the
desktop app's volume controls the other device); the Spotify checkboxes switched on through
Raycast's settings; macOS versions older than 26; Intel Macs.

## Known limitations

- Playback starts when all the audio has arrived, so a long selection starts after a few seconds.
- Only the Spotify desktop app is controlled, not the web player.
- macOS asks once whether Raycast may control Spotify.
