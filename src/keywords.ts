// Every English phrase the runtime understands, with a one-line hint.
// The editor's autocomplete lists these as you type.

export interface Keyword { phrase: string; hint: string; }

export const KEYWORDS: Keyword[] = [
  // Structure
  { phrase: 'task',               hint: 'start a function: task NAME does … done' },
  { phrase: 'taking',             hint: 'parameters: taking number a and number b' },
  { phrase: 'gives',              hint: 'return type: gives number' },
  { phrase: 'does',               hint: 'opens a task body' },
  { phrase: 'done',               hint: 'closes a block' },
  { phrase: 'call',               hint: 'run a task: call NAME with X and Y' },
  { phrase: 'with',               hint: 'arguments after call' },
  { phrase: 'give back',          hint: 'return a value' },
  { phrase: 'note:',              hint: 'a comment to the end of the line' },

  // Types and variables
  { phrase: 'number',             hint: 'whole number: number x is 10' },
  { phrase: 'decimal',            hint: 'number with a fraction: decimal x is 2.5' },
  { phrase: 'precise decimal',    hint: 'double-precision decimal' },
  { phrase: 'truth',              hint: 'yes or no: truth ok is yes' },
  { phrase: 'talking',            hint: 'text: talking name is "Jaden"' },
  { phrase: 'remember',           hint: 'remember score as 42' },
  { phrase: 'make',               hint: 'change a variable: make x be x plus 1' },
  { phrase: 'increase',           hint: 'add one: increase x' },
  { phrase: 'decrease',           hint: 'subtract one: decrease x' },
  { phrase: 'is',                 hint: 'sets the starting value' },
  { phrase: 'be',                 hint: 'the new value after make' },
  { phrase: 'as',                 hint: 'the value after remember' },

  // Printing
  { phrase: 'show',               hint: 'print a value or text' },
  { phrase: 'show quotes',        hint: 'print text: show quotes Hi ends quote' },
  { phrase: 'tell me',            hint: 'same as show' },
  { phrase: 'say',                hint: 'same as show' },
  { phrase: 'display',            hint: 'same as show' },
  { phrase: 'print',              hint: 'same as show' },
  { phrase: 'quotes',             hint: 'starts text, ends with: ends quote' },
  { phrase: 'ends quote',         hint: 'closes text started by quotes' },

  // Conditions
  { phrase: 'if',                 hint: 'if COND then … done' },
  { phrase: 'then',               hint: 'after an if condition' },
  { phrase: 'or if',              hint: 'another condition to try' },
  { phrase: 'otherwise',          hint: 'when no condition matched' },

  // Loops
  { phrase: 'repeat while',       hint: 'loop while a condition holds' },
  { phrase: 'repeat until',       hint: 'loop until a condition holds' },
  { phrase: 'repeat for',         hint: 'repeat for i from 0 to 5 do … done' },
  { phrase: 'repeat',             hint: 'repeat 5 times do … done' },
  { phrase: 'times do',           hint: 'after a repeat count' },
  { phrase: 'keep going while',   hint: 'same as repeat while' },
  { phrase: 'count from',         hint: 'count from 1 to 5 do … done' },
  { phrase: 'loop forever do',    hint: 'loop until stop loop' },
  { phrase: 'do',                 hint: 'opens a loop body' },
  { phrase: 'from',               hint: 'loop start value' },
  { phrase: 'to',                 hint: 'loop end value (not included)' },
  { phrase: 'stop loop',          hint: 'leave the loop' },
  { phrase: 'skip to next',       hint: 'jump to the next pass' },
  { phrase: 'skip ahead',         hint: 'same as skip to next' },
  { phrase: 'stop everything',    hint: 'end the program' },
  { phrase: 'exit program',       hint: 'end the program' },
  { phrase: 'quit',               hint: 'end the program' },

  // Arithmetic
  { phrase: 'plus',               hint: '+' },
  { phrase: 'minus',              hint: '-' },
  { phrase: 'times',              hint: '* (or a repeat count)' },
  { phrase: 'divided by',         hint: '/' },
  { phrase: 'modulo',             hint: '% remainder' },
  { phrase: 'to the power of',    hint: 'exponent: 2 to the power of 8' },

  // Comparisons and logic
  { phrase: 'equals',             hint: '==' },
  { phrase: 'is equal to',        hint: '==' },
  { phrase: 'is not equal to',    hint: '!=' },
  { phrase: 'not equals',         hint: '!=' },
  { phrase: 'greater than',       hint: '>' },
  { phrase: 'less than',          hint: '<' },
  { phrase: 'greater than or equal to', hint: '>=' },
  { phrase: 'less than or equal to',    hint: '<=' },
  { phrase: 'at least',           hint: '>=' },
  { phrase: 'at most',            hint: '<=' },
  { phrase: 'and also',           hint: 'both must hold (&&)' },
  { phrase: 'or else',            hint: 'either may hold (||)' },
  { phrase: 'yes',                hint: 'true' },
  { phrase: 'no',                 hint: 'false' },

  // Bits
  { phrase: 'bitwise and',        hint: '&' },
  { phrase: 'bitwise or',         hint: '|' },
  { phrase: 'bitwise xor',        hint: '^' },
  { phrase: 'bitwise not',        hint: '~' },
  { phrase: 'shift left',         hint: '<<' },
  { phrase: 'shift right',        hint: '>>' },

  // Math
  { phrase: 'square root of',     hint: 'sqrt' },
  { phrase: 'absolute value of',  hint: 'abs' },
  { phrase: 'rounded',            hint: 'nearest whole number' },
  { phrase: 'rounded up',         hint: 'ceil' },
  { phrase: 'rounded down',       hint: 'floor' },
  { phrase: 'sine of',            hint: 'sin' },
  { phrase: 'cosine of',          hint: 'cos' },
  { phrase: 'tangent of',         hint: 'tan' },
  { phrase: 'logarithm of',       hint: 'natural log' },
  { phrase: 'maximum of',         hint: 'maximum of A and B' },
  { phrase: 'minimum of',         hint: 'minimum of A and B' },
  { phrase: 'bigger of',          hint: 'same as maximum of' },
  { phrase: 'smaller of',         hint: 'same as minimum of' },
];

// Single words that are part of the language, so the autocomplete doesn't
// offer them again as variable names
export const KEYWORD_WORDS = new Set(KEYWORDS.flatMap(k => k.phrase.replace(':', '').split(' ')));
