import { environment, getPreferenceValues, getSelectedText, LaunchProps, showHUD } from "@raycast/api";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Preferences = {
  apiKey: string;
  speed: string;
  voiceId: string;
  lowerSpotify: boolean;
  spotifyVolume: string;
  lowerSpotifyElsewhere: boolean;
  models: string;
  typesafeApiKey?: string;
  cacheSize: string;
};

/**
 * What is going on right now, kept in a file because every key press runs this command afresh.
 * `pid` is the player once the voice has started; before that the audio is still being fetched.
 */
type State = { token: string; startedAt: number; pid?: number; model?: string; cached?: boolean };

const statePath = join(environment.supportPath, "state.json");
const playerScript = join(environment.assetsPath, "play.sh");
const cacheFolder = join(environment.supportPath, "cache");
const languagesPath = join(environment.supportPath, "model-languages.json");

function readState(): State | undefined {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return undefined;
  }
}

function writeState(state: State) {
  mkdirSync(environment.supportPath, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state));
}

function clearState() {
  rmSync(statePath, { force: true });
}

/** True if `pid` is still our player, not some other process that reused the number. */
function isOurPlayer(pid: number): boolean {
  try {
    return execFileSync("/bin/ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).includes(playerScript);
  } catch {
    return false;
  }
}

/** Stops whatever is being read or fetched. Returns false if nothing was. */
function stopReading(): boolean {
  const state = readState();
  if (!state) return false;
  clearState();
  if (state.pid) {
    if (!isOurPlayer(state.pid)) return false; // it finished by itself earlier
    process.kill(state.pid, "SIGTERM");
    return true;
  }
  // No player yet: a fetch is under way unless that command died. It sees its token is gone and gives up.
  return Date.now() - state.startedAt < 60_000;
}

/** The human-readable part of an error response from ElevenLabs or TypeSafe. */
async function errorMessage(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body);
    return parsed.detail?.message ?? parsed.error?.message ?? parsed.message ?? body.slice(0, 120);
  } catch {
    return body.slice(0, 120);
  }
}

/** Model ID to the names of the languages it speaks, as ElevenLabs reports them. Refreshed weekly. */
async function modelLanguages(key: string): Promise<Record<string, string[]>> {
  type Cache = { fetchedAt: number; languages: Record<string, string[]> };
  let cache: Cache | undefined;
  try {
    cache = JSON.parse(readFileSync(languagesPath, "utf8"));
  } catch {
    // no cache yet
  }
  if (cache && Date.now() - cache.fetchedAt < 7 * 24 * 3600 * 1000) return cache.languages;
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/models", {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${await errorMessage(response)}`);
    const models = (await response.json()) as { model_id: string; languages?: { name: string }[] }[];
    const languages = Object.fromEntries(models.map((m) => [m.model_id, (m.languages ?? []).map((l) => l.name)]));
    mkdirSync(environment.supportPath, { recursive: true });
    writeFileSync(languagesPath, JSON.stringify({ fetchedAt: Date.now(), languages } satisfies Cache));
    return languages;
  } catch (error) {
    if (cache) return cache.languages; // an old list beats none
    throw error;
  }
}

/**
 * Picks the first model in the user's list that speaks every language in the text, by asking Jev
 * (TypeSafe's decision model) one yes/no question per model. The last model is the catch-all and is
 * not asked about. If the question cannot be asked, the first model is used and `problem` says why.
 */
async function chooseModel(
  text: string,
  elevenLabsKey: string,
  preferences: Preferences,
): Promise<{ model: string; problem?: string }> {
  const models = preferences.models
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length === 0) return { model: "eleven_flash_v2_5", problem: "no models are set" };
  if (models.length === 1) return { model: models[0] };

  const typesafeKey = preferences.typesafeApiKey?.trim();
  if (!typesafeKey) return { model: models[0], problem: "no TypeSafe API key" };
  try {
    const languages = await modelLanguages(elevenLabsKey);
    const candidates = models.slice(0, -1).filter((m) => languages[m]?.length);
    if (candidates.length === 0) return { model: models[models.length - 1] };
    const questions = Object.fromEntries(
      candidates.map((m) => [
        m,
        {
          type: "noul",
          instructions:
            "Is every word of this text written in one of these languages? " +
            `Numbers, punctuation, code and names do not count. Languages: ${languages[m].join(", ")}.`,
        },
      ]),
    );
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${typesafeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", state: text, questions }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Jev ${response.status}: ${await errorMessage(response)}`);
    const { answers } = (await response.json()) as { answers: Record<string, { noul: number }> };
    return { model: candidates.find((m) => answers[m]?.noul >= 0.5) ?? models[models.length - 1] };
  } catch (error) {
    return { model: models[0], problem: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchSpeech(text: string, key: string, model: string, preferences: Preferences): Promise<Buffer> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${preferences.voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: model }),
    },
  );
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${await errorMessage(response)}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Where the audio for this text is kept, so reading the same selection again costs nothing and
 * starts at once. Voice and model list are part of the name; speed is not, it is applied on playback.
 */
function cachePath(text: string, preferences: Preferences): string {
  const name = createHash("sha256")
    .update(JSON.stringify([text, preferences.voiceId, preferences.models]))
    .digest("hex");
  return join(cacheFolder, `${name}.mp3`);
}

/** Deletes all but the `keep` most recently played readings. */
function trimCache(keep: number) {
  const files = readdirSync(cacheFolder)
    .map((name) => join(cacheFolder, name))
    .map((path) => ({ path, playedAt: statSync(path).mtimeMs }))
    .sort((a, b) => b.playedAt - a.playedAt);
  for (const { path } of files.slice(keep)) rmSync(path, { force: true });
}

export default async function Command(props: LaunchProps<{ launchContext?: { text?: string } }>) {
  if (stopReading()) {
    await showHUD("Stopped");
    return;
  }

  const preferences = getPreferenceValues<Preferences>();

  // `launchContext.text` lets a deeplink pass the text, which is how this is tested without a selection.
  let text = props.launchContext?.text;
  if (!text) {
    try {
      text = await getSelectedText();
    } catch {
      text = undefined;
    }
  }
  if (!text?.trim()) {
    await showHUD("Read Aloud: no text is selected");
    return;
  }

  const audioPath = cachePath(text, preferences);
  const wanted = Number.parseInt(preferences.cacheSize, 10);
  const cacheSize = Number.isNaN(wanted) ? 10 : Math.max(0, wanted);
  const cached = cacheSize > 0 && existsSync(audioPath);
  const key = preferences.apiKey.trim();

  const token = randomUUID();
  writeState({ token, startedAt: Date.now() });
  const hud = showHUD("Reading…");

  let model: string | undefined;
  let notice: string | undefined;
  if (cached) {
    utimesSync(audioPath, new Date(), new Date()); // mark it as just played
  } else {
    try {
      const choice = await chooseModel(text, key, preferences);
      model = choice.model;
      if (choice.problem) notice = `Reading with ${model}. Language check failed: ${choice.problem}`;
      const audio = await fetchSpeech(text, key, model, preferences);
      // Saved even if the reading was stopped meanwhile: it is paid for, and may be asked for again.
      mkdirSync(cacheFolder, { recursive: true });
      writeFileSync(audioPath, audio);
      trimCache(Math.max(1, cacheSize)); // the file about to be played always stays
    } catch (error) {
      await hud;
      if (readState()?.token === token) {
        clearState();
        await showHUD(`Read Aloud: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
  }
  await hud;
  if (readState()?.token !== token) return; // stopped while the audio was on its way

  // 100 tells the player to leave Spotify alone.
  const keep = preferences.lowerSpotify
    ? Math.min(100, Math.max(0, Math.round(Number(preferences.spotifyVolume)) || 0))
    : 100;
  const when = preferences.lowerSpotifyElsewhere ? "always" : "here";
  const player = spawn("/bin/bash", [playerScript, audioPath, preferences.speed, String(keep), when], {
    detached: true,
    stdio: "ignore",
  });
  player.unref();
  writeState({ token, startedAt: Date.now(), pid: player.pid, model, cached });
  if (notice) await showHUD(notice);
}
