declare module 'opencc-js' {
  // Minimal surface we use: a Simplified→Traditional converter factory.
  export function Converter(opts: { from: string; to: string }): (text: string) => string
}
