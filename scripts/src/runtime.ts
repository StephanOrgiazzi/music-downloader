import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ffmpegPath from "ffmpeg-static";
import YTDlpWrapModule from "yt-dlp-wrap";

type YTDlpWrapStatic = {
  downloadFromGithub: (filePath?: string, version?: string, platform?: NodeJS.Platform) => Promise<void>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "../..");
const runtimeDir = path.join(skillRoot, ".runtime");
const ytDlpPath = path.join(runtimeDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

export function resolveSkillPath(...segments: string[]): string {
  return path.join(skillRoot, ...segments);
}

function resolveYtDlpWrap(): YTDlpWrapStatic {
  const moduleValue = YTDlpWrapModule as unknown as {
    downloadFromGithub?: YTDlpWrapStatic["downloadFromGithub"];
    default?: YTDlpWrapStatic | { downloadFromGithub?: YTDlpWrapStatic["downloadFromGithub"] };
  };
  const candidate =
    (typeof moduleValue.downloadFromGithub === "function" ? moduleValue : undefined) ??
    (typeof moduleValue.default?.downloadFromGithub === "function" ? moduleValue.default : undefined);

  if (!candidate?.downloadFromGithub) {
    throw new Error("Could not resolve yt-dlp-wrap.");
  }

  return candidate as YTDlpWrapStatic;
}

export async function refreshYtDlpBinary(): Promise<string> {
  await fs.mkdir(runtimeDir, { recursive: true });
  await resolveYtDlpWrap().downloadFromGithub(ytDlpPath);
  return ytDlpPath;
}

export function resolveFfmpegPath(): string {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not provide a binary for this platform.");
  }
  return String(ffmpegPath);
}
