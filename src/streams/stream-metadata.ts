export type NormalizedQuality =
  | "4k"
  | "2160p"
  | "1440p"
  | "1080p"
  | "720p"
  | "576p"
  | "480p"
  | "360p"
  | "240p"
  | "144p"
  | "unknown";

export type ReleaseSource =
  | "BluRay"
  | "WEB-DL"
  | "WEBRip"
  | "HDRip"
  | "DVDRip"
  | "HDTV"
  | "CAM"
  | "TS"
  | "TC"
  | "unknown";

export type VideoCodec = "AV1" | "HEVC" | "H264" | "XVID" | "MPEG2" | "unknown";
export type AudioCodec = "AAC" | "AC3" | "EAC3" | "DTS" | "TrueHD" | "FLAC" | "MP3" | "Opus" | "Vorbis" | "PCM" | "unknown";

export type AudioKind = "original" | "lektor" | "dubbing" | "subbed" | "multi" | "unknown";

export type NormalizedStreamMetadata = {
  quality: NormalizedQuality;
  source: ReleaseSource;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec;
  audioLanguage?: string;
  subtitleLanguage?: string;
  audioKind: AudioKind;
  isMultiLanguage: boolean;
  releaseGroup?: string;
  size?: string;
  rawText: string;
  matchedTokens: string[];
};
