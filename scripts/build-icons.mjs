import sharp from "sharp";

const outputs = [
  { size: 16, source: "assets/icons/icon16-source.svg" },
  { size: 48, source: "assets/icons/icon.svg" },
  { size: 128, source: "assets/icons/icon.svg" },
];

await Promise.all(outputs.map(({ size, source }) =>
  sharp(source)
    .resize(size, size)
    .png()
    .toFile(`assets/icons/icon${size}.png`)
));
