declare module "opentype.js" {
  interface Glyph {
    advanceWidth?: number;
  }
  interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    charToGlyph(ch: string): Glyph | undefined;
  }
  function parse(buffer: ArrayBuffer): Font;
  export default { parse };
  export { parse, Font, Glyph };
}
