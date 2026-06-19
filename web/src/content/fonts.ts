// A distinct dialogue font for a FEW characters whose voice genuinely suits it — used sparingly so it stays
// special. Keyed by family; most shapes use the default UI font.
export const SPEAKER_FONT: Record<string, string> = {
  dodecahedron: 'Georgia, "Times New Roman", serif', // Dodi — formal, classical register
  klein_quartic: 'Georgia, "Times New Roman", serif', // Sette — the 168-fold choir, musical/classical
  tesseract: 'ui-monospace, "Courier New", monospace', // Tess — 4D geometric precision
  cell_16: 'ui-monospace, "Courier New", monospace', // Hex — the precise, humming angel
  lorenz: 'ui-monospace, "Courier New", monospace', // Lorrie — deterministic chaos, computational
}

export const fontOf = (family: string): string | undefined => SPEAKER_FONT[family]
