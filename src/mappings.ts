// Language definitions — the same reference catalog users see in the
// macOS LangIDE. These are read-only on the web (user-added mappings can
// be layered on top; see app state in main.ts).

export type MappingCategory =
  | 'types'
  | 'functions'
  | 'control'
  | 'operators'
  | 'statements'
  | 'math'
  | 'io'
  | 'other';

export interface LanguageMapping {
  id: string;
  customSyntax: string;
  equivalentSyntax: string;
  category: MappingCategory;
  description: string;
  isDefault: boolean;
}

export const CATEGORY_LABELS: Record<MappingCategory, string> = {
  types: 'Types',
  functions: 'Functions',
  control: 'Control Flow',
  operators: 'Operators',
  statements: 'Statements',
  math: 'Math',
  io: 'I/O',
  other: 'Other',
};

const DEF = (
  id: string,
  customSyntax: string,
  equivalentSyntax: string,
  category: MappingCategory,
  description: string
): LanguageMapping => ({ id, customSyntax, equivalentSyntax, category, description, isDefault: true });

export const DEFAULT_MAPPINGS: LanguageMapping[] = [
  // Types
  DEF('t-number', 'number NAME is VALUE',         'int NAME = VALUE',        'types', 'Integer variable'),
  DEF('t-decimal', 'decimal NAME is VALUE',       'float NAME = VALUE',      'types', 'Floating-point variable'),
  DEF('t-double', 'precise decimal NAME is VALUE','double NAME = VALUE',     'types', 'Double-precision float'),
  DEF('t-string', 'talking NAME quotes TEXT ends quote', 'string NAME = "TEXT"', 'types', 'String variable'),
  DEF('t-truth',  'truth NAME is yes/no',         'bool NAME = true/false',  'types', 'Boolean variable'),

  // Functions
  DEF('f-task',   'task NAME does ... done',              'int NAME() { ... }',       'functions', 'Function definition'),
  DEF('f-taking', 'task NAME taking TYPE A and TYPE B does ... done', 'TYPE NAME(TYPE A, TYPE B) { ... }', 'functions', 'Function with parameters'),
  DEF('f-gives',  'task NAME ... gives TYPE does ... done','TYPE NAME(...) { ... }',  'functions', 'Explicit return type'),
  DEF('f-call',   'call NAME with ARG and ARG',           'NAME(ARG, ARG)',           'functions', 'Function call'),
  DEF('f-return', 'give back VALUE',                       'return VALUE',             'functions', 'Return a value'),

  // Control flow
  DEF('c-if',     'if COND then ... done',                 'if (COND) { ... }',        'control', 'Conditional'),
  DEF('c-elif',   'or if COND then ... done',              '} else if (COND) { ... }', 'control', 'Else-if branch'),
  DEF('c-else',   'otherwise ... done',                    '} else { ... }',           'control', 'Else branch'),
  DEF('c-while',  'repeat while COND do ... done',         'while (COND) { ... }',     'control', 'While loop'),
  DEF('c-until',  'repeat until COND do ... done',         'while (!(COND)) { ... }',  'control', 'Until loop'),
  DEF('c-for',    'repeat for i from A to B do ... done',  'for (int i = A; i < B; i++) { ... }', 'control', 'For loop'),
  DEF('c-times',  'repeat N times do ... done',            'for (int _i = 0; _i < N; _i++) { ... }', 'control', 'Repeat N times'),
  DEF('c-count',  'count from A to B do ... done',         'for (int _c = A; _c < B; _c++) { ... }', 'control', 'Implicit counter loop'),
  DEF('c-break',  'stop loop',                             'break',                    'control', 'Break out of loop'),
  DEF('c-cont',   'skip to next',                          'continue',                 'control', 'Skip to next iteration'),

  // Operators
  DEF('o-plus',   'plus',            '+',        'operators', 'Add'),
  DEF('o-minus',  'minus',           '-',        'operators', 'Subtract'),
  DEF('o-times',  'times',           '*',        'operators', 'Multiply'),
  DEF('o-div',    'divided by',      '/',        'operators', 'Divide'),
  DEF('o-mod',    'modulo / mod',    '%',        'operators', 'Remainder'),
  DEF('o-eq',     'is equal to / equals', '==',  'operators', 'Equality'),
  DEF('o-neq',    'is not equal to / not equals', '!=', 'operators', 'Not equal'),
  DEF('o-gt',     'greater than',    '>',        'operators', 'Greater than'),
  DEF('o-lt',     'less than',       '<',        'operators', 'Less than'),
  DEF('o-gte',    'at least',        '>=',       'operators', 'Greater or equal'),
  DEF('o-lte',    'at most',         '<=',       'operators', 'Less or equal'),
  DEF('o-and',    'and also',        '&&',       'operators', 'Logical AND'),
  DEF('o-or',     'or else',         '||',       'operators', 'Logical OR'),
  DEF('o-band',   'bitwise and',     '&',        'operators', 'Bitwise AND'),
  DEF('o-bor',    'bitwise or',      '|',        'operators', 'Bitwise OR'),
  DEF('o-bxor',   'bitwise xor',     '^',        'operators', 'Bitwise XOR'),
  DEF('o-bnot',   'bitwise not',     '~',        'operators', 'Bitwise NOT'),
  DEF('o-shl',    'shift left',      '<<',       'operators', 'Shift left'),
  DEF('o-shr',    'shift right',     '>>',       'operators', 'Shift right'),

  // Statements
  DEF('s-show',   'show X',                               'print X',        'statements', 'Print an expression'),
  DEF('s-showq',  'show quotes TEXT ends quote',           'print "TEXT"',   'statements', 'Print a literal string'),
  DEF('s-tell',   'tell me X',                             'print X',        'statements', 'Print alias'),
  DEF('s-say',    'say X',                                 'print X',        'statements', 'Print alias'),
  DEF('s-disp',   'display X',                             'print X',        'statements', 'Print alias'),
  DEF('s-make',   'make X be VALUE',                       'X = VALUE',      'statements', 'Assignment'),
  DEF('s-inc',    'increase X',                            'X = X + 1',      'statements', 'Increment'),
  DEF('s-dec',    'decrease X',                            'X = X - 1',      'statements', 'Decrement'),
  DEF('s-rem',    'remember X as VALUE',                   'int X = VALUE',  'statements', 'Variable declaration alias'),
  DEF('s-exit',   'stop everything / quit',                'exit(0)',        'statements', 'Immediate exit'),
  DEF('s-wait',   'wait for N seconds',                    'sleep(N)',       'statements', 'Pause'),
  DEF('s-clear',  'clear screen',                          'system("clear")', 'statements', 'Clear terminal'),

  // Math
  DEF('m-sqrt',   'square root of X',                     'sqrt(X)',        'math', 'Square root'),
  DEF('m-pow',    'X to the power of Y',                  'pow(X, Y)',      'math', 'Exponent'),
  DEF('m-abs',    'absolute value of X',                  'abs(X)',         'math', 'Absolute value'),
  DEF('m-round',  'rounded X',                            'round(X)',       'math', 'Nearest integer'),
  DEF('m-rup',    'rounded up X',                         'ceil(X)',        'math', 'Ceiling'),
  DEF('m-rdn',    'rounded down X',                       'floor(X)',       'math', 'Floor'),
  DEF('m-sin',    'sine of X',                            'sin(X)',         'math', 'Sine'),
  DEF('m-cos',    'cosine of X',                          'cos(X)',         'math', 'Cosine'),
  DEF('m-tan',    'tangent of X',                         'tan(X)',         'math', 'Tangent'),
  DEF('m-log',    'logarithm of X',                       'log(X)',         'math', 'Natural log'),
  DEF('m-max',    'maximum of A and B / bigger of A and B','max(A, B)',     'math', 'Larger of two'),
  DEF('m-min',    'minimum of A and B / smaller of A and B','min(A, B)',    'math', 'Smaller of two'),

  // I/O
  DEF('i-ask',    'ask for X',                             'scanf("%d", &X)', 'io', 'Read a number from stdin'),
  DEF('i-read',   'read number into X',                    'scanf("%d", &X)', 'io', 'Read a number from stdin'),
  DEF('i-rand',   'random number',                          'rand()',          'io', 'Random integer'),
  DEF('i-seed',   'seed random with current time',          'srand(time(NULL))', 'io', 'Seed RNG'),
];
