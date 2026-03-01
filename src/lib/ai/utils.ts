/**
 * AI Utilities for generation control and loop detection
 */

/**
 * Detects if the generated text is stuck in a loop.
 * Checks for repeating patterns of at least minLength.
 */
export function detectLoop(text: string): boolean {
  // Clean up whitespace to make detection more robust
  const cleanText = text.replace(/\s+/g, ' ').trim();
  const words = cleanText.split(' ').filter(w => w.length > 0);
  
  if (words.length < 3) return false;

  // 1. Detect single word repeated 3 or more times consecutively
  // e.g. "hola hola hola"
  // We check from the end to detect loops as they happen
  for (let i = words.length - 1; i >= 2; i--) {
    const w1 = words[i].toLowerCase();
    const w2 = words[i-1].toLowerCase();
    const w3 = words[i-2].toLowerCase();
    
    // Si la palabra tiene menos de 2 letras (ej. "y", "o", "a"), pedimos 4 repeticiones para estar seguros
    if (w1 === w2 && w1 === w3) {
      if (w1.length < 2 && i >= 3 && words[i-3].toLowerCase() === w1) {
        console.warn(`[Loop Detection] Short word repeated 4 times: "${words[i]}"`);
        return true;
      } else if (w1.length >= 2) {
        console.warn(`[Loop Detection] Word repeated 3 times: "${words[i]}"`);
        return true;
      }
    }
  }

  // 2. Detect sequence of words repeated 3 times
  // e.g., "yo soy tonto yo soy tonto yo soy tonto"
  const maxSeqLen = Math.floor(words.length / 3);
  for (let seqLen = 1; seqLen <= Math.min(maxSeqLen, 20); seqLen++) {
    // Check from the end of the text
    const end = words.length;
    const seq1 = words.slice(end - seqLen, end).join(' ').toLowerCase();
    const seq2 = words.slice(end - seqLen * 2, end - seqLen).join(' ').toLowerCase();
    const seq3 = words.slice(end - seqLen * 3, end - seqLen * 2).join(' ').toLowerCase();

    if (seq1 === seq2 && seq1 === seq3) {
      console.warn(`[Loop Detection] Word sequence repeated: "${seq1}"`);
      return true;
    }
  }

  return false;
}
