# Read Aloud

Select text in any app, run **Read Selection**, and it is read out loud with an ElevenLabs voice.
Run it again to stop. Give the command a hotkey in Raycast and it becomes a one-key "read this to
me".

- **Any language your models support.** You list ElevenLabs models in order, fastest first. For
  each reading, the first model that supports every language in the text is used; the last one is
  the catch-all. With the default list, English is read by Flash v2.5 and languages it lacks, such
  as Hebrew, by Eleven v4 Turbo.
- **Speed.** From 1× to 2×.
- **Repeat for free.** The most recent readings are kept on your Mac, so reading the same
  selection again starts at once and uses no credits.
- **Spotify, if you want.** Optionally lowers the Spotify desktop app while reading and restores
  it afterwards.

## Setup

1. Create an ElevenLabs API key at <https://elevenlabs.io/app/settings/api-keys> that may
   use text to speech and, if you list more than one model, read the model list (`models_read`). Raycast
   asks for it the first time you run the command.
2. Optional, for the per-language model choice: a TypeSafe API key, entered in the extension's
   settings. The choice is made by [Jev](https://docs.typesafe.ai), TypeSafe's decision model.
   Without this key, the first model in your list is always used.
3. Optional: give **Read Selection** a hotkey in Raycast Settings → Extensions → Read Aloud.

## Settings

| Setting | What it does |
| --- | --- |
| ElevenLabs API Key | Required. |
| Speed | 1× to 2×. Applies from the next reading. |
| Voice | One of ElevenLabs' standard voices. |
| Spotify | Lower Spotify's volume while reading. Off by default. |
| Spotify Volume While Reading | How loud Spotify stays, as a share of its current volume. |
| Spotify on Another Device | Also lower it when Spotify is not producing sound on this Mac. |
| Models, in Order | ElevenLabs model IDs separated by commas, fastest first. |
| TypeSafe API Key | Optional; enables the per-language model choice. |
| Readings to Keep | How many recent readings are kept for instant replay. 0 turns this off. |

## What leaves your Mac

Only the text that is selected at the moment you run the command, and only then:

- It is sent to **ElevenLabs** to be turned into speech.
- If you entered a TypeSafe API key and listed more than one model, it is also sent to
  **TypeSafe** to decide which model to use.

A reading that is already kept on your Mac is played without sending anything. Nothing is sent to
anyone else, and the extension collects no analytics.

## Good to know

- Playback starts once the whole audio has arrived, so a long selection takes a few seconds.
- Each new reading uses ElevenLabs credits.
- Only the Spotify desktop app is controlled. macOS asks once whether Raycast may control it.
