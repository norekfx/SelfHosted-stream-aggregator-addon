import { parseStreamMetadata } from "./parse-stream-metadata.js";

const examples = [
  "Movie.2024.2160p.WEB-DL.MULTi.POLISH.LEKTOR.PL.HEVC-GROUP",
  "Movie.2024.1080p.BluRay.DTS-HD.MA.5.1.PL.SUBBED-GROUP",
  "Movie.2024.720p.WEBRip.x264.NAPISY.PL-GROUP",
  "Movie.2024.1080p.WEB-DL.DUBBING.PL.H264-GROUP",
  "Movie.2024.480p.HDRip.XviD-Group",
  "Movie.2024.4K.BluRay.AV1.MULTi-Group"
];

for (const example of examples) {
  console.log(JSON.stringify(parseStreamMetadata({ title: example }), null, 2));
}
